import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

type NotificationPredicate = (message: JsonRpcMessage) => boolean;

class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly notificationWaiters: Array<{
    method: string;
    predicate: NotificationPredicate;
    resolve: (message: JsonRpcMessage) => void;
  }> = [];
  private stderr = "";

  constructor(serverPath: string) {
    this.child = spawn(process.execPath, [serverPath, "--stdio"], {
      stdio: "pipe",
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.readMessages();
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.write(message);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.write({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  waitForNotification(
    method: string,
    predicate: NotificationPredicate,
    timeoutMs = 2000,
  ): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${method}. stderr: ${this.stderr}`));
      }, timeoutMs);

      this.notificationWaiters.push({
        method,
        predicate,
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
      });
    });
  }

  async shutdown(): Promise<void> {
    await this.request("shutdown", null);
    this.notify("exit");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 1000);

      this.child.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private write(message: JsonRpcMessage): void {
    const json = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, "ascii");
    this.child.stdin.write(Buffer.concat([header, json]));
  }

  private readMessages(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const lengthMatch = header.match(/Content-Length: (\d+)/i);
      assert.ok(lengthMatch, `missing Content-Length header: ${header}`);

      const length = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (this.buffer.length < messageEnd) return;

      const raw = this.buffer.subarray(messageStart, messageEnd).toString("utf8");
      this.buffer = this.buffer.subarray(messageEnd);
      this.handleMessage(JSON.parse(raw) as JsonRpcMessage);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;

      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }

      return;
    }

    if (!message.method) return;

    const index = this.notificationWaiters.findIndex(
      (waiter) => waiter.method === message.method && waiter.predicate(message),
    );

    if (index !== -1) {
      const [waiter] = this.notificationWaiters.splice(index, 1);
      waiter.resolve(message);
    }
  }
}

const serverPath = path.resolve(__dirname, "../src/server.js");
const fixturePath = path.resolve(__dirname, "../../test/fixtures/protocol.imba");
const uri = pathToFileURL(fixturePath).toString();

const invalidSource = ["tag app", "\tdef render", "\t\treturn if", ""].join("\n");
const validSource = [
  "import {Profile} from './project/profile.imba'",
  "import {PersonProfile, DefaultProfile} from './project/barrel.imba'",
  "import * as profiles from './project/profile.imba'",
  "",
  "tag app",
  "\tcount = 0",
  "\tdef save item",
  "\t\treturn {name: 'Ada', active: item.active}",
  "\tdef render",
  "\t\tdocument.body.style.overflow = 'hidden'",
  "\t\tnavigator.userAgent",
  "\t\twindow.location.href",
  "\t\tself.rendered?",
  "\t\t<div.card @click=save> \"Hi\"",
  "\tcss .card",
  "\t\tbgc:red5",
  "\tcss .panel",
  "\t\tc:blue5",
  "",
  "class Person",
  "\tnickname = 'Ada'",
  "\tfoo-bar = 1",
  "\tget ready?",
  "\t\treturn true",
  "\t# Says hello",
  "\tdef greet",
  "\t\treturn \"hi\"",
  "",
  "let person = new Person",
  "person.greet",
  "let profile = new Profile",
  "profile.name",
  "profile.ready?",
  "profile.foo-bar",
  "profile.greet",
  "let aliased = new PersonProfile",
  "aliased.greet",
  "let defaultProfile = new DefaultProfile",
  "defaultProfile.greet",
  "let namespaceProfile = new profiles.Profile",
  "namespaceProfile.greet",
  "",
].join("\n");

const typeErrorSource = [
  "def check",
  "\tlet value = 1",
  "\tvalue.toUpperCase()",
  "",
].join("\n");

const typingSource = [
  "def close _event = null",
  "\tdoc",
  "\timba.unmount(self)",
  "\treset!",
  "\tdocument.body.style.overflow = 'visible'",
  "\tself",
  "",
].join("\n");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const client = new LspClient(serverPath);

  try {
    const initialize = (await client.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(path.resolve(__dirname, "../..")).toString(),
      capabilities: {},
    })) as {
      capabilities?: {
        completionProvider?: {
          triggerCharacters?: string[];
        };
        definitionProvider?: boolean;
        documentSymbolProvider?: boolean;
        hoverProvider?: boolean;
        referencesProvider?: boolean;
        renameProvider?: unknown;
        semanticTokensProvider?: unknown;
      };
    };

    assert.equal(initialize.capabilities?.documentSymbolProvider, true);
    assert.equal(initialize.capabilities?.definitionProvider, true);
    assert.equal(initialize.capabilities?.hoverProvider, true);
    assert.equal(initialize.capabilities?.referencesProvider, true);
    assert.ok(initialize.capabilities?.renameProvider);
    assert.ok(initialize.capabilities?.semanticTokensProvider);
    assert.ok(initialize.capabilities?.completionProvider);
    assert.ok(initialize.capabilities.completionProvider.triggerCharacters?.includes("."));
    assert.ok(initialize.capabilities.completionProvider.triggerCharacters?.includes("@"));

    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "imba",
        version: 1,
        text: invalidSource,
      },
    });

    const invalidDiagnostics = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      (message) => {
        const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
        return params?.uri === uri && Array.isArray(params.diagnostics) && params.diagnostics.length > 0;
      },
    );
    assert.ok(invalidDiagnostics);

    client.notify("textDocument/didChange", {
      textDocument: {
        uri,
        version: 2,
      },
      contentChanges: [
        {
          text: validSource,
        },
      ],
    });

    const cleanDiagnostics = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      (message) => {
        const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
        return params?.uri === uri && Array.isArray(params.diagnostics) && params.diagnostics.length === 0;
      },
    );
    assert.ok(cleanDiagnostics);

    const symbols = (await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    })) as Array<{ name: string; children?: Array<{ name: string }> }>;
    assert.ok(symbols.some((symbol) => symbol.name === "app"));
    assert.ok(symbols.some((symbol) => symbol.name === "Person"));
    assert.ok(
      symbols.find((symbol) => symbol.name === "app")?.children?.some((child) => child.name === "render"),
    );

    const saveDefinition = locationTexts(
      validSource,
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "@click=save"),
      }),
    );
    assert.ok(saveDefinition.has("save"));

    const greetDefinition = locationTexts(
      validSource,
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "person.greet"),
      }),
    );
    assert.ok(greetDefinition.has("greet"));

    const importedGreetDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.greet"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(importedGreetDefinition, "expected definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, importedGreetDefinition), "greet");

    const importedProfileDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "new Profile"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(importedProfileDefinition, "expected class definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, importedProfileDefinition), "Profile");

    const importedProfileSpecifierDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "import {Profile"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(
      importedProfileSpecifierDefinition,
      "expected import specifier definition in imported profile.imba",
    );
    assert.equal(locationText(validSource, uri, importedProfileSpecifierDefinition), "Profile");

    const importedProfilePathDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "./project/profile.imba"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(
      importedProfilePathDefinition,
      "expected import path definition in imported profile.imba",
    );
    assert.equal(locationText(validSource, uri, importedProfilePathDefinition), "Profile");

    const aliasedProfileDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "new PersonProfile"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(aliasedProfileDefinition, "expected aliased class definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, aliasedProfileDefinition), "Profile");

    const defaultProfileDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "new DefaultProfile"),
      }),
    ).find((location) => location.uri.endsWith("/project/default-profile.imba"));
    assert.ok(defaultProfileDefinition, "expected default class definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, defaultProfileDefinition), "DefaultProfile");

    const namespaceProfileDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "profiles.Profile"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(namespaceProfileDefinition, "expected namespace class definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, namespaceProfileDefinition), "Profile");

    const importedReadyDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.ready?"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(importedReadyDefinition, "expected ready? definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, importedReadyDefinition), "ready?");

    const importedDashedDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.foo-bar"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(importedDashedDefinition, "expected foo-bar definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, importedDashedDefinition), "foo-bar");

    const aliasedGreetDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "aliased.greet"),
      }),
    ).find((location) => location.uri.endsWith("/project/profile.imba"));
    assert.ok(aliasedGreetDefinition, "expected aliased greet definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, aliasedGreetDefinition), "greet");

    const defaultGreetDefinition = locations(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "defaultProfile.greet"),
      }),
    ).find((location) => location.uri.endsWith("/project/default-profile.imba"));
    assert.ok(defaultGreetDefinition, "expected default greet definition in imported profile.imba");
    assert.equal(locationText(validSource, uri, defaultGreetDefinition), "greet");

    const dashedReferences = locations(
      await client.request("textDocument/references", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.foo-bar"),
        context: {
          includeDeclaration: true,
        },
      }),
    );
    assert.ok(
      dashedReferences.some((location) =>
        location.uri.endsWith("/project/profile.imba") &&
        locationText(validSource, uri, location) === "foo-bar"
      ),
      "expected foo-bar declaration reference in imported profile.imba",
    );
    assert.ok(
      dashedReferences.some((location) =>
        location.uri === uri &&
        locationText(validSource, uri, location) === "foo-bar"
      ),
      "expected foo-bar usage reference in current document",
    );

    const dashedPrepareRename = await client.request("textDocument/prepareRename", {
      textDocument: { uri },
      position: positionAfter(validSource, "profile.foo-bar"),
    }) as { placeholder?: unknown; range?: LspRange } | null;
    assert.equal(dashedPrepareRename?.placeholder, "foo-bar");
    assert.ok(dashedPrepareRename?.range);
    assert.equal(rangeText(validSource, dashedPrepareRename.range), "foo-bar");

    const dashedRenameEdits = workspaceEditItems(
      await client.request("textDocument/rename", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.foo-bar"),
        newName: "bar-baz",
      }),
    );
    assert.ok(
      dashedRenameEdits.some((edit) =>
        edit.uri.endsWith("/project/profile.imba") &&
        edit.newText === "bar-baz" &&
        locationText(validSource, uri, edit) === "foo-bar"
      ),
      "expected foo-bar declaration rename edit in imported profile.imba",
    );
    assert.ok(
      dashedRenameEdits.some((edit) =>
        edit.uri === uri &&
        edit.newText === "bar-baz" &&
        locationText(validSource, uri, edit) === "foo-bar"
      ),
      "expected foo-bar usage rename edit in current document",
    );

    const greetHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "person.greet"),
      }),
    );
    assert.match(greetHover, /Imba method `Person\.greet`/);
    assert.match(greetHover, /Says hello/);

    const importedGreetHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.greet"),
      }),
    );
    assert.match(importedGreetHover, /Profile\.greet/);
    assert.match(importedGreetHover, /Imba method/);
    assert.match(importedGreetHover, /def greet/);

    const importedProfileHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "new Profile"),
      }),
    );
    assert.match(importedProfileHover, /Imba class `Profile`/);
    assert.match(importedProfileHover, /export class Profile/);

    const importedReadyHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.ready?"),
      }),
    );
    assert.match(importedReadyHover, /Profile\.ready\?/);
    assert.match(importedReadyHover, /True once the profile is ready/);
    assert.match(importedReadyHover, /get ready\?/);
    assert.doesNotMatch(importedReadyHover, /readyΦ/);

    const navigatorHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "navigator.userAgent"),
      }),
    );
    assert.match(navigatorHover, /NavigatorID\.userAgent/);
    assert.match(navigatorHover, /string/);

    const overflowHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "document.body.style.overflow"),
      }),
    );
    assert.match(overflowHover, /CSSStyleDeclaration\.overflow/);

    const navigatorDefinitionUris = locationUris(
      await client.request("textDocument/definition", {
        textDocument: { uri },
        position: positionAfter(validSource, "navigator.userAgent"),
      }),
    );
    assert.ok(navigatorDefinitionUris.some((item) => item.endsWith("lib.dom.d.ts")));

    const semanticTokens = (await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri },
    })) as { data?: number[] };
    assert.ok(Array.isArray(semanticTokens.data));
    assert.ok(semanticTokens.data.length > 0);
    assert.equal(semanticTokens.data.length % 5, 0);

    const generalCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionBefore(validSource, "\t\tdocument.body"),
      }),
    );
    assert.ok(generalCompletion.has("return"));
    assert.ok(generalCompletion.has("save"));
    assert.ok(generalCompletion.has("Person"));
    assert.ok(generalCompletion.has("navigator"));
    assert.ok(generalCompletion.has("window"));
    assert.ok(generalCompletion.has("fetch"));

    const memberCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "document."),
      }),
    );
    assert.ok(memberCompletion.has("body"));
    assert.ok(memberCompletion.has("style"));

    const bodyCompletion = completionItem(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "document.bo"),
      }),
      "body",
    );
    assert.equal(completionTextEditNewText(bodyCompletion), "body");
    assert.equal(completionTextEditRangeText(validSource, bodyCompletion), "body");

    const domCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "document.body.style."),
      }),
    );
    assert.ok(domCompletion.has("backgroundColor"));

    const navigatorCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "navigator."),
      }),
    );
    assert.ok(navigatorCompletion.has("userAgent"));
    assert.ok(navigatorCompletion.has("language"));
    assert.ok(navigatorCompletion.has("clipboard"));

    const windowCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "window."),
      }),
    );
    assert.ok(windowCompletion.has("navigator"));
    assert.ok(windowCompletion.has("location"));
    assert.ok(windowCompletion.has("localStorage"));

    const selfCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "self."),
      }),
    );
    assert.ok(selfCompletion.has("rendered?"));
    assert.equal(selfCompletion.has("_ns_"), false);
    assert.equal(selfCompletion.has("__slots"), false);
    assert.equal(selfCompletion.has("css$var"), false);
    assert.equal(selfCompletion.has("flagSelf$"), false);
    assert.equal(selfCompletion.has("on$"), false);

    const classMemberCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "person."),
      }),
    );
    assert.ok(classMemberCompletion.has("greet"));
    assert.ok(classMemberCompletion.has("nickname"));
    assert.ok(classMemberCompletion.has("foo-bar"));
    assert.ok(classMemberCompletion.has("ready?"));
    assert.equal(classMemberCompletion.has("fooΞbar"), false);
    assert.equal(classMemberCompletion.has("readyΦ"), false);

    const readyCompletion = completionItem(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "person."),
      }),
      "ready?",
    );
    assert.equal(completionTextEditNewText(readyCompletion), "ready?");

    const importedClassMemberCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "profile.na"),
      }),
    );
    assert.ok(importedClassMemberCompletion.has("name"));
    assert.ok(importedClassMemberCompletion.has("greet"));

    const eventCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "<div.card @"),
      }),
    );
    assert.ok(eventCompletion.has("click"));
    assert.ok(eventCompletion.has("submit"));

    const cssCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionBefore(validSource, "\t\tbgc:red5"),
      }),
    );
    assert.ok(cssCompletion.has("bgc"));
    assert.ok(cssCompletion.has("c"));

    const tagCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "\t\t<"),
      }),
    );
    assert.ok(tagCompletion.has("div"));
    assert.ok(tagCompletion.has("self"));
    assert.ok(tagCompletion.has("app"));

    const classCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "\t\t<div."),
      }),
    );
    assert.ok(classCompletion.has("card"));
    assert.ok(classCompletion.has("panel"));
    assert.equal(classCompletion.has("click"), false);

    client.notify("textDocument/didChange", {
      textDocument: {
        uri,
        version: 3,
      },
      contentChanges: [
        {
          text: typeErrorSource,
        },
      ],
    });

    const typeDiagnostics = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      (message) => {
        const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
        return params?.uri === uri &&
          Array.isArray(params.diagnostics) &&
          params.diagnostics.some((diagnostic) =>
            diagnosticSource(diagnostic) === "typescript" &&
            diagnosticMessage(diagnostic).includes("toUpperCase")
          );
      },
    );
    const typeDiagnostic = diagnosticByMessage(typeDiagnostics, "toUpperCase");
    assert.equal(diagnosticSource(typeDiagnostic), "typescript");
    assert.equal(diagnosticRangeText(typeErrorSource, typeDiagnostic), "toUpperCase");

    client.notify("textDocument/didChange", {
      textDocument: {
        uri,
        version: 4,
      },
      contentChanges: [
        {
          text: typingSource,
        },
      ],
    });

    const typingSemanticTokens = (await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri },
    })) as { data?: number[] };
    assert.ok(Array.isArray(typingSemanticTokens.data));
    const typingTokenTexts = semanticTokenTexts(typingSource, typingSemanticTokens.data);
    assert.ok(typingTokenTexts.has("close"));
    assert.ok(typingTokenTexts.has("doc"));
    assert.equal(typingTokenTexts.has("Person"), false);
  } finally {
    await client.shutdown();
  }

  console.log("protocol.test ok");
}

function completionLabels(result: unknown): Set<string> {
  const items = Array.isArray(result)
    ? result
    : ((result as { items?: unknown[] } | undefined)?.items ?? []);

  return new Set(
    items
      .map((item) => (item as { label?: unknown }).label)
      .filter((label): label is string => typeof label === "string"),
  );
}

function completionItem(result: unknown, label: string): Record<string, unknown> {
  const items = Array.isArray(result)
    ? result
    : ((result as { items?: unknown[] } | undefined)?.items ?? []);
  const match = items.find((item) => (item as { label?: unknown }).label === label);
  assert.ok(match, `missing completion item ${label}`);
  return match as Record<string, unknown>;
}

function completionTextEditNewText(item: Record<string, unknown>): string {
  const textEdit = item.textEdit as { newText?: unknown } | undefined;
  assert.ok(textEdit, `missing textEdit on completion ${String(item.label)}`);
  const newText = textEdit.newText;
  assert.ok(typeof newText === "string");
  return newText;
}

function completionTextEditRangeText(source: string, item: Record<string, unknown>): string {
  const textEdit = item.textEdit as { range?: LspRange } | undefined;
  assert.ok(textEdit?.range, `missing textEdit range on completion ${String(item.label)}`);
  return rangeText(source, textEdit.range);
}

function locationTexts(source: string, result: unknown): Set<string> {
  return new Set(
    locations(result).map((location) => rangeText(source, location.range)),
  );
}

function locationUris(result: unknown): string[] {
  return locations(result).map((location) => location.uri);
}

function workspaceEditItems(result: unknown): Array<LspLocation & { newText: string }> {
  const changes = (result as { changes?: Record<string, unknown[]> } | undefined)?.changes ?? {};
  const items: Array<LspLocation & { newText: string }> = [];

  for (const [uri, edits] of Object.entries(changes)) {
    for (const edit of edits) {
      const textEdit = edit as { newText?: unknown; range?: LspRange };
      if (typeof textEdit.newText !== "string" || !textEdit.range) continue;

      items.push({
        newText: textEdit.newText,
        range: textEdit.range,
        uri,
      });
    }
  }

  return items;
}

function locations(result: unknown): LspLocation[] {
  const items = Array.isArray(result) ? result : result ? [result] : [];
  return items
    .map((location) => location as { range?: LspRange; uri?: unknown })
    .filter((location): location is LspLocation =>
      typeof location.uri === "string" && Boolean(location.range)
    );
}

function locationText(
  inMemorySource: string,
  inMemoryUri: string,
  location: LspLocation,
): string {
  const source = location.uri === inMemoryUri
    ? inMemorySource
    : fs.readFileSync(fileURLToPath(location.uri), "utf8");
  return rangeText(source, location.range);
}

function hoverText(result: unknown): string {
  const contents = (result as { contents?: unknown } | null)?.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.join("\n");
  if (contents && typeof contents === "object") {
    const value = (contents as { value?: unknown }).value;
    return typeof value === "string" ? value : "";
  }

  return "";
}

function diagnosticByMessage(message: JsonRpcMessage, needle: string): Record<string, unknown> {
  const diagnostics =
    (message.params as { diagnostics?: unknown[] } | undefined)?.diagnostics ?? [];
  const match = diagnostics.find((diagnostic) => diagnosticMessage(diagnostic).includes(needle));
  assert.ok(match, `missing diagnostic containing ${JSON.stringify(needle)}`);
  return match as Record<string, unknown>;
}

function diagnosticSource(diagnostic: unknown): string {
  const source = (diagnostic as { source?: unknown }).source;
  return typeof source === "string" ? source : "";
}

function diagnosticMessage(diagnostic: unknown): string {
  const message = (diagnostic as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function diagnosticRangeText(source: string, diagnostic: Record<string, unknown>): string {
  const range = diagnostic.range as LspRange | undefined;
  assert.ok(range, "missing diagnostic range");
  return rangeText(source, range);
}

function semanticTokenTexts(source: string, data: number[]): Set<string> {
  const lines = source.split("\n");
  const texts = new Set<string>();
  let line = 0;
  let character = 0;

  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index];
    const deltaStart = data[index + 1];
    const length = data[index + 2];

    if (deltaLine === 0) {
      character += deltaStart;
    } else {
      line += deltaLine;
      character = deltaStart;
    }

    const text = lines[line]?.slice(character, character + length);
    if (text) {
      texts.add(text);
    }
  }

  return texts;
}

interface LspRange {
  start: {
    line: number;
    character: number;
  };
  end: {
    line: number;
    character: number;
  };
}

interface LspLocation {
  range: LspRange;
  uri: string;
}

function rangeText(source: string, range: LspRange): string {
  return source.slice(offsetAtPosition(source, range.start), offsetAtPosition(source, range.end));
}

function positionBefore(source: string, needle: string): { line: number; character: number } {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `missing source needle ${JSON.stringify(needle)}`);
  return positionAtOffset(source, offset);
}

function positionAfter(source: string, needle: string): { line: number; character: number } {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `missing source needle ${JSON.stringify(needle)}`);
  return positionAtOffset(source, offset + needle.length);
}

function positionAtOffset(source: string, offset: number): { line: number; character: number } {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
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
