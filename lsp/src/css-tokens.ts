import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Range } from "vscode-languageserver/node";
import { filePathFromUri } from "./uri";

export type CssTokenKind = "css-variable" | "imba-color-variable" | "imba-variable";
export type CssTokenValueKind =
  | "color"
  | "display"
  | "duration"
  | "easing"
  | "font-family"
  | "font-size"
  | "font-weight"
  | "length"
  | "radius"
  | "shadow"
  | "spacing"
  | "unknown";

export interface CssToken {
  insertText: string;
  kind: CssTokenKind;
  name: string;
  range: Range;
  sourcePath: string | null;
  uri: string;
  value: string;
  valueKind: CssTokenValueKind;
}

export interface CssTokenDocument {
  source: string;
  sourcePath: string | null;
  uri: string;
}

const styleExtensions = new Set([".css", ".imba", ".less", ".sass", ".scss"]);

const ignoredDirectories = new Set([
  ".git",
  ".imba-lsp",
  ".zed",
  ".vscode",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

export async function buildWorkspaceCssTokens(
  rootPath: string,
  openDocuments: CssTokenDocument[] = [],
): Promise<CssToken[]> {
  const files = await collectWorkspaceStyleFiles(rootPath);
  const openByPath = new Map(
    openDocuments
      .filter((document) => document.sourcePath)
      .map((document) => [path.resolve(document.sourcePath as string), document]),
  );
  const tokens: CssToken[] = [];

  for (const file of files) {
    const open = openByPath.get(path.resolve(file));
    if (open) {
      tokens.push(...collectCssTokensFromSource(open.source, open.uri, open.sourcePath));
      continue;
    }

    try {
      const source = await fs.readFile(file, "utf8");
      tokens.push(...collectCssTokensFromSource(source, pathToFileURL(file).toString(), file));
    } catch {
      // Ignore transient file-system races from watcher updates.
    }
  }

  for (const document of openDocuments) {
    if (document.sourcePath && files.includes(path.resolve(document.sourcePath))) continue;
    tokens.push(...collectCssTokensFromSource(document.source, document.uri, document.sourcePath));
  }

  return uniqueCssTokens(resolveCssTokenReferences(tokens));
}

export function collectCssTokensFromSource(
  source: string,
  uri: string,
  sourcePath: string | null = filePathFromUri(uri),
): CssToken[] {
  const tokens: CssToken[] = [];
  const lines = source.split("\n");

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? "";
    if (/^\t*#(?:\s|$)/.test(text)) continue;

    tokens.push(...collectLineTokens(text, line, uri, sourcePath));
  }

  return uniqueCssTokens(resolveCssTokenReferences(tokens));
}

export function isStyleTokenFile(rootPath: string, file: string): boolean {
  if (!styleExtensions.has(path.extname(file))) return false;

  const relative = path.relative(path.resolve(rootPath), path.resolve(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;

  return !relative.split(path.sep).some((part) => ignoredDirectories.has(part));
}

async function collectWorkspaceStyleFiles(rootPath: string): Promise<string[]> {
  const files = new Set<string>();
  await collectStyleFilesIn(path.resolve(rootPath), files);
  return [...files].sort();
}

async function collectStyleFilesIn(target: string, files: Set<string>): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) return;

  if (stat.isFile()) {
    if (styleExtensions.has(path.extname(target))) {
      files.add(path.resolve(target));
    }
    return;
  }

  if (!stat.isDirectory()) return;
  if (ignoredDirectories.has(path.basename(target))) return;

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    await collectStyleFilesIn(path.join(target, entry.name), files);
  }
}

function collectLineTokens(
  text: string,
  line: number,
  uri: string,
  sourcePath: string | null,
): CssToken[] {
  const tokens: CssToken[] = [];
  const tokenPattern =
    /(^|[\s{;\[])([$#][A-Za-z_][\w-]*|--[A-Za-z_][\w-]*)\s*:\s*([^;\]\n]*?)(?=\s+(?:[$#][A-Za-z_][\w-]*|--[A-Za-z_][\w-]*)\s*:|[;\]\n]|$)/g;

  for (const match of text.matchAll(tokenPattern)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const value = cleanValue(match[3] ?? "");
    const start = match.index + prefix.length;
    const valueKind = inferValueKind(value);
    const kind = tokenKind(name, value, valueKind);
    if (!kind) continue;

    tokens.push({
      insertText: kind === "css-variable" ? `var(${name})` : name,
      kind,
      name,
      range: Range.create(line, start, line, start + name.length),
      sourcePath,
      uri,
      value,
      valueKind,
    });
  }

  return tokens;
}

function tokenKind(
  name: string,
  value: string,
  valueKind: CssTokenValueKind,
): CssTokenKind | null {
  if (name.startsWith("--")) return "css-variable";
  if (name.startsWith("$")) return "imba-variable";
  if (name.startsWith("#") && (valueKind === "color" || tokenReferenceName(value))) {
    return "imba-color-variable";
  }

  return null;
}

function inferValueKind(value: string): CssTokenValueKind {
  const normalizedValue = value.toLowerCase();

  if (tokenReferenceName(value)) return "unknown";
  if (isFontFamilyValue(normalizedValue)) return "font-family";
  if (isFontWeightValue(normalizedValue)) return "font-weight";
  if (isShadowValue(normalizedValue)) return "shadow";
  if (isDurationValue(normalizedValue)) return "duration";
  if (isEasingValue(normalizedValue)) return "easing";
  if (isDisplayValue(normalizedValue)) return "display";
  if (isColorishValue(value)) return "color";
  if (isLengthValue(normalizedValue)) return "length";

  return "unknown";
}

function cleanValue(value: string): string {
  return value
    .replace(/\s+#\s.*$/, "")
    .replace(/\s+\/\/.*$/, "")
    .replace(/\s+\/\*.*$/, "")
    .trim();
}

function isColorishValue(value: string): boolean {
  return /^(?:#[0-9a-fA-F]{3,8}\b|hsl|hsla|rgb|rgba|oklch|color\(|light-dark\(|linear-gradient\(|radial-gradient\(|currentColor\b|transparent\b|clear\b|black\b|white\b|(?:warm|warmer|gray|cool|cooler|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|zinc|stone|neutral)\d)/.test(value);
}

function isFontFamilyValue(value: string): boolean {
  return /(?:system-ui|sans-serif|serif|monospace|menlo|inter|roboto|arial|georgia|mono|sans\b)/.test(value);
}

function isFontWeightValue(value: string): boolean {
  return /^(?:normal|bold|lighter|bolder|[1-9]00)$/.test(value);
}

function isShadowValue(value: string): boolean {
  return /\b\d+(?:px|rem|em)?\s+\d+(?:px|rem|em)?/.test(value) &&
    /(?:black|white|gray|rgba|hsla|#)/.test(value);
}

function isDurationValue(value: string): boolean {
  return /^\d+(?:ms|s)$/.test(value);
}

function isEasingValue(value: string): boolean {
  return /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\()/.test(value);
}

function isDisplayValue(value: string): boolean {
  return /^(?:none|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|vflex|hflex|box|vbox|hbox|vcc|hcc|vtl|hcl|vbr|hbr)$/.test(value);
}

function isLengthValue(value: string): boolean {
  return /^(?:0|auto|fit-content|min-content|max-content|calc\(|clamp\(|min\(|max\(|-?\d+(?:\.\d+)?(?:px|rem|em|ch|vw|vh|vmin|vmax|%|elw|elh)?)$/.test(value);
}

function resolveCssTokenReferences(tokens: CssToken[]): CssToken[] {
  const resolved = tokens.map((token) => ({ ...token }));
  const byName = new Map<string, CssToken>();
  for (const token of resolved) {
    const existing = byName.get(token.name);
    if (!existing || (existing.valueKind === "unknown" && token.valueKind !== "unknown")) {
      byName.set(token.name, token);
    }
  }

  for (let pass = 0; pass < resolved.length; pass++) {
    let changed = false;

    for (const token of resolved) {
      if (token.valueKind !== "unknown") continue;

      const referenceName = tokenReferenceName(token.value);
      if (!referenceName) continue;

      const reference = byName.get(referenceName);
      if (!reference || reference.valueKind === "unknown") continue;

      token.valueKind = reference.valueKind;
      changed = true;
    }

    if (!changed) break;
  }

  return resolved;
}

function tokenReferenceName(value: string): string | null {
  const trimmed = value.trim();
  const cssVariable = trimmed.match(/^var\(\s*(--[A-Za-z_][\w-]*)\s*\)$/);
  if (cssVariable) return cssVariable[1];
  if (/^\$[A-Za-z_][\w-]*$/.test(trimmed)) return trimmed;
  if (/^#[A-Za-z_][\w-]*$/.test(trimmed) && !/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
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

  return result.sort((left, right) => left.insertText.localeCompare(right.insertText));
}
