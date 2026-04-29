# Imba for Zed

Zed-native language support for Imba.

The project is intentionally split into small, verifiable layers:

1. `tree-sitter-imba`: a Tree-sitter grammar for parsing `.imba` files.
2. Zed language extension metadata and Tree-sitter queries.
3. `imba-lsp`: a later language server for diagnostics, symbols, semantic tokens, completions, hover, and navigation.

The existing VS Code extension is used only as a behavioral reference. It does not ship a Tree-sitter grammar; it uses TextMate grammar plus Imba/TypeScript tooling. No VS Code extension code has been copied into this repository.

## Current Status

This repository currently contains the first parser MVP:

- comments: `# ...` and `### ... ###`
- strings: single, double, and backtick strings
- numbers, booleans, nil-like constants
- Imba identifiers with `?`, `!`, and dashed names
- indentation tokens and indentation blocks
- `def`, `get`, `set`, `class`, `tag`, `css`, import/export, control-flow statements
- basic Imba tags such as `<self>`, `<div.card>`, attributes, events, and inline style brackets
- initial Zed queries for highlights, brackets, indents, outline, and CSS-block injection

This is not a complete Imba parser yet. It is a grammar foundation for useful Zed highlighting and for iterating against real Imba files.

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

## Zed Dev Extension

Zed language extensions use:

- `extension.toml` for extension metadata and grammar registration
- `languages/imba/config.toml` for language metadata
- `languages/imba/*.scm` for Tree-sitter queries

For local development, install this repository as a Zed dev extension. The grammar registration in `extension.toml` points to this local repository with a `file://` URL. After the first commit, replace `rev = "HEAD"` with the exact commit SHA if Zed requires a stable revision.

This first phase is grammar-only and intentionally has no `Cargo.toml` or Rust extension code. Adding a no-op Rust crate makes Zed try to compile WebAssembly even though no language server is registered yet.

## References

- Zed language extension docs: https://zed.dev/docs/extensions/languages
- Zed extension development docs: https://zed.dev/docs/extensions/developing-extensions
- Local VS Code Imba extension reference: `/Users/fedor/.vscode/extensions/scrimba.vsimba-4.2.3`
