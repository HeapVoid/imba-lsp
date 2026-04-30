# Roadmap

## Phase 1: Tree-sitter and Zed Highlighting Shell

Goal: useful Zed-native syntax highlighting and structure support for `.imba` files, without pretending Tree-sitter is the semantic source of truth.

- [x] Create project README and roadmap.
- [x] Add a Tree-sitter grammar skeleton.
- [x] Add indentation-aware external scanner.
- [x] Add corpus coverage for comments, declarations, tags, CSS, imports, and control flow.
- [x] Add initial Zed language config and query files.
- [x] Run the grammar against real Imba files from local projects and collect parse errors.
- [ ] Keep the grammar conservative and recovery-friendly.
- [ ] Fix highlighting regressions when they block real editing.
- [ ] Avoid large grammar-expansion work unless it is needed for Zed queries.

## Phase 2: Native Compiler Analysis

Goal: base the real language features on Imba's own parser/compiler instead of a hand-written duplicate grammar.

- [x] Verify that the native parser is generated from Imba's Jison grammar.
- [x] Verify the compiler pipeline: lexer, rewriter, parser, AST, compiler result.
- [x] Verify that `imba/compiler` exposes `tokenize`, `rewrite`, `parse`, and `compile`.
- [x] Verify that compiler diagnostics include source ranges.
- [x] Probe compiler output on a corpus of real local `.imba` files.
- [x] Document the compiler API surface that the LSP will depend on.

## Phase 3: `imba-lsp` MVP

Goal: a small Node/TypeScript LSP that calls native `imba/compiler` and makes Zed useful beyond syntax highlighting.

- [x] Scaffold `imba-lsp`.
- [x] Implement `initialize`, document sync, and shutdown cleanup.
- [x] Resolve the workspace-local `imba/compiler`, with a pinned fallback dependency.
- [x] Compile open documents with debounce and cache the result per document version.
- [x] Publish diagnostics from `compilation.diagnostics`.
- [x] Keep `ast`, `tokens`, `js`, `css`, and `locs.spans` in document state.
- [x] Add protocol-level stdio smoke test for initialize, diagnostics, document symbols, semantic tokens, and completions.
- [x] Implement `textDocument/documentSymbol` from native `imba/program` outline data, with a local fast outline scanner as fallback.
- [x] Implement initial `textDocument/semanticTokens/full` from native compiler tokens.
- [x] Implement initial non-TypeScript `textDocument/completion` for keywords, document symbols, tags, events, CSS shortcuts, and heuristic member names.
- [x] Implement initial local `textDocument/definition` and `textDocument/hover` for declarations, fields, and typed local class members.
- [ ] Upgrade semantic tokens to use richer Imba program symbols where available.
- [x] Add Zed language-server registration.
- [x] Verify diagnostics and LSP startup inside a live Zed dev extension.
- [ ] Verify semantic token styling inside a live Zed dev extension with Zed semantic tokens enabled.
- [x] Add a corpus probe for compiler diagnostics, document symbols, and semantic-token adapter failures.
- [ ] Add a release/install path for `imba-lsp` instead of relying on the dev-extension local `lsp/dist` path.

## Phase 4: TypeScript-Aware Features

Goal: completion, hover, and navigation that understand compiled Imba output.

- [x] Reuse Imba compiler output for a first TypeScript-backed member completion path.
- [x] Create a minimal TypeScript LanguageService bridge for synthetic compiled JS completions.
- [x] Add TypeScript-backed hover and go-to-definition fallback for JS-compatible browser/global expressions.
- [x] Add span-based source mapping from native `locs.spans` for Imba source offsets and generated JS offsets.
- [x] Use compiler source spans as the first TypeScript hover/go-to-definition path, with fallback for weak `any` results.
- [x] Add explicit LSP replacement edits for TypeScript and fallback member completions.
- [x] Resolve project `tsconfig.json` and imported `.imba` files as virtual compiled JS modules in the TypeScript bridge.
- [x] Map cross-file TypeScript definitions from virtual compiled JS back to Imba source ranges.
- [x] Reuse virtual Imba module metadata for hover documentation and more precise imported symbol ranges.
- [x] Publish TypeScript diagnostics for the open document with compiled JS ranges mapped back to Imba source.
- [x] Decode compiler-mangled Imba member names in TypeScript completions.
- [x] Decode compiler-mangled Imba member names in TypeScript hover/go-to-definition.
- [x] Add basic preceding-comment extraction for Imba hovers.
- [ ] Expand completion with richer Imba-aware post-processing for generated JS names.
- [ ] Expand docs extraction beyond directly preceding `#` comments.
- [ ] Expand TypeScript diagnostics to project/imported `.imba` files without noisy duplicate publishes.
- [ ] Port useful codefix behavior from `typescript-imba-plugin` as reference, with license checks before copying anything.

## Known Risks

- Zed still requires a Tree-sitter grammar for built-in syntax highlighting and query-based editor features.
- Native Imba parsing depends on the full lexer/rewriter/parser pipeline; duplicating only the grammar will be wrong.
- The public compiler API is usable, but we need to pin the Imba version and watch for compiler API drift.
- Compiler work may need debounce or worker-thread isolation for large files.
- VS Code completions depend on a custom bridge, while the TypeScript plugin's standard `getCompletionsAtPosition` currently returns `null`.
- Completion, hover, and go-to-definition require TypeScript LanguageService integration plus careful Imba-to-compiled-output position mapping.
- CSS in Imba is its own compiled DSL, not raw CSS; Zed injection should stay conservative.
- Zed extension publishing requires a valid accepted license for extension code.
