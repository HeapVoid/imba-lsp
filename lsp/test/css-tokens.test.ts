import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildWorkspaceCssTokens,
  collectCssTokensFromSource,
  isStyleTokenFile,
} from "../src/css-tokens";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "imba-lsp-css-tokens-"));

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  try {
    const themePath = path.join(root, "src", "theme.imba");
    const cssPath = path.join(root, "src", "app.css");
    const ignoredPath = path.join(root, "node_modules", "ignored.css");

    fs.mkdirSync(path.dirname(themePath), { recursive: true });
    fs.mkdirSync(path.dirname(ignoredPath), { recursive: true });
    fs.writeFileSync(
      themePath,
      [
        "global css",
        "\t:root",
        "\t\t$surface: warm1",
        "\t\t$gap: 8px",
        "\t\t$font-main: sans",
        "\t\t$shadow-card: 0 4px 12px black/20",
        "\t\t#brand: blue6",
        "\t\t#nav:hover",
        "\t\t\tc: blue6",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      cssPath,
      [
        ":root {",
        "  --text-primary: #111;",
        "}",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(ignoredPath, ":root { --ignored: red; }\n");

    assert.equal(isStyleTokenFile(root, themePath), true);
    assert.equal(isStyleTokenFile(root, ignoredPath), false);
    assert.equal(isStyleTokenFile(root, path.join(root, "notes.txt")), false);

    const tokens = await buildWorkspaceCssTokens(root);
    const labels = new Set(tokens.map((token) => token.insertText));
    assert.ok(labels.has("$surface"));
    assert.ok(labels.has("$gap"));
    assert.ok(labels.has("$font-main"));
    assert.ok(labels.has("$shadow-card"));
    assert.ok(labels.has("#brand"));
    assert.ok(labels.has("var(--text-primary)"));
    assert.equal(labels.has("var(--ignored)"), false);
    assert.equal(labels.has("#nav"), false);
    assert.equal(tokenKind(tokens, "$surface"), "color");
    assert.equal(tokenKind(tokens, "$gap"), "spacing");
    assert.equal(tokenKind(tokens, "$font-main"), "font-family");
    assert.equal(tokenKind(tokens, "$shadow-card"), "shadow");
    assert.equal(tokenKind(tokens, "var(--text-primary)"), "color");

    const openTokens = await buildWorkspaceCssTokens(root, [
      {
        source: "global css\n\t$draft: gray9\n",
        sourcePath: themePath,
        uri: pathToFileURL(themePath).toString(),
      },
    ]);
    assert.ok(openTokens.some((token) => token.name === "$draft"));
    assert.equal(openTokens.some((token) => token.name === "$surface"), false);

    const sourceTokens = collectCssTokensFromSource(
      "<div [$inline-gap: 12px --inline-color: red5]>",
      "file:///inline.imba",
    );
    assert.ok(sourceTokens.some((token) => token.name === "$inline-gap"));
    assert.ok(sourceTokens.some((token) => token.name === "--inline-color"));
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }

  console.log("css-tokens.test ok");
}

function tokenKind(
  tokens: Awaited<ReturnType<typeof buildWorkspaceCssTokens>>,
  insertText: string,
): string {
  const token = tokens.find((item) => item.insertText === insertText);
  assert.ok(token, `missing token ${insertText}`);
  return token.valueKind;
}
