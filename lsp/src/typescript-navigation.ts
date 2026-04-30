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
import { createTypeScriptLanguageService } from "./typescript-service";

interface ExpressionContext {
  expression: string;
  targetOffset: number;
  tokenRange: Range;
}

const expressionPattern = /^[$A-Za-z_][\w$]*(?:(?:\.|\?\.)[$A-Za-z_][\w$]*)*$/;

export function buildTypeScriptHover(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
): Hover | null {
  const context = expressionContextAt(document, position);
  if (!context) return null;

  const probe = createExpressionProbe(context, sourcePath);
  const service = createTypeScriptLanguageService(probe.fileName, probe.source);
  const quickInfo = service.getQuickInfoAtPosition(probe.fileName, probe.offset);
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
): Location[] {
  const context = expressionContextAt(document, position);
  if (!context) return [];

  const probe = createExpressionProbe(context, sourcePath);
  const service = createTypeScriptLanguageService(probe.fileName, probe.source);
  const definitions = service.getDefinitionAtPosition(probe.fileName, probe.offset) ?? [];
  const locations: Location[] = [];
  const seen = new Set<string>();

  for (const definition of definitions) {
    if (definition.fileName === probe.fileName) continue;

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
): { fileName: string; offset: number; source: string } {
  const prefix = "const __imba_lsp_probe = ";
  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.ts-nav.js`;

  return {
    fileName,
    offset: prefix.length + context.targetOffset,
    source: `${prefix}${context.expression};\n`,
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
