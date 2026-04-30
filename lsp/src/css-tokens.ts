import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Range } from "vscode-languageserver/node";
import { filePathFromUri } from "./uri";

export type CssTokenKind = "css-variable" | "imba-color-variable" | "imba-variable";

export interface CssToken {
  insertText: string;
  kind: CssTokenKind;
  name: string;
  range: Range;
  sourcePath: string | null;
  uri: string;
  value: string;
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

  return uniqueCssTokens(tokens);
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

  return uniqueCssTokens(tokens);
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
    const kind = tokenKind(name, value);
    if (!kind) continue;

    tokens.push({
      insertText: kind === "css-variable" ? `var(${name})` : name,
      kind,
      name,
      range: Range.create(line, start, line, start + name.length),
      sourcePath,
      uri,
      value,
    });
  }

  return tokens;
}

function tokenKind(name: string, value: string): CssTokenKind | null {
  if (name.startsWith("--")) return "css-variable";
  if (name.startsWith("$")) return "imba-variable";
  if (name.startsWith("#") && isColorishValue(value)) return "imba-color-variable";

  return null;
}

function cleanValue(value: string): string {
  return value
    .replace(/\s+#\s.*$/, "")
    .replace(/\s+\/\/.*$/, "")
    .replace(/\s+\/\*.*$/, "")
    .trim();
}

function isColorishValue(value: string): boolean {
  return /^(?:[$#]|var\(|hsl|hsla|rgb|rgba|oklch|color\(|light-dark\(|linear-gradient\(|radial-gradient\(|currentColor\b|transparent\b|clear\b|black\b|white\b|(?:warm|warmer|gray|cool|cooler|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|zinc|stone|neutral)\d)/.test(value);
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
