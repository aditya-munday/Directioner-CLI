#!/usr/bin/env bash
#
# Install the Directioner CLI onto PATH.
#
# The hosted runtime resets $HOME and non-repo paths between sessions, which
# removes any previously placed `directioner` symlink even though the repo and
# the built binary survive. Re-run this after a reset (`bash install.sh`) to
# put the command back. It is idempotent.
#
# Usage:
#   bash install.sh              # link the existing binary
#   bash install.sh --build      # rebuild the binary first
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="$REPO_ROOT/cli/bin/directioner"
BUILD_SCRIPT="$REPO_ROOT/directioner/cli/build.ts"

if [[ "${1:-}" == "--build" ]]; then
  echo "Building Directioner..."
  (cd "$REPO_ROOT" && bun "$BUILD_SCRIPT" 0.0.0-dev)
fi

if [[ ! -x "$BINARY" ]]; then
  echo "error: $BINARY is missing or not executable." >&2
  echo "Re-run with --build (needs bun on PATH)." >&2
  exit 1
fi

# tree-sitter.wasm must sit next to the binary; the build copies it.
if [[ ! -f "$REPO_ROOT/cli/bin/tree-sitter.wasm" ]]; then
  echo "error: cli/bin/tree-sitter.wasm is missing; re-run with --build." >&2
  exit 1
fi

link() {
  local dir="$1"
  mkdir -p "$dir"
  ln -sfn "$BINARY" "$dir/directioner"
  ln -sfn "$BINARY" "$dir/directioner-cli"
}

# User-writable dirs that are on the default login PATH or already prepended.
link "$HOME/.local/bin"
link "$HOME/.npm-global/bin"

# System dir, needs sudo on the hosted runtime.
if [[ -w /usr/local/bin ]]; then
  link /usr/local/bin
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo mkdir -p /usr/local/bin
  sudo ln -sfn "$BINARY" /usr/local/bin/directioner
  sudo ln -sfn "$BINARY" /usr/local/bin/directioner-cli
else
  echo "warning: cannot write /usr/local/bin; linked user dirs only." >&2
fi

echo "Linked: directioner, directioner-cli -> $BINARY"
if command -v directioner >/dev/null 2>&1; then
  echo "Version: $(directioner --version)"
else
  echo "note: open a new shell (or 'hash -r') for the command to resolve." >&2
fi
