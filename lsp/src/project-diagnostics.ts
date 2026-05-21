import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba, type CompileResult } from "./compiler";
import {
  buildProjectTypeScriptDiagnostics,
  type ProjectTypeScriptDiagnosticSource,
} from "./project-typescript-diagnostics";
import { buildTypeScriptDiagnostics } from "./typescript-diagnostics";

export interface ProjectDiagnosticFile {
  diagnostics: Diagnostic[];
  sourcePath: string;
  uri: string;
}

export interface ProjectDiagnosticOptions {
  includeTypeScript?: boolean;
}

interface ProjectDiagnosticRecord extends ProjectDiagnosticFile {
  document: TextDocument;
  result: CompileResult;
  source: string;
}

interface ProjectDiagnosticRecordOptions extends ProjectDiagnosticOptions {
  runSingleFileTypeScript?: boolean;
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
  options: ProjectDiagnosticOptions = {},
): Promise<ProjectDiagnosticFile[]> {
  const files = await collectProjectImbaFiles(rootPath);
  const records: ProjectDiagnosticRecord[] = [];

  for (const file of files) {
    const uri = pathToFileURL(file).toString();
    if (openUris.has(uri)) continue;

    const record = await buildProjectDiagnosticRecord(file, {
      ...options,
      runSingleFileTypeScript: false,
    });
    if (record) {
      records.push(record);
    }
  }

  if (options.includeTypeScript) {
    const typeScriptDiagnostics = buildProjectTypeScriptDiagnostics(
      rootPath,
      records
        .filter((record) => record.result.compilation?.js && !hasCompilerErrors(record.result))
        .map((record): ProjectTypeScriptDiagnosticSource => ({
          compilation: record.result.compilation!,
          document: record.document,
          source: record.source,
          sourcePath: record.sourcePath,
        })),
    );

    for (const record of records) {
      record.diagnostics.push(...(typeScriptDiagnostics.get(record.sourcePath) ?? []));
    }
  }

  return records.map(({ diagnostics, sourcePath, uri }) => ({
    diagnostics,
    sourcePath,
    uri,
  }));
}

export async function collectProjectImbaFiles(rootPath: string): Promise<string[]> {
  const files = new Set<string>();
  await collectImbaFilesIn(path.resolve(rootPath), files);
  return [...files].sort();
}

export async function buildProjectDiagnosticFile(
  file: string,
  options: ProjectDiagnosticOptions = {},
): Promise<ProjectDiagnosticFile | null> {
  const record = await buildProjectDiagnosticRecord(file, options);
  if (!record) return null;

  return {
    diagnostics: record.diagnostics,
    sourcePath: record.sourcePath,
    uri: record.uri,
  };
}

async function buildProjectDiagnosticRecord(
  file: string,
  options: ProjectDiagnosticRecordOptions = {},
): Promise<ProjectDiagnosticRecord | null> {
  try {
    const uri = pathToFileURL(file).toString();
    const source = await fs.readFile(file, "utf8");
    const document = TextDocument.create(uri, "imba", 0, source);
    const result = compileImba(source, file, {
      sourcemap: options.includeTypeScript === true,
    });
    const typeScriptDiagnostics =
      !options.includeTypeScript ||
      options.runSingleFileTypeScript === false ||
      hasCompilerErrors(result)
      ? []
      : buildTypeScriptDiagnostics(document, file, result.compilation);

    return {
      diagnostics: [
        ...result.diagnostics,
        ...typeScriptDiagnostics,
      ],
      document,
      result,
      source,
      sourcePath: file,
      uri,
    };
  } catch {
    return null;
  }
}

export function isProjectImbaFile(rootPath: string, file: string): boolean {
  if (!file.endsWith(".imba")) return false;

  const relative = path.relative(path.resolve(rootPath), path.resolve(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;

  return !relative.split(path.sep).some((part) => ignoredDirectories.has(part));
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
