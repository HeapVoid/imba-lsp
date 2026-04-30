import {
  CompletionItemKind,
  type CompletionItem,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ImbaCompilation } from "./compiler";
import { buildTypeScriptCompletionItems } from "./typescript-completion";

export const completionTriggerCharacters = [".", "@", "<", ":", "[", " "] as const;

const keywords = [
  "and",
  "as",
  "await",
  "break",
  "catch",
  "class",
  "const",
  "continue",
  "css",
  "def",
  "do",
  "elif",
  "else",
  "export",
  "extend",
  "finally",
  "for",
  "from",
  "get",
  "global",
  "if",
  "import",
  "in",
  "isa",
  "let",
  "new",
  "not",
  "of",
  "or",
  "own",
  "prop",
  "return",
  "set",
  "tag",
  "throw",
  "try",
  "until",
  "unless",
  "var",
  "when",
  "while",
].sort();

const htmlTags = [
  "a",
  "article",
  "aside",
  "button",
  "canvas",
  "div",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "header",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "option",
  "p",
  "section",
  "select",
  "self",
  "span",
  "textarea",
  "ul",
].sort();

const tagAttributes = [
  "alt",
  "aria-label",
  "bind",
  "data",
  "disabled",
  "for",
  "href",
  "id",
  "name",
  "placeholder",
  "ref",
  "role",
  "src",
  "target",
  "title",
  "type",
  "value",
].sort();

const events = [
  "blur",
  "change",
  "click",
  "contextmenu",
  "error",
  "focus",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "load",
  "mousedown",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseup",
  "pointerdown",
  "pointerenter",
  "pointerleave",
  "pointermove",
  "pointerup",
  "submit",
  "touchcancel",
  "touchend",
  "touchmove",
  "touchstart",
].sort();

const cssProperties = [
  "ai",
  "bd",
  "bg",
  "bgc",
  "bxs",
  "c",
  "cur",
  "d",
  "ff",
  "fl",
  "fld",
  "fs",
  "fw",
  "g",
  "gtc",
  "gtr",
  "h",
  "jc",
  "lh",
  "m",
  "mah",
  "maw",
  "mih",
  "miw",
  "mx",
  "my",
  "o",
  "of",
  "ofx",
  "ofy",
  "p",
  "pos",
  "px",
  "py",
  "rd",
  "s",
  "ta",
  "td",
  "tween",
  "us",
  "w",
].sort();

const cssValues = [
  "black",
  "blue5",
  "blue6",
  "bold",
  "center",
  "flex",
  "gray1",
  "gray5",
  "gray9",
  "green5",
  "grid",
  "none",
  "pointer",
  "red5",
  "white",
].sort();

const globalItems = [
  "AbortController",
  "Array",
  "Blob",
  "Boolean",
  "Date",
  "Error",
  "FormData",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "RegExp",
  "Set",
  "String",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
  "cancelAnimationFrame",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "document",
  "fetch",
  "global",
  "globalThis",
  "history",
  "imba",
  "isFinite",
  "isNaN",
  "localStorage",
  "location",
  "navigator",
  "parseFloat",
  "parseInt",
  "performance",
  "process",
  "requestAnimationFrame",
  "screen",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "window",
].sort();

const commonMembers = [
  "active",
  "addEventListener",
  "appendChild",
  "body",
  "classList",
  "commit",
  "createElement",
  "dataset",
  "emit",
  "getElementById",
  "head",
  "length",
  "listen",
  "map",
  "mount",
  "querySelector",
  "remove",
  "removeEventListener",
  "setInterval",
  "setTimeout",
  "style",
  "textContent",
  "unmount",
  "value",
].sort();

export function buildCompletionItems(
  document: TextDocument,
  position: Position,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): CompletionItem[] {
  const source = document.getText();
  const line = getLine(source, position.line);
  const prefix = line.slice(0, position.character);
  const symbols = collectDocumentCompletions(source, compilation);

  if (isEventContext(prefix)) {
    return uniqueItems(
      events.map((event) => item(event, CompletionItemKind.Event, "Imba event", "20", `${event}=`)),
    );
  }

  if (isTagNameContext(prefix)) {
    return uniqueItems([
      ...htmlTags.map((tag) => item(tag, CompletionItemKind.Class, "HTML/Imba tag", "20")),
      ...symbols.tags,
    ]);
  }

  if (isTagClassContext(prefix)) {
    return uniqueItems(symbols.classes);
  }

  if (isTagContext(prefix)) {
    return uniqueItems([
      ...tagAttributes.map((attribute) =>
        item(attribute, CompletionItemKind.Property, "Tag attribute", "20"),
      ),
      ...events.map((event) =>
        item(`@${event}`, CompletionItemKind.Event, "Imba event", "21", `@${event}=`),
      ),
      ...symbols.general,
    ]);
  }

  if (isMemberContext(prefix)) {
    return uniqueItems([
      ...buildTypeScriptCompletionItems(document, position, sourcePath),
      ...symbols.members,
      ...commonMembers.map((member) => item(member, CompletionItemKind.Property, "Common member", "40")),
    ]);
  }

  if (isCssContext(source, position, prefix)) {
    return uniqueItems([
      ...cssProperties.map((property) =>
        item(property, CompletionItemKind.Property, "Imba CSS property", "20"),
      ),
      ...cssValues.map((value) => item(value, CompletionItemKind.Value, "Imba CSS value", "40")),
    ]);
  }

  return uniqueItems([
    ...keywords.map((keyword) => item(keyword, CompletionItemKind.Keyword, "Imba keyword", "10")),
    ...symbols.general,
    ...globalItems.map((global) => item(global, CompletionItemKind.Variable, "Global", "80")),
  ]);
}

interface DocumentCompletions {
  classes: CompletionItem[];
  general: CompletionItem[];
  members: CompletionItem[];
  tags: CompletionItem[];
}

function collectDocumentCompletions(
  source: string,
  _compilation: ImbaCompilation | undefined,
): DocumentCompletions {
  const general = new Map<string, CompletionItem>();
  const members = new Map<string, CompletionItem>();
  const tags = new Map<string, CompletionItem>();
  const classes = new Map<string, CompletionItem>();

  for (const match of source.matchAll(
    /^\t*(?:export\s+)?(?:static\s+)?(?:extend\s+)?(?:local\s+)?(?:global\s+)?(class|tag|def|get|set|prop|attr)\s+(@?[$A-Za-z_][\w$:-]*(?:\.[\w$-]+)?)/gm,
  )) {
    const keyword = match[1] ?? "";
    const name = match[2] ?? "";
    if (!name) continue;

    const completion = item(name, declarationKind(keyword), `Imba ${keyword}`, "30");
    general.set(name, completion);

    if (keyword === "tag") {
      tags.set(name, item(name, CompletionItemKind.Class, "Local Imba tag", "10"));
    }
  }

  for (const match of source.matchAll(/^\t+([$A-Za-z_][\w$?!-]*)\s*=/gm)) {
    const name = match[1] ?? "";
    if (name && !general.has(name)) {
      general.set(name, item(name, CompletionItemKind.Variable, "Local value", "50"));
    }
  }

  for (const match of source.matchAll(/(?:^|[({,\s])([$A-Za-z_][\w$?!-]*)\s*:/gm)) {
    const name = match[1] ?? "";
    if (name) {
      members.set(name, item(name, CompletionItemKind.Property, "Object key", "20"));
    }
  }

  for (const match of source.matchAll(/\.\s*([$A-Za-z_][\w$?!-]*)/g)) {
    const name = match[1] ?? "";
    if (name) {
      members.set(name, item(name, CompletionItemKind.Property, "Member", "30"));
    }
  }

  for (const name of collectClassNames(source)) {
    classes.set(name, item(name, CompletionItemKind.Class, "CSS class", "10"));
  }

  return {
    classes: [...classes.values()],
    general: [...general.values()],
    members: [...members.values()],
    tags: [...tags.values()],
  };
}

function collectClassNames(source: string): string[] {
  const names = new Set<string>();

  for (const match of source.matchAll(/(?:^|[\s,&>+~:(])\.([A-Za-z_][\w-]*)/gm)) {
    addClassName(names, match[1]);
  }

  for (const match of source.matchAll(/<[^>\n\s]+/g)) {
    const tagHead = match[0] ?? "";

    for (const classMatch of tagHead.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      addClassName(names, classMatch[1]);
    }
  }

  return [...names].sort();
}

function addClassName(names: Set<string>, name: string | undefined): void {
  if (name) {
    names.add(name);
  }
}

function declarationKind(keyword: string): CompletionItemKind {
  switch (keyword) {
    case "class":
    case "tag":
      return CompletionItemKind.Class;
    case "def":
    case "get":
    case "set":
      return CompletionItemKind.Method;
    case "prop":
    case "attr":
      return CompletionItemKind.Property;
    default:
      return CompletionItemKind.Variable;
  }
}

function isMemberContext(prefix: string): boolean {
  return /(?:\.|\?\.)[$A-Za-z_][\w$?!-]*$/.test(prefix) || /(?:\.|\?\.)$/.test(prefix);
}

function isEventContext(prefix: string): boolean {
  return /(?:^|[\s<])@[\w-]*$/.test(prefix);
}

function isTagNameContext(prefix: string): boolean {
  return /<[$A-Za-z][\w$:-]*$/.test(prefix) || /<$/.test(prefix);
}

function isTagClassContext(prefix: string): boolean {
  const tagStart = prefix.lastIndexOf("<");
  const tagEnd = prefix.lastIndexOf(">");
  if (tagStart <= tagEnd) return false;

  const tagPrefix = prefix.slice(tagStart);
  if (/\s/.test(tagPrefix)) return false;

  return /\.[$A-Za-z_][\w-]*$/.test(tagPrefix) || /\.$/.test(tagPrefix);
}

function isTagContext(prefix: string): boolean {
  const tagStart = prefix.lastIndexOf("<");
  const tagEnd = prefix.lastIndexOf(">");
  return tagStart > tagEnd;
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

    if (indent < currentIndent) {
      return false;
    }
  }

  return false;
}

function isInlineStyleContext(prefix: string): boolean {
  return prefix.lastIndexOf("[") > prefix.lastIndexOf("]");
}

function indentOf(line: string): number {
  return line.match(/^\t*/)?.[0].length ?? 0;
}

function getLine(source: string, line: number): string {
  return source.split("\n")[line] ?? "";
}

function item(
  label: string,
  kind: CompletionItemKind,
  detail: string,
  sortPrefix: string,
  insertText = label,
): CompletionItem {
  return {
    label,
    kind,
    detail,
    insertText,
    sortText: `${sortPrefix}_${label}`,
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
