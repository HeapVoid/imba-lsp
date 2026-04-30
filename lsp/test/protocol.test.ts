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
  "\tdef render",
  "\t\t<div.card @click=save> \"Hi\"",
  "",
  "class Person",
  "\tdef greet",
  "\t\treturn \"hi\"",
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
        documentSymbolProvider?: boolean;
        semanticTokensProvider?: unknown;
      };
    };

    assert.equal(initialize.capabilities?.documentSymbolProvider, true);
    assert.ok(initialize.capabilities?.semanticTokensProvider);

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

    const semanticTokens = (await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri },
    })) as { data?: number[] };
    assert.ok(Array.isArray(semanticTokens.data));
    assert.ok(semanticTokens.data.length > 0);
    assert.equal(semanticTokens.data.length % 5, 0);
  } finally {
    await client.shutdown();
  }

  console.log("protocol.test ok");
}
