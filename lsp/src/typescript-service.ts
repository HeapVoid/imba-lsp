import * as ts from "typescript";

export function createTypeScriptLanguageService(
  fileName: string,
  source: string,
): ts.LanguageService {
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    target: ts.ScriptTarget.ES2022,
  };

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "0",
    getScriptSnapshot: (requestedFile) => {
      const text = requestedFile === fileName ? source : readSystemFile(requestedFile);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    fileExists: (requestedFile) => requestedFile === fileName || ts.sys.fileExists(requestedFile),
    readFile: (requestedFile) => {
      if (requestedFile === fileName) return source;
      return ts.sys.readFile(requestedFile);
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  return ts.createLanguageService(host);
}

function readSystemFile(fileName: string): string | undefined {
  if (!ts.sys.fileExists(fileName)) return undefined;
  return ts.sys.readFile(fileName);
}
