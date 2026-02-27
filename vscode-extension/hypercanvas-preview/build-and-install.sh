#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Installing dependencies ==="
npm install

echo "=== Packaging extension ==="
npm run package

VSIX_FILE="$SCRIPT_DIR/hypercanvas-preview-0.1.0.vsix"

if [[ ! -f "$VSIX_FILE" ]]; then
  echo "ERROR: VSIX file not found at $VSIX_FILE"
  exit 1
fi

echo "=== Installing extension ==="
code --install-extension "$VSIX_FILE" --force

echo "=== Done. Reload VS Code window (Cmd+Shift+P → 'Reload Window') ==="
