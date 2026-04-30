import path from "node:path";
import * as ts from "typescript";
import { compileImba, type ImbaCompilation } from "./compiler";

export interface VirtualImbaFile {
  compilation: ImbaCompilation;
  source: string;
  sourcePath: string;
}

export interface TypeScriptLanguageServiceOptions {
  compilerOptions?: ts.CompilerOptions;
}

const virtualImbaFilesByService = new WeakMap<ts.LanguageService, Map<string, VirtualImbaFile>>();

export function createTypeScriptLanguageService(
  fileName: string,
  source: string,
  options: TypeScriptLanguageServiceOptions = {},
): ts.LanguageService {
  const project = projectConfigFor(fileName);
  const compilerOptions: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...project.compilerOptions,
    ...options.compilerOptions,
    allowJs: true,
  };
  const virtualFiles = new Map<string, string>([[fileName, source]]);
  const virtualImbaFiles = new Map<string, VirtualImbaFile>();
  const scriptFileNames = [
    fileName,
    ...project.fileNames.filter(
      (projectFile) => path.resolve(projectFile) !== path.resolve(fileName),
    ),
  ];

  const fileExists = (requestedFile: string): boolean =>
    virtualFiles.has(requestedFile) || ts.sys.fileExists(requestedFile);

  const readFile = (requestedFile: string): string | undefined =>
    virtualFiles.get(requestedFile) ?? ts.sys.readFile(requestedFile);

  const moduleResolutionHost: ts.ModuleResolutionHost = {
    directoryExists: ts.sys.directoryExists,
    fileExists,
    getCurrentDirectory: () => project.currentDirectory,
    getDirectories: ts.sys.getDirectories,
    readFile,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => project.currentDirectory,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => scriptFileNames,
    getScriptVersion: () => "0",
    getScriptSnapshot: (requestedFile) => {
      const text = readFile(requestedFile);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    fileExists,
    readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    resolveModuleNames: (moduleNames, containingFile) =>
      moduleNames.map((moduleName) =>
        resolveModuleName(
          moduleName,
          containingFile,
          compilerOptions,
          moduleResolutionHost,
          virtualFiles,
          virtualImbaFiles,
        ),
      ),
  };

  const service = ts.createLanguageService(host);
  virtualImbaFilesByService.set(service, virtualImbaFiles);
  return service;
}

export function virtualImbaFileFor(
  service: ts.LanguageService,
  fileName: string,
): VirtualImbaFile | undefined {
  return virtualImbaFilesByService.get(service)?.get(fileName);
}

export function virtualImbaFilesFor(
  service: ts.LanguageService,
): Array<[string, VirtualImbaFile]> {
  return [...(virtualImbaFilesByService.get(service)?.entries() ?? [])];
}

interface ProjectConfig {
  compilerOptions: ts.CompilerOptions;
  currentDirectory: string;
  fileNames: string[];
}

const defaultCompilerOptions: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
};

const projectConfigCache = new Map<string, ProjectConfig>();

function projectConfigFor(fileName: string): ProjectConfig {
  const startDirectory = path.dirname(path.resolve(fileName));
  const configPath = ts.findConfigFile(startDirectory, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    return {
      compilerOptions: {},
      currentDirectory: startDirectory,
      fileNames: [],
    };
  }

  const cached = projectConfigCache.get(configPath);
  if (cached) return cached;

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    return {
      compilerOptions: {},
      currentDirectory: path.dirname(configPath),
      fileNames: [],
    };
  }

  const currentDirectory = path.dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    currentDirectory,
    defaultCompilerOptions,
    configPath,
  );
  const project = {
    compilerOptions: parsed.options,
    currentDirectory,
    fileNames: parsed.fileNames,
  };

  projectConfigCache.set(configPath, project);
  return project;
}

function resolveImbaModule(
  moduleName: string,
  containingFile: string,
  virtualFiles: Map<string, string>,
  virtualImbaFiles: Map<string, VirtualImbaFile>,
): ts.ResolvedModuleFull | undefined {
  if (!moduleName.endsWith(".imba")) return undefined;

  const sourcePath = path.resolve(path.dirname(containingFile), moduleName);
  if (!ts.sys.fileExists(sourcePath)) return undefined;

  const virtualPath = `${sourcePath}.js`;
  if (!virtualFiles.has(virtualPath)) {
    const source = ts.sys.readFile(sourcePath);
    if (source === undefined) return undefined;

    const result = compileImba(source, sourcePath, {
      sourcemap: true,
    });
    const compilation = result.compilation;
    const js = compilation?.js;
    if (!compilation || !js) return undefined;

    virtualFiles.set(virtualPath, js);
    virtualImbaFiles.set(virtualPath, {
      compilation,
      source,
      sourcePath,
    });
  }

  return {
    extension: ts.Extension.Js,
    isExternalLibraryImport: false,
    resolvedFileName: virtualPath,
  };
}

function resolveModuleName(
  moduleName: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions,
  moduleResolutionHost: ts.ModuleResolutionHost,
  virtualFiles: Map<string, string>,
  virtualImbaFiles: Map<string, VirtualImbaFile>,
): ts.ResolvedModuleFull | undefined {
  const imbaModule = resolveImbaModule(
    moduleName,
    containingFile,
    virtualFiles,
    virtualImbaFiles,
  );
  if (imbaModule) return imbaModule;

  return ts.resolveModuleName(
    moduleName,
    containingFile,
    compilerOptions,
    moduleResolutionHost,
  ).resolvedModule;
}
