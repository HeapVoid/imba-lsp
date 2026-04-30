import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DiagnosticSeverity,
  type Diagnostic,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as ts from "typescript";
import type { ImbaCompilation } from "./compiler";
import { generatedOffsetToSourceOffset } from "./source-map";
import {
  createTypeScriptLanguageService,
  virtualImbaFilesFor,
} from "./typescript-service";

export interface TypeScriptDiagnosticGroup {
  diagnostics: Diagnostic[];
  source: string;
  sourcePath: string;
  uri: string;
}

export interface TypeScriptDiagnosticGroups {
  current: Diagnostic[];
  imported: TypeScriptDiagnosticGroup[];
}

export function buildTypeScriptDiagnostics(
  document: TextDocument,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Diagnostic[] {
  return buildTypeScriptDiagnosticGroups(document, sourcePath, compilation).current;
}

export function buildTypeScriptDiagnosticGroups(
  document: TextDocument,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): TypeScriptDiagnosticGroups {
  const generated = compilation?.js;
  if (!generated) return { current: [], imported: [] };

  const source = document.getText();
  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated, {
    compilerOptions: {
      checkJs: true,
      noEmit: true,
    },
  });

  const current = mapDiagnosticsForFile(
    service,
    fileName,
    generated,
    document,
    source,
    compilation,
  );
  const imported = virtualImbaFilesFor(service).map(([virtualPath, virtualFile]) => {
    const virtualSource = virtualFile.source;
    const virtualDocument = TextDocument.create(
      pathToFileURL(virtualFile.sourcePath).toString(),
      "imba",
      0,
      virtualSource,
    );

    return {
      diagnostics: mapDiagnosticsForFile(
        service,
        virtualPath,
        virtualFile.compilation.js ?? "",
        virtualDocument,
        virtualSource,
        virtualFile.compilation,
      ),
      source: virtualSource,
      sourcePath: virtualFile.sourcePath,
      uri: virtualDocument.uri,
    };
  });

  return { current, imported };
}

function mapDiagnosticsForFile(
  service: ts.LanguageService,
  fileName: string,
  generated: string,
  document: TextDocument,
  source: string,
  compilation: ImbaCompilation,
): Diagnostic[] {
  if (!generated) return [];

  const diagnostics = [
    ...service.getSyntacticDiagnostics(fileName),
    ...service.getSemanticDiagnostics(fileName),
  ];

  const result: Diagnostic[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.file?.fileName !== fileName) continue;

    const mapped = mapTypeScriptDiagnostic(document, source, compilation, diagnostic);
    if (!mapped) continue;
    if (!isUsefulMappedDiagnostic(source, mapped, diagnostic)) continue;

    result.push(mapped);
  }

  return result;
}

function mapTypeScriptDiagnostic(
  document: TextDocument,
  source: string,
  compilation: ImbaCompilation,
  diagnostic: ts.Diagnostic,
): Diagnostic | null {
  if (diagnostic.start === undefined) return null;

  const start = generatedOffsetToSourceOffset(compilation, source, diagnostic.start);
  const end = generatedOffsetToSourceOffset(
    compilation,
    source,
    diagnostic.start + Math.max((diagnostic.length ?? 1) - 1, 0),
  );
  if (!start || !end) return null;

  const startOffset = start.offset;
  const endOffset = Math.max(startOffset + 1, end.offset + 1);

  return {
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    range: {
      start: document.positionAt(startOffset),
      end: document.positionAt(endOffset),
    },
    severity: severityForCategory(diagnostic.category),
    source: "typescript",
  };
}

function severityForCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Warning:
      return DiagnosticSeverity.Warning;
    case ts.DiagnosticCategory.Message:
      return DiagnosticSeverity.Information;
    case ts.DiagnosticCategory.Suggestion:
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

function isUsefulMappedDiagnostic(
  source: string,
  mapped: Diagnostic,
  diagnostic: ts.Diagnostic,
): boolean {
  if (isImbaEventCallbackArgumentFalsePositive(source, mapped, diagnostic)) return false;

  return true;
}

function isImbaEventCallbackArgumentFalsePositive(
  source: string,
  mapped: Diagnostic,
  diagnostic: ts.Diagnostic,
): boolean {
  if (diagnostic.code !== 2554) return false;
  if (!diagnosticMessage(diagnostic).includes("Expected 0 arguments, but got 1")) {
    return false;
  }

  // Imba event attributes compile to method(event). A source handler with no
  // declared argument is still valid Imba; the extra JS argument is introduced
  // by the compiler lowering, not by the user source.
  return /(?:^|\s)@[\w-]+(?:\.[\w-]+)*=/.test(lineTextAt(source, mapped.range.start.line));
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function lineTextAt(source: string, line: number): string {
  return source.split("\n")[line] ?? "";
}
