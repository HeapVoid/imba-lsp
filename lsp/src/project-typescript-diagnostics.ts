import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ImbaCompilation } from "./compiler";
import { mapTypeScriptDiagnosticsForFile } from "./typescript-diagnostics";
import { createTypeScriptLanguageServiceForFiles } from "./typescript-service";

export interface ProjectTypeScriptDiagnosticSource {
  compilation: ImbaCompilation;
  document: TextDocument;
  source: string;
  sourcePath: string;
}

interface ProjectTypeScriptGroup {
  configPath?: string;
  currentDirectory?: string;
  sources: ProjectTypeScriptDiagnosticSource[];
}

export function buildProjectTypeScriptDiagnostics(
  rootPath: string,
  sources: ProjectTypeScriptDiagnosticSource[],
): Map<string, Diagnostic[]> {
  const diagnosticsByPath = new Map<string, Diagnostic[]>();
  const groups = groupTypeScriptSources(rootPath, sources);

  for (const group of groups.values()) {
    try {
      const service = createTypeScriptLanguageServiceForFiles(
        group.sources.map((source) => ({
          fileName: projectVirtualFileName(source.sourcePath),
          source: source.compilation.js ?? "",
        })),
        {
          configPath: group.configPath,
          compilerOptions: {
            checkJs: true,
            noEmit: true,
          },
          currentDirectory: group.currentDirectory,
        },
      );

      for (const source of group.sources) {
        diagnosticsByPath.set(
          source.sourcePath,
          mapTypeScriptDiagnosticsForFile(
            service,
            projectVirtualFileName(source.sourcePath),
            source.compilation.js ?? "",
            source.document,
            source.source,
            source.compilation,
          ),
        );
      }
    } catch {
      continue;
    }
  }

  return diagnosticsByPath;
}

function groupTypeScriptSources(
  rootPath: string,
  sources: ProjectTypeScriptDiagnosticSource[],
): Map<string, ProjectTypeScriptGroup> {
  const root = path.resolve(rootPath);
  const groups = new Map<string, ProjectTypeScriptGroup>();

  for (const source of sources) {
    const directory = path.dirname(path.resolve(source.sourcePath));
    const tsconfigPath = nearestFileWithin(directory, root, "tsconfig.json");
    const jsconfigPath = tsconfigPath ? null : nearestFileWithin(directory, root, "jsconfig.json");
    const configPath = tsconfigPath ?? jsconfigPath ?? undefined;
    const packagePath = configPath ? null : nearestFileWithin(directory, root, "package.json");
    const groupKey = configPath
      ? `config:${configPath}`
      : `dir:${packagePath ? path.dirname(packagePath) : root}`;
    const currentDirectory = configPath
      ? undefined
      : packagePath
        ? path.dirname(packagePath)
        : root;
    const group = groups.get(groupKey) ?? {
      configPath,
      currentDirectory,
      sources: [],
    };

    group.sources.push(source);
    groups.set(groupKey, group);
  }

  return groups;
}

function nearestFileWithin(
  startDirectory: string,
  rootPath: string,
  fileName: string,
): string | null {
  const root = path.resolve(rootPath);
  let directory = path.resolve(startDirectory);

  while (isWithinOrSame(root, directory)) {
    const candidate = path.join(directory, fileName);
    if (fs.existsSync(candidate)) return candidate;

    if (directory === root) break;
    directory = path.dirname(directory);
  }

  return null;
}

function isWithinOrSame(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectVirtualFileName(sourcePath: string): string {
  return `${sourcePath}.js`;
}
