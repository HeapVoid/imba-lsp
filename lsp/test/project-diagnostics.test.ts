import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildProjectDiagnostics,
  collectProjectImbaFiles,
} from "../src/project-diagnostics";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "imba-lsp-project-diagnostics-"));

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  try {
    const compilerErrorPath = path.join(root, "compiler-error.imba");
    const typeErrorPath = path.join(root, "type-error.imba");
    const openErrorPath = path.join(root, "open-error.imba");
    const ignoredPath = path.join(root, "node_modules", "ignored.imba");

    fs.mkdirSync(path.dirname(ignoredPath), { recursive: true });
    fs.writeFileSync(
      compilerErrorPath,
      [
        "tag broken",
        "\tdef render",
        "\t\treturn if",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      typeErrorPath,
      [
        "def check",
        "\tlet value = 1",
        "\tvalue.toUpperCase()",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(openErrorPath, fs.readFileSync(compilerErrorPath, "utf8"));
    fs.writeFileSync(ignoredPath, fs.readFileSync(compilerErrorPath, "utf8"));

    const files = await collectProjectImbaFiles(root);
    assert.ok(files.includes(compilerErrorPath));
    assert.ok(files.includes(typeErrorPath));
    assert.equal(files.includes(ignoredPath), false);

    const openUri = pathToFileURL(openErrorPath).toString();
    const results = await buildProjectDiagnostics(root, new Set([openUri]));
    assert.equal(results.some((result) => result.sourcePath === openErrorPath), false);

    const compilerError = resultFor(results, compilerErrorPath);
    assert.ok(
      compilerError.diagnostics.some((diagnostic) => diagnostic.source === "imba-parser"),
      "expected compiler diagnostic for unopened project file",
    );

    const typeError = resultFor(results, typeErrorPath);
    assert.ok(
      typeError.diagnostics.some((diagnostic) =>
        diagnostic.source === "typescript" &&
        diagnostic.message.includes("toUpperCase")
      ),
      "expected TypeScript diagnostic for unopened project file",
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }

  console.log("project-diagnostics.test ok");
}

function resultFor(
  results: Awaited<ReturnType<typeof buildProjectDiagnostics>>,
  sourcePath: string,
): Awaited<ReturnType<typeof buildProjectDiagnostics>>[number] {
  const result = results.find((item) => item.sourcePath === sourcePath);
  assert.ok(result, `missing project diagnostics for ${sourcePath}`);
  return result;
}
