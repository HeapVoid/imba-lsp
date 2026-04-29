# Roadmap

## Phase 1: Tree-sitter and Zed Highlighting

Goal: useful Zed-native syntax highlighting and structure support for `.imba` files.

- [x] Create project README and roadmap.
- [x] Add a Tree-sitter grammar skeleton.
- [x] Add indentation-aware external scanner.
- [x] Add corpus coverage for comments, declarations, tags, CSS, imports, and control flow.
- [x] Add initial Zed language config and query files.
- [x] Run the grammar against real Imba files from local projects and collect parse errors.
- [ ] Expand tag parsing for named refs, dynamic tags, conditional classes, and richer attribute values. Initial support exists for dynamic class bindings and richer attribute calls/subscripts.
- [ ] Expand expression parsing for ranges, postfix modifiers, `do` callbacks, object-literal `def`, and Imba-specific operators. Initial support exists for `do` callbacks, typed params/fields, ternaries, regex literals, `typeof`/`instanceof`, `for own`, spread arrays, and update/shift operators.
- [ ] Improve CSS block parsing and injection boundaries.
- [ ] Add textobjects and better outline queries.

## Phase 2: Zed Extension Hardening

Goal: installable local Zed dev extension with stable highlighting behavior.

- [ ] Verify local dev-extension install in Zed.
- [ ] Replace local `file://` grammar reference with a publishable repository URL and exact revision.
- [ ] Add a license before publishing to Zed's extension registry.
- [ ] Test highlighting, brackets, indents, and outline in real Zed buffers.
- [ ] Add regression samples for parser bugs found in real code.

## Phase 3: `imba-lsp` MVP

Goal: a small Node/TypeScript LSP that makes Zed useful beyond syntax highlighting.

- [ ] Scaffold `imba-lsp`.
- [ ] Implement `initialize`, document sync, and shutdown.
- [ ] Publish diagnostics from the Imba compiler.
- [ ] Implement `textDocument/documentSymbol`, using `imba-monarch` behavior as reference.
- [ ] Implement `textDocument/semanticTokens/full`.
- [ ] Add Zed language-server registration.

## Phase 4: TypeScript-Aware Features

Goal: completion, hover, and navigation that understand compiled Imba output.

- [ ] Reuse Imba compiler output and source maps/loc spans.
- [ ] Create or embed a TypeScript LanguageService bridge.
- [ ] Implement completion with Imba-aware post-processing.
- [ ] Implement hover and go-to-definition with position mapping.
- [ ] Port useful diagnostics/codefix behavior from `typescript-imba-plugin` as reference, with license checks before copying anything.

## Known Risks

- Imba's indentation and tag syntax are not JavaScript-shaped; grammar error recovery will need real-world samples.
- Current real-world parser smoke set is 91 local `.imba` files; this iteration parses 25 cleanly and uses the remaining failures as the next grammar backlog.
- VS Code completions depend on a custom bridge, while the TypeScript plugin's standard `getCompletionsAtPosition` currently returns `null`.
- CSS in Imba is its own compiled DSL, not raw CSS; Tree-sitter injection should start conservative.
- Zed extension publishing requires a valid accepted license for extension code.
