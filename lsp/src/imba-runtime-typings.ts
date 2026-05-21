import path from "node:path";
import { createRequire } from "node:module";
import * as ts from "typescript";

export interface ImbaRuntimeTypings {
  fileName: string;
  source: string;
}

const imbaModuleAnyExports = [
  "Accessor",
  "Action",
  "CUSTOM_TYPES",
  "ClassFlags",
  "Comment",
  "ComputedType",
  "CustomEvent",
  "Document",
  "DocumentFragment",
  "EaseGroup",
  "Easer",
  "Element",
  "ElementRoute",
  "ElementRouteTo",
  "Emitter",
  "Event",
  "EventHandler",
  "FocusEvent",
  "Fragment",
  "HAS",
  "HTMLButtonElement",
  "HTMLElement",
  "HTMLHtmlElement",
  "HTMLInputElement",
  "HTMLLinkElement",
  "HTMLOptionElement",
  "HTMLScriptElement",
  "HTMLSelectElement",
  "HTMLStyleElement",
  "HTMLTextAreaElement",
  "ImbaElement",
  "IntersectionEventDefaults",
  "KeyboardEvent",
  "LazyProxy",
  "Location",
  "MouseEvent",
  "Node",
  "OBSERVED",
  "ObservableArray",
  "PointerEvent",
  "Queue",
  "Ref",
  "RenderContext",
  "Router",
  "SVGElement",
  "SVGSVGElement",
  "Scheduler",
  "ShadowRoot",
  "StyleDeclaration",
  "Text",
  "Touch",
  "UIEvent",
  "Window",
  "__has__$",
  "__hooks__$",
  "__imba__$",
  "__init__$",
  "__inited__$",
  "__initor__$",
  "__meta__$",
  "__mixin__$",
  "__patch__$",
  "__served__",
  "accessor",
  "afterReconcile$",
  "afterVisit$",
  "appendChild$",
  "atomic",
  "augment$",
  "autorun",
  "awaits",
  "beforeReconcile$",
  "clearInterval",
  "clearTimeout",
  "colors",
  "commit",
  "createAtom",
  "createComment",
  "createComponent",
  "createDynamic",
  "createElement",
  "createFragment",
  "createIndexedList",
  "createKeyedList",
  "createLiveFragment",
  "createRef",
  "createRenderContext",
  "createSVGElement",
  "createSlot",
  "createTextNode",
  "customElements",
  "decorate$",
  "defineConfig",
  "defineTag",
  "descriptor",
  "devlog$",
  "disposeObservables",
  "document",
  "emit",
  "env",
  "events",
  "extend$",
  "getComputed",
  "getDeepPropertyDescriptor",
  "getRenderContext",
  "getSuperTagType",
  "getTagType",
  "get_document",
  "has$",
  "hooks",
  "hotkeys",
  "hydrate",
  "idx$",
  "inited$",
  "is$",
  "isa$",
  "iterable$",
  "listen",
  "locals",
  "logFormatter",
  "matcher",
  "memofunc",
  "mount",
  "multi$",
  "observable",
  "once",
  "parseTime",
  "proxy",
  "register$",
  "render",
  "renderContext",
  "renderer",
  "reportChanged",
  "reportInvalidated",
  "reportObserved",
  "router",
  "run",
  "rx",
  "scheduler",
  "serve",
  "session",
  "setInterval",
  "setTimeout",
  "spy",
  "statics$",
  "styles",
  "sup$",
  "toCamelCase",
  "transitions",
  "unlisten",
  "unmount",
  "up$",
  "use_devlog",
  "use_dom_bind",
  "use_dom_teleport",
  "use_dom_transitions",
  "use_events",
  "use_events_hotkey",
  "use_events_intersect",
  "use_events_keyboard",
  "use_events_mouse",
  "use_events_mutate",
  "use_events_pointer",
  "use_events_resize",
  "use_events_selection",
  "use_events_touch",
  "use_hooks",
  "use_router",
  "use_slots",
  "use_styles",
  "use_window",
  "\u03b1action",
  "\u03b1autorun",
  "\u03b1bound",
  "\u03b1computed",
  "\u03b1lazy",
  "\u03b1observable",
  "\u03b1prop",
  "\u03b1ref",
  "\u03b1thenable",
];

const imbaRuntimeAnyExports = [
  "ClassFlags",
  "HAS",
  "__has__$",
  "__hooks__$",
  "__imba__$",
  "__init__$",
  "__inited__$",
  "__initor__$",
  "__meta__$",
  "__mixin__$",
  "__patch__$",
  "afterReconcile$",
  "afterVisit$",
  "appendChild$",
  "augment$",
  "beforeReconcile$",
  "decorate$",
  "devlog$",
  "extend$",
  "has$",
  "idx$",
  "inited$",
  "is$",
  "isa$",
  "iterable$",
  "matcher",
  "multi$",
  "register$",
  "statics$",
  "sup$",
  "up$",
];

const typingsCache = new Map<string, ImbaRuntimeTypings | null>();

export function imbaRuntimeTypingsFor(currentDirectory: string): ImbaRuntimeTypings | null {
  const resolvedDirectory = path.resolve(currentDirectory);
  const cached = typingsCache.get(resolvedDirectory);
  if (cached !== undefined) return cached;

  const imbaTypingsPath = findImbaTypingsPath(resolvedDirectory);
  const typings = imbaTypingsPath
    ? {
        fileName: path.join(resolvedDirectory, ".imba-lsp", "runtime-augment.d.ts"),
        source: imbaRuntimeAugmentationSource(imbaTypingsPath),
      }
    : null;

  typingsCache.set(resolvedDirectory, typings);
  return typings;
}

function findImbaTypingsPath(currentDirectory: string): string | null {
  const compilerPath =
    resolveFromDirectory("imba/compiler", currentDirectory) ??
    resolveFromDirectory("imba/compiler", __dirname);
  if (!compilerPath) return null;

  let directory = path.dirname(compilerPath);
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, "typings", "imba.d.ts");
    if (ts.sys.fileExists(candidate)) return candidate;
    directory = path.dirname(directory);
  }

  return null;
}

function resolveFromDirectory(specifier: string, directory: string): string | null {
  try {
    return createRequire(path.join(directory, "__imba_lsp__.js")).resolve(specifier);
  } catch {
    return null;
  }
}

function imbaRuntimeAugmentationSource(imbaTypingsPath: string): string {
  return [
    `/// <reference path="${escapeReferencePath(imbaTypingsPath)}" />`,
    "",
    "interface Element {",
    "  on$(event: string, handlers: any, target?: any): any;",
    "  flag$(value?: any): any;",
    "  set$(name: string, value: any): any;",
    "}",
    "",
    "declare namespace imba {",
    "  interface Component extends Globals {",
    "    _ns_?: string;",
    "    __slots?: Record<string, any>;",
    "    css$var: any;",
    "    flagSelf$(value?: any, flags?: any): any;",
    "    readonly globalThis: typeof globalThis;",
    "    readonly history: History;",
    "    readonly location: Location;",
    "    readonly navigator: Navigator;",
    "    readonly performance: Performance;",
    "    readonly screen: Screen;",
    "  }",
    "}",
    "",
    "declare module \"imba\" {",
    "  export import Component = imba.Component;",
    "  export function isa$(value: any, type: any): boolean;",
    "  export function iterable$<T>(value: Iterable<T> | ArrayLike<T>): T[];",
    "  export function iterable$(value: any): any[];",
    ...imbaModuleAnyExports
      .filter((name) => name !== "Component" && name !== "isa$" && name !== "iterable$")
      .map((name) => `  export const ${name}: any;`),
    "}",
    "",
    "declare module \"imba/runtime\" {",
    "  export function isa$(value: any, type: any): boolean;",
    "  export function iterable$<T>(value: Iterable<T> | ArrayLike<T>): T[];",
    "  export function iterable$(value: any): any[];",
    ...imbaRuntimeAnyExports
      .filter((name) => name !== "isa$" && name !== "iterable$")
      .map((name) => `  export const ${name}: any;`),
    "}",
    "",
  ].join("\n");
}

function escapeReferencePath(fileName: string): string {
  return fileName.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
