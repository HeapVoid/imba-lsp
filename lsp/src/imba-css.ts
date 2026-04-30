import {
  CompletionItemKind,
  MarkupKind,
  Range,
  TextEdit,
  type CompletionItem,
  type Hover,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { resolveImbaCompiler } from "./compiler";
import {
  collectCssTokensFromSource,
  type CssToken,
  type CssTokenValueKind,
} from "./css-tokens";

type CssAliasTarget = string | string[];

interface ImbaCssCompilerData {
  aliases?: Record<string, CssAliasTarget>;
  modifiers?: Record<string, unknown>;
  variants?: Record<string, Record<string, unknown>>;
}

interface CssPropertyInfo {
  aliases: string[];
  canonical: string;
  deprecated: boolean;
  name: string;
  target: CssAliasTarget;
  type: "shortcut" | "property";
}

interface CssContext {
  kind: "property" | "value" | "modifier";
  propertyName?: string;
}

const fallbackAliases: Record<string, CssAliasTarget> = {
  ai: "align-items",
  bd: "border",
  bg: "background",
  bgc: "background-color",
  bxs: "box-shadow",
  c: "color",
  cur: "cursor",
  d: "display",
  ff: "font-family",
  fl: "flex",
  fld: "flex-direction",
  fs: "font-size",
  fw: "font-weight",
  g: "gap",
  h: "height",
  jc: "justify-content",
  lh: "line-height",
  m: "margin",
  mah: "max-height",
  maw: "max-width",
  mih: "min-height",
  miw: "min-width",
  o: "opacity",
  of: "overflow",
  p: "padding",
  pos: "position",
  rd: "border-radius",
  s: "size",
  ta: "text-align",
  td: "text-decoration",
  tween: "transition",
  w: "width",
};

const commonCssProperties = [
  "animation",
  "aspect-ratio",
  "backdrop-filter",
  "background",
  "background-color",
  "border",
  "border-bottom",
  "border-color",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "bottom",
  "box-shadow",
  "box-sizing",
  "clip-path",
  "color",
  "content",
  "cursor",
  "display",
  "filter",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "height",
  "inset",
  "left",
  "line-height",
  "margin",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "opacity",
  "overflow",
  "padding",
  "pointer-events",
  "position",
  "right",
  "text-align",
  "text-decoration",
  "text-overflow",
  "top",
  "transform",
  "transition",
  "user-select",
  "visibility",
  "white-space",
  "width",
  "z-index",
];

const deprecatedShortcuts = new Set(["e", "j", "a", "shadow", "ts"]);
const cssWordCharacterPattern = /[$#@A-Za-z_0-9-]/;

const colorFamilies = [
  "warm",
  "warmer",
  "gray",
  "cool",
  "cooler",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
  "zinc",
  "stone",
  "neutral",
];

const namedColors = [
  "black",
  "white",
  "transparent",
  "clear",
  "currentColor",
  "inherit",
];

const colorValues = [
  ...namedColors,
  ...colorFamilies.flatMap((family) =>
    Array.from({ length: 10 }, (_, index) => `${family}${index}`)
  ),
  "black/10",
  "black/20",
  "black/30",
  "white/10",
  "white/20",
  "blue6/20",
  "blue6/40",
  "$base1",
  "$base9",
  "$font1",
  "$font9",
  "$spot4",
  "#site-bg",
  "var(--color)",
];

const sharedValues = [
  "inherit",
  "initial",
  "unset",
  "revert",
  "var(--name)",
];

const lengthValues = [
  "0",
  "1px",
  "2px",
  "4px",
  "8px",
  "12px",
  "16px",
  "24px",
  "32px",
  "0.5rem",
  "1rem",
  "100%",
  "100vh",
  "100vw",
  "auto",
  "fit-content",
  "min-content",
  "max-content",
];

const spacingValues = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "6",
  "8",
  "12",
  "16px",
  "1rem",
  "auto",
];

const displayLayouts = [
  "none",
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "contents",
  "vflex",
  "hflex",
  "box",
  "vbox",
  "hbox",
  "vcc",
  "hcc",
  "vtl",
  "hcl",
  "vbr",
  "hbr",
];

const alignmentValues = [
  "normal",
  "start",
  "end",
  "center",
  "stretch",
  "baseline",
  "flex-start",
  "flex-end",
  "space-between",
  "space-around",
  "space-evenly",
];

const propertyValueHints: Record<string, string[]> = {
  "align-content": alignmentValues,
  "align-items": alignmentValues,
  "align-self": alignmentValues,
  "background-attachment": ["scroll", "fixed", "local"],
  "background-clip": ["border-box", "padding-box", "content-box", "text"],
  "background-image": ["none", "url()", "linear-gradient()", "radial-gradient()"],
  "background-position": ["center", "top", "right", "bottom", "left", "50% 50%"],
  "background-repeat": ["no-repeat", "repeat", "repeat-x", "repeat-y", "space", "round"],
  "background-size": ["cover", "contain", "auto", "100% 100%"],
  "border": ["1px solid gray3", "1px solid currentColor", "0", "none"],
  "border-style": ["solid", "dashed", "dotted", "double", "none"],
  "box-shadow": ["none", "xs", "sm", "md", "lg", "xl", "0 4px 12px black/20"],
  "box-sizing": ["border-box", "content-box"],
  "cursor": ["pointer", "default", "text", "grab", "grabbing", "not-allowed"],
  "display": displayLayouts,
  "flex": ["1", "auto", "none", "0 0 auto", "1 1 0"],
  "flex-basis": lengthValues,
  "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
  "flex-flow": ["row nowrap", "row wrap", "column nowrap", "column wrap"],
  "flex-grow": ["0", "1"],
  "flex-shrink": ["0", "1"],
  "flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
  "font-family": ["sans", "serif", "mono", "system-ui"],
  "font-size": ["xxs", "xs", "sm-", "sm", "md-", "md", "lg", "xl", "2xl", "16px"],
  "font-weight": ["100", "200", "300", "400", "500", "600", "700", "800", "900", "normal", "bold"],
  "gap": spacingValues,
  "grid-auto-flow": ["row", "column", "dense", "row dense", "column dense"],
  "grid-template-columns": ["1fr", "repeat(2, 1fr)", "repeat(3, 1fr)", "minmax(0, 1fr)", "auto"],
  "grid-template-rows": ["auto", "1fr", "repeat(2, 1fr)", "minmax(0, 1fr)"],
  "justify-align": alignmentValues,
  "justify-content": alignmentValues,
  "justify-items": alignmentValues,
  "justify-self": alignmentValues,
  "letter-spacing": ["xs", "sm", "md", "lg", "0.01em", "0.05em"],
  "line-height": ["1", "1.2", "1.4", "1.5", "normal"],
  "object-fit": ["cover", "contain", "fill", "scale-down", "none"],
  "opacity": ["0", "0.1", "0.25", "0.5", "0.75", "1"],
  "outline": ["none", "1px solid currentColor", "2px solid blue6"],
  "overflow": ["visible", "hidden", "clip", "scroll", "auto"],
  "overflow-x": ["visible", "hidden", "clip", "scroll", "auto"],
  "overflow-y": ["visible", "hidden", "clip", "scroll", "auto"],
  "place-content": alignmentValues,
  "place-items": alignmentValues,
  "place-self": alignmentValues,
  "pointer-events": ["auto", "none"],
  "position": ["static", "relative", "absolute", "fixed", "sticky", "rel", "abs", "fix", "stk"],
  "text-align": ["left", "right", "center", "justify", "start", "end"],
  "text-decoration": ["none", "underline", "line-through", "overline"],
  "text-decoration-line": ["none", "underline", "line-through", "overline"],
  "text-decoration-skip-ink": ["auto", "none", "all"],
  "text-decoration-style": ["solid", "double", "dotted", "dashed", "wavy"],
  "text-emphasis-position": ["over right", "over left", "under right", "under left"],
  "text-emphasis-style": ["none", "filled", "open", "dot", "circle", "double-circle", "triangle"],
  "text-overflow": ["clip", "ellipsis"],
  "text-transform": ["none", "uppercase", "lowercase", "capitalize"],
  "transition": ["ease-in-out .2s", "ease .2s", "all .2s ease", "none"],
  "transform-origin": ["center", "top", "right", "bottom", "left", "top left"],
  "user-select": ["auto", "none", "text", "all"],
  "vertical-align": ["baseline", "middle", "top", "bottom", "sub", "super"],
  "visibility": ["visible", "hidden", "collapse"],
  "white-space": ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"],
  "z-index": ["0", "1", "10", "100", "999", "auto"],
};

const dimensionProperties = new Set([
  "bottom",
  "height",
  "inset",
  "left",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "right",
  "size",
  "top",
  "width",
]);

const spacingProperties = new Set([
  "column-gap",
  "gap",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-x",
  "margin-y",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-x",
  "padding-y",
  "row-gap",
]);

const colorPropertyPattern = /(?:^|-)color$|^(?:background|caret-color|fill|stroke)$/;
const borderColorPattern = /^border(?:-.+)?-color$|^border-[xy]-color$/;
const borderWidthPattern = /^border(?:-.+)?-width$|^border-[xy]-width$/;
const borderRadiusPattern = /^border(?:-.+)?-radius$|^radius$/;
const transformPropertyPattern = /^(?:x|y|z|rotate|scale|scale-x|scale-y|skew-x|skew-y)$/;
const borderShorthandProperties = new Set([
  "border",
  "border-bottom",
  "border-left",
  "border-right",
  "border-top",
  "border-x",
  "border-y",
  "outline",
]);

export function buildCssCompletionItems(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  workspaceTokens: CssToken[] = [],
): CompletionItem[] | null {
  const source = document.getText();
  const line = lineAt(source, position.line);
  const prefix = line.slice(0, position.character);
  if (!isCssContext(source, position, prefix)) return null;

  const cssTokens = cssTokensForDocument(document, workspaceTokens);
  const context = cssContextForPrefix(prefix);
  if (context.kind === "modifier") {
    const replacementRange = modifierRangeAtPosition(document, position);
    return uniqueItems(
      modifierNames(sourcePath).map((modifier) =>
        withReplacementRange(
          item(`@${modifier}`, CompletionItemKind.EnumMember, "Imba CSS modifier", "10", undefined, modifier),
          replacementRange,
        ),
      ),
    );
  }

  const replacementRange = wordRangeAtPosition(document, position);
  if (context.kind === "value") {
    return uniqueItems(
      valueItemsForProperty(context.propertyName ?? "", sourcePath, cssTokens).map((entry) =>
        withReplacementRange(entry, replacementRange),
      ),
    );
  }

  return uniqueItems(
    propertyInfos(sourcePath).map((info) =>
      withPropertyReplacementRange(propertyItem(info), document, replacementRange),
    ),
  );
}

export function buildCssHover(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  workspaceTokens: CssToken[] = [],
): Hover | null {
  const source = document.getText();
  const line = lineAt(source, position.line);
  if (!isCssContext(source, position, line.slice(0, position.character))) return null;

  const token = cssTokenAtPosition(document, position);
  if (!token) return null;

  const cssToken = cssTokenForName(token.name, document, workspaceTokens);
  if (cssToken) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: cssTokenHoverMarkdown(cssToken),
      },
      range: token.range,
    };
  }

  const name = cssPropertyNameFromToken(token.name);
  const info = propertyInfoFor(name, sourcePath);
  if (!info) return null;

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: cssPropertyHoverMarkdown(info, sourcePath, cssTokensForDocument(document, workspaceTokens)),
    },
    range: token.range,
  };
}

function propertyItem(info: CssPropertyInfo): CompletionItem {
  const deprecated = info.deprecated ? " deprecated" : "";
  const detail = info.type === "shortcut"
    ? `Imba CSS shortcut${deprecated}: ${targetLabel(info.target)}`
    : info.aliases.length > 0
      ? `CSS property, shortcut: ${info.aliases[0]}`
      : "CSS property";

  return item(
    info.name,
    CompletionItemKind.Property,
    detail,
    info.type === "shortcut" ? "10" : "30",
    cssPropertyHoverMarkdown(info, null),
  );
}

function valueItemsForProperty(
  propertyName: string,
  sourcePath: string | null,
  tokens: CssToken[],
): CompletionItem[] {
  const canonical = canonicalCssProperty(propertyName, sourcePath);
  const tokenItems = projectTokenItemsForProperty(canonical, tokens);
  const values = valuesForCanonicalProperty(canonical, sourcePath);

  return [
    ...tokenItems,
    ...values.map((value) =>
      item(value, CompletionItemKind.Value, `CSS value for ${canonical || propertyName}`, "20"),
    ),
  ];
}

function valuesForCanonicalProperty(
  canonical: string,
  sourcePath: string | null,
): string[] {
  const values = [
    ...(propertyValueHints[canonical] ?? []),
    ...variantValuesForProperty(canonical, sourcePath),
  ];

  if (colorPropertyPattern.test(canonical) || borderColorPattern.test(canonical)) {
    values.push(...colorValues);
  }

  if (dimensionProperties.has(canonical)) {
    values.push(...lengthValues);
  }

  if (spacingProperties.has(canonical)) {
    values.push(...spacingValues);
  }

  if (borderWidthPattern.test(canonical)) {
    values.push("0", "1px", "2px", "thin", "medium", "thick");
  }

  if (borderRadiusPattern.test(canonical)) {
    values.push("0", "xs", "sm", "md", "lg", "xl", "full", "9999px");
  }

  if (transformPropertyPattern.test(canonical)) {
    values.push("0", "1px", "8px", "1rem", "45deg", "90deg", "1", "1.05");
  }

  return uniqueStrings([...values, ...sharedValues]);
}

function variantValuesForProperty(
  canonical: string,
  sourcePath: string | null,
): string[] {
  const variants = compilerData(sourcePath).variants ?? {};
  const keys = new Set<string>();

  if (canonical === "border-radius") {
    for (const key of Object.keys(variants.radius ?? {})) keys.add(key);
  }

  if (canonical === "font-size") {
    for (const key of Object.keys(variants["font-size"] ?? {})) keys.add(key);
  }

  if (canonical === "box-shadow") {
    for (const key of Object.keys(variants["box-shadow"] ?? {})) keys.add(key);
  }

  keys.delete("NUMBER");
  return [...keys].sort();
}

function cssPropertyHoverMarkdown(
  info: CssPropertyInfo,
  sourcePath: string | null,
  tokens: CssToken[] = [],
): string {
  const lines = [
    info.type === "shortcut"
      ? `Imba CSS shortcut \`${info.name}\``
      : `CSS property \`${info.name}\``,
  ];

  if (info.deprecated) {
    lines.push("", "**Deprecated shortcut.** Prefer the non-deprecated property/shortcut.");
  }

  if (info.type === "shortcut") {
    lines.push("", `Expands to: \`${targetLabel(info.target)}\`.`);
  } else if (info.aliases.length > 0) {
    lines.push("", `Preferred Imba shortcut: \`${info.aliases[0]}\`.`);
  }

  const canonical = info.canonical;
  const tokenValues = projectTokenItemsForProperty(canonical, tokens).map((entry) => entry.label);
  const values = [
    ...tokenValues,
    ...valuesForCanonicalProperty(canonical, sourcePath),
  ].slice(0, 18);
  if (values.length > 0) {
    lines.push("", `Common values: ${values.map((value) => `\`${value}\``).join(", ")}.`);
  }

  return lines.join("\n");
}

function projectTokenItemsForProperty(
  canonical: string,
  tokens: CssToken[],
): CompletionItem[] {
  return tokens
    .filter((token) => isUsefulTokenForProperty(token, canonical))
    .map((token) =>
      item(
        token.insertText,
        CompletionItemKind.Variable,
        cssTokenDetail(token),
        "05",
        cssTokenHoverMarkdown(token),
      ),
    );
}

function isUsefulTokenForProperty(token: CssToken, canonical: string): boolean {
  const expected = expectedTokenKindsForProperty(canonical);
  if (!expected) return token.valueKind === "unknown";

  return expected.has(token.valueKind);
}

function expectedTokenKindsForProperty(canonical: string): Set<CssTokenValueKind> | null {
  if (colorPropertyPattern.test(canonical) || borderColorPattern.test(canonical)) {
    return new Set(["color"]);
  }

  if (canonical === "font-family") return new Set(["font-family"]);
  if (canonical === "font-size") return new Set(["font-size", "length"]);
  if (canonical === "font-weight") return new Set(["font-weight"]);
  if (canonical === "box-shadow" || canonical === "text-shadow") return new Set(["shadow"]);
  if (borderRadiusPattern.test(canonical)) return new Set(["radius", "length"]);
  if (spacingProperties.has(canonical)) return new Set(["spacing", "length"]);
  if (dimensionProperties.has(canonical)) return new Set(["length"]);
  if (canonical === "display") return new Set(["display"]);
  if (canonical === "transition" || canonical.includes("duration") || canonical.includes("delay")) {
    return new Set(["duration", "easing"]);
  }
  if (borderShorthandProperties.has(canonical)) return new Set(["color", "length"]);

  return null;
}

function cssTokenForName(
  name: string,
  document: TextDocument,
  workspaceTokens: CssToken[],
): CssToken | null {
  const tokens = cssTokensForDocument(document, workspaceTokens);
  return tokens.find((token) =>
    token.name === name ||
    token.insertText === name ||
    (token.kind === "css-variable" && token.insertText === `var(${name})`)
  ) ?? null;
}

function cssTokensForDocument(
  document: TextDocument,
  workspaceTokens: CssToken[],
): CssToken[] {
  const documentTokens = collectCssTokensFromSource(document.getText(), document.uri);
  return uniqueCssTokens([...documentTokens, ...workspaceTokens]);
}

function cssTokenDetail(token: CssToken): string {
  const kind = token.valueKind === "unknown" ? "" : ` ${token.valueKind}`;

  switch (token.kind) {
    case "css-variable":
      return `Project${kind} CSS variable ${token.name}`;
    case "imba-color-variable":
      return `Project Imba color token ${token.name}`;
    default:
      return `Project${kind} Imba CSS token ${token.name}`;
  }
}

function cssTokenHoverMarkdown(token: CssToken): string {
  const lines = [
    `${cssTokenDetail(token)}.`,
    "",
    `Value: \`${token.value || "(empty)"}\`.`,
  ];
  const location = cssTokenLocation(token);
  if (location) {
    lines.push("", `Defined in \`${location}\`.`);
  }

  return lines.join("\n");
}

function cssTokenLocation(token: CssToken): string | null {
  if (!token.sourcePath) return null;
  return `${token.sourcePath}:${token.range.start.line + 1}:${token.range.start.character + 1}`;
}

function propertyInfoFor(
  name: string,
  sourcePath: string | null,
): CssPropertyInfo | null {
  return propertyInfos(sourcePath).find((info) => info.name === name) ?? null;
}

function propertyInfos(sourcePath: string | null): CssPropertyInfo[] {
  const aliases = compilerAliases(sourcePath);
  const infos: CssPropertyInfo[] = [];
  const aliasesByCanonical = new Map<string, string[]>();
  const propertyNames = new Set(commonCssProperties);

  for (const [name, target] of Object.entries(aliases)) {
    const canonical = canonicalTarget(target);
    propertyNames.add(canonical);
    pushMap(aliasesByCanonical, canonical, name);
    infos.push({
      aliases: [name],
      canonical,
      deprecated: deprecatedShortcuts.has(name),
      name,
      target,
      type: "shortcut",
    });
  }

  for (const name of propertyNames) {
    if (aliases[name]) continue;

    infos.push({
      aliases: aliasesByCanonical.get(name) ?? [],
      canonical: name,
      deprecated: false,
      name,
      target: name,
      type: "property",
    });
  }

  return infos.sort((left, right) =>
    `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
  );
}

function canonicalCssProperty(
  propertyName: string,
  sourcePath: string | null,
): string {
  const base = cssPropertyNameFromToken(propertyName);
  const target = compilerAliases(sourcePath)[base] ?? base;
  return canonicalTarget(target);
}

function canonicalTarget(target: CssAliasTarget): string {
  if (Array.isArray(target)) return target.join(", ");
  return target.replace(/@.+$/, "");
}

function targetLabel(target: CssAliasTarget): string {
  return Array.isArray(target) ? target.join(", ") : target;
}

function modifierNames(sourcePath: string | null): string[] {
  const modifiers = compilerData(sourcePath).modifiers ?? {};
  const names = Object.keys(modifiers);
  if (names.length > 0) return names.sort();

  return [
    "active",
    "after",
    "before",
    "checked",
    "dark",
    "disabled",
    "focus",
    "focus-visible",
    "hover",
    "lg",
    "md",
    "sm",
    "xl",
  ];
}

function compilerAliases(sourcePath: string | null): Record<string, CssAliasTarget> {
  return compilerData(sourcePath).aliases ?? fallbackAliases;
}

function compilerData(sourcePath: string | null): ImbaCssCompilerData {
  try {
    return resolveImbaCompiler(sourcePath).compiler as ImbaCssCompilerData;
  } catch {
    return { aliases: fallbackAliases };
  }
}

function cssContextForPrefix(prefix: string): CssContext {
  if (/(?:^|[\s\[])[-$#A-Za-z_][\w$#-]*[.@^!]*[\w.-]*@$/.test(prefix)) {
    return { kind: "modifier" };
  }

  const propertyMatch = prefix.match(
    /(?:^|[\s\[])([-$#A-Za-z_][\w$#-]*(?:[@.^!]+[\w.-]+)*):[^\n]*$/,
  );
  if (propertyMatch) {
    return {
      kind: "value",
      propertyName: propertyMatch[1],
    };
  }

  return { kind: "property" };
}

function isCssContext(source: string, position: Position, prefix: string): boolean {
  if (isInlineStyleContext(prefix)) return true;

  const lines = source.split("\n");
  const currentIndent = indentOf(lines[position.line] ?? "");

  for (let line = position.line; line >= 0; line--) {
    const text = lines[line] ?? "";
    if (!text.trim()) continue;

    const indent = indentOf(text);
    const trimmed = text.trim();

    if (/^(?:global\s+)?css(?:\s|$)/.test(trimmed)) {
      return line === position.line || indent < currentIndent;
    }

    if (indent < currentIndent) return false;
  }

  return false;
}

function isInlineStyleContext(prefix: string): boolean {
  return prefix.lastIndexOf("[") > prefix.lastIndexOf("]");
}

function cssTokenAtPosition(
  document: TextDocument,
  position: Position,
): { name: string; range: Range } | null {
  const source = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  let end = offset;

  if (!cssWordCharacterPattern.test(source[start] ?? "") && start > 0) {
    start--;
    end--;
  }

  if (!cssWordCharacterPattern.test(source[start] ?? "")) return null;

  while (start > 0 && cssWordCharacterPattern.test(source[start - 1] ?? "")) {
    start--;
  }

  while (end < source.length && cssWordCharacterPattern.test(source[end] ?? "")) {
    end++;
  }

  const name = source.slice(start, end);
  if (!/^[-$#A-Za-z_]/.test(name)) return null;

  return {
    name,
    range: Range.create(document.positionAt(start), document.positionAt(end)),
  };
}

function cssPropertyNameFromToken(token: string): string {
  return token.replace(/[@.^!]+.*$/, "");
}

function wordRangeAtPosition(document: TextDocument, position: Position): Range {
  const source = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  let end = offset;

  while (start > 0 && cssWordCharacterPattern.test(source[start - 1] ?? "")) {
    start--;
  }

  while (end < source.length && cssWordCharacterPattern.test(source[end] ?? "")) {
    end++;
  }

  return Range.create(document.positionAt(start), document.positionAt(end));
}

function modifierRangeAtPosition(document: TextDocument, position: Position): Range {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const at = source.lastIndexOf("@", offset - 1);
  const start = at >= lineStart ? at + 1 : offset;

  return Range.create(document.positionAt(start), position);
}

function item(
  label: string,
  kind: CompletionItemKind,
  detail: string,
  sortPrefix: string,
  documentation?: string,
  insertText = label,
): CompletionItem {
  return {
    label,
    kind,
    detail,
    documentation: documentation
      ? {
          kind: MarkupKind.Markdown,
          value: documentation,
        }
      : undefined,
    insertText,
    sortText: `${sortPrefix}_${label}`,
  };
}

function withPropertyReplacementRange(
  item: CompletionItem,
  document: TextDocument,
  range: Range,
): CompletionItem {
  const source = document.getText();
  const rangeEnd = document.offsetAt(range.end);
  const nextCharacter = source[rangeEnd] ?? "";
  const newText = nextCharacter === ":" ? item.label : `${item.label}:`;

  return {
    ...item,
    insertText: undefined,
    textEdit: TextEdit.replace(range, newText),
  };
}

function withReplacementRange(item: CompletionItem, range: Range): CompletionItem {
  const newText = item.insertText ?? item.label;
  return {
    ...item,
    insertText: undefined,
    textEdit: TextEdit.replace(range, newText),
  };
}

function uniqueItems(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  const result: CompletionItem[] = [];

  for (const item of items) {
    if (seen.has(item.label)) continue;
    seen.add(item.label);
    result.push(item);
  }

  return result;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function uniqueCssTokens(tokens: CssToken[]): CssToken[] {
  const seen = new Set<string>();
  const result: CssToken[] = [];

  for (const token of tokens) {
    const key = `${token.kind}:${token.name}:${token.insertText}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(token);
  }

  return result;
}

function pushMap(map: Map<string, string[]>, key: string, value: string): void {
  const items = map.get(key);
  if (items) {
    items.push(value);
  } else {
    map.set(key, [value]);
  }
}

function lineAt(source: string, line: number): string {
  return source.split("\n")[line] ?? "";
}

function indentOf(line: string): number {
  return line.match(/^\t*/)?.[0].length ?? 0;
}
