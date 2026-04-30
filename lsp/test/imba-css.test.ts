import assert from "node:assert/strict";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildCssCompletionItems,
  buildCssHover,
} from "../src/imba-css";
import { collectCssTokensFromSource } from "../src/css-tokens";

const source = [
  "tag app",
  "\tdef render",
  "\t\t<div.card [pos:abs]> 'Hi'",
  "\t\t<div.card data-items=[items[index]] @click=save [d:flex g:]> 'Complex'",
  "\tcss .card",
  "\t\t",
  "\t\tbgc:red5",
  "\t\td:flex",
  "\t\tbg@hover:blue6",
  "\t\tdisplay:grid",
  "\t\tc:$surface",
  "\t\tbc:var(--text-primary)",
  "\t\tff:sans",
  "\t\tbxs:none",
  "",
].join("\n");
const workspaceTokens = collectCssTokensFromSource(
  [
    "global css",
    "\t$surface: warm1",
    "\t$surface-alias: $surface",
    "\t$surface-name-only: tokenish",
    "\t$gap: 8px",
    "\t$layout: flex",
    "\t$layout-alias: $layout",
    "\t$font-main: sans",
    "\t$shadow-card: 0 4px 12px black/20",
    "\t#brand: blue6",
    "\t#brand-alias: #brand",
    "\t--text-primary: gray9",
    "\t--text-alias: var(--text-primary)",
    "",
  ].join("\n"),
  "file:///theme.imba",
);

const document = TextDocument.create(
  "file:///test.imba",
  "imba",
  0,
  source,
);

const propertyCompletion = completionLabels(positionBefore("\t\tbgc:red5"));
assert.ok(propertyCompletion.has("bgc"));
assert.ok(propertyCompletion.has("maw"));
assert.ok(propertyCompletion.has("bdt"));
assert.ok(propertyCompletion.has("background-color"));
assert.ok(propertyCompletion.has("display"));

const blankPropertyCompletion = completionItem(positionAfter("\tcss .card\n\t\t"), "bgc");
assert.equal(completionTextEditNewText(blankPropertyCompletion), "bgc:");

const colorValueCompletion = completionLabels(positionBefore("red5"));
assert.ok(colorValueCompletion.has("gray9"));
assert.ok(colorValueCompletion.has("blue6/40"));
assert.ok(colorValueCompletion.has("$base9"));
assert.ok(colorValueCompletion.has("$surface"));
assert.ok(colorValueCompletion.has("$surface-alias"));
assert.ok(colorValueCompletion.has("#brand"));
assert.ok(colorValueCompletion.has("#brand-alias"));
assert.ok(colorValueCompletion.has("var(--text-primary)"));
assert.ok(colorValueCompletion.has("var(--text-alias)"));
assert.equal(colorValueCompletion.has("$surface-name-only"), false);
assert.equal(colorValueCompletion.has("$gap"), false);
assert.equal(colorValueCompletion.has("$layout"), false);
assert.equal(colorValueCompletion.has("$font-main"), false);
assert.equal(colorValueCompletion.has("maw"), false);

const grayValueCompletion = completionItem(positionBefore("red5"), "gray9");
assert.equal(completionTextEditNewText(grayValueCompletion), "gray9");

const displayValueCompletion = completionLabels(positionBefore("flex"));
assert.ok(displayValueCompletion.has("grid"));
assert.ok(displayValueCompletion.has("vflex"));
assert.ok(displayValueCompletion.has("hcc"));
assert.ok(displayValueCompletion.has("$layout"));
assert.ok(displayValueCompletion.has("$layout-alias"));
assert.equal(displayValueCompletion.has("$surface"), false);
assert.equal(displayValueCompletion.has("$surface-name-only"), false);
assert.equal(displayValueCompletion.has("#brand"), false);

const fontValueCompletion = completionLabels(positionBefore("sans"));
assert.ok(fontValueCompletion.has("$font-main"));
assert.equal(fontValueCompletion.has("$surface"), false);

const shadowValueCompletion = completionLabels(positionBefore("none"));
assert.ok(shadowValueCompletion.has("$shadow-card"));
assert.equal(shadowValueCompletion.has("$surface"), false);

const modifierCompletion = completionLabels(positionAfter("bg@"));
assert.ok(modifierCompletion.has("@hover"));
assert.ok(modifierCompletion.has("@focus"));

const hoverModifierCompletion = completionItem(positionAfter("bg@"), "@hover");
assert.equal(completionTextEditNewText(hoverModifierCompletion), "hover");

const inlineValueCompletion = completionLabels(positionAfter("[pos:"));
assert.ok(inlineValueCompletion.has("abs"));
assert.ok(inlineValueCompletion.has("rel"));
assert.ok(inlineValueCompletion.has("sticky"));

const complexInlinePropertyCompletion = completionLabels(positionAfter("@click=save ["));
assert.ok(complexInlinePropertyCompletion.has("bgc"));
assert.ok(complexInlinePropertyCompletion.has("maw"));
assert.equal(buildCssCompletionItems(document, positionAfter("items["), null, workspaceTokens), null);

const complexInlineGapCompletion = completionLabels(positionAfter("d:flex g:"));
assert.ok(complexInlineGapCompletion.has("8"));
assert.ok(complexInlineGapCompletion.has("16px"));
assert.equal(complexInlineGapCompletion.has("grid"), false);

const shortcutHover = hoverText(buildCssHover(document, positionAfter("bgc"), null));
assert.match(shortcutHover, /Imba CSS shortcut `bgc`/);
assert.match(shortcutHover, /background-color/);
assert.match(shortcutHover, /Common values/);

const fullPropertyHover = hoverText(buildCssHover(document, positionAfter("display"), null));
assert.match(fullPropertyHover, /CSS property `display`/);
assert.match(fullPropertyHover, /Preferred Imba shortcut: `d`/);

const tokenHover = hoverText(buildCssHover(document, positionAfter("$surface"), null, workspaceTokens));
assert.match(tokenHover, /Project color Imba CSS token \$surface/);
assert.match(tokenHover, /warm1/);

const cssVariableHover = hoverText(buildCssHover(document, positionAfter("--text-primary"), null, workspaceTokens));
assert.match(cssVariableHover, /Project color CSS variable --text-primary/);
assert.match(cssVariableHover, /gray9/);

console.log("imba-css.test ok");

function completionLabels(position: { line: number; character: number }): Set<string> {
  const items = buildCssCompletionItems(document, position, null, workspaceTokens);
  assert.ok(items, "expected CSS completions");
  return new Set(items.map((item) => item.label));
}

function completionItem(
  position: { line: number; character: number },
  label: string,
): NonNullable<ReturnType<typeof buildCssCompletionItems>>[number] {
  const items = buildCssCompletionItems(document, position, null, workspaceTokens);
  assert.ok(items, "expected CSS completions");
  const match = items.find((item) => item.label === label);
  assert.ok(match, `missing completion ${JSON.stringify(label)}`);
  return match;
}

function completionTextEditNewText(
  item: NonNullable<ReturnType<typeof buildCssCompletionItems>>[number],
): string {
  const textEdit = item.textEdit;
  assert.ok(textEdit && "newText" in textEdit, "missing completion text edit");
  return textEdit.newText;
}

function hoverText(hover: ReturnType<typeof buildCssHover>): string {
  const contents = hover?.contents;
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.join("\n");
  return typeof contents.value === "string" ? contents.value : "";
}

function positionBefore(needle: string): { line: number; character: number } {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `missing source needle ${JSON.stringify(needle)}`);
  return positionAtOffset(offset);
}

function positionAfter(needle: string): { line: number; character: number } {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `missing source needle ${JSON.stringify(needle)}`);
  return positionAtOffset(offset + needle.length);
}

function positionAtOffset(offset: number): { line: number; character: number } {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}
