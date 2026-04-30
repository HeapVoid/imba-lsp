import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const fixturePath = path.resolve(__dirname, "../fixtures/protocol.imba");
const uri = pathToFileURL(fixturePath).toString();

const invalidSource = ["tag app", "\tdef render", "\t\treturn if", ""].join("\n");
const validSource = [
  "tag app",
  "\tcount = 0",
  "\tdef save item",
  "\t\treturn {name: 'Ada', active: item.active}",
  "\tdef render",
  "\t\tdocument.body.style.overflow = 'hidden'",
  "\t\tnavigator.userAgent",
  "\t\twindow.location.href",
  "\t\t<div.card @click=save> \"Hi\"",
  "\tcss .card",
  "\t\tbgc:red5",
  "\tcss .panel",
  "\t\tc:blue5",
  "",
  "class Person",
  "\tnickname = 'Ada'",
  "\tdef greet",
  "\t\treturn \"hi\"",
  "",
  "let person = new Person",
  "person.greet",
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
        semanticTokensProvider?: unknown;
      };
    };

    assert.equal(initialize.capabilities?.documentSymbolProvider, true);
    assert.equal(initialize.capabilities?.definitionProvider, true);
    assert.equal(initialize.capabilities?.hoverProvider, true);
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

    const greetHover = hoverText(
      await client.request("textDocument/hover", {
        textDocument: { uri },
        position: positionAfter(validSource, "person.greet"),
      }),
    );
    assert.match(greetHover, /Imba method `Person\.greet`/);

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

    const classMemberCompletion = completionLabels(
      await client.request("textDocument/completion", {
        textDocument: { uri },
        position: positionAfter(validSource, "person."),
      }),
    );
    assert.ok(classMemberCompletion.has("greet"));
    assert.ok(classMemberCompletion.has("nickname"));

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

function locationTexts(source: string, result: unknown): Set<string> {
  const locations = Array.isArray(result) ? result : result ? [result] : [];
  return new Set(
    locations
      .map((location) => (location as { range?: LspRange }).range)
      .filter((range): range is LspRange => Boolean(range))
      .map((range) => rangeText(source, range)),
  );
}

function locationUris(result: unknown): string[] {
  const locations = Array.isArray(result) ? result : result ? [result] : [];
  return locations
    .map((location) => (location as { uri?: unknown }).uri)
    .filter((uri): uri is string => typeof uri === "string");
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
