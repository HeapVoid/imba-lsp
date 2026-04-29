#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZED_DATA="${ZED_DATA:-$HOME/Library/Application Support/Zed}"
WASI_SDK="${ZED_WASI_SDK:-$ZED_DATA/extensions/build/wasi-sdk}"
CLANG="$WASI_SDK/bin/clang-19"
OUT="${1:-/tmp/tree-sitter-imba-zed.wasm}"

if [[ ! -x "$CLANG" ]]; then
  echo "Missing Zed wasi-sdk clang at: $CLANG" >&2
  echo "Open Zed and install any grammar extension once so Zed downloads wasi-sdk, then retry." >&2
  exit 1
fi

"$CLANG" \
  --target=wasm32-wasip1 \
  -fPIC \
  -shared \
  -Os \
  -I "$ROOT/src" \
  "$ROOT/src/parser.c" \
  "$ROOT/src/scanner.c" \
  -o "$OUT"

ls -lh "$OUT"

