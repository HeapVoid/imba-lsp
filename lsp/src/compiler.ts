import { createRequire } from "node:module";
import path from "node:path";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";

export interface ImbaCompiler {
  compile(code: string, options?: Record<string, unknown>): ImbaCompilation;
  parse?(code: string, options?: Record<string, unknown>): unknown;
  tokenize?(code: string, options?: Record<string, unknown>): unknown[];
  rewrite?(tokens: unknown[], options?: Record<string, unknown>): unknown[];
}

export interface ImbaCompilation {
  diagnostics?: ImbaDiagnostic[];
  ast?: unknown;
  tokens?: ImbaToken[];
  js?: string;
  css?: string;
  locs?: {
    spans?: unknown[];
  };
  sourceCode?: string;
  sourcePath?: string;
}

export interface ImbaDiagnostic {
  message?: string;
  severity?: number | string;
  source?: string;
  code?: string | number;
  range?: {
    start?: {
      line?: number;
      character?: number;
    };
    end?: {
      line?: number;
      character?: number;
    };
  };
}

export interface ImbaToken {
  _type?: string;
  _value?: string;
  _loc?: number | [number, number];
  _len?: number;
  type?: () => string;
  value?: () => string;
  loc?: () => [number, number];
  endLoc?: () => number;
}

export interface CompilerResolution {
  compiler: ImbaCompiler;
  modulePath: string;
  workspaceLocal: boolean;
}

export interface CompileResult {
  compilerPath: string;
  workspaceLocal: boolean;
  compilation?: ImbaCompilation;
  diagnostics: LspDiagnostic[];
}

const fallbackRequire = createRequire(__filename);

const compilerCache = new Map<string, CompilerResolution>();

export function resolveImbaCompiler(sourcePath: string | null): CompilerResolution {
  const basePath = sourcePath ? path.dirname(sourcePath) : process.cwd();
  const cacheKey = nearestPackageScope(basePath) ?? basePath;
  const cached = compilerCache.get(cacheKey);
  if (cached) return cached;

  const localRequire = createRequire(path.join(basePath, "__imba_lsp_resolver__.js"));

  try {
    const modulePath = localRequire.resolve("imba/compiler");
    const compiler = localRequire("imba/compiler") as ImbaCompiler;
    const resolution = { compiler, modulePath, workspaceLocal: true };
    compilerCache.set(cacheKey, resolution);
    return resolution;
  } catch {
    const modulePath = fallbackRequire.resolve("imba/compiler");
    const compiler = fallbackRequire("imba/compiler") as ImbaCompiler;
    const resolution = { compiler, modulePath, workspaceLocal: false };
    compilerCache.set(cacheKey, resolution);
    return resolution;
  }
}

export function compileImba(
  source: string,
  sourcePath: string | null,
  options: Record<string, unknown> = {},
): CompileResult {
  const resolution = resolveImbaCompiler(sourcePath);

  try {
    const compilation = resolution.compiler.compile(source, {
      sourcePath: sourcePath ?? undefined,
      ...options,
    });

    return {
      compilerPath: resolution.modulePath,
      workspaceLocal: resolution.workspaceLocal,
      compilation,
      diagnostics: mapDiagnostics(compilation.diagnostics ?? []),
    };
  } catch (error) {
    return {
      compilerPath: resolution.modulePath,
      workspaceLocal: resolution.workspaceLocal,
      diagnostics: [diagnosticFromThrown(error)],
    };
  }
}

export function mapDiagnostics(items: ImbaDiagnostic[]): LspDiagnostic[] {
  return items.map((item) => ({
    range: normalizeRange(item.range),
    severity: normalizeSeverity(item.severity),
    source: item.source ?? "imba",
    code: item.code,
    message: item.message || "Imba compiler diagnostic",
  }));
}

function nearestPackageScope(startDir: string): string | null {
  let dir = path.resolve(startDir);

  while (true) {
    try {
      return createRequire(path.join(dir, "package.json")).resolve("imba/package.json");
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

function normalizeSeverity(value: ImbaDiagnostic["severity"]): DiagnosticSeverity {
  if (value === DiagnosticSeverity.Warning || value === "warning") {
    return DiagnosticSeverity.Warning;
  }

  if (value === DiagnosticSeverity.Information || value === "info") {
    return DiagnosticSeverity.Information;
  }

  if (value === DiagnosticSeverity.Hint || value === "hint") {
    return DiagnosticSeverity.Hint;
  }

  return DiagnosticSeverity.Error;
}

function normalizeRange(range: ImbaDiagnostic["range"]): LspDiagnostic["range"] {
  const start = {
    line: numberOrZero(range?.start?.line),
    character: numberOrZero(range?.start?.character),
  };
  const end = {
    line: numberOrZero(range?.end?.line),
    character: numberOrZero(range?.end?.character),
  };

  if (end.line === start.line && end.character <= start.character) {
    end.character = start.character + 1;
  }

  return {
    start,
    end,
  };
}

function diagnosticFromThrown(error: unknown): LspDiagnostic {
  const err = error as {
    message?: string;
    range?: ImbaDiagnostic["range"];
  };

  return {
    range: normalizeRange(err.range),
    severity: DiagnosticSeverity.Error,
    source: "imba",
    message: err.message || "Imba compiler failed",
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
