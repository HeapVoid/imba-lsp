import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "imba-lsp-probe-"));
const fixturePath = path.join(root, "type-error.imba");
const source = [
  "def check",
  "\tlet value = 1",
  "\tvalue.toUpperCase()",
  "",
].join("\n");

try {
  fs.writeFileSync(fixturePath, source);

  const probePath = path.resolve(__dirname, "../src/probe.js");
  const result = spawnSync(
    process.execPath,
    [probePath, "--typescript-diagnostics", "--show-diagnostics", fixturePath],
    {
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /diag .*type-error\.imba/);
  assert.match(result.stdout, /error typescript 2339 3:\d+ Property 'toUpperCase' does not exist on type 'number'\./);
  assert.match(result.stdout, /\s+value\.toUpperCase\(\)/);
  assert.match(result.stdout, /\^+/);
} finally {
  fs.rmSync(root, { force: true, recursive: true });
}

console.log("probe.test ok");
