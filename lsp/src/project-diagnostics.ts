import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba, type CompileResult } from "./compiler";
import { buildTypeScriptDiagnostics } from "./typescript-diagnostics";

export interface ProjectDiagnosticFile {
  diagnostics: Diagnostic[];
  sourcePath: string;
  uri: string;
}

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

export async function buildProjectDiagnostics(
  rootPath: string,
  openUris: Set<string>,
): Promise<ProjectDiagnosticFile[]> {
  const files = await collectProjectImbaFiles(rootPath);
  const results: ProjectDiagnosticFile[] = [];

  for (const file of files) {
    const uri = pathToFileURL(file).toString();
    if (openUris.has(uri)) continue;

    const result = await buildProjectDiagnosticFile(file, uri);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

export async function collectProjectImbaFiles(rootPath: string): Promise<string[]> {
  const files = new Set<string>();
  await collectImbaFilesIn(path.resolve(rootPath), files);
  return [...files].sort();
}

async function buildProjectDiagnosticFile(
  file: string,
  uri: string,
): Promise<ProjectDiagnosticFile | null> {
  try {
    const source = await fs.readFile(file, "utf8");
    const document = TextDocument.create(uri, "imba", 0, source);
    const result = compileImba(source, file, {
      sourcemap: true,
    });
    const typeScriptDiagnostics = hasCompilerErrors(result)
      ? []
      : buildTypeScriptDiagnostics(document, file, result.compilation);

    return {
      diagnostics: [
        ...result.diagnostics,
        ...typeScriptDiagnostics,
      ],
      sourcePath: file,
      uri,
    };
  } catch {
    return null;
  }
}

async function collectImbaFilesIn(target: string, files: Set<string>): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) return;

  if (stat.isFile()) {
    if (target.endsWith(".imba")) {
      files.add(target);
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

    await collectImbaFilesIn(path.join(target, entry.name), files);
  }
}

function hasCompilerErrors(result: CompileResult): boolean {
  return result.diagnostics.some((diagnostic) =>
    diagnostic.severity === undefined ||
    diagnostic.severity === DiagnosticSeverity.Error
  );
}
