# Imba for Zed

Zed-native language support for Imba.

The project is intentionally split into two different parsing layers:

1. A small Tree-sitter grammar that gives Zed the syntax tree it requires for editor-native highlighting, brackets, indents, and outline.
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
- a deliberately shallow Tree-sitter editor grammar for `def`, `get`, `set`, `class`, `tag`, `css`, imports, variables, assignments, tags, and `do` blocks
- basic Imba tags such as `<self>`, `<div.card>`, attributes, events, and inline style brackets
- initial Zed queries for highlights, brackets, indents, and outline
- Imba CSS blocks are highlighted through Imba grammar/LSP tokens instead of injecting raw CSS grammar
- Rust Zed adapter that launches `imba-lsp` through Zed's managed Node runtime
- compiler-backed diagnostics from native `imba/compiler`
- document symbols from native `imba/program` outline data, with a local fallback scanner
- source-aware semantic tokens from native compiler tokens plus Imba-specific source ranges for declarations, class/tag fields, tag attributes/classes, events, object keys, and CSS selectors/properties
- initial non-TypeScript completions for keywords, document symbols, tags, events, CSS shortcuts, and heuristic member names
- Imba CSS completions use compiler shortcut aliases, offer property-specific value suggestions, CSS modifiers, and hover help for shortcuts/properties
- Imba CSS completions index and type project-local `$tokens`, `#color-tokens`, and CSS custom properties for workspace-aware value suggestions and token hovers
- initial TypeScript-backed member completions for compiled Imba expressions such as DOM APIs and local class instances
- TypeScript-backed member completions decode compiler-mangled Imba identifiers such as `readyΦ` and `fooΞbar` back to `ready?` and `foo-bar`
- TypeScript-backed member completions hide generated Imba runtime internals unless an internal-looking prefix is explicitly typed
- initial local hover and go-to-definition for Imba declarations, fields, and typed local class members
- initial TypeScript-backed hover and go-to-definition for JS-compatible browser/global expressions
- TypeScript-backed hover and go-to-definition understand compiler-mangled Imba member names such as `ready?` and `foo-bar`
- Imba hovers include directly preceding `#` documentation comments for local and imported declarations
- initial span-based mapping from Imba source offsets to generated JS offsets via native `locs.spans`
- member completions now include explicit LSP replacement edits instead of relying on editor word guessing
- TypeScript bridge reads project `tsconfig.json` and resolves imported `.imba` files as virtual compiled JS modules for cross-file hover/completion
- TypeScript bridge also honors `jsconfig.json` and maps generated `.js` imports back to sibling `.imba` source files when possible
- cross-file TypeScript definitions from virtual compiled `.imba` modules are mapped back to source `.imba` ranges
- cross-file definitions cover named imports, alias re-exports, default exports, namespace imports, and import module specifiers
- cross-file TypeScript hover for imported `.imba` symbols prefers the original Imba declaration and suppresses weak `any` hovers
- initial references and rename support use TypeScript rename/reference locations mapped back to Imba source, with a conservative local fallback
- initial TypeScript diagnostics for the open `.imba` document, mapped back from compiled JS through native source spans
- TypeScript diagnostics are also mapped for imported virtual `.imba` modules and published for matching open documents
- project-wide diagnostics scan unopened `.imba` files in the workspace, skip open buffers, and publish compiler + shared TypeScript diagnostics without duplicate empty publishes
- project-wide diagnostics register `.imba` file watchers when the client supports them, refresh changed/created files quickly, and clear deleted-file diagnostics
- TypeScript diagnostics use an Imba-native noise policy: dynamic object-property checks, null-safe `..` access, default-value pseudo-typing noise, string-valued `fetch` headers objects, and `$app` transaction pass-through patterns are suppressed, while primitive/type-specific mistakes still surface
- TypeScript diagnostics load Imba runtime typings for compiled JS and can be checked by `lsp:probe -- --typescript-diagnostics`

The Tree-sitter grammar is not a complete Imba parser, and it should not be expanded as though it were the main semantic parser. It intentionally avoids a full expression/control-flow AST; the LSP calls `imba/compiler` directly and keeps the compiler result as document state.

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

The LSP tests include a protocol-level stdio smoke test. It starts the built server, sends `initialize`, `didOpen`, `didChange`, `textDocument/documentSymbol`, `textDocument/definition`, `textDocument/hover`, `textDocument/semanticTokens/full`, and `textDocument/completion`, and verifies diagnostics/symbols/navigation/tokens/completions without requiring Zed.

Probe the LSP adapters against real `.imba` files:

```sh
npm run lsp:probe -- /path/to/imba/project
npm run lsp:probe -- --typescript-diagnostics --show-diagnostics /path/to/imba/project
```

The probe compiles every `.imba` file under the target path, builds semantic tokens, builds document symbols, reports diagnostics, and fails only on runtime failures. Add `--fail-on-diagnostics` when the target is expected to be clean. Add `--typescript-diagnostics` to include mapped TypeScript diagnostics in the diagnostic counts. Add `--show-diagnostics` to print source, code, line/column, message, source line, and caret markers for each diagnostic.

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

The adapter launches Zed's managed Node binary. In local development it uses the built `lsp/dist/src/server.js` from this repository. In a published extension, when the local build is absent, the adapter installs `imba-lsp` from npm through Zed's extension API and launches `node_modules/imba-lsp/dist/src/server.js --stdio`.

Check the npm package contents before publishing:

```sh
npm run lsp:pack
```

For local dev-extension testing, Zed must be able to find `rustc` through the GUI process `PATH`. Installing Rust via `rustup` is required for dev extensions; published extensions are precompiled by Zed's extension packaging flow.

## References

- Internal implementation notes: [INTERNALS.md](INTERNALS.md)
- Native parser architecture notes: [docs/native-parser-analysis.md](docs/native-parser-analysis.md)
- Zed language extension docs: https://zed.dev/docs/extensions/languages
- Zed extension development docs: https://zed.dev/docs/extensions/developing-extensions
- Imba source: https://github.com/imba/imba
- Local VS Code Imba extension reference: `/Users/fedor/.vscode/extensions/scrimba.vsimba-4.2.3`
