import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildProjectDiagnosticFile,
  buildProjectDiagnostics,
  collectProjectImbaFiles,
  isProjectImbaFile,
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
    const jsConfigDir = path.join(root, "pocketbase");
    const jsConfigTypePath = path.join(jsConfigDir, "types.d.ts");
    const jsConfigPath = path.join(jsConfigDir, "jsconfig.json");
    const jsConfigTestPath = path.join(jsConfigDir, "test", "security.js");
    const jsConfigImbaPath = path.join(jsConfigDir, "src", "hook.imba");
    const jsConfigHelperPath = path.join(jsConfigDir, "src", "helper.imba");
    const ignoredPath = path.join(root, "node_modules", "ignored.imba");

    fs.mkdirSync(path.dirname(ignoredPath), { recursive: true });
    fs.mkdirSync(path.dirname(jsConfigImbaPath), { recursive: true });
    fs.mkdirSync(path.dirname(jsConfigTestPath), { recursive: true });
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
    fs.writeFileSync(
      jsConfigTypePath,
      [
        "declare const pocketGlobal: { ready: boolean }",
        "declare namespace security {",
        "\tinterface pseudorandomString {",
        "\t\t(length: number): string",
        "\t}",
        "}",
        "declare namespace $security {",
        "\tlet pseudorandomString: security.pseudorandomString",
        "}",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      jsConfigTestPath,
      [
        "globalThis.$security = {",
        "\tpseudorandomString: () => 'test-seed',",
        "};",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      jsConfigPath,
      JSON.stringify({
        compilerOptions: {
          allowJs: true,
          checkJs: false,
          lib: ["ES2022"],
        },
        include: ["test/**/*.js", "types.d.ts"],
      }),
    );
    fs.writeFileSync(
      jsConfigImbaPath,
      [
        "import {helper} from './helper.js'",
        "def hook",
        "\tpocketGlobal.ready",
        "\t$security.pseudorandomString(20)",
        "\thelper!",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      jsConfigHelperPath,
      [
        "export def helper",
        "\t'ok'",
        "",
      ].join("\n"),
    );

    const files = await collectProjectImbaFiles(root);
    assert.ok(files.includes(compilerErrorPath));
    assert.ok(files.includes(typeErrorPath));
    assert.equal(files.includes(ignoredPath), false);

    const openUri = pathToFileURL(openErrorPath).toString();
    const results = await buildProjectDiagnostics(root, new Set([openUri]));
    assert.equal(results.some((result) => result.sourcePath === openErrorPath), false);
    assert.equal(isProjectImbaFile(root, compilerErrorPath), true);
    assert.equal(isProjectImbaFile(root, ignoredPath), false);
    assert.equal(isProjectImbaFile(root, path.join(root, "notes.txt")), false);
    assert.equal(await buildProjectDiagnosticFile(path.join(root, "missing.imba")), null);

    const compilerError = resultFor(results, compilerErrorPath);
    assert.ok(
      compilerError.diagnostics.some((diagnostic) => diagnostic.source === "imba-parser"),
      "expected compiler diagnostic for unopened project file",
    );

    const typeError = resultFor(results, typeErrorPath);
    assert.equal(
      typeError.diagnostics.some((diagnostic) => diagnostic.source === "typescript"),
      false,
      "project diagnostics helper should stay compiler-only unless TypeScript is requested",
    );

    const typeScriptProjectResults = await buildProjectDiagnostics(root, new Set([openUri]), {
      includeTypeScript: true,
    });
    const projectTypeError = resultFor(typeScriptProjectResults, typeErrorPath);
    assert.ok(
      projectTypeError.diagnostics.some((diagnostic) =>
        diagnostic.source === "typescript" &&
        diagnostic.message.includes("toUpperCase")
      ),
      "expected shared TypeScript diagnostics for unopened project file",
    );

    const jsConfigResult = resultFor(typeScriptProjectResults, jsConfigImbaPath);
    assert.equal(
      jsConfigResult.diagnostics.some((diagnostic) =>
        diagnostic.source === "typescript" &&
        (diagnostic.message.includes("pocketGlobal") ||
          diagnostic.message.includes("0 arguments") ||
          diagnostic.message.includes("./helper.js"))
      ),
      false,
      "expected project-wide TypeScript diagnostics to load jsconfig globals, ignore root JS stubs, and resolve .js imports to virtual .imba modules",
    );

    const typeScriptResult = await buildProjectDiagnosticFile(typeErrorPath, {
      includeTypeScript: true,
    });
    assert.ok(typeScriptResult, "expected explicit TypeScript diagnostic result");
    assert.ok(
      typeScriptResult.diagnostics.some((diagnostic) =>
        diagnostic.source === "typescript" &&
        diagnostic.message.includes("toUpperCase")
      ),
      "expected TypeScript diagnostics when explicitly requested",
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
