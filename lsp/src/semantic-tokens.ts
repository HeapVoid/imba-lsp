import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ImbaCompilation, ImbaToken } from "./compiler";

export const semanticTokenTypes = [
  // Standard LSP token types.
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",

  // Imba-specific token types styled by languages/imba/semantic_token_rules.json.
  "tag",
  "attribute",
  "cssProperty",
  "cssValue",
  "boolean",
  "constant",
  "selfKeyword",
] as const;

export const semanticTokenModifiers = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
] as const;

const tokenTypeIndex = new Map<string, number>(
  semanticTokenTypes.map((token, index) => [token, index]),
);

const keywordTokens = new Set([
  "AWAIT",
  "BEGIN",
  "BREAK",
  "CASE",
  "CATCH",
  "CLASS",
  "CONST",
  "CONTINUE",
  "CSS",
  "DEBUGGER",
  "DECLARE",
  "DEF",
  "DO",
  "ELIF",
  "ELSE",
  "EXPORT",
  "EXTEND",
  "FINALLY",
  "FOR",
  "FROM",
  "GET",
  "GLOBAL",
  "IF",
  "IMPORT",
  "LET",
  "LOCAL",
  "MODULE",
  "PROP",
  "RETURN",
  "SET",
  "STATIC",
  "TAG",
  "THROW",
  "TRY",
  "UNTIL",
  "VAR",
  "WHEN",
  "WHILE",
  "YIELD",
  "POST_IF",
  "FORIN",
]);

const operatorTokens = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "==",
  "===",
  "!=",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
  "?.",
  "BANG",
  "COMPOUND_ASSIGN",
  "COMPARE",
  "LOGIC",
  "MATH",
  "RELATION",
  "UNARY",
]);

const operatorValueTokens = new Set([
  ".",
  "..",
  "?.",
  ":",
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "?=",
  "||=",
  "&&=",
  "=?",
  "!",
]);

export function buildSemanticTokenData(
  document: TextDocument,
  compilation: ImbaCompilation | undefined,
): number[] {
  const tokens = compilation?.tokens ?? [];
  const items: SemanticItem[] = [];

  let previousType: string | null = null;

  for (const token of tokens) {
    const type = readTokenType(token);
    const value = readTokenValue(token);
    const span = readTokenSpan(token);

    if (!type || !span || span.start < 0 || span.end <= span.start) {
      previousType = type ?? previousType;
      continue;
    }

    const semanticType = classify(type, previousType);
    if (!semanticType) {
      previousType = type;
      continue;
    }

    const start = document.positionAt(span.start);
    const end = document.positionAt(span.end);

    // LSP semantic tokens cannot cross lines. Skip multiline compiler tokens
    // until we split strings/comments intentionally.
    if (start.line !== end.line) {
      previousType = type;
      continue;
    }

    const length = Math.max(1, value.length || end.character - start.character);

    items.push({
      line: start.line,
      character: start.character,
      length,
      typeIndex: tokenTypeIndex.get(semanticType) ?? tokenTypeIndex.get("variable") ?? 0,
      modifiers: modifierMask(type, previousType),
    });

    previousType = type;
  }

  return encodeSemanticTokens(items);
}

interface SemanticItem {
  line: number;
  character: number;
  length: number;
  typeIndex: number;
  modifiers: number;
}

function encodeSemanticTokens(items: SemanticItem[]): number[] {
  items.sort((a, b) => a.line - b.line || a.character - b.character);

  const data: number[] = [];
  let lastLine = 0;
  let lastCharacter = 0;

  for (const item of items) {
    const deltaLine = item.line - lastLine;
    const deltaStart = deltaLine === 0 ? item.character - lastCharacter : item.character;

    data.push(deltaLine, deltaStart, item.length, item.typeIndex, item.modifiers);

    lastLine = item.line;
    lastCharacter = item.character;
  }

  return data;
}

function classify(type: string, previousType: string | null): string | null {
  if (keywordTokens.has(type)) return "keyword";
  if (operatorTokens.has(type) || operatorValueTokens.has(type)) return "operator";

  if (type === "COMMENT" || type === "HERECOMMENT") return "comment";
  if (type === "STRING" || type === "NEOSTRING") return "string";
  if (type === "REGEX") return "regexp";
  if (type === "NUMBER" || type === "DIMENSION" || type === "PERCENTAGE") return "number";
  if (type === "DECORATOR") return "decorator";
  if (type === "TRUE" || type === "FALSE") return "boolean";
  if (type === "NULL") return "constant";
  if (type === "SELF" || type === "THIS") return "selfKeyword";

  if (type === "COLOR" || type === "CSSFUNCTION" || type === "CSSIDENTIFIER") return "cssValue";
  if (type === "CSSPROP") return "cssProperty";
  if (type === "CSS_SEL") return "tag";

  if (type === "TAG_TYPE") {
    return previousType === "TAG" ? "class" : "tag";
  }

  if (type === "TAG_LITERAL") {
    return previousType === "T@" ? "event" : "attribute";
  }

  if (type === "IDENTIFIER" || type === "SYMBOL" || type === "SYMBOLID" || type === "ARGVAR") {
    if (previousType === "DEF" || previousType === "GET" || previousType === "SET") {
      return "method";
    }

    if (previousType === "CLASS") {
      return "class";
    }

    return "variable";
  }

  return null;
}

function modifierMask(type: string, previousType: string | null): number {
  let mask = 0;
  const declaration = 1 << semanticTokenModifiers.indexOf("declaration");
  const definition = 1 << semanticTokenModifiers.indexOf("definition");

  if (previousType === "DEF" || previousType === "GET" || previousType === "SET") {
    mask |= declaration | definition;
  }

  if (type === "TAG_TYPE" && previousType === "TAG") {
    mask |= declaration | definition;
  }

  if (type === "IDENTIFIER" && previousType === "CLASS") {
    mask |= declaration | definition;
  }

  return mask;
}

function readTokenType(token: ImbaToken): string | null {
  if (typeof token.type === "function") return token.type();
  return token._type ?? null;
}

function readTokenValue(token: ImbaToken): string {
  if (typeof token.value === "function") return token.value();
  return token._value ?? "";
}

function readTokenSpan(token: ImbaToken): { start: number; end: number } | null {
  if (typeof token.loc === "function") {
    const loc = token.loc();
    if (Array.isArray(loc)) {
      return { start: loc[0], end: loc[1] };
    }
  }

  if (Array.isArray(token._loc)) {
    return { start: token._loc[0], end: token._loc[1] };
  }

  if (typeof token._loc === "number") {
    return { start: token._loc, end: token._loc + (token._len ?? 0) };
  }

  return null;
}
