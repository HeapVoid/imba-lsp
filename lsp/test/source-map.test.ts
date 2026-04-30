import assert from "node:assert/strict";
import path from "node:path";
import { compileImba } from "../src/compiler";
import {
  generatedOffsetToSourceOffset,
  sourceOffsetToGeneratedOffset,
  sourceSpanForOffset,
} from "../src/source-map";

const fixturePath = path.resolve(__dirname, "../fixtures/source-map.imba");
const source = [
  "def probe",
  "\tnavigator.userAgent",
  "\tdocument.body.style.overflow = 'hidden'",
  "",
].join("\n");

const result = compileImba(source, fixturePath, {
  platform: "browser",
  sourcemap: true,
});
const compilation = result.compilation;
const generated = compilation?.js ?? "";

assert.equal(result.diagnostics.length, 0);
assert.ok(compilation?.locs?.spans?.length, "expected compiler locs.spans");
assert.ok(generated.includes("globalThis.document.body.style.overflow"));

assertSourceMapsToGeneratedToken("navigator");
assertSourceMapsToGeneratedToken("userAgent");
assertSourceMapsToGeneratedToken("document");
assertSourceMapsToGeneratedToken("body");
assertSourceMapsToGeneratedToken("style");
assertSourceMapsToGeneratedToken("overflow");
assertSourceMapsToGeneratedToken("hidden");

{
  const offset = source.indexOf("overflow");
  const span = sourceSpanForOffset(compilation, offset);
  assert.ok(span, "expected source span for overflow");
  assert.equal(source.slice(span.sourceStart, span.sourceEnd), "overflow");
  assert.equal(generated.slice(span.generatedStart, span.generatedEnd), "overflow");
}

{
  const generatedOffset = generated.indexOf("globalThis.document") + "globalThis.".length;
  const mapping = generatedOffsetToSourceOffset(compilation, source, generatedOffset);
  assert.ok(mapping, "expected generated document mapping");
  assert.equal(source.slice(mapping.offset, mapping.offset + "document".length), "document");
}

console.log("source-map.test ok");

function assertSourceMapsToGeneratedToken(token: string): void {
  const sourceOffset = source.indexOf(token);
  assert.notEqual(sourceOffset, -1, `missing source token ${token}`);

  const mapping = sourceOffsetToGeneratedOffset(compilation, source, sourceOffset);
  assert.ok(mapping, `expected mapping for ${token}`);
  assert.equal(
    generated.slice(mapping.offset, mapping.offset + token.length),
    token,
    `expected ${token} to map to its generated token`,
  );
}
