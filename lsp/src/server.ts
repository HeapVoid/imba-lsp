import path from "node:path";
import {
  createConnection,
  DiagnosticSeverity,
  ProposedFeatures,
  TextDocumentSyncKind,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildCompletionItems, completionTriggerCharacters } from "./completion";
import { compileImba, type CompileResult } from "./compiler";
import {
  buildDefinitionLocations,
  buildHover,
  buildReferenceLocations,
  buildRenameEdit,
  prepareRename,
} from "./navigation";
import {
  buildProjectDiagnostics,
  type ProjectDiagnosticFile,
} from "./project-diagnostics";
import {
  buildSemanticTokenData,
  semanticTokenModifiers,
  semanticTokenTypes,
} from "./semantic-tokens";
import { buildDocumentSymbols } from "./symbols";
import {
  buildTypeScriptDiagnosticGroups,
  type TypeScriptDiagnosticGroup,
} from "./typescript-diagnostics";
import { filePathFromUri } from "./uri";

const validationDelayMs = 120;
const projectValidationDelayMs = 1200;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

interface DocumentState {
  version: number;
  result: CompileResult;
}

const documentState = new Map<string, DocumentState>();
const pendingValidation = new Map<string, NodeJS.Timeout>();
const pendingProjectValidation = new Map<string, NodeJS.Timeout>();
const publishedDiagnostics = new Map<string, string>();
const projectDiagnosticUris = new Map<string, Set<string>>();
let workspaceRootPath: string | null = null;
let projectValidationRun = 0;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRootPath = workspaceRootFromInitialize(params);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      semanticTokensProvider: {
        legend: {
          tokenTypes: [...semanticTokenTypes],
          tokenModifiers: [...semanticTokenModifiers],
        },
        full: true,
      },
      documentSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: [...completionTriggerCharacters],
        resolveProvider: false,
      },
    },
    serverInfo: {
      name: "imba-lsp",
      version: "0.0.1",
    },
  };
});

connection.onInitialized(() => {
  if (workspaceRootPath) {
    scheduleProjectValidation(workspaceRootPath);
  }
});

documents.onDidOpen((event) => {
  scheduleValidation(event.document);
  scheduleProjectValidationForDocument(event.document);
});

documents.onDidChangeContent((event) => {
  scheduleValidation(event.document);
});

documents.onDidSave((event) => {
  validateNow(event.document);
  scheduleProjectValidationForDocument(event.document);
});

documents.onDidClose((event) => {
  clearPendingValidation(event.document.uri);
  documentState.delete(event.document.uri);
  publishedDiagnostics.delete(event.document.uri);
  connection.sendDiagnostics({
    uri: event.document.uri,
    diagnostics: [],
  });
  scheduleProjectValidationForUri(event.document.uri);
});

connection.onShutdown(() => {
  for (const uri of pendingValidation.keys()) {
    clearPendingValidation(uri);
  }

  for (const rootPath of pendingProjectValidation.keys()) {
    clearPendingProjectValidation(rootPath);
  }

  documentState.clear();
  projectDiagnosticUris.clear();
  publishedDiagnostics.clear();
});

connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };

  const state = currentState(document);

  return {
    data: buildSemanticTokenData(document, state.result.compilation),
  };
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  return buildDocumentSymbols(document, filePathFromUri(document.uri));
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const state = documentState.get(document.uri);
  const compilation = state?.version === document.version ? state.result.compilation : undefined;
  return buildCompletionItems(
    document,
    params.position,
    filePathFromUri(document.uri),
    compilation,
  );
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const state = currentState(document);
  return buildDefinitionLocations(
    document,
    params.position,
    filePathFromUri(document.uri),
    state.result.compilation,
  );
});

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const state = currentState(document);
  return buildReferenceLocations(
    document,
    params.position,
    filePathFromUri(document.uri),
    state.result.compilation,
    params.context.includeDeclaration,
  );
});

connection.onPrepareRename((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const state = currentState(document);
  return prepareRename(
    document,
    params.position,
    filePathFromUri(document.uri),
    state.result.compilation,
  );
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const state = currentState(document);
  return buildRenameEdit(
    document,
    params.position,
    filePathFromUri(document.uri),
    state.result.compilation,
    params.newName,
  );
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const state = currentState(document);
  return buildHover(
    document,
    params.position,
    filePathFromUri(document.uri),
    state.result.compilation,
  );
});

function scheduleValidation(document: TextDocument): void {
  clearPendingValidation(document.uri);

  const timer = setTimeout(() => {
    pendingValidation.delete(document.uri);
    const current = documents.get(document.uri);
    if (current && current.version === document.version) {
      validateNow(current);
    }
  }, validationDelayMs);

  pendingValidation.set(document.uri, timer);
}

function validateNow(document: TextDocument): CompileResult {
  clearPendingValidation(document.uri);

  const state = currentState(document);
  const sourcePath = filePathFromUri(document.uri);
  const hasCompilerError = hasCompilerErrors(state.result);
  const typeScriptDiagnostics = hasCompilerError
    ? { current: [], imported: [] }
    : buildTypeScriptDiagnosticGroups(document, sourcePath, state.result.compilation);
  const diagnostics = hasCompilerError
    ? state.result.diagnostics
    : [
        ...state.result.diagnostics,
        ...typeScriptDiagnostics.current,
      ];

  publishDiagnostics(document.uri, document.version, diagnostics);
  publishOpenImportedDiagnostics(document.uri, typeScriptDiagnostics.imported);

  return state.result;
}

function scheduleProjectValidationForDocument(document: TextDocument): void {
  scheduleProjectValidationForUri(document.uri);
}

function scheduleProjectValidationForUri(uri: string): void {
  const sourcePath = filePathFromUri(uri);
  const rootPath = projectRootFor(sourcePath);
  if (!rootPath) return;

  scheduleProjectValidation(rootPath);
}

function scheduleProjectValidation(rootPath: string): void {
  clearPendingProjectValidation(rootPath);

  const timer = setTimeout(() => {
    pendingProjectValidation.delete(rootPath);
    void validateProject(rootPath);
  }, projectValidationDelayMs);

  pendingProjectValidation.set(rootPath, timer);
}

async function validateProject(rootPath: string): Promise<void> {
  const run = ++projectValidationRun;
  const openUris = new Set(documents.keys());
  const results = await buildProjectDiagnostics(rootPath, openUris);
  if (run !== projectValidationRun) return;

  publishProjectDiagnostics(rootPath, results);
}

function publishProjectDiagnostics(
  rootPath: string,
  results: ProjectDiagnosticFile[],
): void {
  const seen = new Set<string>();

  for (const result of results) {
    seen.add(result.uri);
    if (documents.get(result.uri)) continue;

    if (result.diagnostics.length > 0 || publishedDiagnostics.has(result.uri)) {
      publishDiagnostics(result.uri, undefined, result.diagnostics);
    }
  }

  for (const uri of projectDiagnosticUris.get(rootPath) ?? []) {
    if (seen.has(uri)) continue;
    if (documents.get(uri)) continue;
    if (!publishedDiagnostics.has(uri)) continue;

    publishDiagnostics(uri, undefined, []);
  }

  projectDiagnosticUris.set(rootPath, seen);
}

function hasCompilerErrors(result: CompileResult): boolean {
  return result.diagnostics.some((diagnostic) =>
    diagnostic.severity === undefined ||
    diagnostic.severity === DiagnosticSeverity.Error
  );
}

function currentState(document: TextDocument): DocumentState {
  const cached = documentState.get(document.uri);
  if (cached?.version === document.version) {
    return cached;
  }

  const sourcePath = filePathFromUri(document.uri);
  const result = compileImba(document.getText(), sourcePath, {
    sourcemap: true,
  });
  const state = {
    version: document.version,
    result,
  };

  documentState.set(document.uri, state);
  return state;
}

function clearPendingValidation(uri: string): void {
  const timer = pendingValidation.get(uri);
  if (timer) {
    clearTimeout(timer);
    pendingValidation.delete(uri);
  }
}

function clearPendingProjectValidation(rootPath: string): void {
  const timer = pendingProjectValidation.get(rootPath);
  if (timer) {
    clearTimeout(timer);
    pendingProjectValidation.delete(rootPath);
  }
}

function workspaceRootFromInitialize(params: InitializeParams): string | null {
  const workspaceFolderUri = params.workspaceFolders?.[0]?.uri;
  return filePathFromUri(workspaceFolderUri ?? params.rootUri ?? "");
}

function projectRootFor(sourcePath: string | null): string | null {
  if (workspaceRootPath) return workspaceRootPath;
  if (!sourcePath) return null;

  return path.dirname(sourcePath);
}

function publishOpenImportedDiagnostics(
  ownerUri: string,
  groups: TypeScriptDiagnosticGroup[],
): void {
  for (const group of groups) {
    if (group.uri === ownerUri) continue;

    const document = documents.get(group.uri);
    if (!document) continue;
    if (document.getText() !== group.source) continue;

    const state = currentState(document);
    const diagnostics = hasCompilerErrors(state.result)
      ? state.result.diagnostics
      : [
          ...state.result.diagnostics,
          ...group.diagnostics,
        ];

    publishDiagnostics(document.uri, document.version, diagnostics);
  }
}

function publishDiagnostics(
  uri: string,
  version: number | undefined,
  diagnostics: Diagnostic[],
): void {
  const key = JSON.stringify({ diagnostics, version });
  if (publishedDiagnostics.get(uri) === key) return;

  publishedDiagnostics.set(uri, key);
  connection.sendDiagnostics({
    uri,
    version,
    diagnostics,
  });
}

documents.listen(connection);
connection.listen();
