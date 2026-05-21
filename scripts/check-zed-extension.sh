#!/usr/bin/env bash
set -euo pipefail

node scripts/check-zed-language-configs.js

npm run lsp:build
npm run zed:build-grammar -- grammars/imba.wasm

if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
	# rustup can be installed without modifying the parent process PATH.
	# shellcheck disable=SC1090
	. "$HOME/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
	echo "Skipping Rust adapter check; cargo is not available on PATH." >&2
	exit 0
fi

cargo check

if command -v rustup >/dev/null 2>&1 && rustup target list --installed | grep -qx 'wasm32-wasip2'; then
	cargo check --target wasm32-wasip2
else
	echo "Skipping wasm32-wasip2 check; install it with: rustup target add wasm32-wasip2" >&2
fi
