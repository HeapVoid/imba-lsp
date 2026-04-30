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
  "tagClass",
  "tagId",
  "cssSelector",
  "classField",
  "tagField",
  "tagAttribute",
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
const declarationLinePattern =
  /^(\t*)(?:(export)\s+)?(?:(static)\s+)?(?:extend\s+)?(?:local\s+)?(?:global\s+)?(class|tag|def|get|set|prop|attr)\s+(@?[$A-Za-z_][\w$?!:-]*)/;
const bindingLinePattern = /^(\t*)(?:(let|const|var)\s+)([$A-Za-z_][\w$?!-]*)/;
const assignmentLinePattern = /^(\t*)([$A-Za-z_][\w$?!-]*)\s*=/;
const tagSegmentPattern = /<(?!!|\/)(?=[$A-Za-z_.#])([^>\n]*)>?/g;
const cssSelectorClassOrIdPattern = /([.#])([@$A-Za-z_][\w$-]*)/g;
const cssSelectorElementPattern = /(^|[\s>+~,(])([A-Za-z_][\w$-]*)(?=[\s.#:@[>+~),]|$)/g;
const cssSelectorModifierPattern = /@([@$A-Za-z_][\w$-]*)/g;
const cssSelectorParentPattern = /&/g;
const cssSelectorPseudoPattern = /:{1,2}([@$A-Za-z_][\w$-]*)/g;
const tagClassTokenPattern = /([.#])([@$A-Za-z_][\w$-]*)/g;
const tagAttributeTokenPattern = /(?:^|\s)([@$A-Za-z_][\w$-]*)(?=\s*(?:=|$|\]))/g;
const tagEventTokenPattern = /@([@$A-Za-z_][\w$-]*)/g;
const stylePropertyPattern = /(?:^|\s)([$A-Za-z_][\w$-]*)\s*:/g;

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

  items.push(...buildSourceSemanticItems(document.getText()));

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
            priority: 0,
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
  priority: number;
}

function encodeSemanticTokens(items: SemanticItem[]): number[] {
  items.sort((a, b) =>
    a.line - b.line ||
    a.character - b.character ||
    b.priority - a.priority ||
    a.length - b.length
  );

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
  if (type === "CSS_SEL") return null;

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

function buildSourceSemanticItems(source: string): SemanticItem[] {
  const lines = source.split("\n");
  const items: SemanticItem[] = [];
  const stack: Array<{ indent: number; kind: string }> = [];
  let cssIndent: number | null = null;

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? "";
    const trimmed = text.trim();
    const indent = indentOf(text);

    if (!trimmed) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (cssIndent !== null && indent <= cssIndent) {
      cssIndent = null;
    }

    const declaration = text.match(declarationLinePattern);
    if (declaration) {
      addDeclarationLineItems(items, declaration, line, text, nearestContainerKind(stack));

      const keyword = declaration[4] ?? "";
      if (keyword === "class" || keyword === "tag") {
        stack.push({ indent, kind: keyword });
      }
    }

    const binding = text.match(bindingLinePattern);
    if (binding) {
      const name = binding[3] ?? "";
      addLineToken(items, line, text.indexOf(name), name.length, "variable", {
        modifiers: modifierNamesToMask(["declaration"]),
        priority: 4,
      });
    }

    const assignment = text.match(assignmentLinePattern);
    if (assignment && !binding) {
      const name = assignment[2] ?? "";
      const containerKind = nearestContainerKind(stack);
      addLineToken(items, line, text.indexOf(name), name.length, fieldSemanticType(containerKind, "variable"), {
        modifiers: modifierNamesToMask(["declaration"]),
        priority: 4,
      });
    }

    const cssLine = text.match(/^(\t*)css\b/);
    if (cssLine) {
      cssIndent = indent;
      const selectorStart = text.indexOf("css") + 3;
      scanCssSelector(items, line, cssSelectorPrefix(text.slice(selectorStart)), selectorStart);
    } else if (cssIndent !== null && indent > cssIndent) {
      scanCssLine(items, line, text);
    }

    scanTagSegments(items, line, text);
  }

  return items;
}

function addDeclarationLineItems(
  items: SemanticItem[],
  match: RegExpMatchArray,
  line: number,
  text: string,
  containerKind: string | null,
): void {
  const keyword = match[4] ?? "";
  const name = match[5] ?? "";
  const nameStart = match[0].lastIndexOf(name);
  const semanticType = declarationSemanticType(keyword, containerKind);
  const modifiers = modifierNamesToMask(["declaration", "definition"]);

  addLineToken(items, line, nameStart, name.length, semanticType, {
    modifiers,
    priority: 5,
  });

  if (keyword === "def" || keyword === "get" || keyword === "set") {
    scanSignatureParameters(items, line, text, match[0].length);
  }
}

function scanSignatureParameters(
  items: SemanticItem[],
  line: number,
  text: string,
  signatureStart: number,
): void {
  const rest = text.slice(signatureStart);
  const paramPattern = /([@$A-Za-z_][\w$?!-]*)(?:\s*:\s*([@$A-Za-z_][\w$?!:-]*))?/g;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(rest)) !== null) {
    const name = match[1] ?? "";
    const nameStart = signatureStart + match.index;
    addLineToken(items, line, nameStart, name.length, "parameter", {
      modifiers: modifierNamesToMask(["declaration"]),
      priority: 5,
    });

    const typeName = match[2];
    if (typeName) {
      const typeStart = signatureStart + match.index + match[0].lastIndexOf(typeName);
      addLineToken(items, line, typeStart, typeName.length, "type", {
        priority: 5,
      });
    }
  }
}

function scanTagSegments(
  items: SemanticItem[],
  line: number,
  text: string,
): void {
  let segment: RegExpExecArray | null;
  tagSegmentPattern.lastIndex = 0;

  while ((segment = tagSegmentPattern.exec(text)) !== null) {
    if (looksLikeLessThanExpression(text, segment.index)) continue;

    const body = segment[1] ?? "";
    const bodyStart = segment.index + 1;
    const tagNameMatch = body.match(/^([@$A-Za-z_][\w$-]*|self|this)/);
    if (tagNameMatch) {
      const name = tagNameMatch[1] ?? "";
      addLineToken(items, line, bodyStart, name.length, name === "self" || name === "this" ? "tag" : "tag", {
        modifiers: modifierNamesToMask([]),
        priority: 4,
      });
    }

    scanTagClassTokens(items, line, body, bodyStart);
    scanTagEventTokens(items, line, body, bodyStart);
    scanTagAttributeTokens(items, line, body, bodyStart);
    scanInlineStyleTokens(items, line, body, bodyStart);
  }
}

function looksLikeLessThanExpression(text: string, offset: number): boolean {
  const previous = text[offset - 1];
  return typeof previous === "string" && /[$A-Za-z_0-9)\]]/.test(previous);
}

function scanTagClassTokens(
  items: SemanticItem[],
  line: number,
  body: string,
  bodyStart: number,
): void {
  let match: RegExpExecArray | null;
  tagClassTokenPattern.lastIndex = 0;

  while ((match = tagClassTokenPattern.exec(body)) !== null) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    addLineToken(items, line, bodyStart + match.index + prefix.length, name.length, prefix === "#" ? "tagId" : "tagClass", {
      priority: 6,
    });
  }
}

function scanTagEventTokens(
  items: SemanticItem[],
  line: number,
  body: string,
  bodyStart: number,
): void {
  let match: RegExpExecArray | null;
  tagEventTokenPattern.lastIndex = 0;

  while ((match = tagEventTokenPattern.exec(body)) !== null) {
    const name = match[1] ?? "";
    addLineToken(items, line, bodyStart + match.index + 1, name.length, "event", {
      priority: 6,
    });
  }
}

function scanTagAttributeTokens(
  items: SemanticItem[],
  line: number,
  body: string,
  bodyStart: number,
): void {
  let match: RegExpExecArray | null;
  tagAttributeTokenPattern.lastIndex = 0;

  while ((match = tagAttributeTokenPattern.exec(body)) !== null) {
    const name = match[1] ?? "";
    const nameStart = bodyStart + match.index + match[0].lastIndexOf(name);
    if (name.startsWith("@")) continue;
    if (name === "self" || name === "this") continue;

    addLineToken(items, line, nameStart, name.length, "tagAttribute", {
      priority: 5,
    });
  }
}

function scanInlineStyleTokens(
  items: SemanticItem[],
  line: number,
  body: string,
  bodyStart: number,
): void {
  for (const range of inlineStyleRanges(body)) {
    const style = body.slice(range.start + 1, range.end);
    scanStyleProperties(items, line, style, bodyStart + range.start + 1);
  }
}

function scanCssLine(
  items: SemanticItem[],
  line: number,
  text: string,
): void {
  const trimmed = text.trimStart();
  if (!trimmed || trimmed.startsWith("#")) return;

  const selector = cssSelectorPrefix(trimmed);
  if (selector.trim()) {
    scanCssSelector(items, line, selector, text.length - trimmed.length);
  }

  const propertyStart = text.length - trimmed.length;
  if (/^[$A-Za-z_][\w$-]*\s*:/.test(trimmed)) {
    scanStyleProperties(items, line, trimmed, propertyStart);
  }
}

function scanCssSelector(
  items: SemanticItem[],
  line: number,
  selector: string,
  startCharacter: number,
): void {
  let match: RegExpExecArray | null;

  cssSelectorParentPattern.lastIndex = 0;
  while ((match = cssSelectorParentPattern.exec(selector)) !== null) {
    addLineToken(items, line, startCharacter + match.index, 1, "cssSelector", {
      priority: 4,
    });
  }

  cssSelectorClassOrIdPattern.lastIndex = 0;
  while ((match = cssSelectorClassOrIdPattern.exec(selector)) !== null) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    addLineToken(items, line, startCharacter + match.index + prefix.length, name.length, prefix === "#" ? "tagId" : "tagClass", {
      priority: 6,
    });
  }

  cssSelectorPseudoPattern.lastIndex = 0;
  while ((match = cssSelectorPseudoPattern.exec(selector)) !== null) {
    const name = match[1] ?? "";
    addLineToken(items, line, startCharacter + match.index + match[0].lastIndexOf(name), name.length, "tagClass", {
      priority: 6,
    });
  }

  cssSelectorModifierPattern.lastIndex = 0;
  while ((match = cssSelectorModifierPattern.exec(selector)) !== null) {
    const name = match[1] ?? "";
    addLineToken(items, line, startCharacter + match.index + 1, name.length, "tagClass", {
      priority: 6,
    });
  }

  cssSelectorElementPattern.lastIndex = 0;
  while ((match = cssSelectorElementPattern.exec(selector)) !== null) {
    const element = match[2] ?? "";
    if (element === "css") continue;

    const leading = match[1]?.length ?? 0;
    addLineToken(items, line, startCharacter + match.index + leading, element.length, "cssSelector", {
      priority: 4,
    });
  }
}

function cssSelectorPrefix(text: string): string {
  const property = firstStylePropertyMatch(text);
  if (!property) return text;

  return text.slice(0, property.index);
}

function firstStylePropertyMatch(text: string): RegExpExecArray | null {
  stylePropertyPattern.lastIndex = 0;
  return stylePropertyPattern.exec(text);
}

function inlineStyleRanges(body: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < body.length; index++) {
    if (body[index] !== "[") continue;
    if (!isPotentialInlineStyleStart(body, index)) continue;

    const close = body.indexOf("]", index + 1);
    if (close === -1) break;

    ranges.push({ start: index, end: close });
    index = close;
  }

  return ranges;
}

function isPotentialInlineStyleStart(text: string, index: number): boolean {
  const tokenStart = text.slice(0, index).search(/\S+$/);
  if (tokenStart >= 0 && text.slice(tokenStart, index).includes("=")) return false;

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const character = text[cursor];
    if (/\s/.test(character)) continue;
    return character !== "=";
  }

  return true;
}

function scanStyleProperties(
  items: SemanticItem[],
  line: number,
  text: string,
  startCharacter: number,
): void {
  let match: RegExpExecArray | null;
  stylePropertyPattern.lastIndex = 0;

  while ((match = stylePropertyPattern.exec(text)) !== null) {
    const name = match[1] ?? "";
    const nameStart = startCharacter + match.index + match[0].lastIndexOf(name);
    addLineToken(items, line, nameStart, name.length, "cssProperty", {
      priority: 6,
    });
  }
}

function addLineToken(
  items: SemanticItem[],
  line: number,
  character: number,
  length: number,
  type: string,
  options: {
    modifiers?: number;
    priority?: number;
  } = {},
): void {
  if (character < 0 || length <= 0) return;

  items.push({
    line,
    character,
    length,
    typeIndex: tokenTypeIndex.get(type) ?? tokenTypeIndex.get("variable") ?? 0,
    modifiers: options.modifiers ?? 0,
    priority: options.priority ?? 3,
  });
}

function nearestContainerKind(stack: Array<{ kind: string }>): string | null {
  for (let index = stack.length - 1; index >= 0; index--) {
    const kind = stack[index].kind;
    if (kind === "class" || kind === "tag") return kind;
  }

  return null;
}

function fieldSemanticType(containerKind: string | null, fallback: string): string {
  switch (containerKind) {
    case "class":
      return "classField";
    case "tag":
      return "tagField";
    default:
      return fallback;
  }
}

function declarationSemanticType(keyword: string, containerKind: string | null): string {
  switch (keyword) {
    case "class":
      return "class";
    case "tag":
      return "tag";
    case "prop":
    case "attr":
      return fieldSemanticType(containerKind, "property");
    default:
      return "method";
  }
}

function modifierNamesToMask(names: string[]): number {
  let mask = 0;

  for (const name of names) {
    const index = semanticTokenModifiers.indexOf(
      name as (typeof semanticTokenModifiers)[number],
    );
    if (index >= 0) {
      mask |= 1 << index;
    }
  }

  return mask;
}

function indentOf(line: string): number {
  return line.match(/^\t*/)?.[0].length ?? 0;
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
