import assert from "node:assert/strict";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildCssCompletionItems,
  buildCssHover,
} from "../src/imba-css";

const source = [
  "tag app",
  "\tdef render",
  "\t\t<div.card [pos:abs]> 'Hi'",
  "\tcss .card",
  "\t\t",
  "\t\tbgc:red5",
  "\t\td:flex",
  "\t\tbg@hover:blue6",
  "\t\tdisplay:grid",
  "",
].join("\n");

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
assert.equal(colorValueCompletion.has("maw"), false);

const grayValueCompletion = completionItem(positionBefore("red5"), "gray9");
assert.equal(completionTextEditNewText(grayValueCompletion), "gray9");

const displayValueCompletion = completionLabels(positionBefore("flex"));
assert.ok(displayValueCompletion.has("grid"));
assert.ok(displayValueCompletion.has("vflex"));
assert.ok(displayValueCompletion.has("hcc"));

const modifierCompletion = completionLabels(positionAfter("bg@"));
assert.ok(modifierCompletion.has("@hover"));
assert.ok(modifierCompletion.has("@focus"));

const hoverModifierCompletion = completionItem(positionAfter("bg@"), "@hover");
assert.equal(completionTextEditNewText(hoverModifierCompletion), "hover");

const inlineValueCompletion = completionLabels(positionAfter("[pos:"));
assert.ok(inlineValueCompletion.has("abs"));
assert.ok(inlineValueCompletion.has("rel"));
assert.ok(inlineValueCompletion.has("sticky"));

const shortcutHover = hoverText(buildCssHover(document, positionAfter("bgc"), null));
assert.match(shortcutHover, /Imba CSS shortcut `bgc`/);
assert.match(shortcutHover, /background-color/);
assert.match(shortcutHover, /Common values/);

const fullPropertyHover = hoverText(buildCssHover(document, positionAfter("display"), null));
assert.match(fullPropertyHover, /CSS property `display`/);
assert.match(fullPropertyHover, /Preferred Imba shortcut: `d`/);

console.log("imba-css.test ok");

function completionLabels(position: { line: number; character: number }): Set<string> {
  const items = buildCssCompletionItems(document, position, null);
  assert.ok(items, "expected CSS completions");
  return new Set(items.map((item) => item.label));
}

function completionItem(
  position: { line: number; character: number },
  label: string,
): NonNullable<ReturnType<typeof buildCssCompletionItems>>[number] {
  const items = buildCssCompletionItems(document, position, null);
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
