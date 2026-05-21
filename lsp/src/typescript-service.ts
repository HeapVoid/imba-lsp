import path from "node:path";
import * as ts from "typescript";
import { compileImba, type ImbaCompilation } from "./compiler";
import { imbaRuntimeTypingsFor } from "./imba-runtime-typings";

export interface VirtualImbaFile {
  compilation: ImbaCompilation;
  source: string;
  sourcePath: string;
}

export interface TypeScriptLanguageServiceOptions {
  configPath?: string | null;
  compilerOptions?: ts.CompilerOptions;
  currentDirectory?: string;
}

const virtualImbaFilesByService = new WeakMap<ts.LanguageService, Map<string, VirtualImbaFile>>();

export function createTypeScriptLanguageService(
  fileName: string,
  source: string,
  options: TypeScriptLanguageServiceOptions = {},
): ts.LanguageService {
  return createTypeScriptLanguageServiceForFiles(
    [{ fileName, source }],
    options,
  );
}

export interface TypeScriptServiceFile {
  fileName: string;
  source: string;
}

export function createTypeScriptLanguageServiceForFiles(
  files: TypeScriptServiceFile[],
  options: TypeScriptLanguageServiceOptions = {},
): ts.LanguageService {
  const primaryFileName = files[0]?.fileName ?? path.join(process.cwd(), "untitled.js");
  const project = projectConfigFor(primaryFileName, options);
  const compilerOptions: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...project.compilerOptions,
    ...options.compilerOptions,
    allowJs: true,
  };
  const imbaRuntimeTypings = imbaRuntimeTypingsFor(project.currentDirectory);
  const virtualFiles = new Map<string, string>(
    files.map((file) => [file.fileName, file.source]),
  );
  if (imbaRuntimeTypings) {
    virtualFiles.set(imbaRuntimeTypings.fileName, imbaRuntimeTypings.source);
  }
  const virtualImbaFiles = new Map<string, VirtualImbaFile>();
  const virtualFileNames = new Set(
    [...virtualFiles.keys()].map((file) => path.resolve(file)),
  );
  const scriptFileNames = [
    ...virtualFiles.keys(),
    ...project.fileNames.filter(
      (projectFile) =>
        isAmbientProjectFile(projectFile) &&
        !virtualFileNames.has(path.resolve(projectFile)) &&
        path.resolve(projectFile) !== path.resolve(imbaRuntimeTypings?.fileName ?? ""),
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

function projectConfigFor(
  fileName: string,
  options: TypeScriptLanguageServiceOptions = {},
): ProjectConfig {
  const startDirectory = path.resolve(
    options.currentDirectory ?? path.dirname(path.resolve(fileName)),
  );
  const configPath = options.configPath === undefined
    ? findProjectConfigPath(startDirectory)
    : options.configPath;
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

function isAmbientProjectFile(fileName: string): boolean {
  return /\.d\.[cm]?ts$/.test(fileName);
}

function findProjectConfigPath(startDirectory: string): string | null {
  let directory = path.resolve(startDirectory);

  while (true) {
    const tsconfigPath = path.join(directory, "tsconfig.json");
    if (ts.sys.fileExists(tsconfigPath)) return tsconfigPath;

    const jsconfigPath = path.join(directory, "jsconfig.json");
    if (ts.sys.fileExists(jsconfigPath)) return jsconfigPath;

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function resolveImbaModule(
  moduleName: string,
  containingFile: string,
  virtualFiles: Map<string, string>,
  virtualImbaFiles: Map<string, VirtualImbaFile>,
): ts.ResolvedModuleFull | undefined {
  const sourcePath = imbaSourcePathForModule(moduleName, containingFile);
  if (!sourcePath) return undefined;
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

function imbaSourcePathForModule(
  moduleName: string,
  containingFile: string,
): string | null {
  if (moduleName.endsWith(".imba")) {
    return path.resolve(path.dirname(containingFile), moduleName);
  }

  if (moduleName.endsWith(".js")) {
    return path.resolve(
      path.dirname(containingFile),
      `${moduleName.slice(0, -".js".length)}.imba`,
    );
  }

  return null;
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
