import path from "node:path";
import {
  CompletionItemKind,
  Range,
  TextEdit,
  type CompletionItem,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import * as ts from "typescript";
import { compileImba, type ImbaCompilation } from "./compiler";
import { isGeneratedInternalIdentifier, toImbaIdentifier } from "./imba-identifiers";
import { generatedOffsetToSourceOffset, sourceOffsetToGeneratedOffset } from "./source-map";
import { createTypeScriptLanguageService } from "./typescript-service";

const marker = "__imba_lsp_completion__";
const memberPattern = /(?:\.|\?\.)([$A-Za-z_][\w$?!-]*)?$/;
const memberExpressionPattern =
  /([$A-Za-z_][\w$]*(?:(?:\.|\?\.)[$A-Za-z_][\w$]*)*)(?:\.|\?\.)([$A-Za-z_][\w$?!-]*)?$/;
const wordPattern = /[$A-Za-z_0-9?!-]/;

export function buildTypeScriptCompletionItems(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): CompletionItem[] {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const context = memberContext(source, offset);
  if (!context) return [];

  const replacementRange = Range.create(
    document.positionAt(context.start),
    document.positionAt(context.end),
  );
  const typedPrefix = source.slice(context.start, offset);
  const syntheticSource = [
    source.slice(0, context.start),
    marker,
    source.slice(context.end),
  ].join("");

  const syntheticPath = sourcePath ?? path.join(process.cwd(), "untitled.imba");
  const mappedItems = buildMappedCompletionItems(
    document,
    source,
    position,
    syntheticPath,
    replacementRange,
    typedPrefix,
    compilation,
  );
  if (mappedItems.length > 0) return mappedItems;

  const result = compileImba(syntheticSource, syntheticPath, {
    sourcemap: true,
  });

  const js = result.compilation?.js;
  const compiledItems = js
    ? buildLanguageServiceCompletionItems(`${syntheticPath}.js`, js, {
      defaultRange: replacementRange,
      generatedOffset: js.indexOf(marker),
      typedPrefix,
    })
    : [];
  if (compiledItems.length > 0) return compiledItems;

  return buildDirectCompletionItems(source, offset, syntheticPath, replacementRange, typedPrefix);
}

function buildDirectCompletionItems(
  source: string,
  offset: number,
  syntheticPath: string,
  replacementRange: Range,
  typedPrefix: string,
): CompletionItem[] {
  const before = source.slice(0, offset);
  const match = before.match(memberExpressionPattern);
  const expression = match?.[1];
  if (!expression) return [];

  const js = `const __imba_lsp_probe = ${expression}.${marker};\n`;
  return buildLanguageServiceCompletionItems(`${syntheticPath}.fallback.js`, js, {
    defaultRange: replacementRange,
    generatedOffset: js.indexOf(marker),
    typedPrefix,
  });
}

interface LanguageServiceCompletionOptions {
  defaultRange: Range;
  document?: TextDocument;
  generatedOffset: number;
  mappedCompilation?: ImbaCompilation;
  source?: string;
  typedPrefix: string;
}

function buildMappedCompletionItems(
  document: TextDocument,
  source: string,
  position: Position,
  syntheticPath: string,
  replacementRange: Range,
  typedPrefix: string,
  compilation: ImbaCompilation | undefined,
): CompletionItem[] {
  const currentCompilation = compilation ?? compileImba(source, syntheticPath, {
    sourcemap: true,
  }).compilation;
  const generated = currentCompilation?.js;
  if (!generated) return [];

  const offset = document.offsetAt(position);
  const sourceOffset = offset > 0 ? offset - 1 : offset;
  const mapping = sourceOffsetToGeneratedOffset(currentCompilation, source, sourceOffset);
  if (!mapping) return [];

  return buildLanguageServiceCompletionItems(`${syntheticPath}.compiled.js`, generated, {
    defaultRange: replacementRange,
    document,
    generatedOffset: mapping.offset + 1,
    mappedCompilation: currentCompilation,
    source,
    typedPrefix,
  });
}

function buildLanguageServiceCompletionItems(
  jsPath: string,
  js: string,
  options: LanguageServiceCompletionOptions,
): CompletionItem[] {
  if (options.generatedOffset < 0) return [];

  const service = createTypeScriptLanguageService(jsPath, js);
  const completions = service.getCompletionsAtPosition(jsPath, options.generatedOffset, {
    includeCompletionsForModuleExports: false,
    includeCompletionsWithInsertText: false,
  });

  if (!completions?.isMemberCompletion) return [];

  return completions.entries
    .filter((entry) => isUsefulEntry(entry, options.typedPrefix))
    .map((entry) => {
      const label = toImbaIdentifier(entry.name);
      const newText = toImbaIdentifier(entry.insertText ?? entry.name);

      return {
        label,
        kind: completionKind(entry.kind),
        detail: "TypeScript",
        textEdit: TextEdit.replace(
          replacementRangeForEntry(entry, options),
          newText,
        ),
        sortText: `05_ts_${label}`,
      };
    });
}

function replacementRangeForEntry(
  entry: ts.CompletionEntry,
  options: LanguageServiceCompletionOptions,
): Range {
  const replacementSpan = entry.replacementSpan;
  if (!replacementSpan || !options.document || !options.mappedCompilation || !options.source) {
    return options.defaultRange;
  }

  const start = generatedOffsetToSourceOffset(
    options.mappedCompilation,
    options.source,
    replacementSpan.start,
  );
  const end = generatedOffsetToSourceOffset(
    options.mappedCompilation,
    options.source,
    replacementSpan.start + Math.max(replacementSpan.length - 1, 0),
  );
  if (!start || !end) return options.defaultRange;

  const startOffset = start.offset;
  const endOffset = Math.max(startOffset, end.offset + 1);
  return Range.create(
    options.document.positionAt(startOffset),
    options.document.positionAt(endOffset),
  );
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

function isUsefulEntry(entry: ts.CompletionEntry, typedPrefix: string): boolean {
  if (entry.kind === ts.ScriptElementKind.warning) return false;
  if (entry.name === marker) return false;
  if (isGeneratedInternalIdentifier(entry.name)) return false;
  if (isImbaRuntimeInternalCompletion(entry.name, typedPrefix)) return false;
  return true;
}

function isImbaRuntimeInternalCompletion(name: string, typedPrefix: string): boolean {
  if (isExplicitInternalPrefix(typedPrefix)) return false;
  return /^_/.test(name) || name.includes("$");
}

function isExplicitInternalPrefix(typedPrefix: string): boolean {
  return /[_$]/.test(typedPrefix);
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
