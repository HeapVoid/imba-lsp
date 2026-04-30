# Internals

This file records implementation details that are easy to forget while working on the Zed extension and `imba-lsp`.

## Architecture

The project has two parsing layers:

- Tree-sitter is the Zed editor shell. It exists for syntax highlighting, bracket matching, indentation queries, outline queries, and language injections.
- The native Imba compiler is the semantic source of truth. The LSP uses `imba/compiler` for diagnostics, compiler tokens, generated JS/CSS, AST-ish state, and `locs.spans`.

Do not try to turn `grammar.js` into a full Imba parser. Imba syntax depends on the native lexer, rewriter, Jison parser, and compiler pipeline. Tree-sitter should stay conservative and recovery-friendly.

## Tree-sitter Contract

`grammar.js` is intentionally shallow. It should keep only editor-safe structure:

- comments, strings, template strings, regexes, numbers, booleans, and nil-like constants;
- indentation blocks and `do` line blocks;
- declaration shells for `def`, `get`, `set`, `class`, and `tag`;
- simple import, variable, field, and assignment lines;
- basic tag forms, attributes, events, class/id/reference shorthands, and inline style brackets;
- Imba CSS blocks, selectors, at-rules, declarations, and inline CSS-ish rows.

It should not model the full expression grammar, control-flow semantics, object/array syntax, TypeScript-ish types, call precedence, or Imba rewriter behavior. Those belong to the compiler-backed LSP. Corpus tests should defend the shallow editor contract, not real-language completeness.

The external scanner has two newline tokens on purpose:

- `_newline` is an ordinary line separator and may keep, reduce, or close indentation.
- `_block_newline` is only for a real block opener, where the next structural line is more indented.

Do not collapse them. A plain optional `block` after tags makes empty tag lines like `<div>` fight with nested tag blocks like `<div>\n\t<span>`, because Tree-sitter otherwise wants to shift the newline before it knows whether indentation increased.

## Zed Extension Loading

The dev extension is installed as a symlink:

```text
~/Library/Application Support/Zed/extensions/installed/imba -> /Users/fedor/Projects/modules/imba-lsp
```

`extension.toml` registers the local grammar with a `file://` repository and an exact commit SHA. Zed does not accept `rev = "HEAD"` here.

For local dev-extension work:

```sh
npm --prefix lsp install
npm run lsp:build
npm run zed:check-extension
```

Published Zed extensions are precompiled by Zed's packaging flow. End users should not need Rust, `tree-sitter-cli`, or the local dev toolchain just to install the extension. Rust via `rustup` is only required for local dev extension compilation.

## Zed Config Regexes

Zed language config regex fields use Rust regex syntax. They do not support lookahead or lookbehind.

This is invalid and will make Zed unload the extension:

```regex
(?!...)
```

`npm run zed:check-extension` runs `scripts/check-zed-language-configs.js`, which validates `increase_indent_pattern` and `decrease_indent_pattern` with `rg` before Zed sees them.

If the extension disappears from Zed after a rebuild, check:

```sh
tail -n 240 ~/Library/Logs/Zed/Zed.log
```

The common failure mode is a `TOML parse error` or `regex parse error` while loading `languages/*/config.toml`.

## Indentation

Zed has two relevant indentation paths:

- `languages/imba/indents.scm` uses Tree-sitter structure. It works best when the syntax tree already contains a complete node such as `block`, `css_rule`, or `css_block`.
- `increase_indent_pattern` in `languages/imba/config.toml` handles incomplete freshly typed lines such as `def mount`, `get value`, `tag app`, `if condition`, `do`, and `css self`.

This distinction explains two different live behaviors:

- Sometimes pressing Enter immediately inserts the shifted indent.
- Sometimes the cursor first lands at the old level and then quickly jumps right after Zed applies auto-indent.

The second behavior is normal for pattern/tree-sitter based auto-indent after the newline edit.

## Hard Tabs

Imba requires hard tabs. The language config must keep:

```toml
tab_size = 4
hard_tabs = true
```

Avoid relying on global Zed `hard_tabs`; other languages should not inherit Imba's tab behavior.

## Imba CSS Injection

Imba CSS is indentation-based and nested. It is not raw CSS, even though Zed can benefit from CSS-ish parsing and editor behavior.

`languages/imba/injections.scm` injects `css_block` as a hidden language named `Imba CSS`, not as global `CSS`:

```scm
((css_block) @injection.content
 (#set! injection.language "imba-css"))
```

The hidden language is defined in `languages/imba-css/config.toml` and keeps hard tabs inside CSS blocks without changing global CSS settings.

The reason this matters: when the cursor is inside a Zed injection, Zed uses the injected language settings for editing actions such as Tab. Injecting plain `CSS` caused Tab inside Imba CSS to insert spaces.

## Imba CSS Indent And Context

`languages/imba-css/config.toml` has its own `increase_indent_pattern` for selector-like lines:

- `&.small`
- `&:hover`
- `.nav-menu`
- `@media (...)`
- element-ish selector lines

The LSP has a separate CSS context detector in `lsp/src/imba-css.ts`. It must walk up the indentation ancestry through nested selector lines until it reaches `css` or `global css`.

Do not stop at the first parent line with a smaller indent. In real Imba CSS that parent is often a selector such as `&.small` or `.nav-menu`, and the code is still inside CSS.

The nested behavior is covered by `lsp/test/imba-css.test.ts`.

## CSS Completions And Hovers

Imba CSS completions and hovers are LSP features, not Zed injection features.

The LSP provides:

- property and shortcut completions;
- property-specific value completions;
- modifier completions such as `@hover`;
- project-local `$tokens`, `#tokens`, and CSS custom property completions;
- hovers for shortcuts, long CSS properties, and project tokens.

The token typing is intentionally data-driven where possible. Avoid adding one-off filters for a single project error unless it generalizes to Imba CSS.

## Semantic Tokens

Zed tree-sitter highlights are still present, but semantic highlighting comes from the LSP when Zed has semantic tokens enabled.

The LSP currently emits source-aware tokens for:

- declarations, including distinct `classField` and `tagField` tokens for Imba class/tag members;
- tag names, classes, `tagAttribute` attributes, and events;
- object keys;
- CSS selectors, properties, and values;
- compiler token ranges where useful.

Theme color is user/theme-dependent. The extension exposes stable semantic token types and maps the Imba-specific ones through `languages/imba/semantic_token_rules.json`. Theme-specific scopes currently include `imba.class.field`, `imba.tag.field`, and `imba.tag.attribute`.

## TypeScript Bridge

TypeScript-aware features use compiled JS plus source mapping:

- Imba source is compiled to virtual JS.
- Imported `.imba` files are compiled as virtual JS modules.
- TypeScript completions, hover, definitions, references, rename, and diagnostics are mapped back through native source spans.

Compiler-mangled Imba names must be decoded for user-facing results, for example `readyΦ` -> `ready?` and `fooΞbar` -> `foo-bar`.

Do not assume `vtsls + typescript-imba-plugin` will provide VS Code-like behavior automatically. The VS Code extension uses its own bridge, and the TypeScript plugin's standard completion entrypoint was observed returning `null`.

## Project-Wide Diagnostics

The LSP publishes diagnostics for open buffers and scans unopened `.imba` files in the workspace.

Important details:

- Skip open buffers during project-wide scans so open-document diagnostics remain authoritative.
- Watch `.imba` create/change/delete events when the client supports file watchers.
- Clear diagnostics when files are deleted.
- Avoid duplicate empty publishes.

## Verification

Baseline checks:

```sh
npm test
npm --prefix lsp test
npm run zed:check-extension
git diff --check
```

Useful live Zed checks after rebuilding the dev extension:

- `.imba` files still show language `Imba`.
- Syntax highlighting appears before semantic tokens are enabled.
- Semantic tokens work with `"semantic_tokens": "combined"`.
- Enter after `def`, `get`, `tag`, `if`, `do`, and `css self` indents as expected.
- Tab in normal Imba and inside `css self` inserts hard tabs.
- Deeply nested Imba CSS still gets completions and hovers.
- Browser globals such as `window`, `document`, and `navigator` get TypeScript-backed completions.
- Go-to-definition works for local declarations and imported `.imba` symbols.
- Project-wide diagnostics appear for unopened files.
