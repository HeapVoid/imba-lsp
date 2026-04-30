import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba } from "../src/compiler";
import { buildSemanticTokenData, semanticTokenTypes } from "../src/semantic-tokens";

const fixturePath = path.resolve(__dirname, "../fixtures/sample.imba");

const validSource = [
  "tag app",
  "\tdef render",
  "\t\t<div.card @click=save> \"Hi\"",
  "\tcss .card",
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

  const seenTokenTypes = new Set<string>();
  for (let index = 0; index < tokens.length; index += 5) {
    seenTokenTypes.add(semanticTokenTypes[tokens[index + 3]]);
  }

  assert.ok(seenTokenTypes.has("tag"), "expected tag semantic tokens");
  assert.ok(seenTokenTypes.has("attribute"), "expected attribute semantic tokens");
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

console.log("diagnostics.test ok");

function assertSemanticTokensAreWellFormed(source: string, data: number[]): void {
  const lines = source.split("\n");
  const decoded = decodeSemanticTokens(data);

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

function decodeSemanticTokens(data: number[]): Array<{ line: number; character: number; length: number }> {
  const tokens: Array<{ line: number; character: number; length: number }> = [];
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

    tokens.push({ line, character, length });
  }

  return tokens;
}
