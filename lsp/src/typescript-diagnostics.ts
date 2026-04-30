import path from "node:path";
import {
  DiagnosticSeverity,
  type Diagnostic,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import * as ts from "typescript";
import type { ImbaCompilation } from "./compiler";
import { generatedOffsetToSourceOffset } from "./source-map";
import { createTypeScriptLanguageService } from "./typescript-service";

export function buildTypeScriptDiagnostics(
  document: TextDocument,
  sourcePath: string | null,
  compilation: ImbaCompilation | undefined,
): Diagnostic[] {
  const generated = compilation?.js;
  if (!generated) return [];

  const source = document.getText();
  const fileName = `${sourcePath ?? path.join(process.cwd(), "untitled.imba")}.compiled.js`;
  const service = createTypeScriptLanguageService(fileName, generated, {
    compilerOptions: {
      checkJs: true,
      noEmit: true,
    },
  });
  const diagnostics = [
    ...service.getSyntacticDiagnostics(fileName),
    ...service.getSemanticDiagnostics(fileName),
  ];

  return diagnostics
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .filter((diagnostic) => isUsefulDiagnostic(generated, diagnostic))
    .map((diagnostic) => mapTypeScriptDiagnostic(document, source, compilation, diagnostic))
    .filter((diagnostic): diagnostic is Diagnostic => Boolean(diagnostic));
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

function isUsefulDiagnostic(
  generated: string,
  diagnostic: ts.Diagnostic,
): boolean {
  const text = diagnosticText(generated, diagnostic);
  if (/^[_$]/.test(text)) return false;
  if (isImbaComponentGlobalFalsePositive(generated, diagnostic)) return false;

  return true;
}

function isImbaComponentGlobalFalsePositive(
  generated: string,
  diagnostic: ts.Diagnostic,
): boolean {
  if (diagnostic.code !== 2339 || diagnostic.start === undefined) return false;

  const text = diagnosticText(generated, diagnostic);
  if (!knownGlobalNames.has(text)) return false;

  const before = generated.slice(Math.max(0, diagnostic.start - 12), diagnostic.start);
  return /(?:^|[^\w$])this\.$/.test(before);
}

function diagnosticText(generated: string, diagnostic: ts.Diagnostic): string {
  if (diagnostic.start === undefined) return "";
  return generated.slice(
    diagnostic.start,
    diagnostic.start + Math.max(diagnostic.length ?? 1, 1),
  );
}

const knownGlobalNames = new Set([
  "document",
  "globalThis",
  "history",
  "location",
  "navigator",
  "performance",
  "screen",
  "window",
]);
