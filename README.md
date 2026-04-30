# Imba for Zed

Zed-native language support for Imba.

The project is intentionally split into two different parsing layers:

1. A small Tree-sitter grammar that gives Zed the syntax tree it requires for editor-native highlighting, brackets, indents, and injections.
2. `imba-lsp`, backed by the native Imba compiler/parser, for diagnostics, symbols, semantic tokens, completions, hover, and navigation.

The Tree-sitter grammar is not intended to become the source of truth for the Imba language. The source of truth is the native Imba pipeline: lexer, rewriter, Jison parser, AST, and compiler result. See [docs/native-parser-analysis.md](docs/native-parser-analysis.md).

The existing VS Code extension is used only as a behavioral reference. It does not ship a Tree-sitter grammar; it uses TextMate grammar plus Imba/TypeScript tooling. No VS Code extension code has been copied into this repository.

## Current Status

This repository currently contains a working Zed dev-extension MVP:

- comments: `# ...` and `### ... ###`
- strings: single, double, and backtick strings
- numbers, booleans, nil-like constants
- Imba identifiers with `?`, `!`, and dashed names
- indentation tokens and indentation blocks
- `def`, `get`, `set`, `class`, `tag`, `css`, import/export, control-flow statements
- basic Imba tags such as `<self>`, `<div.card>`, attributes, events, and inline style brackets
- initial Zed queries for highlights, brackets, indents, outline, and CSS-block injection
- Rust Zed adapter that launches `imba-lsp` through Zed's managed Node runtime
- compiler-backed diagnostics from native `imba/compiler`
- document symbols from native `imba/program` outline data, with a local fallback scanner
- initial semantic tokens from native compiler tokens
- initial non-TypeScript completions for keywords, document symbols, tags, events, CSS shortcuts, and heuristic member names
- initial TypeScript-backed member completions for compiled Imba expressions such as DOM APIs and local class instances

The Tree-sitter grammar is not a complete Imba parser, and it should not be expanded as though it were the main semantic parser. The LSP calls `imba/compiler` directly and keeps the compiler result as document state.

## Development

Install the Tree-sitter CLI through npm:

```sh
npm install
```

Generate the parser:

```sh
npm run generate
```

Run parser corpus tests:

```sh
npm test
```

Parse the sample file:

```sh
npm run parse:sample
```

Compile the grammar with Zed's local `wasi-sdk` toolchain:

```sh
npm run zed:build-grammar
```

Build the native compiler-backed language server:

```sh
npm --prefix lsp install
npm run lsp:build
```

Run the LSP smoke tests:

```sh
npm run lsp:test
```

The LSP tests include a protocol-level stdio smoke test. It starts the built server, sends `initialize`, `didOpen`, `didChange`, `textDocument/documentSymbol`, `textDocument/semanticTokens/full`, and `textDocument/completion`, and verifies diagnostics/symbols/tokens/completions without requiring Zed.

Probe the LSP adapters against real `.imba` files:

```sh
npm run lsp:probe -- /path/to/imba/project
```

The probe compiles every `.imba` file under the target path, builds semantic tokens, builds document symbols, reports diagnostics, and fails only on runtime failures. Add `--fail-on-diagnostics` when the target is expected to be clean.

Run the language server over stdio:

```sh
node lsp/dist/src/server.js --stdio
```

Check the Rust Zed adapter:

```sh
npm run zed:check-extension
```

## Zed Dev Extension

Zed language extensions use:

- `extension.toml` for extension metadata and grammar registration
- `languages/imba/config.toml` for language metadata
- `languages/imba/*.scm` for Tree-sitter queries

For local development, install this repository as a Zed dev extension. The grammar registration in `extension.toml` points to this local repository with a `file://` URL and an exact commit SHA. Zed does not accept `rev = "HEAD"` for this local grammar checkout path.

The LSP is registered in the Zed extension through the Rust adapter in `src/lib.rs`. For local dev-extension testing, build the LSP before reinstalling the extension:

```sh
npm --prefix lsp install
npm run lsp:build
```

The adapter launches Zed's managed Node binary with `lsp/dist/src/server.js --stdio`.

For local dev-extension testing, Zed must be able to find `rustc` through the GUI process `PATH`. Installing Rust via `rustup` is required for dev extensions; published extensions are precompiled by Zed's extension packaging flow.

## References

- Native parser architecture notes: [docs/native-parser-analysis.md](docs/native-parser-analysis.md)
- Zed language extension docs: https://zed.dev/docs/extensions/languages
- Zed extension development docs: https://zed.dev/docs/extensions/developing-extensions
- Imba source: https://github.com/imba/imba
- Local VS Code Imba extension reference: `/Users/fedor/.vscode/extensions/scrimba.vsimba-4.2.3`
