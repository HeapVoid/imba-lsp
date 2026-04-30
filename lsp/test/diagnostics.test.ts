import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba } from "../src/compiler";
import { buildSemanticTokenData } from "../src/semantic-tokens";

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
}

console.log("diagnostics.test ok");
