import { createRequire } from "node:module";
import path from "node:path";
import {
  DocumentSymbol,
  Range,
  SymbolKind,
  type SymbolKind as LspSymbolKind,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

interface ImbaProgram {
  ImbaDocument: new (
    uri: string,
    languageId: string,
    version: number,
    content: string,
  ) => ImbaProgramDocument;
}

interface ImbaProgramDocument {
  getOutline(): ImbaOutlineRoot;
}

interface ImbaOutlineRoot {
  children?: ImbaOutlineItem[];
}

interface ImbaOutlineItem {
  name?: unknown;
  kind?: unknown;
  span?: ImbaSpan;
  children?: ImbaOutlineItem[];
}

interface ImbaSpan {
  offset?: number;
  length?: number;
  start?: {
    line?: number;
    character?: number;
  };
  end?: {
    line?: number;
    character?: number;
  };
}

interface ScopedSymbol {
  indent: number;
  symbol: DocumentSymbol;
}

const fallbackRequire = createRequire(__filename);
const programCache = new Map<string, ImbaProgram>();

export function buildDocumentSymbols(document: TextDocument, sourcePath: string | null): DocumentSymbol[] {
  try {
    return buildNativeDocumentSymbols(document, sourcePath);
  } catch {
    return buildFallbackDocumentSymbols(document);
  }
}

function buildNativeDocumentSymbols(
  document: TextDocument,
  sourcePath: string | null,
): DocumentSymbol[] {
  const program = resolveImbaProgram(sourcePath);
  const imbaDocument = new program.ImbaDocument(
    document.uri,
    document.languageId || "imba",
    document.version,
    document.getText(),
  );

  const outline = imbaDocument.getOutline();
  return convertNativeItems(document, outline.children ?? []);
}

function resolveImbaProgram(sourcePath: string | null): ImbaProgram {
  const basePath = sourcePath ? path.dirname(sourcePath) : process.cwd();
  const cacheKey = sourcePath ? basePath : "__fallback__";
  const cached = programCache.get(cacheKey);
  if (cached) return cached;

  const localRequire = createRequire(path.join(basePath, "__imba_lsp_program_resolver__.js"));

  try {
    const program = localRequire("imba/program") as ImbaProgram;
    programCache.set(cacheKey, program);
    return program;
  } catch {
    const program = fallbackRequire("imba/program") as ImbaProgram;
    programCache.set(cacheKey, program);
    return program;
  }
}

function convertNativeItems(document: TextDocument, items: ImbaOutlineItem[]): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  for (const item of items) {
    const name = typeof item.name === "string" ? item.name : null;
    if (!name) continue;

    const selectionRange = nativeRange(document, item.span, name);
    const children = convertNativeItems(document, item.children ?? []);

    symbols.push(
      DocumentSymbol.create(
        name,
        undefined,
        nativeKind(item.kind),
        selectionRange,
        selectionRange,
        children,
      ),
    );
  }

  return symbols;
}

function buildFallbackDocumentSymbols(document: TextDocument): DocumentSymbol[] {
  const roots: DocumentSymbol[] = [];
  const stack: ScopedSymbol[] = [];
  const lines = document.getText().split(/\n/);

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    const match = text.match(
      /^(\t*)((?:export\s+)?(?:static\s+)?(?:extend\s+)?(?:local\s+)?(?:global\s+)?)(class|tag|def|get|set|prop|attr)\s+(@?[$A-Za-z_][\w$:-]*(?:\.[\w$-]+)?)/,
    );

    if (!match) continue;

    const indent = match[1].length;
    const keyword = match[3];
    const name = match[4];
    const start = match[0].length - name.length;
    const range = Range.create(line, start, line, start + name.length);
    const symbol = DocumentSymbol.create(name, undefined, fallbackKind(keyword), range, range, []);

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]?.symbol;
    if (parent) {
      parent.children ??= [];
      parent.children.push(symbol);
    } else {
      roots.push(symbol);
    }

    stack.push({ indent, symbol });
  }

  return roots;
}

function nativeRange(document: TextDocument, span: ImbaSpan | undefined, name: string): Range {
  if (span?.start && span.end) {
    const start = {
      line: numberOrZero(span.start.line),
      character: numberOrZero(span.start.character),
    };
    const end = {
      line: numberOrZero(span.end.line),
      character: numberOrZero(span.end.character),
    };

    if (end.line > start.line || end.character > start.character) {
      return Range.create(start, end);
    }
  }

  if (typeof span?.offset === "number") {
    const start = document.positionAt(span.offset);
    const length = typeof span.length === "number" && span.length > 0 ? span.length : name.length;
    const end = document.positionAt(span.offset + length);
    return Range.create(start, end);
  }

  return Range.create(0, 0, 0, Math.max(1, name.length));
}

function nativeKind(kind: unknown): LspSymbolKind {
  if (typeof kind === "number" && kind >= SymbolKind.File && kind <= SymbolKind.TypeParameter) {
    return kind as LspSymbolKind;
  }

  return SymbolKind.Variable;
}

function fallbackKind(keyword: string): LspSymbolKind {
  switch (keyword) {
    case "class":
    case "tag":
      return SymbolKind.Class;
    case "def":
    case "get":
    case "set":
      return SymbolKind.Method;
    case "prop":
    case "attr":
      return SymbolKind.Property;
    default:
      return SymbolKind.Variable;
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
