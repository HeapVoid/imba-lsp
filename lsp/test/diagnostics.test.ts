import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba } from "../src/compiler";
import {
  buildSemanticTokenData,
  semanticTokenModifiers,
  semanticTokenTypes,
} from "../src/semantic-tokens";

const fixturePath = path.resolve(__dirname, "../fixtures/sample.imba");

const validSource = [
  "tag app",
  "\tdef render",
  "\t\t<div.card data-id=1 @click=save> \"Hi\"",
  "\tcss section.card",
  "\t\tc:red5",
  "",
].join("\n");

const invalidSource = ["def bad", "\treturn if", ""].join("\n");

const timingSource = [
  "fakeOn = false",
  "cardRevealed = false",
  "shineOn = false",
  "showPerks = false",
  "activePerk = null",
  "showBtns = false",
  "",
  "def mount",
  "\treset!",
  "\tdocument.body.style.overflow = 'hidden'",
  "\timba.setTimeout(&, 0) do",
  "\t\tfakeOn = true",
  "\t\timba.commit!",
  "\t\timba.setTimeout(&, 3750) do",
  "\t\t\tcardRevealed = true",
  "\t\t\timba.commit!",
  "\t\t\timba.setTimeout(&, 0) do",
  "\t\t\t\tshineOn = true",
  "\t\t\t\tshowPerks = true",
  "\t\t\t\timba.commit!",
  "",
].join("\n");

const semanticSource = [
  "tag app",
  "\tdef save item: Item, index",
  "\t\titem.active = true",
  "\t\treset!",
  "\t\timba.commit!",
  "\t\timba.setTimeout(&, 0) do",
  "\t\t\tdocument.body.style.overflow = 'hidden'",
  "\tdef render",
  "\t\t<self.active @click=save data-id=index [c:red5 bgc:var(--accent)]>",
  "\tcss section.card",
  "\t\tbgc:var(--accent)",
  "\t\t&:hover opacity: 0.9",
  "\t\t&:before bc: blue5/50",
  "\t\th1 fs: 24px",
  "",
].join("\n");

const objectKeySource = [
  "def data item: Item",
  "\treturn {name: 'Ada', score: item.score, active: true}",
  "",
].join("\n");

const comparisonSource = [
  "def compare a, b",
  "\treturn a<b",
  "",
].join("\n");

{
  const result = compileImba(validSource, fixturePath);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.compilation?.tokens?.length, "expected compiler tokens");
}

{
  const result = compileImba(invalidSource, fixturePath);
  assert.ok(result.diagnostics.length > 0, "expected parser diagnostics");
  assert.match(result.diagnostics[0].message, /Unexpected|unexpected|parse/i);
  assert.equal(result.diagnostics[0].source, "imba-parser");
  assert.ok(
    result.diagnostics[0].range.end.character > result.diagnostics[0].range.start.character,
    "expected visible non-empty diagnostic range",
  );
}

{
  const uri = pathToFileURL(fixturePath).toString();
  const document = TextDocument.create(uri, "imba", 1, validSource);
  const result = compileImba(validSource, fixturePath);
  const tokens = buildSemanticTokenData(document, result.compilation);
  assert.ok(tokens.length > 0, "expected semantic tokens");
  assert.equal(tokens.length % 5, 0, "semantic tokens must be LSP encoded in groups of five");

  const decoded = decodeSemanticTokens(validSource, tokens);
  const seenTokenTypes = new Set(decoded.map((token) => token.type));

  assert.ok(seenTokenTypes.has("tag"), "expected tag semantic tokens");
  assert.ok(seenTokenTypes.has("attribute"), "expected attribute semantic tokens");
  assert.ok(seenTokenTypes.has("tagClass"), "expected tag class semantic tokens");
  assert.ok(seenTokenTypes.has("cssProperty"), "expected CSS property semantic tokens");
  assert.ok(seenTokenTypes.has("cssValue"), "expected CSS value semantic tokens");
  assert.ok(seenTokenTypes.has("method"), "expected method semantic tokens");
  assertSemanticTokensAreWellFormed(validSource, tokens);
}

{
  const uri = pathToFileURL(fixturePath).toString();
  const document = TextDocument.create(uri, "imba", 1, timingSource);
  const result = compileImba(timingSource, fixturePath);
  assert.equal(result.diagnostics.length, 0);
  const tokens = buildSemanticTokenData(document, result.compilation);
  assert.ok(tokens.length > 0, "expected timing semantic tokens");
  assertSemanticTokensAreWellFormed(timingSource, tokens);
}

{
  const uri = pathToFileURL(fixturePath).toString();
  const document = TextDocument.create(uri, "imba", 1, semanticSource);
  const result = compileImba(semanticSource, fixturePath);
  assert.equal(result.diagnostics.length, 0);
  const tokens = buildSemanticTokenData(document, result.compilation);
  assert.ok(tokens.length > 0, "expected rich semantic tokens");
  assertSemanticTokensAreWellFormed(semanticSource, tokens);

  const decoded = decodeSemanticTokens(semanticSource, tokens);
  assertToken(decoded, "app", "tag", 0, ["declaration", "definition"]);
  assertToken(decoded, "save", "method", 1, ["declaration", "definition"]);
  assertToken(decoded, "item", "parameter", 1, ["declaration"]);
  assertToken(decoded, "Item", "type", 1);
  assertToken(decoded, "index", "parameter", 1, ["declaration"]);
  assertToken(decoded, "active", "property", 2);
  assertToken(decoded, "reset", "function", 3);
  assertToken(decoded, "commit", "method", 4);
  assertToken(decoded, "setTimeout", "method", 5);
  assertToken(decoded, "body", "property", 6);
  assertToken(decoded, "style", "property", 6);
  assertToken(decoded, "overflow", "property", 6);
  assertToken(decoded, "render", "method", 7, ["declaration", "definition"]);
  assertToken(decoded, "self", "tag", 8);
  assertToken(decoded, "active", "tagClass", 8);
  assertToken(decoded, "data-id", "attribute", 8);
  assertToken(decoded, "click", "event", 8);
  assertToken(decoded, "var", "function", 8);
  assertToken(decoded, "--accent", "cssValue", 8);
  assertToken(decoded, "section", "cssSelector", 9);
  assertToken(decoded, "card", "tagClass", 9);
  assertToken(decoded, "bgc", "cssProperty", 10);
  assertToken(decoded, "&", "cssSelector", 11);
  assertToken(decoded, "hover", "tagClass", 11);
  assertToken(decoded, "opacity", "cssProperty", 11);
  assertToken(decoded, "before", "tagClass", 12);
  assertToken(decoded, "bc", "cssProperty", 12);
  assertToken(decoded, "h1", "cssSelector", 13);
  assertToken(decoded, "fs", "cssProperty", 13);
}

{
  const uri = pathToFileURL(fixturePath).toString();
  const document = TextDocument.create(uri, "imba", 1, objectKeySource);
  const result = compileImba(objectKeySource, fixturePath);
  assert.equal(result.diagnostics.length, 0);
  const tokens = buildSemanticTokenData(document, result.compilation);
  assert.ok(tokens.length > 0, "expected object key semantic tokens");
  assertSemanticTokensAreWellFormed(objectKeySource, tokens);

  const decoded = decodeSemanticTokens(objectKeySource, tokens);
  assertToken(decoded, "item", "parameter", 0);
  assertToken(decoded, "Item", "type", 0);
  assertToken(decoded, "name", "objectKey", 1);
  assertToken(decoded, "score", "objectKey", 1);
  assertToken(decoded, "active", "objectKey", 1);
  assertToken(decoded, "score", "property", 1);
}

{
  const uri = pathToFileURL(fixturePath).toString();
  const document = TextDocument.create(uri, "imba", 1, comparisonSource);
  const result = compileImba(comparisonSource, fixturePath);
  assert.equal(result.diagnostics.length, 0);
  const tokens = buildSemanticTokenData(document, result.compilation);
  assertSemanticTokensAreWellFormed(comparisonSource, tokens);

  const decoded = decodeSemanticTokens(comparisonSource, tokens);
  assert.equal(
    decoded.some((token) => token.text === "b" && token.type === "tag"),
    false,
    "less-than expressions must not be scanned as tags",
  );
}

console.log("diagnostics.test ok");

function assertSemanticTokensAreWellFormed(source: string, data: number[]): void {
  const lines = source.split("\n");
  const decoded = decodeSemanticTokens(source, data);

  let previousLine = -1;
  let previousEnd = 0;

  for (const token of decoded) {
    assert.ok(token.length > 0, "semantic token length must be positive");
    assert.ok(token.line >= 0 && token.line < lines.length, "semantic token line must exist");
    assert.ok(token.character >= 0, "semantic token start must be non-negative");
    assert.ok(
      token.character + token.length <= lines[token.line].length,
      "semantic token must stay inside its source line",
    );

    if (token.line !== previousLine) {
      previousLine = token.line;
      previousEnd = 0;
    }

    assert.ok(
      token.character >= previousEnd,
      "semantic tokens must not overlap on the same line",
    );

    previousEnd = token.character + token.length;
  }
}

interface DecodedSemanticToken {
  line: number;
  character: number;
  length: number;
  type: string;
  text: string;
  modifiers: string[];
}

function decodeSemanticTokens(source: string, data: number[]): DecodedSemanticToken[] {
  const lines = source.split("\n");
  const tokens: DecodedSemanticToken[] = [];
  let line = 0;
  let character = 0;

  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index];
    const deltaStart = data[index + 1];
    const length = data[index + 2];

    if (deltaLine === 0) {
      character += deltaStart;
    } else {
      line += deltaLine;
      character = deltaStart;
    }

    tokens.push({
      line,
      character,
      length,
      modifiers: semanticTokenModifiers.filter((_, modifierIndex) =>
        Boolean(data[index + 4] & (1 << modifierIndex))
      ),
      type: semanticTokenTypes[data[index + 3]],
      text: lines[line]?.slice(character, character + length) ?? "",
    });
  }

  return tokens;
}

function assertToken(
  tokens: DecodedSemanticToken[],
  text: string,
  type: string,
  line: number,
  modifiers: string[] = [],
): void {
  assert.ok(
    tokens.some((token) =>
      token.text === text &&
      token.type === type &&
      token.line === line &&
      modifiers.every((modifier) => token.modifiers.includes(modifier))
    ),
    `expected ${JSON.stringify(text)} on line ${line + 1} to be ${type}` +
      (modifiers.length > 0 ? ` with ${modifiers.join(",")}` : ""),
  );
}
