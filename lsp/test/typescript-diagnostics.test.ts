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
  const runtimePath = path.join(root, "runtime.imba");
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

  const runtimeSource = [
    "tag card",
    "\tdef mount",
    "\t\tself.querySelector('canvas')",
    "\tdef close",
    "\t\treturn true",
    "\tdef render",
    "\t\t<self ease @click=close>",
    "\t\t\t<span> data.name",
    "\tcss self",
    "\t\tpos: rel",
    "\t\t&:before bc: blue5/50",
    "",
  ].join("\n");
  const runtimeDocument = TextDocument.create(
    pathToFileURL(runtimePath).toString(),
    "imba",
    1,
    runtimeSource,
  );
  const runtimeResult = compileImba(runtimeSource, runtimePath, {
    sourcemap: true,
  });
  assert.equal(runtimeResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      runtimeDocument,
      runtimePath,
      runtimeResult.compilation,
    ).current,
    [],
  );

  const ethereumSource = [
    "def connect",
    "\twindow.ethereum",
    "",
  ].join("\n");
  const ethereumDocument = TextDocument.create(
    pathToFileURL(path.join(root, "ethereum.imba")).toString(),
    "imba",
    1,
    ethereumSource,
  );
  const ethereumResult = compileImba(ethereumSource, path.join(root, "ethereum.imba"), {
    sourcemap: true,
  });
  assert.equal(ethereumResult.diagnostics.length, 0);

  const ethereumDiagnostics = buildTypeScriptDiagnosticGroups(
    ethereumDocument,
    path.join(root, "ethereum.imba"),
    ethereumResult.compilation,
  ).current;
  assert.ok(
    ethereumDiagnostics.some((item) => item.message.includes("ethereum")),
    "expected project-owned Window.ethereum diagnostic to remain visible",
  );

  const setIterationSource = [
    "const listeners = new Set",
    "def emit",
    "\tfor listener in listeners",
    "\t\tlistener!",
    "",
  ].join("\n");
  const setIterationPath = path.join(root, "set-iteration.imba");
  const setIterationDocument = TextDocument.create(
    pathToFileURL(setIterationPath).toString(),
    "imba",
    1,
    setIterationSource,
  );
  const setIterationResult = compileImba(setIterationSource, setIterationPath, {
    sourcemap: true,
  });
  assert.equal(setIterationResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      setIterationDocument,
      setIterationPath,
      setIterationResult.compilation,
    ).current,
    [],
  );
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
