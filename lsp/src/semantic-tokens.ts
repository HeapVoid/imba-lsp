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
  "objectKey",
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

const declarationTokens = new Set(["DEF", "GET", "SET"]);
const identifierTokens = new Set(["IDENTIFIER", "SYMBOL", "SYMBOLID", "ARGVAR"]);
const propertyAccessTokens = new Set([".", "?."]);
const callFollowerTokens = new Set(["CALL_START", "BANG"]);
const signatureEndTokens = new Set(["DEF_BODY", "TERMINATOR", "OUTDENT"]);

export function buildSemanticTokenData(
  document: TextDocument,
  compilation: ImbaCompilation | undefined,
): number[] {
  const compilerTokens = (compilation?.tokens ?? [])
    .map(readCompilerToken)
    .filter((token): token is CompilerTokenInfo => token !== null);
  const items: SemanticItem[] = [];

  let previousType: string | null = null;
  let signature: SignatureContext | null = null;

  for (let index = 0; index < compilerTokens.length; index++) {
    const token = compilerTokens[index];
    const context: ClassificationContext = {
      previousType,
      nextType: nextTokenType(compilerTokens, index),
      signature,
    };

    const semanticType = classify(token.type, context);
    if (semanticType && token.span && token.span.start >= 0 && token.span.end > token.span.start) {
      const start = document.positionAt(token.span.start);
      const end = document.positionAt(token.span.end);

      // LSP semantic tokens cannot cross lines. Skip multiline compiler tokens
      // until we split strings/comments intentionally.
      if (start.line === end.line) {
        const length = end.character - start.character;

        if (length > 0) {
          items.push({
            line: start.line,
            character: start.character,
            length,
            typeIndex: tokenTypeIndex.get(semanticType) ?? tokenTypeIndex.get("variable") ?? 0,
            modifiers: modifierMask(token.type, semanticType, context),
          });
        }
      }
    }

    signature = updateSignatureContext(signature, token.type);
    previousType = token.type;
  }

  return encodeSemanticTokens(items);
}

interface CompilerTokenInfo {
  type: string;
  span: {
    start: number;
    end: number;
  } | null;
}

interface SignatureContext {
  expectingName: boolean;
  readingParameters: boolean;
}

interface ClassificationContext {
  previousType: string | null;
  nextType: string | null;
  signature: SignatureContext | null;
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
  let previousLine = -1;
  let previousLineEnd = 0;

  for (const item of items) {
    if (item.line !== previousLine) {
      previousLine = item.line;
      previousLineEnd = 0;
    }

    if (item.character < previousLineEnd) {
      continue;
    }

    const deltaLine = item.line - lastLine;
    const deltaStart = deltaLine === 0 ? item.character - lastCharacter : item.character;

    data.push(deltaLine, deltaStart, item.length, item.typeIndex, item.modifiers);

    lastLine = item.line;
    lastCharacter = item.character;
    previousLineEnd = item.character + item.length;
  }

  return data;
}

function classify(type: string, context: ClassificationContext): string | null {
  const { previousType, nextType, signature } = context;

  if (keywordTokens.has(type)) return "keyword";
  if (operatorTokens.has(type) || operatorValueTokens.has(type)) return "operator";

  if (type === "COMMENT" || type === "HERECOMMENT") return "comment";
  if (type === "STRING" || type === "NEOSTRING") return "string";
  if (type === "REGEX") return "regexp";
  if (type === "NUMBER" || type === "DIMENSION" || type === "PERCENTAGE") return "number";
  if (type === "DECORATOR") return "decorator";
  if (type === "TRUE" || type === "FALSE") return "boolean";
  if (type === "NULL") return "constant";
  if ((type === "SELF" || type === "THIS") && previousType === "TAG_START") return "tag";
  if (type === "SELF" || type === "THIS") return "selfKeyword";

  if (type === "CSSFUNCTION") return "function";
  if (type === "COLOR" || type === "CSSIDENTIFIER" || type === "CSSVAR") return "cssValue";
  if (type === "CSSPROP") return "cssProperty";
  if (type === "CSS_SEL") return "tag";

  if (type === "TAG_TYPE") {
    return previousType === "TAG" ? "class" : "tag";
  }

  if (type === "TAG_LITERAL") {
    return previousType === "T@" ? "event" : "attribute";
  }

  if (identifierTokens.has(type)) {
    if (signature?.expectingName) {
      return "method";
    }

    if (signature?.readingParameters) {
      return previousType === ":" ? "type" : "parameter";
    }

    if (previousType === "CLASS") {
      return "class";
    }

    if (nextType === ":") {
      return "objectKey";
    }

    if (propertyAccessTokens.has(previousType ?? "")) {
      return callFollowerTokens.has(nextType ?? "") ? "method" : "property";
    }

    if (callFollowerTokens.has(nextType ?? "")) {
      return "function";
    }

    return "variable";
  }

  return null;
}

function modifierMask(
  type: string,
  semanticType: string,
  context: ClassificationContext,
): number {
  const { previousType, signature } = context;
  let mask = 0;
  const declaration = 1 << semanticTokenModifiers.indexOf("declaration");
  const definition = 1 << semanticTokenModifiers.indexOf("definition");

  if (signature?.expectingName && identifierTokens.has(type)) {
    mask |= declaration | definition;
  }

  if (semanticType === "parameter" && signature?.readingParameters) {
    mask |= declaration;
  }

  if (type === "TAG_TYPE" && previousType === "TAG") {
    mask |= declaration | definition;
  }

  if (type === "IDENTIFIER" && previousType === "CLASS") {
    mask |= declaration | definition;
  }

  return mask;
}

function updateSignatureContext(
  signature: SignatureContext | null,
  type: string,
): SignatureContext | null {
  if (declarationTokens.has(type)) {
    return {
      expectingName: true,
      readingParameters: false,
    };
  }

  if (!signature || signatureEndTokens.has(type)) {
    return null;
  }

  if (signature.expectingName && identifierTokens.has(type)) {
    return {
      expectingName: false,
      readingParameters: true,
    };
  }

  return signature;
}

function nextTokenType(tokens: CompilerTokenInfo[], index: number): string | null {
  return tokens[index + 1]?.type ?? null;
}

function readCompilerToken(token: ImbaToken): CompilerTokenInfo | null {
  const type = readTokenType(token);
  if (!type) return null;

  return {
    type,
    span: readTokenSpan(token),
  };
}

function readTokenType(token: ImbaToken): string | null {
  if (typeof token.type === "function") return token.type();
  return token._type ?? null;
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
