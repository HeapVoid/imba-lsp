import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Hover,
  Location,
  MarkupKind,
  Range,
  TextEdit,
  type WorkspaceEdit,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildTypeScriptDefinitionLocations,
  buildTypeScriptHover,
  buildTypeScriptReferenceLocations,
  buildTypeScriptRenameLocations,
} from "./typescript-navigation";
import type { ImbaCompilation } from "./compiler";
import { buildCssHover } from "./imba-css";

type SymbolKind = "class" | "tag" | "method" | "property" | "field" | "local";

interface TokenAtPosition {
  name: string;
  range: Range;
  startOffset: number;
  endOffset: number;
}

interface NavigationSymbol {
  name: string;
  kind: SymbolKind;
  range: Range;
  line: number;
  indent: number;
  containerName: string | null;
  declaration: string;
  documentation?: string;
  typeName?: string;
}

interface NavigationIndex {
  symbols: NavigationSymbol[];
  byName: Map<string, NavigationSymbol[]>;
  membersByContainer: Map<string, Map<string, NavigationSymbol[]>>;
}

interface StackEntry {
  indent: number;
  symbol: NavigationSymbol;
}

const declarationPattern =
  /^(\t*)((?:export\s+)?(?:static\s+)?(?:extend\s+)?(?:local\s+)?(?:global\s+)?)(class|tag|def|get|set|prop|attr)\s+(@?[$A-Za-z_][\w$:-]*(?:\.[\w$-]+)?)/;
const fieldPattern = /^(\t+)([$A-Za-z_][\w$?!-]*)\s*=/;
const typedLocalPattern =
  /^(\t*)(?:(?:let|const|var)\s+)?([$A-Za-z_][\w$?!-]*)\s*=\s*new\s+([$A-Za-z_][\w$:-]*)/;
const memberBasePattern =
  /([$A-Za-z_][\w$?!-]*(?:(?:\.|\?\.)[$A-Za-z_][\w$?!-]*)*)\s*(?:\.|\?\.)\s*$/;
const wordCharacterPattern = /[$A-Za-z_0-9?!:-]/;
const renameNamePattern = /^@?[$A-Za-z_][\w$?!-]*$/;

export function buildDefinitionLocations(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Location[] {
  const token = tokenAtPosition(document, position);
  if (!token) {
    return buildTypeScriptDefinitionLocations(document, position, sourcePath, compilation);
  }

  const localLocations = resolveSymbols(document, position, token).map((symbol) =>
    Location.create(document.uri, symbol.range),
  );
  if (localLocations.length > 0) return localLocations;

  return buildTypeScriptDefinitionLocations(document, position, sourcePath, compilation);
}

export function buildHover(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Hover | null {
  const cssHover = buildCssHover(document, position, sourcePath);
  if (cssHover) return cssHover;

  const token = tokenAtPosition(document, position);
  if (!token) return buildTypeScriptHover(document, position, sourcePath, compilation);

  const symbol = resolveSymbols(document, position, token)[0];
  if (!symbol) return buildTypeScriptHover(document, position, sourcePath, compilation);

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: hoverMarkdown(symbol),
    },
    range: token.range,
  };
}

export function buildReferenceLocations(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
  includeDeclaration: boolean,
): Location[] {
  const typeScriptLocations = buildTypeScriptReferenceLocations(
    document,
    position,
    sourcePath,
    compilation,
    includeDeclaration,
  );
  if (typeScriptLocations.length > 0) return typeScriptLocations;

  const token = tokenAtPosition(document, position);
  if (!token) return [];

  return localReferenceLocations(document, position, token, includeDeclaration);
}

export function prepareRename(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): { placeholder: string; range: Range } | null {
  const token = tokenAtPosition(document, position);
  if (!token) return null;

  const locations = renameLocations(document, position, sourcePath, compilation, token);
  if (locations.length === 0) return null;
  if (!allLocationsMatchName(document, locations, token.name)) return null;

  return {
    placeholder: token.name,
    range: token.range,
  };
}

export function buildRenameEdit(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
  newName: string,
): WorkspaceEdit | null {
  if (!renameNamePattern.test(newName)) return null;

  const token = tokenAtPosition(document, position);
  if (!token) return null;

  const locations = renameLocations(document, position, sourcePath, compilation, token);
  if (locations.length === 0) return null;
  if (!allLocationsMatchName(document, locations, token.name)) return null;

  const changes: NonNullable<WorkspaceEdit["changes"]> = {};
  for (const location of locations) {
    if (!location.uri.endsWith(".imba")) return null;

    const edits = changes[location.uri] ?? [];
    edits.push(TextEdit.replace(location.range, newName));
    changes[location.uri] = edits;
  }

  return { changes };
}

function resolveSymbols(
  document: TextDocument,
  position: Position,
  token: TokenAtPosition,
): NavigationSymbol[] {
  const source = document.getText();
  const index = buildNavigationIndex(document);
  const memberBase = memberBaseBefore(source, token.startOffset);

  if (memberBase) {
    return resolveMember(index, source, position, memberBase, token.name);
  }

  const currentContainer = enclosingContainer(index, source, position);
  if (currentContainer) {
    const memberSymbols = index.membersByContainer.get(currentContainer.name)?.get(token.name) ?? [];
    if (memberSymbols.length > 0) return memberSymbols;
  }

  return index.byName.get(token.name) ?? [];
}

function renameLocations(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
  token: TokenAtPosition,
): Location[] {
  const typeScriptLocations = buildTypeScriptRenameLocations(
    document,
    position,
    sourcePath,
    compilation,
  );
  if (typeScriptLocations.length > 0) return typeScriptLocations;

  return localReferenceLocations(document, position, token, true);
}

function localReferenceLocations(
  document: TextDocument,
  position: Position,
  token: TokenAtPosition,
  includeDeclaration: boolean,
): Location[] {
  const symbols = resolveSymbols(document, position, token);
  if (symbols.length === 0) return [];

  const ranges = localReferenceRanges(document.getText(), symbols, token.name, includeDeclaration);
  return ranges.map((range) => Location.create(document.uri, range));
}

function localReferenceRanges(
  source: string,
  symbols: NavigationSymbol[],
  name: string,
  includeDeclaration: boolean,
): Range[] {
  const declarationKeys = new Set(
    symbols.map((symbol) =>
      `${symbol.range.start.line}:${symbol.range.start.character}`
    ),
  );
  const ranges: Range[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (offset < source.length) {
    const index = source.indexOf(name, offset);
    if (index === -1) break;

    const end = index + name.length;
    offset = end;

    if (isWordCharacter(source[index - 1]) || isWordCharacter(source[end])) continue;

    const range = Range.create(positionAtOffset(source, index), positionAtOffset(source, end));
    const key = `${range.start.line}:${range.start.character}`;
    const isDeclaration = declarationKeys.has(key);
    if (!includeDeclaration && isDeclaration) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    ranges.push(range);
  }

  return ranges;
}

function resolveMember(
  index: NavigationIndex,
  source: string,
  position: Position,
  baseExpression: string,
  memberName: string,
): NavigationSymbol[] {
  const rootName = baseExpression.split(/\.|\?\./)[0] ?? "";

  if (rootName === "self" || rootName === "this") {
    const currentContainer = enclosingContainer(index, source, position);
    return currentContainer
      ? index.membersByContainer.get(currentContainer.name)?.get(memberName) ?? []
      : [];
  }

  const localType = nearestTypedLocal(index, rootName, position.line)?.typeName;
  if (localType) {
    const typedMembers = index.membersByContainer.get(localType)?.get(memberName) ?? [];
    if (typedMembers.length > 0) return typedMembers;
  }

  return index.membersByContainer.get(rootName)?.get(memberName) ?? [];
}

function nearestTypedLocal(
  index: NavigationIndex,
  name: string,
  line: number,
): NavigationSymbol | null {
  const symbols = index.byName.get(name) ?? [];
  let nearest: NavigationSymbol | null = null;

  for (const symbol of symbols) {
    if (!symbol.typeName || symbol.line > line) continue;
    if (!nearest || symbol.line >= nearest.line) {
      nearest = symbol;
    }
  }

  return nearest;
}

function enclosingContainer(
  index: NavigationIndex,
  source: string,
  position: Position,
): NavigationSymbol | null {
  const lineText = source.split("\n")[position.line] ?? "";
  const currentIndent = indentOf(lineText);
  let current: NavigationSymbol | null = null;

  for (const symbol of index.symbols) {
    if (symbol.line >= position.line) continue;
    if (symbol.kind !== "class" && symbol.kind !== "tag") continue;
    if (symbol.indent >= currentIndent) continue;
    if (!current || symbol.line > current.line || symbol.indent > current.indent) {
      current = symbol;
    }
  }

  return current;
}

function buildNavigationIndex(document: TextDocument): NavigationIndex {
  const source = document.getText();
  const lines = source.split("\n");
  const symbols: NavigationSymbol[] = [];
  const stack: StackEntry[] = [];

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? "";
    if (!text.trim()) continue;

    const indent = indentOf(text);
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const declarationMatch = text.match(declarationPattern);
    if (declarationMatch) {
      const keyword = declarationMatch[3] ?? "";
      const name = declarationMatch[4] ?? "";
      const character = declarationMatch[0].length - name.length;
      const container = nearestContainer(stack);
      const symbol = addSymbol(symbols, {
        name,
        kind: declarationKind(keyword),
        range: Range.create(line, character, line, character + name.length),
        line,
        indent,
        containerName:
          keyword === "class" || keyword === "tag" ? null : container?.name ?? null,
        declaration: text.trim(),
        documentation: documentationBeforeLine(lines, line),
      });

      stack.push({ indent, symbol });
      continue;
    }

    const fieldMatch = text.match(fieldPattern);
    const container = nearestContainer(stack);
    if (fieldMatch && container) {
      const name = fieldMatch[2] ?? "";
      const character = fieldMatch[0].indexOf(name);
      addSymbol(symbols, {
        name,
        kind: "field",
        range: Range.create(line, character, line, character + name.length),
        line,
        indent,
        containerName: container.name,
        declaration: text.trim(),
        documentation: documentationBeforeLine(lines, line),
      });
    }

    const typedLocalMatch = text.match(typedLocalPattern);
    if (typedLocalMatch) {
      const name = typedLocalMatch[2] ?? "";
      const typeName = typedLocalMatch[3] ?? "";
      const character = typedLocalMatch[0].indexOf(name);
      addSymbol(symbols, {
        name,
        kind: "local",
        range: Range.create(line, character, line, character + name.length),
        line,
        indent,
        containerName: container?.name ?? null,
        declaration: text.trim(),
        documentation: documentationBeforeLine(lines, line),
        typeName,
      });
    }
  }

  const byName = new Map<string, NavigationSymbol[]>();
  const membersByContainer = new Map<string, Map<string, NavigationSymbol[]>>();

  for (const symbol of symbols) {
    pushMap(byName, symbol.name, symbol);

    if (symbol.containerName) {
      let members = membersByContainer.get(symbol.containerName);
      if (!members) {
        members = new Map();
        membersByContainer.set(symbol.containerName, members);
      }

      pushMap(members, symbol.name, symbol);
    }
  }

  return { symbols, byName, membersByContainer };
}

function addSymbol(
  symbols: NavigationSymbol[],
  symbol: NavigationSymbol,
): NavigationSymbol {
  symbols.push(symbol);
  return symbol;
}

function nearestContainer(stack: StackEntry[]): NavigationSymbol | null {
  for (let index = stack.length - 1; index >= 0; index--) {
    const symbol = stack[index].symbol;
    if (symbol.kind === "class" || symbol.kind === "tag") return symbol;
  }

  return null;
}

function pushMap(
  map: Map<string, NavigationSymbol[]>,
  key: string,
  symbol: NavigationSymbol,
): void {
  const items = map.get(key);
  if (items) {
    items.push(symbol);
  } else {
    map.set(key, [symbol]);
  }
}

function tokenAtPosition(
  document: TextDocument,
  position: Position,
): TokenAtPosition | null {
  const source = document.getText();
  let offset = document.offsetAt(position);

  if (!isWordCharacter(source[offset]) && offset > 0 && isWordCharacter(source[offset - 1])) {
    offset--;
  }

  if (!isWordCharacter(source[offset])) return null;

  let start = offset;
  while (start > 0 && isWordCharacter(source[start - 1])) {
    start--;
  }

  let end = offset;
  while (end < source.length && isWordCharacter(source[end])) {
    end++;
  }

  const name = source.slice(start, end);
  if (!/^@?[$A-Za-z_]/.test(name)) return null;

  return {
    name,
    range: Range.create(document.positionAt(start), document.positionAt(end)),
    startOffset: start,
    endOffset: end,
  };
}

function memberBaseBefore(source: string, offset: number): string | null {
  const before = source.slice(0, offset);
  const match = before.match(memberBasePattern);
  return match?.[1] ?? null;
}

function isWordCharacter(value: string | undefined): boolean {
  return typeof value === "string" && wordCharacterPattern.test(value);
}

function indentOf(line: string): number {
  return line.match(/^\t*/)?.[0].length ?? 0;
}

function declarationKind(keyword: string): SymbolKind {
  switch (keyword) {
    case "class":
      return "class";
    case "tag":
      return "tag";
    case "def":
    case "get":
    case "set":
      return "method";
    case "prop":
    case "attr":
      return "property";
    default:
      return "local";
  }
}

function hoverMarkdown(symbol: NavigationSymbol): string {
  const name = symbol.containerName
    ? `${symbol.containerName}.${symbol.name}`
    : symbol.name;
  const typeSuffix = symbol.typeName ? `: ${symbol.typeName}` : "";

  return [
    `Imba ${symbol.kind} \`${name}${typeSuffix}\``,
    symbol.documentation,
    "```imba",
    symbol.declaration,
    "```",
  ].filter(Boolean).join("\n\n");
}

function documentationBeforeLine(lines: string[], line: number): string | undefined {
  const comments: string[] = [];

  for (let index = line - 1; index >= 0; index--) {
    const text = lines[index] ?? "";
    const match = text.match(/^\t*#\s?(.*)$/);
    if (!match) break;

    comments.unshift(match[1] ?? "");
  }

  const documentation = comments.join("\n").trim();
  return documentation || undefined;
}

function allLocationsMatchName(
  document: TextDocument,
  locations: Location[],
  name: string,
): boolean {
  if (locations.length === 0) return false;

  for (const location of locations) {
    if (!location.uri.endsWith(".imba")) return false;
    if (textForLocation(document, location) !== name) return false;
  }

  return true;
}

function textForLocation(document: TextDocument, location: Location): string | null {
  let source: string;
  if (location.uri === document.uri) {
    source = document.getText();
  } else {
    try {
      source = fs.readFileSync(fileURLToPath(location.uri), "utf8");
    } catch {
      return null;
    }
  }

  const start = offsetAtPosition(source, location.range.start);
  const end = offsetAtPosition(source, location.range.end);
  return source.slice(start, end);
}

function positionAtOffset(source: string, offset: number): Position {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

function offsetAtPosition(source: string, position: Position): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let line = 0; line < position.line; line++) {
    offset += (lines[line] ?? "").length + 1;
  }

  return offset + position.character;
}
