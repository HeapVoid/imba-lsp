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
import { toImbaIdentifier, toJsIdentifier } from "./imba-identifiers";
import {
  generatedOffsetToSourceOffset,
  sourceOffsetToGeneratedOffset,
} from "./source-map";
import {
  createTypeScriptLanguageService,
  virtualImbaFileFor,
  type VirtualImbaFile,
} from "./typescript-service";

interface ExpressionContext {
  expression: string;
  targetOffset: number;
  tokenStartOffset: number;
  tokenRange: Range;
}

interface SourceRange {
  endOffset: number;
  startOffset: number;
}

interface ImbaDeclarationCandidate extends SourceRange {
  exported: boolean;
  name: string;
  topLevel: boolean;
}

interface CurrentVirtualImbaFile {
  fileName: string;
  virtualFile: VirtualImbaFile;
}

const imbaExpressionPattern =
  /^[$A-Za-z_][\w$?!-]*(?:(?:\.|\?\.)[$A-Za-z_][\w$?!-]*)*$/;

export function buildTypeScriptHover(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Hover | null {
  const context = expressionContextAt(document, position);
  if (!context) return null;

  return (
    getCompiledHover(document, context, sourcePath, compilation) ??
    getExpressionHover(context, sourcePath)
  );
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

export function buildTypeScriptReferenceLocations(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
  includeDeclaration: boolean,
): Location[] {
  const context = expressionContextAt(document, position);
  if (!context) return [];

  return getCompiledReferenceLocations(
    document,
    context,
    sourcePath,
    compilation,
    includeDeclaration,
  );
}

export function buildTypeScriptRenameLocations(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Location[] {
  const context = expressionContextAt(document, position);
  if (!context) return [];

  return getCompiledRenameLocations(document, context, sourcePath, compilation);
}

function getCompiledHover(
  document: TextDocument,
  context: ExpressionContext,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Hover | null {
  const generated = compilation?.js;
  if (!generated) return null;

  const mapping = sourceOffsetToGeneratedOffset(
    compilation,
    document.getText(),
    context.tokenStartOffset,
  );
  if (!mapping) return null;

  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated);
  return hoverFromTypeScriptService(service, fileName, mapping.offset, context.tokenRange);
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

function getCompiledReferenceLocations(
  document: TextDocument,
  context: ExpressionContext,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
  includeDeclaration: boolean,
): Location[] {
  const generated = compilation?.js;
  if (!generated || !sourcePath) return [];

  const source = document.getText();
  const mapping = sourceOffsetToGeneratedOffset(
    compilation,
    source,
    context.tokenStartOffset,
  );
  if (!mapping) return [];

  const fileName = `${sourcePath}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated);
  const symbols = service.findReferences(fileName, mapping.offset) ?? [];
  const entries = symbols.flatMap((symbol) =>
    symbol.references.filter((entry) => includeDeclaration || !entry.isDefinition)
  );

  return locationsForDocumentSpans(service, entries, {
    currentVirtualFile: {
      fileName,
      virtualFile: {
        compilation,
        source,
        sourcePath,
      },
    },
  });
}

function getCompiledRenameLocations(
  document: TextDocument,
  context: ExpressionContext,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Location[] {
  const generated = compilation?.js;
  if (!generated || !sourcePath) return [];

  const source = document.getText();
  const mapping = sourceOffsetToGeneratedOffset(
    compilation,
    source,
    context.tokenStartOffset,
  );
  if (!mapping) return [];

  const fileName = `${sourcePath}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated);
  const renameInfo = service.getRenameInfo(fileName, mapping.offset, {});
  if (!renameInfo.canRename) return [];

  const entries = service.findRenameLocations(fileName, mapping.offset, false, false, {}) ?? [];
  return locationsForDocumentSpans(service, entries, {
    currentVirtualFile: {
      fileName,
      virtualFile: {
        compilation,
        source,
        sourcePath,
      },
    },
  });
}

function getExpressionQuickInfo(
  context: ExpressionContext,
  sourcePath: string | null,
): ts.QuickInfo | undefined {
  const probe = createExpressionProbe(context, sourcePath);
  return probe.service.getQuickInfoAtPosition(probe.fileName, probe.offset);
}

function getExpressionHover(
  context: ExpressionContext,
  sourcePath: string | null,
): Hover | null {
  const quickInfo = getExpressionQuickInfo(context, sourcePath);
  if (!isUsefulQuickInfo(quickInfo)) return null;

  return hoverFromQuickInfo(quickInfo, context.tokenRange);
}

function isUsefulQuickInfo(quickInfo: ts.QuickInfo | undefined): boolean {
  const display = ts.displayPartsToString(quickInfo?.displayParts ?? []).trim();
  return Boolean(display && display !== "any" && !display.endsWith(": any"));
}

function hoverFromTypeScriptService(
  service: ts.LanguageService,
  fileName: string,
  offset: number,
  range: Range,
): Hover | null {
  const quickInfo = service.getQuickInfoAtPosition(fileName, offset);
  if (!quickInfo) return null;
  if (!isUsefulQuickInfo(quickInfo)) return null;

  const virtualHover = virtualImbaHover(service, fileName, offset, quickInfo);
  if (virtualHover) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: virtualHover,
      },
      range,
    };
  }

  return hoverFromQuickInfo(quickInfo, range);
}

function hoverFromQuickInfo(
  quickInfo: ts.QuickInfo | undefined,
  range: Range,
): Hover | null {
  const display = ts.displayPartsToString(quickInfo?.displayParts ?? []);
  if (!display) return null;

  const documentation = ts.displayPartsToString(quickInfo?.documentation ?? []);
  const value = hoverMarkdown(display, documentation);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value,
    },
    range,
  };
}

function virtualImbaHover(
  service: ts.LanguageService,
  fileName: string,
  offset: number,
  quickInfo: ts.QuickInfo,
): string | null {
  const definitions = service.getDefinitionAtPosition(fileName, offset) ?? [];

  for (const definition of definitions) {
    const virtualFile = virtualImbaFileFor(service, definition.fileName);
    if (!virtualFile) continue;

    const sourceRange = sourceRangeForVirtualImbaDefinition(virtualFile, definition) ??
      fallbackSourceRangeForVirtualImbaDefinition(virtualFile, definition);
    if (!sourceRange) continue;

    const declaration = declarationLineAtOffset(virtualFile.source, sourceRange.startOffset);
    if (!declaration) continue;

    const title = virtualImbaHoverTitle(definition, declaration);
    const sourceDocumentation = documentationBeforeOffset(virtualFile.source, sourceRange.startOffset);
    const display = ts.displayPartsToString(quickInfo.displayParts ?? []);
    const documentation = ts.displayPartsToString(quickInfo.documentation ?? []);

    return virtualImbaHoverMarkdown(
      title,
      declaration,
      display,
      [sourceDocumentation, documentation].filter(Boolean).join("\n\n"),
    );
  }

  return null;
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
  const expression = toJsMemberExpression(context.expression);
  const source = `${prefix}${expression};\n`;

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

  if (!imbaExpressionPattern.test(expression)) return null;

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
  return locationForDocumentSpan(service, definition, {
    fallbackDefinition: definition,
  });
}

function locationForVirtualImbaDefinition(
  virtualFile: VirtualImbaFile,
  definition: ts.DefinitionInfo,
): Location {
  const sourceRange = sourceRangeForVirtualImbaDefinition(virtualFile, definition) ??
    fallbackSourceRangeForVirtualImbaDefinition(virtualFile, definition);
  if (!sourceRange) {
    return Location.create(
      pathToFileURL(virtualFile.sourcePath).toString(),
      Range.create(0, 0, 0, 0),
    );
  }

  return Location.create(
    pathToFileURL(virtualFile.sourcePath).toString(),
    Range.create(
      positionForOffset(undefined, virtualFile.source, sourceRange.startOffset),
      positionForOffset(undefined, virtualFile.source, sourceRange.endOffset),
    ),
  );
}

function sourceRangeForVirtualImbaDefinition(
  virtualFile: VirtualImbaFile,
  definition: ts.DefinitionInfo,
): SourceRange | null {
  return sourceRangeForVirtualImbaTextSpan(virtualFile, definition.textSpan);
}

function sourceRangeForVirtualImbaTextSpan(
  virtualFile: VirtualImbaFile,
  textSpan: ts.TextSpan,
): SourceRange | null {
  const start = generatedOffsetToSourceOffset(
    virtualFile.compilation,
    virtualFile.source,
    textSpan.start,
  );
  const end = generatedOffsetToSourceOffset(
    virtualFile.compilation,
    virtualFile.source,
    textSpan.start + Math.max(textSpan.length - 1, 0),
  );
  if (!start || !end) return null;

  const startOffset = start.offset;
  const endOffset = Math.max(startOffset + 1, end.offset + 1);
  return { endOffset, startOffset };
}

function locationsForDocumentSpans(
  service: ts.LanguageService,
  spans: readonly ts.DocumentSpan[],
  options: {
    currentVirtualFile?: CurrentVirtualImbaFile;
  } = {},
): Location[] {
  const locations: Location[] = [];
  const seen = new Set<string>();

  for (const span of spans) {
    const location = locationForDocumentSpan(service, span, options);
    if (!location) continue;

    const key = [
      location.uri,
      location.range.start.line,
      location.range.start.character,
      location.range.end.line,
      location.range.end.character,
    ].join(":");
    if (seen.has(key)) continue;

    seen.add(key);
    locations.push(location);
  }

  return locations;
}

function locationForDocumentSpan(
  service: ts.LanguageService,
  span: ts.DocumentSpan,
  options: {
    currentVirtualFile?: CurrentVirtualImbaFile;
    fallbackDefinition?: ts.DefinitionInfo;
  } = {},
): Location | null {
  const virtualImbaFile = virtualImbaFileForDocumentSpan(service, span, options.currentVirtualFile);
  if (virtualImbaFile) {
    const sourceRange = sourceRangeForVirtualImbaTextSpan(virtualImbaFile, span.textSpan) ??
      (options.fallbackDefinition
        ? fallbackSourceRangeForVirtualImbaDefinition(virtualImbaFile, options.fallbackDefinition)
        : null);
    if (!sourceRange) return null;

    return Location.create(
      pathToFileURL(virtualImbaFile.sourcePath).toString(),
      Range.create(
        positionForOffset(undefined, virtualImbaFile.source, sourceRange.startOffset),
        positionForOffset(undefined, virtualImbaFile.source, sourceRange.endOffset),
      ),
    );
  }

  const sourceFile = service.getProgram()?.getSourceFile(span.fileName);
  const fileText = sourceFile?.getFullText() ?? ts.sys.readFile(span.fileName);
  if (!fileText) return null;

  const start = positionForOffset(sourceFile, fileText, span.textSpan.start);
  const end = positionForOffset(
    sourceFile,
    fileText,
    span.textSpan.start + span.textSpan.length,
  );

  return Location.create(
    pathToFileURL(span.fileName).toString(),
    Range.create(start.line, start.character, end.line, end.character),
  );
}

function virtualImbaFileForDocumentSpan(
  service: ts.LanguageService,
  span: ts.DocumentSpan,
  currentVirtualFile: CurrentVirtualImbaFile | undefined,
): VirtualImbaFile | undefined {
  if (currentVirtualFile?.fileName === span.fileName) {
    return currentVirtualFile.virtualFile;
  }

  return virtualImbaFileFor(service, span.fileName);
}

function fallbackSourceRangeForVirtualImbaDefinition(
  virtualFile: VirtualImbaFile,
  definition: ts.DefinitionInfo,
): SourceRange | null {
  const declarations = imbaDeclarationCandidates(virtualFile.source);
  if (declarations.length === 0) return null;

  const names = preferredImbaDefinitionNames(definition);
  for (const name of names) {
    const match = bestImbaDeclarationCandidate(
      declarations.filter((declaration) => declaration.name === name),
    );
    if (match) return match;
  }

  return bestImbaDeclarationCandidate(declarations);
}

function preferredImbaDefinitionNames(definition: ts.DefinitionInfo): string[] {
  const names = new Set<string>();

  for (const raw of [
    definition.name,
    qualifiedDefinitionName(definition),
  ]) {
    for (const name of imbaNameCandidates(raw)) {
      names.add(name);
    }
  }

  return [...names];
}

function imbaNameCandidates(raw: string | undefined): string[] {
  const value = toImbaIdentifier(raw ?? "");
  const parts = value.split(".");
  const candidates = [value, parts[parts.length - 1] ?? ""];

  return candidates.filter(isImbaIdentifierName);
}

function isImbaIdentifierName(value: string): boolean {
  return /^[@$A-Za-z_][\w$?!@-]*$/.test(value);
}

function imbaDeclarationCandidates(source: string): ImbaDeclarationCandidate[] {
  const candidates: ImbaDeclarationCandidate[] = [];
  let lineStart = 0;

  for (const line of source.split("\n")) {
    const declaration = imbaDeclarationCandidateForLine(line, lineStart);
    if (declaration) candidates.push(declaration);

    lineStart += line.length + 1;
  }

  return candidates;
}

function imbaDeclarationCandidateForLine(
  line: string,
  lineStart: number,
): ImbaDeclarationCandidate | null {
  const declarationMatch = line.match(
    /^(\t*)(?:(export)\s+)?(?:default\s+)?(?:class|tag|def|get|set|prop|attr)\s+([@$A-Za-z_][\w$?!@-]*)/,
  );
  if (declarationMatch) {
    return imbaDeclarationCandidateFromMatch(line, lineStart, declarationMatch);
  }

  const bindingMatch = line.match(
    /^(\t*)(?:(export)\s+)?(?:let|const|var)\s+([@$A-Za-z_][\w$?!@-]*)/,
  );
  if (bindingMatch) {
    return imbaDeclarationCandidateFromMatch(line, lineStart, bindingMatch);
  }

  const assignmentMatch = line.match(
    /^(\t*)(?:(export)\s+)?([@$A-Za-z_][\w$?!@-]*)\s*=/,
  );
  if (assignmentMatch) {
    return imbaDeclarationCandidateFromMatch(line, lineStart, assignmentMatch);
  }

  return null;
}

function imbaDeclarationCandidateFromMatch(
  line: string,
  lineStart: number,
  match: RegExpMatchArray,
): ImbaDeclarationCandidate | null {
  const indent = match[1] ?? "";
  const name = match[3] ?? match[2];
  if (!name) return null;

  const nameOffset = match[0].lastIndexOf(name);
  if (nameOffset === -1) return null;

  return {
    endOffset: lineStart + nameOffset + name.length,
    exported: Boolean(match[2]),
    name,
    startOffset: lineStart + nameOffset,
    topLevel: indent.length === 0,
  };
}

function bestImbaDeclarationCandidate(
  declarations: ImbaDeclarationCandidate[],
): ImbaDeclarationCandidate | null {
  return declarations.sort((left, right) =>
    imbaDeclarationRank(right) - imbaDeclarationRank(left) ||
    left.startOffset - right.startOffset
  )[0] ?? null;
}

function imbaDeclarationRank(declaration: ImbaDeclarationCandidate): number {
  if (declaration.topLevel && declaration.exported) return 4;
  if (declaration.topLevel) return 3;
  if (declaration.exported) return 2;
  return 1;
}

function declarationLineAtOffset(source: string, offset: number): string | null {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextLineStart = source.indexOf("\n", offset);
  const lineEnd = nextLineStart === -1 ? source.length : nextLineStart;
  const declaration = source.slice(lineStart, lineEnd).trim();

  return declaration || null;
}

function documentationBeforeOffset(source: string, offset: number): string {
  const linesBefore = source.slice(0, offset).split("\n");
  const comments: string[] = [];

  for (let index = linesBefore.length - 2; index >= 0; index--) {
    const text = linesBefore[index] ?? "";
    const match = text.match(/^\t*#\s?(.*)$/);
    if (!match) break;

    comments.unshift(match[1] ?? "");
  }

  return comments.join("\n").trim();
}

function virtualImbaHoverTitle(
  definition: ts.DefinitionInfo,
  declaration: string,
): string {
  const kind = imbaKindForDefinition(definition, declaration);
  const name = virtualImbaHoverName(definition, declaration);
  return `Imba ${kind} \`${name}\``;
}

function virtualImbaHoverName(
  definition: ts.DefinitionInfo,
  declaration: string,
): string {
  const declarationName = imbaDeclarationName(declaration);
  if (declarationName && /^(?:export\s+)?(?:default\s+)?(?:class|tag)\s/.test(declaration)) {
    return declarationName;
  }

  if (
    declarationName &&
    definition.containerName &&
    !definition.containerName.includes("/")
  ) {
    return `${toImbaIdentifier(definition.containerName)}.${declarationName}`;
  }

  return declarationName ?? toImbaIdentifier(qualifiedDefinitionName(definition));
}

function imbaDeclarationName(declaration: string): string | null {
  const match = declaration.match(
    /^(?:(?:export)\s+)?(?:default\s+)?(?:class|tag|def|get|set|prop|attr)\s+([@$A-Za-z_][\w$?!@-]*)/,
  ) ?? declaration.match(/^([@$A-Za-z_][\w$?!@-]*)\s*=/);

  return match?.[1] ?? null;
}

function imbaKindForDefinition(
  definition: ts.DefinitionInfo,
  declaration: string,
): string {
  if (/^(?:export\s+)?tag\s/.test(declaration)) return "tag";
  if (/^(?:export\s+)?class\s/.test(declaration)) return "class";
  if (/^(?:export\s+)?def\s/.test(declaration)) return "method";
  if (/^(?:export\s+)?get\s/.test(declaration)) return "getter";
  if (/^(?:export\s+)?set\s/.test(declaration)) return "setter";
  if (/=/.test(declaration) && definition.kind === ts.ScriptElementKind.memberVariableElement) {
    return "field";
  }

  return definition.kind || "symbol";
}

function qualifiedDefinitionName(definition: ts.DefinitionInfo): string {
  if (definition.containerName && !definition.containerName.includes("/")) {
    return `${definition.containerName}.${definition.name}`;
  }

  return definition.name;
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
    toImbaIdentifier(display),
    "```",
    documentation,
  ].filter(Boolean).join("\n\n");
}

function virtualImbaHoverMarkdown(
  title: string,
  declaration: string,
  display: string,
  documentation: string,
): string {
  return [
    title,
    `\`\`\`imba\n${declaration}\n\`\`\``,
    `\`\`\`ts\n${toImbaIdentifier(display)}\n\`\`\``,
    documentation,
  ].filter(Boolean).join("\n\n");
}

function isIdentifierStart(value: string | undefined): boolean {
  return typeof value === "string" && /[$A-Za-z_]/.test(value);
}

function isIdentifierPart(value: string | undefined): boolean {
  return typeof value === "string" && /[$A-Za-z_0-9?!-]/.test(value);
}

function toJsMemberExpression(expression: string): string {
  return expression
    .split(/(\?\.|\.)/)
    .map((part) => part === "." || part === "?." ? part : toJsIdentifier(part))
    .join("");
}
