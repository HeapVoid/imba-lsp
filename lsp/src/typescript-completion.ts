import path from "node:path";
import {
  CompletionItemKind,
  type CompletionItem,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import * as ts from "typescript";
import { compileImba } from "./compiler";

const marker = "__imba_lsp_completion__";
const memberPattern = /(?:\.|\?\.)([$A-Za-z_][\w$?!-]*)?$/;
const memberExpressionPattern =
  /([$A-Za-z_][\w$]*(?:(?:\.|\?\.)[$A-Za-z_][\w$]*)*)(?:\.|\?\.)([$A-Za-z_][\w$?!-]*)?$/;
const wordPattern = /[$A-Za-z_0-9?!-]/;

export function buildTypeScriptCompletionItems(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
): CompletionItem[] {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const context = memberContext(source, offset);
  if (!context) return [];

  const syntheticSource = [
    source.slice(0, context.start),
    marker,
    source.slice(context.end),
  ].join("");

  const syntheticPath = sourcePath ?? path.join(process.cwd(), "untitled.imba");
  const result = compileImba(syntheticSource, syntheticPath, {
    sourcemap: true,
  });

  const js = result.compilation?.js;
  const compiledItems = js ? buildLanguageServiceCompletionItems(`${syntheticPath}.js`, js) : [];
  if (compiledItems.length > 0) return compiledItems;

  return buildDirectCompletionItems(source, offset, syntheticPath);
}

function buildDirectCompletionItems(
  source: string,
  offset: number,
  syntheticPath: string,
): CompletionItem[] {
  const before = source.slice(0, offset);
  const match = before.match(memberExpressionPattern);
  const expression = match?.[1];
  if (!expression) return [];

  const js = `const __imba_lsp_probe = ${expression}.${marker};\n`;
  return buildLanguageServiceCompletionItems(`${syntheticPath}.fallback.js`, js);
}

function buildLanguageServiceCompletionItems(jsPath: string, js: string): CompletionItem[] {
  const generatedOffset = js.indexOf(marker);
  if (generatedOffset < 0) return [];

  const service = createLanguageService(jsPath, js);
  const completions = service.getCompletionsAtPosition(jsPath, generatedOffset, {
    includeCompletionsForModuleExports: false,
    includeCompletionsWithInsertText: false,
  });

  if (!completions?.isMemberCompletion) return [];

  return completions.entries
    .filter((entry) => isUsefulEntry(entry))
    .map((entry) => ({
      label: entry.name,
      kind: completionKind(entry.kind),
      detail: "TypeScript",
      sortText: `05_ts_${entry.name}`,
    }));
}

function memberContext(source: string, offset: number): { start: number; end: number } | null {
  const before = source.slice(0, offset);
  const match = before.match(memberPattern);
  if (!match || match.index === undefined) return null;

  const prefix = match[1] ?? "";
  const start = offset - prefix.length;
  let end = offset;

  while (end < source.length && wordPattern.test(source[end] ?? "")) {
    end++;
  }

  return { start, end };
}

function createLanguageService(fileName: string, source: string): ts.LanguageService {
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

function isUsefulEntry(entry: ts.CompletionEntry): boolean {
  if (entry.kind === ts.ScriptElementKind.warning) return false;
  if (entry.name === marker) return false;
  if (entry.name.startsWith("__")) return false;
  return true;
}

function completionKind(kind: string): CompletionItemKind {
  switch (kind) {
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
      return CompletionItemKind.Method;
    case ts.ScriptElementKind.functionElement:
      return CompletionItemKind.Function;
    case ts.ScriptElementKind.classElement:
      return CompletionItemKind.Class;
    case ts.ScriptElementKind.constElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.variableElement:
      return CompletionItemKind.Variable;
    case ts.ScriptElementKind.memberVariableElement:
      return CompletionItemKind.Property;
    case ts.ScriptElementKind.moduleElement:
      return CompletionItemKind.Module;
    default:
      return CompletionItemKind.Property;
  }
}
