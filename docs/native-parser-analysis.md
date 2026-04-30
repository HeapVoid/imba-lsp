# Native Imba Parser Analysis

Status: accepted direction for the next implementation phase.

## Decision

`imba-lsp` should use Imba's native compiler package as the source of truth. The current Tree-sitter grammar should remain a Zed highlighting shell, not a second full Imba parser.

The core loop should be:

1. Resolve `imba/compiler` from the user's workspace, with a pinned fallback dependency.
2. On document open/change/save, compile the current source with `compile(code, { sourcePath })`.
3. Cache the compiler result by document version.
4. Publish diagnostics from `compilation.diagnostics`.
5. Reuse `compilation.ast`, `tokens`, `js`, `css`, and `locs.spans` for symbols, semantic tokens, and later TypeScript-backed features.

## Local Findings

The native parser is not a standalone grammar that can be copied into Tree-sitter. It is a pipeline:

- `src/compiler/lexer.imba1`: tokenizes Imba syntax, including indentation, tags, selectors, CSS values, comments, operators, strings, numbers, and contextual keywords.
- `src/compiler/rewriter.imba1`: rewrites token streams for implicit indentation, implicit calls, blocks, and other Imba-specific syntax.
- `src/compiler/grammar.imba1`: Jison grammar that builds AST nodes.
- `build/parser.js`: generated Jison parser.
- `src/compiler/nodes.imba1`: AST node definitions and compile behavior.
- `src/compiler/compiler.imba1`: public parser/compiler wiring.

The public compiler entrypoint already exposes what the LSP needs:

- `tokenize(code, options)`
- `rewrite(tokens, options)`
- `parse(code, options)`
- `compile(code, options)`

`compile` returns a compilation object with useful state:

- `diagnostics`
- `ast`
- `tokens`
- `js`
- `css`
- `locs.spans`
- `sourceCode`
- `sourcePath`

Syntax errors can be consumed without crashing the server: bad input returns diagnostics with source ranges from `imba-parser`.

## LSP API Surface In Use

The current LSP MVP depends on a deliberately small native API surface:

- `imba/compiler.compile(source, { sourcePath })` for diagnostics and cached compiler state.
- `compilation.diagnostics` for `textDocument/publishDiagnostics`.
- `compilation.tokens` for initial `textDocument/semanticTokens/full`.
- `compilation.ast`, `compilation.js`, `compilation.css`, and `compilation.locs.spans` are retained in document state for later TypeScript-aware features.
- `imba/program.ImbaDocument#getOutline()` for `textDocument/documentSymbol`, with a local indentation scanner as fallback.

Compiler diagnostics sometimes arrive as zero-width ranges. The LSP normalizes those to at least one character so Zed can show a visible underline.

## Corpus Probe

The repository includes an LSP probe command:

```sh
npm run lsp:probe -- /path/to/imba/project
```

It compiles every `.imba` file under the target path, then exercises diagnostics, semantic tokens, and document symbols without requiring Zed. Runtime adapter failures make the command fail. Diagnostics are reported but do not fail the command unless `--fail-on-diagnostics` is passed.

Current local probe result for `/Users/fedor/Projects/questfall/questfall-application`:

- files: 28
- diagnostics: 0
- failures: 0
- compiler resolution: workspace-local `imba/compiler`
- total probe time: about 350ms on this machine

## Why Not Full Tree-sitter First

Zed requires Tree-sitter for native highlighting, bracket matching, indents, outline queries, and injections. That does not mean Tree-sitter should become the authoritative Imba parser.

Trying to reproduce the entire language in `grammar.js` duplicates the hardest part of Imba: indentation, tags, CSS DSL, implicit calls, and rewriter behavior. That is exactly where the current hand-written grammar becomes fragile.

Tree-sitter should therefore stay conservative:

- parse enough structure for stable Zed highlighting;
- recover well on real files;
- avoid encoding semantic rules already handled by the compiler;
- leave diagnostics, symbols, semantic tokens, completion, hover, and navigation to the LSP.

## Options Considered

### 1. Native compiler-backed LSP

Use the existing `imba/compiler` package directly from a Node/TypeScript LSP.

Pros:

- One source of truth for syntax and diagnostics.
- Fastest route to correct diagnostics.
- Gives us AST, generated JS/CSS, and position spans for later TypeScript features.
- Matches how existing Imba tooling thinks about the language.

Cons:

- Need to treat compiler API/versioning carefully.
- Need debounce or worker threads for large files.
- Symbols/semantic tokens still need a clean adapter layer.

This is the recommended path.

### 2. Port the TypeScript plugin into a standalone service

Use `typescript-imba-plugin` behavior as the basis for completion, hover, definition, diagnostics, and code fixes.

Pros:

- Reuses the most advanced existing behavior.
- Already contains position mapping between Imba and compiled output.

Cons:

- It patches TypeScript internals and is tightly coupled to `tsserver`.
- Standard `getCompletionsAtPosition` currently returns `null`; VS Code completions go through a custom bridge.
- Higher integration risk for an MVP LSP.

This should be phase two, after compiler diagnostics and document state work.

### 3. Translate the Jison grammar to Tree-sitter, Lezer, or Chevrotain

Create a new full parser from the native grammar.

Pros:

- Could eventually provide a standalone parser with editor-friendly incremental behavior.

Cons:

- The grammar alone is insufficient because the lexer and rewriter are part of the language.
- Large rewrite with high risk of semantic drift.
- Does not immediately solve diagnostics or TypeScript-aware features.

This is not recommended now.

## Implementation Plan

1. Add a Node/TypeScript LSP package.
2. Implement workspace-local compiler resolution with `createRequire`.
3. Add a document store that compiles on open/change with debounce.
4. Publish diagnostics from compiler results.
5. Add a corpus probe that compiles local real-world `.imba` files and records timing/diagnostic shape.
6. Implement document symbols from native `imba/program` outline data, falling back to a local fast outline strategy if needed.
7. Implement semantic tokens from Imba program tokens and encode them for `textDocument/semanticTokens/full`.
8. Register the LSP in the Zed extension.
9. Start the TypeScript LanguageService bridge for completion, hover, and definition.

## External References

- Imba source repository: https://github.com/imba/imba
- Imba compiler package metadata and exports: https://github.com/imba/imba/blob/master/packages/imba/package.json
- Imba Jison grammar: https://github.com/imba/imba/blob/master/packages/imba/src/compiler/grammar.imba1
- Jison parser generator: https://github.com/zaach/jison
- Zed language extension docs: https://zed.dev/docs/extensions/languages
- Language Server Protocol 3.17: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
