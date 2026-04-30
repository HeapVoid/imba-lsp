#!/usr/bin/env bash
set -euo pipefail

npm run lsp:build

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
