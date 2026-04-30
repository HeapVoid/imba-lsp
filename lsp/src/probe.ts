import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba, type CompileResult } from "./compiler";
import { buildSemanticTokenData } from "./semantic-tokens";
import { buildDocumentSymbols } from "./symbols";
import { buildTypeScriptDiagnostics } from "./typescript-diagnostics";

interface ProbeOptions {
  failOnDiagnostics: boolean;
  json: boolean;
  targets: string[];
  typescriptDiagnostics: boolean;
}

interface ProbeResult {
  path: string;
  compilerDiagnostics: number;
  diagnostics: number;
  errors: number;
  typeScriptDiagnostics: number;
  warnings: number;
  semanticTokens: number;
  symbols: number;
  compilerPath: string;
  workspaceLocal: boolean;
  elapsedMs: number;
  failure?: string;
}

const ignoredDirectories = new Set([
  ".git",
  ".zed",
  "dist",
  "node_modules",
  "target",
]);

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = await collectImbaFiles(options.targets);

  if (files.length === 0) {
    throw new Error("No .imba files found for probe targets.");
  }

  const results: ProbeResult[] = [];

  for (const file of files) {
    results.push(await probeFile(file, options));
  }

  if (options.json) {
    console.log(JSON.stringify(summary(results), null, 2));
  } else {
    printSummary(results);
  }

  const failures = results.filter((result) => result.failure);
  const diagnostics = results.reduce((count, result) => count + result.diagnostics, 0);

  if (failures.length > 0 || (options.failOnDiagnostics && diagnostics > 0)) {
    process.exit(1);
  }
}

function parseArgs(args: string[]): ProbeOptions {
  const targets: string[] = [];
  let failOnDiagnostics = false;
  let json = false;
  let typescriptDiagnostics = false;

  for (const arg of args) {
    if (arg === "--fail-on-diagnostics") {
      failOnDiagnostics = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--typescript-diagnostics" || arg === "--ts-diagnostics") {
      typescriptDiagnostics = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      targets.push(arg);
    }
  }

  return {
    failOnDiagnostics,
    json,
    targets: targets.length > 0 ? targets : [process.cwd()],
    typescriptDiagnostics,
  };
}

function printHelp(): void {
  console.log([
    "Usage: imba-lsp-probe [--json] [--typescript-diagnostics] [--fail-on-diagnostics] <file-or-directory>...",
    "",
    "Compiles .imba files with the native Imba compiler and exercises the LSP",
    "diagnostics, semantic-token, and document-symbol adapters.",
  ].join("\n"));
}

async function collectImbaFiles(targets: string[]): Promise<string[]> {
  const files = new Set<string>();

  for (const target of targets) {
    const resolved = path.resolve(target);
    await collectTarget(resolved, files);
  }

  return [...files].sort();
}

async function collectTarget(target: string, files: Set<string>): Promise<void> {
  const stat = await fs.stat(target);

  if (stat.isFile()) {
    if (target.endsWith(".imba")) {
      files.add(target);
    }
    return;
  }

  if (!stat.isDirectory()) return;

  const entries = await fs.readdir(target, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    await collectTarget(path.join(target, entry.name), files);
  }
}

async function probeFile(file: string, options: ProbeOptions): Promise<ProbeResult> {
  const started = performance.now();

  try {
    const source = await fs.readFile(file, "utf8");
    const uri = pathToFileURL(file).toString();
    const document = TextDocument.create(uri, "imba", 1, source);
    const result = compileImba(source, file, {
      sourcemap: options.typescriptDiagnostics,
    });
    const typeScriptDiagnostics = options.typescriptDiagnostics && !hasCompilerErrors(result)
      ? buildTypeScriptDiagnostics(document, file, result.compilation)
      : [];
    const diagnostics = [
      ...result.diagnostics,
      ...typeScriptDiagnostics,
    ];
    const semanticTokens = buildSemanticTokenData(document, result.compilation);
    const symbols = buildDocumentSymbols(document, file);

    return {
      path: file,
      compilerDiagnostics: result.diagnostics.length,
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error).length,
      typeScriptDiagnostics: typeScriptDiagnostics.length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === DiagnosticSeverity.Warning).length,
      semanticTokens: semanticTokens.length / 5,
      symbols: countSymbols(symbols),
      compilerPath: result.compilerPath,
      workspaceLocal: result.workspaceLocal,
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    return {
      path: file,
      compilerDiagnostics: 0,
      diagnostics: 0,
      errors: 0,
      typeScriptDiagnostics: 0,
      warnings: 0,
      semanticTokens: 0,
      symbols: 0,
      compilerPath: "",
      workspaceLocal: false,
      elapsedMs: performance.now() - started,
      failure: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }
}

function countSymbols(symbols: Array<{ children?: unknown[] }>): number {
  let count = symbols.length;

  for (const symbol of symbols) {
    if (Array.isArray(symbol.children)) {
      count += countSymbols(symbol.children as Array<{ children?: unknown[] }>);
    }
  }

  return count;
}

function summary(results: ProbeResult[]): Record<string, unknown> {
  return {
    files: results.length,
    compilerDiagnostics: results.reduce((count, result) => count + result.compilerDiagnostics, 0),
    diagnostics: results.reduce((count, result) => count + result.diagnostics, 0),
    errors: results.reduce((count, result) => count + result.errors, 0),
    typeScriptDiagnostics: results.reduce((count, result) => count + result.typeScriptDiagnostics, 0),
    warnings: results.reduce((count, result) => count + result.warnings, 0),
    failures: results.filter((result) => result.failure).length,
    elapsedMs: results.reduce((count, result) => count + result.elapsedMs, 0),
    results,
  };
}

function printSummary(results: ProbeResult[]): void {
  let totalDiagnostics = 0;
  let totalErrors = 0;
  let totalFailures = 0;
  let totalElapsed = 0;

  for (const result of results) {
    totalDiagnostics += result.diagnostics;
    totalErrors += result.errors;
    totalElapsed += result.elapsedMs;

    if (result.failure) {
      totalFailures += 1;
      console.log(`FAIL ${displayPath(result.path)} ${result.elapsedMs.toFixed(1)}ms`);
      console.log(result.failure);
      continue;
    }

    console.log(
      [
        result.diagnostics === 0 ? "ok" : "diag",
        displayPath(result.path),
        `diagnostics=${result.diagnostics}`,
        `compilerDiagnostics=${result.compilerDiagnostics}`,
        `tsDiagnostics=${result.typeScriptDiagnostics}`,
        `tokens=${result.semanticTokens}`,
        `symbols=${result.symbols}`,
        `compiler=${result.workspaceLocal ? "workspace" : "fallback"}`,
        `${result.elapsedMs.toFixed(1)}ms`,
      ].join(" "),
    );
  }

  console.log(
    [
      "summary",
      `files=${results.length}`,
      `diagnostics=${totalDiagnostics}`,
      `errors=${totalErrors}`,
      `failures=${totalFailures}`,
      `${totalElapsed.toFixed(1)}ms`,
    ].join(" "),
  );
}

function displayPath(file: string): string {
  return path.relative(process.cwd(), file) || path.basename(file);
}

function hasCompilerErrors(result: CompileResult): boolean {
  return result.diagnostics.some((diagnostic) =>
    diagnostic.severity === undefined ||
    diagnostic.severity === DiagnosticSeverity.Error
  );
}
