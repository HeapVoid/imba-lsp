import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba } from "../src/compiler";
import { buildTypeScriptDiagnosticGroups } from "../src/typescript-diagnostics";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "imba-lsp-ts-diagnostics-"));

try {
  const appPath = path.join(root, "app.imba");
  const profilePath = path.join(root, "profile.imba");
  const appSource = [
    "import {Profile} from './profile.imba'",
    "let profile = new Profile",
    "profile.check",
    "",
  ].join("\n");
  const profileSource = [
    "export class Profile",
    "\tdef check",
    "\t\tlet value = 1",
    "\t\tvalue.toUpperCase()",
    "",
  ].join("\n");

  fs.writeFileSync(profilePath, profileSource);

  const document = TextDocument.create(
    pathToFileURL(appPath).toString(),
    "imba",
    1,
    appSource,
  );
  const result = compileImba(appSource, appPath, {
    sourcemap: true,
  });
  assert.equal(result.diagnostics.length, 0);

  const groups = buildTypeScriptDiagnosticGroups(document, appPath, result.compilation);
  assert.equal(groups.current.length, 0);

  const imported = groups.imported.find((group) => group.sourcePath === profilePath);
  assert.ok(imported, "expected imported profile diagnostics group");

  const diagnostic = imported.diagnostics.find((item) =>
    item.message.includes("toUpperCase")
  );
  assert.ok(diagnostic, "expected imported TypeScript diagnostic");
  assert.equal(imported.uri, pathToFileURL(profilePath).toString());
  assert.equal(rangeText(imported.source, diagnostic.range), "toUpperCase");
} finally {
  fs.rmSync(root, { force: true, recursive: true });
}

console.log("typescript-diagnostics.test ok");

function rangeText(source: string, range: Range): string {
  return source.slice(offsetAtPosition(source, range.start), offsetAtPosition(source, range.end));
}

function offsetAtPosition(
  source: string,
  position: { line: number; character: number },
): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let line = 0; line < position.line; line++) {
    offset += (lines[line] ?? "").length + 1;
  }

  return offset + position.character;
}
