import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  Hover,
  Location,
  MarkupKind,
  Range,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import * as ts from "typescript";
import type { ImbaCompilation } from "./compiler";
import { sourceOffsetToGeneratedOffset } from "./source-map";
import { createTypeScriptLanguageService } from "./typescript-service";

interface ExpressionContext {
  expression: string;
  targetOffset: number;
  tokenStartOffset: number;
  tokenRange: Range;
}

const expressionPattern = /^[$A-Za-z_][\w$]*(?:(?:\.|\?\.)[$A-Za-z_][\w$]*)*$/;

export function buildTypeScriptHover(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Hover | null {
  const context = expressionContextAt(document, position);
  if (!context) return null;

  const compiledQuickInfo = getCompiledQuickInfo(document, context, sourcePath, compilation);
  const quickInfo = isUsefulQuickInfo(compiledQuickInfo)
    ? compiledQuickInfo
    : getExpressionQuickInfo(context, sourcePath) ?? compiledQuickInfo;
  const display = ts.displayPartsToString(quickInfo?.displayParts ?? []);
  if (!display) return null;

  const documentation = ts.displayPartsToString(quickInfo?.documentation ?? []);
  const value = hoverMarkdown(display, documentation);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value,
    },
    range: context.tokenRange,
  };
}

export function buildTypeScriptDefinitionLocations(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Location[] {
  const context = expressionContextAt(document, position);
  if (!context) return [];

  const compiledDefinitions = getCompiledDefinitionLocations(
    document,
    context,
    sourcePath,
    compilation,
  );
  if (compiledDefinitions.length > 0) return compiledDefinitions;

  const probe = createExpressionProbe(context, sourcePath);
  const definitions = definitionLocations(probe.service, probe.fileName, probe.offset);

  return definitions;
}

function getCompiledQuickInfo(
  document: TextDocument,
  context: ExpressionContext,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): ts.QuickInfo | undefined {
  const generated = compilation?.js;
  if (!generated) return undefined;

  const mapping = sourceOffsetToGeneratedOffset(
    compilation,
    document.getText(),
    context.tokenStartOffset,
  );
  if (!mapping) return undefined;

  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated);
  return service.getQuickInfoAtPosition(fileName, mapping.offset);
}

function getCompiledDefinitionLocations(
  document: TextDocument,
  context: ExpressionContext,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Location[] {
  const generated = compilation?.js;
  if (!generated) return [];

  const mapping = sourceOffsetToGeneratedOffset(
    compilation,
    document.getText(),
    context.tokenStartOffset,
  );
  if (!mapping) return [];

  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated);
  return definitionLocations(service, fileName, mapping.offset);
}

function getExpressionQuickInfo(
  context: ExpressionContext,
  sourcePath: string | null,
): ts.QuickInfo | undefined {
  const probe = createExpressionProbe(context, sourcePath);
  return probe.service.getQuickInfoAtPosition(probe.fileName, probe.offset);
}

function isUsefulQuickInfo(quickInfo: ts.QuickInfo | undefined): boolean {
  const display = ts.displayPartsToString(quickInfo?.displayParts ?? []).trim();
  return Boolean(display && display !== "any" && !display.endsWith(": any"));
}

function definitionLocations(
  service: ts.LanguageService,
  fileName: string,
  offset: number,
): Location[] {
  const definitions = service.getDefinitionAtPosition(fileName, offset) ?? [];
  const locations: Location[] = [];
  const seen = new Set<string>();

  for (const definition of definitions) {
    if (definition.fileName === fileName) continue;

    const location = locationForDefinition(service, definition);
    if (!location) continue;

    const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
  }

  return locations;
}

function createExpressionProbe(
  context: ExpressionContext,
  sourcePath: string | null,
): { fileName: string; offset: number; service: ts.LanguageService; source: string } {
  const prefix = "const __imba_lsp_probe = ";
  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.ts-nav.js`;
  const source = `${prefix}${context.expression};\n`;

  return {
    fileName,
    offset: prefix.length + context.targetOffset,
    service: createTypeScriptLanguageService(fileName, source),
    source,
  };
}

function expressionContextAt(
  document: TextDocument,
  position: Position,
): ExpressionContext | null {
  const source = document.getText();
  let offset = document.offsetAt(position);

  if (!isIdentifierPart(source[offset]) && offset > 0 && isIdentifierPart(source[offset - 1])) {
    offset--;
  }

  if (!isIdentifierPart(source[offset])) return null;

  const tokenStart = scanIdentifierStart(source, offset);
  const tokenEnd = scanIdentifierEnd(source, offset + 1);
  const expressionStart = scanExpressionStart(source, tokenStart);
  const expressionEnd = scanExpressionEnd(source, tokenEnd);
  const expression = source.slice(expressionStart, expressionEnd);

  if (!expressionPattern.test(expression)) return null;

  return {
    expression,
    targetOffset: tokenStart - expressionStart,
    tokenStartOffset: tokenStart,
    tokenRange: Range.create(document.positionAt(tokenStart), document.positionAt(tokenEnd)),
  };
}

function scanExpressionStart(source: string, tokenStart: number): number {
  let start = tokenStart;

  while (start > 0) {
    let separatorStart = start - 1;
    if (source[separatorStart] !== ".") break;
    if (separatorStart > 0 && source[separatorStart - 1] === "?") {
      separatorStart--;
    }

    let wordStart = separatorStart;
    while (wordStart > 0 && isIdentifierPart(source[wordStart - 1])) {
      wordStart--;
    }

    if (wordStart === separatorStart || !isIdentifierStart(source[wordStart])) break;
    start = wordStart;
  }

  return start;
}

function scanExpressionEnd(source: string, tokenEnd: number): number {
  let end = tokenEnd;

  while (end < source.length) {
    let wordStart = -1;

    if (source[end] === ".") {
      wordStart = end + 1;
    } else if (source[end] === "?" && source[end + 1] === ".") {
      wordStart = end + 2;
    } else {
      break;
    }

    if (!isIdentifierStart(source[wordStart])) break;

    end = scanIdentifierEnd(source, wordStart + 1);
  }

  return end;
}

function scanIdentifierStart(source: string, offset: number): number {
  let start = offset;
  while (start > 0 && isIdentifierPart(source[start - 1])) {
    start--;
  }

  return start;
}

function scanIdentifierEnd(source: string, offset: number): number {
  let end = offset;
  while (end < source.length && isIdentifierPart(source[end])) {
    end++;
  }

  return end;
}

function locationForDefinition(
  service: ts.LanguageService,
  definition: ts.DefinitionInfo,
): Location | null {
  const sourceFile = service.getProgram()?.getSourceFile(definition.fileName);
  const fileText = sourceFile?.getFullText() ?? ts.sys.readFile(definition.fileName);
  if (!fileText) return null;

  const start = positionForOffset(sourceFile, fileText, definition.textSpan.start);
  const end = positionForOffset(
    sourceFile,
    fileText,
    definition.textSpan.start + definition.textSpan.length,
  );

  return Location.create(
    pathToFileURL(definition.fileName).toString(),
    Range.create(start.line, start.character, end.line, end.character),
  );
}

function positionForOffset(
  sourceFile: ts.SourceFile | undefined,
  fileText: string,
  offset: number,
): { line: number; character: number } {
  if (sourceFile) {
    return ts.getLineAndCharacterOfPosition(sourceFile, offset);
  }

  const prefix = fileText.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

function hoverMarkdown(display: string, documentation: string): string {
  return [
    "```ts",
    display,
    "```",
    documentation,
  ].filter(Boolean).join("\n\n");
}

function isIdentifierStart(value: string | undefined): boolean {
  return typeof value === "string" && /[$A-Za-z_]/.test(value);
}

function isIdentifierPart(value: string | undefined): boolean {
  return typeof value === "string" && /[$A-Za-z_0-9]/.test(value);
}
