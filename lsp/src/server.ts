import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildCompletionItems, completionTriggerCharacters } from "./completion";
import { compileImba, type CompileResult } from "./compiler";
import {
  buildSemanticTokenData,
  semanticTokenModifiers,
  semanticTokenTypes,
} from "./semantic-tokens";
import { buildDocumentSymbols } from "./symbols";
import { filePathFromUri } from "./uri";

const validationDelayMs = 120;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

interface DocumentState {
  version: number;
  result: CompileResult;
}

const documentState = new Map<string, DocumentState>();
const pendingValidation = new Map<string, NodeJS.Timeout>();

connection.onInitialize((_params: InitializeParams): InitializeResult => ({
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
    completionProvider: {
      triggerCharacters: [...completionTriggerCharacters],
      resolveProvider: false,
    },
  },
  serverInfo: {
    name: "imba-lsp",
    version: "0.0.1",
  },
}));

documents.onDidOpen((event) => {
  scheduleValidation(event.document);
});

documents.onDidChangeContent((event) => {
  scheduleValidation(event.document);
});

documents.onDidSave((event) => {
  validateNow(event.document);
});

documents.onDidClose((event) => {
  clearPendingValidation(event.document.uri);
  documentState.delete(event.document.uri);
  connection.sendDiagnostics({
    uri: event.document.uri,
    diagnostics: [],
  });
});

connection.onShutdown(() => {
  for (const uri of pendingValidation.keys()) {
    clearPendingValidation(uri);
  }

  documentState.clear();
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
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: state.result.diagnostics,
  });

  return state.result;
}

function currentState(document: TextDocument): DocumentState {
  const cached = documentState.get(document.uri);
  if (cached?.version === document.version) {
    return cached;
  }

  const sourcePath = filePathFromUri(document.uri);
  const result = compileImba(document.getText(), sourcePath);
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

documents.listen(connection);
connection.listen();
