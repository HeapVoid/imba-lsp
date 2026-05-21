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

  const current = mapTypeScriptDiagnosticsForFile(
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
      diagnostics: mapTypeScriptDiagnosticsForFile(
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

export function mapTypeScriptDiagnosticsForFile(
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
    if (!isUsefulMappedDiagnostic(service, fileName, generated, source, mapped, diagnostic)) {
      continue;
    }

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
  service: ts.LanguageService,
  fileName: string,
  generated: string,
  source: string,
  mapped: Diagnostic,
  diagnostic: ts.Diagnostic,
): boolean {
  if (isGeneratedSymbolIndexDiagnostic(generated, diagnostic)) return false;
  if (isOpenObjectPropertyDiagnostic(diagnostic)) return false;
  if (isDynamicObjectPropertyDiagnostic(service, fileName, diagnostic)) return false;
  if (isImbaOptionalAccessNullishDiagnostic(source, mapped, diagnostic)) return false;
  if (isDefaultGlobalObjectArgumentDiagnostic(service, fileName, diagnostic)) return false;
  if (isDefaultedParameterMismatchDiagnostic(service, fileName, diagnostic)) return false;
  if (isFetchHeadersInitDiagnostic(service, fileName, diagnostic)) return false;
  if (isImbaEventCallbackArgumentFalsePositive(source, mapped, diagnostic)) return false;

  return true;
}

function isDynamicObjectPropertyDiagnostic(
  service: ts.LanguageService,
  fileName: string,
  diagnostic: ts.Diagnostic,
): boolean {
  if (diagnostic.code !== 2339 || diagnostic.start === undefined) return false;

  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(fileName);
  if (!program || !sourceFile) return true;

  const receiver = propertyReceiverAt(sourceFile, diagnostic.start);
  if (!receiver) return true;

  const checker = program.getTypeChecker();
  const receiverType = checker.getTypeAtLocation(receiver);
  return !isClearlyPrimitivePropertyReceiver(receiverType);
}

function propertyReceiverAt(
  sourceFile: ts.SourceFile,
  offset: number,
): ts.Expression | null {
  const visit = (node: ts.Node): ts.Expression | null => {
    const nested = ts.forEachChild(node, visit);
    if (nested) return nested;

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.getStart(sourceFile) <= offset &&
      offset < node.name.getEnd()
    ) {
      return node.expression;
    }

    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      node.argumentExpression.getStart(sourceFile) <= offset &&
      offset < node.argumentExpression.getEnd()
    ) {
      return node.expression;
    }

    return null;
  };

  return visit(sourceFile);
}

function isClearlyPrimitivePropertyReceiver(type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;

  if (type.isUnion()) {
    const parts = type.types.filter((part) => !isNullishType(part));
    return parts.length > 0 && parts.every(isClearlyPrimitivePropertyReceiver);
  }

  if (type.isIntersection()) return false;
  return isPrimitiveType(type);
}

function isImbaOptionalAccessNullishDiagnostic(
  source: string,
  mapped: Diagnostic,
  diagnostic: ts.Diagnostic,
): boolean {
  if (!isNullishAccessDiagnostic(diagnostic)) return false;

  const line = lineTextAt(source, mapped.range.start.line);
  return line.slice(mapped.range.end.character).startsWith("..");
}

function isNullishAccessDiagnostic(diagnostic: ts.Diagnostic): boolean {
  if (
    diagnostic.code !== 18047 &&
    diagnostic.code !== 18048 &&
    diagnostic.code !== 18049 &&
    diagnostic.code !== 2531 &&
    diagnostic.code !== 2532
  ) {
    return false;
  }

  return /possibly '(?:null|undefined)'|Object is possibly '(?:null|undefined)'/.test(
    diagnosticMessage(diagnostic),
  );
}

function isOpenObjectPropertyDiagnostic(diagnostic: ts.Diagnostic): boolean {
  if (diagnostic.code !== 2339) return false;

  const message = diagnosticMessage(diagnostic);
  return /Property '.+' does not exist on type '(?:object|\{\})'\./.test(message);
}

function isDefaultGlobalObjectArgumentDiagnostic(
  service: ts.LanguageService,
  fileName: string,
  diagnostic: ts.Diagnostic,
): boolean {
  if (diagnostic.code !== 2345 || diagnostic.start === undefined) return false;

  const message = diagnosticMessage(diagnostic);
  if (!message.includes("is missing the following properties from type")) return false;

  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(fileName);
  if (!program || !sourceFile) return false;

  const callArgument = callArgumentAt(sourceFile, diagnostic.start);
  if (!callArgument) return false;

  const checker = program.getTypeChecker();
  const signature = checker.getResolvedSignature(callArgument.call);
  const declaration = signature?.getDeclaration();
  if (!declaration || !("parameters" in declaration)) return false;

  const parameter = declaration.parameters[callArgument.index];
  if (!parameter?.initializer) return false;
  if (!isAmbientGlobalDefaultExpression(parameter.initializer)) return false;

  const argumentType = checker.getTypeAtLocation(callArgument.argument);
  const parameterType = checker.getTypeAtLocation(parameter);
  if (!isObjectLikeArgumentType(argumentType)) return false;
  if (!isObjectLikeArgumentType(parameterType)) return false;

  return defaultGlobalParameterAcceptsArgument(checker, parameter, argumentType);
}

function isDefaultedParameterMismatchDiagnostic(
  service: ts.LanguageService,
  fileName: string,
  diagnostic: ts.Diagnostic,
): boolean {
  if (diagnostic.code !== 2345 || diagnostic.start === undefined) return false;

  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(fileName);
  if (!program || !sourceFile) return false;

  const callArgument = callArgumentAt(sourceFile, diagnostic.start);
  if (!callArgument) return false;

  const checker = program.getTypeChecker();
  const signature = checker.getResolvedSignature(callArgument.call);
  const declaration = signature?.getDeclaration();
  if (!declaration || !("parameters" in declaration)) return false;

  const parameter = parameterForArgumentIndex(declaration.parameters, callArgument.index);
  if (!parameter?.initializer) return false;
  if (parameter.type) return false;
  if (!isImbaGeneratedSourceFile(parameter.getSourceFile())) return false;

  const argumentType = checker.getTypeAtLocation(callArgument.argument);
  const parameterType = checker.getTypeAtLocation(parameter);
  if (checker.isTypeAssignableTo(argumentType, parameterType)) return false;

  return defaultedParameterAcceptsArgument(checker, parameter, argumentType);
}

function isFetchHeadersInitDiagnostic(
  service: ts.LanguageService,
  fileName: string,
  diagnostic: ts.Diagnostic,
): boolean {
  if (
    diagnostic.code !== 2322 &&
    diagnostic.code !== 2769
  ) {
    return false;
  }
  if (diagnostic.start === undefined) return false;

  const message = diagnosticMessage(diagnostic);
  if (!message.includes("HeadersInit")) return false;
  if (!message.includes("Index signature for type 'string' is missing")) return false;

  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(fileName);
  if (!program || !sourceFile) return false;

  const headers = fetchHeadersExpressionAt(sourceFile, diagnostic.start);
  if (!headers) return false;

  const checker = program.getTypeChecker();
  const headersType = checker.getTypeAtLocation(headers);
  return isStringRecordLikeType(checker, sourceFile, headersType);
}

function fetchHeadersExpressionAt(
  sourceFile: ts.SourceFile,
  offset: number,
): ts.Expression | null {
  const visit = (node: ts.Node): ts.Expression | null => {
    const nested = ts.forEachChild(node, visit);
    if (nested) return nested;

    if (ts.isPropertyAssignment(node) && propertyNameText(node.name) === "headers") {
      if (
        !rangeContains(sourceFile, node.name, offset) &&
        !rangeContains(sourceFile, node.initializer, offset)
      ) {
        return null;
      }
      return fetchCallForInitObject(sourceFile, node.parent) ? node.initializer : null;
    }

    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "headers") {
      if (!rangeContains(sourceFile, node.name, offset)) return null;
      return fetchCallForInitObject(sourceFile, node.parent) ? node.name : null;
    }

    return null;
  };

  return visit(sourceFile);
}

function fetchCallForInitObject(
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
): ts.CallExpression | null {
  const parent = object.parent;
  if (!ts.isCallExpression(parent)) return null;
  if (parent.arguments[1] !== object) return null;
  return isGlobalFetchCall(sourceFile, parent) ? parent : null;
}

function isGlobalFetchCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text === "fetch";

  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "fetch") {
    return false;
  }

  const receiver = expression.expression.getText(sourceFile);
  return receiver === "window" || receiver === "globalThis" || receiver === "self";
}

function isStringRecordLikeType(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  type: ts.Type,
): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;

  if (type.isUnion()) {
    const parts = type.types.filter((part) => !isNullishType(part));
    return parts.length > 0 &&
      parts.every((part) => isStringRecordLikeType(checker, sourceFile, part));
  }

  const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (stringIndex && isStringLikeType(stringIndex)) return true;

  const properties = checker.getPropertiesOfType(type);
  if (!properties.length) return false;

  return properties.every((property) => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? sourceFile;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    return isStringLikeType(propertyType);
  });
}

function isStringLikeType(type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;

  if (type.isUnion()) {
    const parts = type.types.filter((part) => !isNullishType(part));
    return parts.length > 0 && parts.every(isStringLikeType);
  }

  return Boolean(type.flags & ts.TypeFlags.StringLike);
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function rangeContains(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  offset: number,
): boolean {
  return node.getStart(sourceFile) <= offset && offset < node.getEnd();
}

interface CallArgument {
  argument: ts.Expression;
  call: ts.CallExpression | ts.NewExpression;
  index: number;
}

function callArgumentAt(sourceFile: ts.SourceFile, offset: number): CallArgument | null {
  const visit = (node: ts.Node): CallArgument | null => {
    const nested = ts.forEachChild(node, visit);
    if (nested) return nested;

    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments) {
      for (let index = 0; index < node.arguments.length; index++) {
        const argument = node.arguments[index];
        if (argument.getStart(sourceFile) <= offset && offset < argument.getEnd()) {
          return {
            argument,
            call: node,
            index,
          };
        }
      }
    }

    return null;
  };

  return visit(sourceFile);
}

function isAmbientGlobalDefaultExpression(
  expression: ts.Expression,
): boolean {
  const text = expression.getText(expression.getSourceFile());
  return /^\$[A-Za-z_$][\w$]*$/.test(text);
}

function defaultGlobalParameterAcceptsArgument(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
  argumentType: ts.Type,
): boolean {
  return defaultedParameterAcceptsArgument(checker, parameter, argumentType);
}

function defaultedParameterAcceptsArgument(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
  argumentType: ts.Type,
): boolean {
  const symbol = checker.getSymbolAtLocation(parameter.name);
  const body = functionBodyForParameter(parameter);
  if (!symbol || !body) return false;

  return parameterBodyUsesOnlyArgumentProperties(
    checker,
    symbol,
    body,
    argumentType,
    new Set(),
  );
}

function parameterBodyUsesOnlyArgumentProperties(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  body: ts.Node,
  argumentType: ts.Type,
  seen: Set<string>,
): boolean {
  let ok = true;

  const visit = (node: ts.Node): void => {
    if (!ok) return;

    if (ts.isPrefixUnaryExpression(node) && isExpressionSymbol(node.operand, symbol, checker)) {
      ok = isGenericPrefixOperator(node.operator);
      return;
    }

    if (ts.isBinaryExpression(node) && binaryExpressionUsesSymbol(node, symbol, checker)) {
      ok = isGenericBinaryOperator(node.operatorToken.kind);
      if (!ok) return;
    }

    if (ts.isPropertyAccessExpression(node) && isExpressionSymbol(node.expression, symbol, checker)) {
      ok = typeHasProperty(checker, argumentType, node.name.text);
      return;
    }

    if (ts.isElementAccessExpression(node) && isExpressionSymbol(node.expression, symbol, checker)) {
      const name = stringLiteralExpressionValue(node.argumentExpression);
      ok = name ? typeHasProperty(checker, argumentType, name) : typeHasStringIndex(checker, argumentType);
      return;
    }

    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments) {
      for (let index = 0; index < node.arguments.length; index++) {
        if (!isExpressionSymbol(node.arguments[index], symbol, checker)) continue;
        if (!calleeAcceptsArgumentLike(checker, node, index, argumentType, seen)) {
          ok = false;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
  return ok;
}

function binaryExpressionUsesSymbol(
  node: ts.BinaryExpression,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  return isExpressionSymbol(node.left, symbol, checker) ||
    isExpressionSymbol(node.right, symbol, checker);
}

function isGenericPrefixOperator(operator: ts.PrefixUnaryOperator): boolean {
  return operator === ts.SyntaxKind.ExclamationToken;
}

function isGenericBinaryOperator(operator: ts.SyntaxKind): boolean {
  return operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.AmpersandAmpersandToken ||
    operator === ts.SyntaxKind.BarBarToken ||
    operator === ts.SyntaxKind.QuestionQuestionToken;
}

function calleeAcceptsArgumentLike(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
  argumentIndex: number,
  argumentType: ts.Type,
  seen: Set<string>,
): boolean {
  const signature = checker.getResolvedSignature(call);
  const declaration = signature?.getDeclaration();
  if (!declaration || !("parameters" in declaration)) {
    return isUntypedCallee(checker, call);
  }

  const parameter = parameterForArgumentIndex(declaration.parameters, argumentIndex);
  if (!parameter) return true;

  const parameterType = checker.getTypeAtLocation(parameter);
  if (checker.isTypeAssignableTo(argumentType, parameterType)) return true;

  const symbol = checker.getSymbolAtLocation(parameter.name);
  const body = functionBodyForParameter(parameter);
  if (!symbol || !body) return false;

  const key = `${parameter.getSourceFile().fileName}:${parameter.pos}`;
  if (seen.has(key)) return true;

  seen.add(key);
  const ok = parameterBodyUsesOnlyArgumentProperties(
    checker,
    symbol,
    body,
    argumentType,
    seen,
  );
  seen.delete(key);
  return ok;
}

function isUntypedCallee(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
): boolean {
  const expression = call.expression;
  const type = checker.getTypeAtLocation(expression);
  return Boolean(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
}

function parameterForArgumentIndex(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  argumentIndex: number,
): ts.ParameterDeclaration | undefined {
  if (argumentIndex < parameters.length) return parameters[argumentIndex];

  const last = parameters[parameters.length - 1];
  return last?.dotDotDotToken ? last : undefined;
}

function functionBodyForParameter(parameter: ts.ParameterDeclaration): ts.Node | null {
  const parent = parameter.parent;
  return "body" in parent && parent.body ? parent.body : null;
}

function isImbaGeneratedSourceFile(sourceFile: ts.SourceFile): boolean {
  return /\.imba(?:\.compiled)?\.js$/.test(sourceFile.fileName);
}

function isExpressionSymbol(
  expression: ts.Expression,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  return checker.getSymbolAtLocation(unwrapExpression(expression)) === symbol;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function stringLiteralExpressionValue(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  return null;
}

function typeHasProperty(
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string,
): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;

  if (type.isUnion()) {
    const parts = type.types.filter((part) => !isNullishType(part));
    return parts.length > 0 && parts.every((part) => typeHasProperty(checker, part, name));
  }

  if (checker.getPropertyOfType(type, name)) return true;
  return typeHasStringIndex(checker, type);
}

function typeHasStringIndex(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;

  if (type.isUnion()) {
    const parts = type.types.filter((part) => !isNullishType(part));
    return parts.length > 0 && parts.every((part) => typeHasStringIndex(checker, part));
  }

  return Boolean(checker.getIndexTypeOfType(type, ts.IndexKind.String));
}

function isNullishType(type: ts.Type): boolean {
  return Boolean(type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void));
}

function isObjectLikeArgumentType(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some(isObjectLikeArgumentType) && !type.types.every(isPrimitiveType);
  }

  if (type.isIntersection()) {
    return type.types.some(isObjectLikeArgumentType);
  }

  return !isPrimitiveType(type) &&
    Boolean(
      type.flags &
        (
          ts.TypeFlags.Any |
          ts.TypeFlags.Object |
          ts.TypeFlags.NonPrimitive |
          ts.TypeFlags.TypeParameter |
          ts.TypeFlags.Unknown
        ),
    );
}

function isPrimitiveType(type: ts.Type): boolean {
  return Boolean(
    type.flags &
      (
        ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.Null |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Void
      ),
  );
}

function isGeneratedSymbolIndexDiagnostic(
  generated: string,
  diagnostic: ts.Diagnostic,
): boolean {
  if (diagnostic.code !== 2538 || diagnostic.start === undefined) return false;

  const symbolName = generatedIndexExpressionAt(generated, diagnostic.start);
  if (!symbolName || !isImbaGeneratedSymbolName(symbolName)) return false;

  return hasGeneratedSymbolDeclaration(generated, symbolName);
}

function generatedIndexExpressionAt(
  generated: string,
  offset: number,
): string | null {
  const lineStart = generated.lastIndexOf("\n", offset) + 1;
  const lineEndIndex = generated.indexOf("\n", offset);
  const lineEnd = lineEndIndex === -1 ? generated.length : lineEndIndex;
  const open = generated.lastIndexOf("[", offset);
  const close = generated.indexOf("]", offset);

  if (open < lineStart || close === -1 || close > lineEnd) return null;
  if (open >= offset || close < offset) return null;

  const expression = generated.slice(open + 1, close).trim();
  return /^[A-Za-z_$][\w$]*$/.test(expression) ? expression : null;
}

function isImbaGeneratedSymbolName(name: string): boolean {
  return /^\$(?:\d+|[A-Za-z_][\w$]*)$/.test(name);
}

function hasGeneratedSymbolDeclaration(generated: string, name: string): boolean {
  return new RegExp(
    `(?:^|[\\s,;])${escapeRegExp(name)}\\s*=\\s*Symbol(?:\\.for)?\\(`,
  ).test(generated);
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineTextAt(source: string, line: number): string {
  return source.split("\n")[line] ?? "";
}
