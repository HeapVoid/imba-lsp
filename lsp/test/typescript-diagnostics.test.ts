import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticSeverity, type Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compileImba } from "../src/compiler";
import { buildTypeScriptDiagnosticGroups } from "../src/typescript-diagnostics";
import { createTypeScriptLanguageService } from "../src/typescript-service";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "imba-lsp-ts-diagnostics-"));

try {
  const appPath = path.join(root, "app.imba");
  const profilePath = path.join(root, "profile.imba");
  const jsImportAppPath = path.join(root, "js-import-app.imba");
  const runtimePath = path.join(root, "runtime.imba");
  const jsConfigDir = path.join(root, "pocketbase");
  const jsConfigPath = path.join(jsConfigDir, "jsconfig.json");
  const jsConfigTestPath = path.join(jsConfigDir, "test", "security.js");
  const jsConfigTypePath = path.join(jsConfigDir, "types.d.ts");
  const jsConfigImbaPath = path.join(jsConfigDir, "src", "hook.imba");
  const appSource = [
    "import {Profile} from './profile.imba'",
    "let profile = new Profile",
    "profile.check",
    "",
  ].join("\n");
  const profileSource = [
    "export class Profile",
    "\tdef check",
    "\t\tlet value = 1",
    "\t\tvalue.toUpperCase()",
    "",
  ].join("\n");

  fs.writeFileSync(profilePath, profileSource);

  const document = TextDocument.create(
    pathToFileURL(appPath).toString(),
    "imba",
    1,
    appSource,
  );
  const result = compileImba(appSource, appPath, {
    sourcemap: true,
  });
  assert.equal(result.diagnostics.length, 0);

  const groups = buildTypeScriptDiagnosticGroups(document, appPath, result.compilation);
  assert.equal(groups.current.length, 0);

  const imported = groups.imported.find((group) => group.sourcePath === profilePath);
  assert.ok(imported, "expected imported profile diagnostics group");

  const diagnostic = imported.diagnostics.find((item) =>
    item.message.includes("toUpperCase")
  );
  assert.ok(diagnostic, "expected imported TypeScript diagnostic");
  assert.equal(imported.uri, pathToFileURL(profilePath).toString());
  assert.equal(rangeText(imported.source, diagnostic.range), "toUpperCase");

  const jsImportSource = [
    "import {Profile} from './profile.js'",
    "let profile = new Profile",
    "profile.check",
    "",
  ].join("\n");
  const jsImportDocument = TextDocument.create(
    pathToFileURL(jsImportAppPath).toString(),
    "imba",
    1,
    jsImportSource,
  );
  const jsImportResult = compileImba(jsImportSource, jsImportAppPath, {
    sourcemap: true,
  });
  assert.equal(jsImportResult.diagnostics.length, 0);
  assert.equal(
    buildTypeScriptDiagnosticGroups(
      jsImportDocument,
      jsImportAppPath,
      jsImportResult.compilation,
    ).current.length,
    0,
    "TypeScript resolver should map .js imports back to sibling .imba modules",
  );

  const runtimeSource = [
    "tag card",
    "\tdef mount",
    "\t\tself.querySelector('canvas')",
    "\tdef close",
    "\t\treturn true",
    "\tdef render",
    "\t\t<self ease @click=close>",
    "\t\t\t<span> data.name",
    "\tcss self",
    "\t\tpos: rel",
    "\t\t&:before bc: blue5/50",
    "",
  ].join("\n");
  const runtimeDocument = TextDocument.create(
    pathToFileURL(runtimePath).toString(),
    "imba",
    1,
    runtimeSource,
  );
  const runtimeResult = compileImba(runtimeSource, runtimePath, {
    sourcemap: true,
  });
  assert.equal(runtimeResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      runtimeDocument,
      runtimePath,
      runtimeResult.compilation,
    ).current,
    [],
  );

  const runtimeHelperPath = path.join(root, "runtime-helper.imba.compiled.js");
  const runtimeHelperService = createTypeScriptLanguageService(
    runtimeHelperPath,
    [
      "import { Component } from 'imba'",
      "class Card extends Component {",
      "  render(){",
      "    this.flagSelf$('generated-class', null);",
      "  }",
      "}",
      "",
    ].join("\n"),
    {
      compilerOptions: {
        checkJs: true,
        noEmit: true,
      },
      currentDirectory: root,
    },
  );
  assert.deepEqual(
    runtimeHelperService.getSemanticDiagnostics(runtimeHelperPath).filter((diagnostic) =>
      diagnostic.code === 2554
    ),
    [],
    "runtime helper typings should accept compiler-emitted flagSelf$(className, flags) calls",
  );

  const isaFunctionPath = path.join(root, "isa-function.imba");
  const isaFunctionSource = [
    "const hooks =",
    "\terror: null",
    "def notify code, detail = ''",
    "\tif hooks.error isa Function",
    "\t\thooks.error(code, detail)",
    "",
  ].join("\n");
  const isaFunctionDocument = TextDocument.create(
    pathToFileURL(isaFunctionPath).toString(),
    "imba",
    1,
    isaFunctionSource,
  );
  const isaFunctionResult = compileImba(isaFunctionSource, isaFunctionPath, {
    sourcemap: true,
  });
  assert.equal(isaFunctionResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      isaFunctionDocument,
      isaFunctionPath,
      isaFunctionResult.compilation,
    ).current,
    [],
    "Imba runtime typings should accept compiler-emitted isa$(value, type) calls",
  );

  fs.mkdirSync(path.dirname(jsConfigImbaPath), { recursive: true });
  fs.mkdirSync(path.dirname(jsConfigTestPath), { recursive: true });
  fs.writeFileSync(
    jsConfigTypePath,
    [
      "declare const pocketGlobal: { ready: boolean }",
      "type CoreApp = {",
      "\tsave(model: unknown): void",
      "}",
      "type PocketBase = CoreApp & {",
      "\tstart(): void",
      "\texecute(command: string): void",
      "\trunInTransaction(fn: (txApp: CoreApp) => void): void",
      "}",
      "declare var $app: PocketBase",
      "declare namespace security {",
      "\tinterface pseudorandomString {",
      "\t\t(length: number): string",
      "\t}",
      "}",
      "declare namespace $security {",
      "\tlet pseudorandomString: security.pseudorandomString",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    jsConfigTestPath,
    [
      "globalThis.$security = {",
      "\tpseudorandomString: () => 'test-seed',",
      "};",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    jsConfigPath,
    JSON.stringify({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        lib: ["ES2022"],
      },
      include: ["test/**/*.js", "types.d.ts"],
    }),
  );
  const jsConfigSource = [
    "def hook",
    "\tpocketGlobal.ready",
    "\t$security.pseudorandomString(20)",
    "\tuseApp $app",
    "def useApp(app = $app)",
    "\tapp.save({})",
    "def transaction",
    "\t$app.runInTransaction do(xapp)",
    "\t\tuseApp xapp",
    "",
  ].join("\n");
  const jsConfigDocument = TextDocument.create(
    pathToFileURL(jsConfigImbaPath).toString(),
    "imba",
    1,
    jsConfigSource,
  );
  const jsConfigResult = compileImba(jsConfigSource, jsConfigImbaPath, {
    sourcemap: true,
  });
  assert.equal(jsConfigResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      jsConfigDocument,
      jsConfigImbaPath,
      jsConfigResult.compilation,
    ).current,
    [],
    "TypeScript diagnostics should load jsconfig globals without letting root JS test stubs override ambient declarations",
  );

  const defaultFallbackSource = [
    "def read(record, name, fallback = '')",
    "\ttry",
    "\t\tconst value = record.get(name)",
    "\t\treturn fallback if value == undefined or value == null",
    "\t\tvalue",
    "\tcatch",
    "\t\tfallback",
    "def use(record)",
    "\tNumber(read(record, 'weight', 0) or 0)",
    "",
  ].join("\n");
  const defaultFallbackPath = path.join(root, "default-fallback.imba");
  const defaultFallbackDocument = TextDocument.create(
    pathToFileURL(defaultFallbackPath).toString(),
    "imba",
    1,
    defaultFallbackSource,
  );
  const defaultFallbackResult = compileImba(defaultFallbackSource, defaultFallbackPath, {
    sourcemap: true,
  });
  assert.equal(defaultFallbackResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      defaultFallbackDocument,
      defaultFallbackPath,
      defaultFallbackResult.compilation,
    ).current,
    [],
    "untyped Imba default values should not become strict TypeScript parameter annotations",
  );

  const strictDefaultStringSource = [
    "def upper(value = '')",
    "\tvalue.toUpperCase()",
    "def broken",
    "\tupper 1",
    "",
  ].join("\n");
  const strictDefaultStringPath = path.join(root, "strict-default-string.imba");
  const strictDefaultStringDocument = TextDocument.create(
    pathToFileURL(strictDefaultStringPath).toString(),
    "imba",
    1,
    strictDefaultStringSource,
  );
  const strictDefaultStringResult = compileImba(strictDefaultStringSource, strictDefaultStringPath, {
    sourcemap: true,
  });
  assert.equal(strictDefaultStringResult.diagnostics.length, 0);
  assert.ok(
    buildTypeScriptDiagnosticGroups(
      strictDefaultStringDocument,
      strictDefaultStringPath,
      strictDefaultStringResult.compilation,
    ).current.some((diagnostic) =>
      diagnostic.source === "typescript" &&
      diagnostic.code === 2345 &&
      diagnostic.message.includes("number")
    ),
    "defaulted parameters should still reject arguments when the body uses string-only APIs",
  );

  const primitiveDefaultGlobalSource = [
    "def useApp(app = $app)",
    "\tapp.save({})",
    "def broken",
    "\tuseApp 1",
    "",
  ].join("\n");
  const primitiveDefaultGlobalPath = path.join(jsConfigDir, "src", "primitive-app.imba");
  const primitiveDefaultGlobalDocument = TextDocument.create(
    pathToFileURL(primitiveDefaultGlobalPath).toString(),
    "imba",
    1,
    primitiveDefaultGlobalSource,
  );
  const primitiveDefaultGlobalResult = compileImba(
    primitiveDefaultGlobalSource,
    primitiveDefaultGlobalPath,
    {
      sourcemap: true,
    },
  );
  assert.equal(primitiveDefaultGlobalResult.diagnostics.length, 0);
  assert.ok(
    buildTypeScriptDiagnosticGroups(
      primitiveDefaultGlobalDocument,
      primitiveDefaultGlobalPath,
      primitiveDefaultGlobalResult.compilation,
    ).current.some((diagnostic) =>
      diagnostic.source === "typescript" &&
      diagnostic.code === 2345 &&
      diagnostic.message.includes("number")
    ),
    "primitive arguments should still be rejected for default-global object parameters",
  );

  const unsafeDefaultGlobalSource = [
    "def useApp(app = $app)",
    "\tapp.start!",
    "def broken",
    "\t$app.runInTransaction do(xapp)",
    "\t\tuseApp xapp",
    "",
  ].join("\n");
  const unsafeDefaultGlobalPath = path.join(jsConfigDir, "src", "unsafe-app.imba");
  const unsafeDefaultGlobalDocument = TextDocument.create(
    pathToFileURL(unsafeDefaultGlobalPath).toString(),
    "imba",
    1,
    unsafeDefaultGlobalSource,
  );
  const unsafeDefaultGlobalResult = compileImba(
    unsafeDefaultGlobalSource,
    unsafeDefaultGlobalPath,
    {
      sourcemap: true,
    },
  );
  assert.equal(unsafeDefaultGlobalResult.diagnostics.length, 0);
  assert.ok(
    buildTypeScriptDiagnosticGroups(
      unsafeDefaultGlobalDocument,
      unsafeDefaultGlobalPath,
      unsafeDefaultGlobalResult.compilation,
    ).current.some((diagnostic) =>
      diagnostic.source === "typescript" &&
      diagnostic.code === 2345 &&
      diagnostic.message.includes("CoreApp")
    ),
    "transaction objects should still be rejected when the helper uses app-only properties",
  );

  const nestedUnsafeDefaultGlobalSource = [
    "def needFull(app = $app)",
    "\tapp.execute('maintenance')",
    "def useApp(app = $app)",
    "\tneedFull app",
    "def broken",
    "\t$app.runInTransaction do(xapp)",
    "\t\tuseApp xapp",
    "",
  ].join("\n");
  const nestedUnsafeDefaultGlobalPath = path.join(jsConfigDir, "src", "nested-unsafe-app.imba");
  const nestedUnsafeDefaultGlobalDocument = TextDocument.create(
    pathToFileURL(nestedUnsafeDefaultGlobalPath).toString(),
    "imba",
    1,
    nestedUnsafeDefaultGlobalSource,
  );
  const nestedUnsafeDefaultGlobalResult = compileImba(
    nestedUnsafeDefaultGlobalSource,
    nestedUnsafeDefaultGlobalPath,
    {
      sourcemap: true,
    },
  );
  assert.equal(nestedUnsafeDefaultGlobalResult.diagnostics.length, 0);
  assert.ok(
    buildTypeScriptDiagnosticGroups(
      nestedUnsafeDefaultGlobalDocument,
      nestedUnsafeDefaultGlobalPath,
      nestedUnsafeDefaultGlobalResult.compilation,
    ).current.some((diagnostic) =>
      diagnostic.source === "typescript" &&
      diagnostic.code === 2345 &&
      diagnostic.message.includes("CoreApp")
    ),
    "transaction objects should still be rejected when a nested helper uses app-only properties",
  );

  const untypedPassThroughSource = [
    "const dynamicModule = JSON.parse('{}')",
    "def useApp(app = $app)",
    "\tdynamicModule.write(app)",
    "def transaction",
    "\t$app.runInTransaction do(xapp)",
    "\t\tuseApp xapp",
    "",
  ].join("\n");
  const untypedPassThroughPath = path.join(jsConfigDir, "src", "untyped-pass-through.imba");
  const untypedPassThroughDocument = TextDocument.create(
    pathToFileURL(untypedPassThroughPath).toString(),
    "imba",
    1,
    untypedPassThroughSource,
  );
  const untypedPassThroughResult = compileImba(
    untypedPassThroughSource,
    untypedPassThroughPath,
    {
      sourcemap: true,
    },
  );
  assert.equal(untypedPassThroughResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      untypedPassThroughDocument,
      untypedPassThroughPath,
      untypedPassThroughResult.compilation,
    ).current,
    [],
    "untyped pass-through calls should not make dynamic Imba helpers look unsafe",
  );

  const objectAccessSource = [
    "def check(input = {})",
    "\treturn false unless input and typeof input == 'object'",
    "\tinput.slot",
    "",
  ].join("\n");
  const objectAccessPath = path.join(root, "object-access.imba");
  const objectAccessDocument = TextDocument.create(
    pathToFileURL(objectAccessPath).toString(),
    "imba",
    1,
    objectAccessSource,
  );
  const objectAccessResult = compileImba(objectAccessSource, objectAccessPath, {
    sourcemap: true,
  });
  assert.equal(objectAccessResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      objectAccessDocument,
      objectAccessPath,
      objectAccessResult.compilation,
    ).current,
    [],
    "dynamic property access on object should behave like runtime undefined access",
  );

  const numberAccessSource = [
    "def check",
    "\tlet value = 1",
    "\tvalue.slot",
    "",
  ].join("\n");
  const numberAccessPath = path.join(root, "number-access.imba");
  const numberAccessDocument = TextDocument.create(
    pathToFileURL(numberAccessPath).toString(),
    "imba",
    1,
    numberAccessSource,
  );
  const numberAccessResult = compileImba(numberAccessSource, numberAccessPath, {
    sourcemap: true,
  });
  assert.equal(numberAccessResult.diagnostics.length, 0);
  const numberAccessDiagnostic = buildTypeScriptDiagnosticGroups(
    numberAccessDocument,
    numberAccessPath,
    numberAccessResult.compilation,
  ).current.find((diagnostic) =>
    diagnostic.source === "typescript" &&
    diagnostic.code === 2339 &&
    diagnostic.message.includes("number")
  );
  assert.ok(
    numberAccessDiagnostic,
    "property access on primitives should remain a TypeScript diagnostic",
  );
  assert.equal(
    numberAccessDiagnostic.severity,
    DiagnosticSeverity.Error,
    "property access on primitives should stay an error",
  );

  const nullSafeAccessSource = [
    "def run",
    "\tlet itemRecord = null",
    "\ttry",
    "\t\t[1].forEach do",
    "\t\t\titemRecord = {id: 1}",
    "\titemRecord..id",
    "",
  ].join("\n");
  const nullSafeAccessPath = path.join(root, "null-safe-access.imba");
  const nullSafeAccessDocument = TextDocument.create(
    pathToFileURL(nullSafeAccessPath).toString(),
    "imba",
    1,
    nullSafeAccessSource,
  );
  const nullSafeAccessResult = compileImba(nullSafeAccessSource, nullSafeAccessPath, {
    sourcemap: true,
  });
  assert.equal(nullSafeAccessResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      nullSafeAccessDocument,
      nullSafeAccessPath,
      nullSafeAccessResult.compilation,
    ).current,
    [],
    "Imba null-safe access should suppress TypeScript nullish access diagnostics",
  );

  const unsafeNullAccessSource = [
    "def run",
    "\tlet itemRecord = null",
    "\ttry",
    "\t\t[1].forEach do",
    "\t\t\titemRecord = {id: 1}",
    "\titemRecord.id",
    "",
  ].join("\n");
  const unsafeNullAccessPath = path.join(root, "unsafe-null-access.imba");
  const unsafeNullAccessDocument = TextDocument.create(
    pathToFileURL(unsafeNullAccessPath).toString(),
    "imba",
    1,
    unsafeNullAccessSource,
  );
  const unsafeNullAccessResult = compileImba(unsafeNullAccessSource, unsafeNullAccessPath, {
    sourcemap: true,
  });
  assert.equal(unsafeNullAccessResult.diagnostics.length, 0);
  assert.ok(
    buildTypeScriptDiagnosticGroups(
      unsafeNullAccessDocument,
      unsafeNullAccessPath,
      unsafeNullAccessResult.compilation,
    ).current.some((diagnostic) =>
      diagnostic.source === "typescript" &&
      diagnostic.code === 18047 &&
      diagnostic.message.includes("possibly 'null'")
    ),
    "plain property access should keep TypeScript nullish diagnostics",
  );

  const fetchHeadersSource = [
    "def load",
    "\tconst headers = {}",
    "\theaders.authorization = 'Bearer token'",
    "\twindow.fetch('/api/media', { headers })",
    "",
  ].join("\n");
  const fetchHeadersPath = path.join(root, "fetch-headers.imba");
  const fetchHeadersDocument = TextDocument.create(
    pathToFileURL(fetchHeadersPath).toString(),
    "imba",
    1,
    fetchHeadersSource,
  );
  const fetchHeadersResult = compileImba(fetchHeadersSource, fetchHeadersPath, {
    sourcemap: true,
  });
  assert.equal(fetchHeadersResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      fetchHeadersDocument,
      fetchHeadersPath,
      fetchHeadersResult.compilation,
    ).current,
    [],
    "local string-valued fetch headers should not trip TypeScript's HeadersInit index-signature check",
  );

  const invalidFetchHeadersSource = [
    "def load",
    "\tconst headers = {}",
    "\theaders.authorization = 1",
    "\twindow.fetch('/api/media', { headers })",
    "",
  ].join("\n");
  const invalidFetchHeadersPath = path.join(root, "invalid-fetch-headers.imba");
  const invalidFetchHeadersDocument = TextDocument.create(
    pathToFileURL(invalidFetchHeadersPath).toString(),
    "imba",
    1,
    invalidFetchHeadersSource,
  );
  const invalidFetchHeadersResult = compileImba(
    invalidFetchHeadersSource,
    invalidFetchHeadersPath,
    {
      sourcemap: true,
    },
  );
  assert.equal(invalidFetchHeadersResult.diagnostics.length, 0);
  assert.ok(
    buildTypeScriptDiagnosticGroups(
      invalidFetchHeadersDocument,
      invalidFetchHeadersPath,
      invalidFetchHeadersResult.compilation,
    ).current.some((diagnostic) =>
      diagnostic.source === "typescript" &&
      (diagnostic.code === 2322 || diagnostic.code === 2769) &&
      diagnostic.message.includes("HeadersInit")
    ),
    "non-string fetch header values should remain TypeScript diagnostics",
  );

  const buttonPath = path.join(root, "button-basic.imba");
  const buttonSource = [
    "tag button-basic < button",
    "\tcss &",
    "\t\tbw:1px rd:3px py:9px px:20px m:0 gap:10px cursor:pointer",
    "\t\tbgc:white/5 bc:white/10 fs:15px fw:300 lh:16px ls:0.09em",
    "\t\t>>> svg w:20px h:20px",
    "\t\t@hover bgc:white/10 bc:white/20",
    "\t\t@disabled",
    "\t\t\tbgc:white/5 bc:white/10 cursor:default c:white fw:400",
    "\t\t\t@hover bgc:white/5 bc:white/10 c:white",
    "\t\t\t>>> svg fill:white fill@hover:white",
    "",
    "\t<self [d:hcc us:none]>",
    "\t\t<slot>",
    "\t\t<slot>",
    "",
  ].join("\n");
  const buttonDocument = TextDocument.create(
    pathToFileURL(buttonPath).toString(),
    "imba",
    1,
    buttonSource,
  );
  const buttonResult = compileImba(buttonSource, buttonPath, {
    sourcemap: true,
  });
  assert.equal(buttonResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      buttonDocument,
      buttonPath,
      buttonResult.compilation,
    ).current,
    [],
    "compiler-generated symbol indexes must not leak as source diagnostics",
  );

  const ethereumSource = [
    "def connect",
    "\twindow.ethereum",
    "",
  ].join("\n");
  const ethereumDocument = TextDocument.create(
    pathToFileURL(path.join(root, "ethereum.imba")).toString(),
    "imba",
    1,
    ethereumSource,
  );
  const ethereumResult = compileImba(ethereumSource, path.join(root, "ethereum.imba"), {
    sourcemap: true,
  });
  assert.equal(ethereumResult.diagnostics.length, 0);

  const ethereumDiagnostics = buildTypeScriptDiagnosticGroups(
    ethereumDocument,
    path.join(root, "ethereum.imba"),
    ethereumResult.compilation,
  ).current;
  assert.deepEqual(
    ethereumDiagnostics,
    [],
    "dynamic object property diagnostics should not leak as warnings",
  );

  const setIterationSource = [
    "const listeners = new Set",
    "def emit",
    "\tfor listener in listeners",
    "\t\tlistener!",
    "",
  ].join("\n");
  const setIterationPath = path.join(root, "set-iteration.imba");
  const setIterationDocument = TextDocument.create(
    pathToFileURL(setIterationPath).toString(),
    "imba",
    1,
    setIterationSource,
  );
  const setIterationResult = compileImba(setIterationSource, setIterationPath, {
    sourcemap: true,
  });
  assert.equal(setIterationResult.diagnostics.length, 0);
  assert.deepEqual(
    buildTypeScriptDiagnosticGroups(
      setIterationDocument,
      setIterationPath,
      setIterationResult.compilation,
    ).current,
    [],
  );
} finally {
  fs.rmSync(root, { force: true, recursive: true });
}

console.log("typescript-diagnostics.test ok");

function rangeText(source: string, range: Range): string {
  return source.slice(offsetAtPosition(source, range.start), offsetAtPosition(source, range.end));
}

function offsetAtPosition(
  source: string,
  position: { line: number; character: number },
): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let line = 0; line < position.line; line++) {
    offset += (lines[line] ?? "").length + 1;
  }

  return offset + position.character;
}
