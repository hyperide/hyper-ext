#!/usr/bin/env bash
# Publish extension to VS Code Marketplace and Open VSX Registry.
#
# Usage:
#   ./publish.sh                  # publish current version
#   ./publish.sh --dry-run        # build VSIX only, no publish
#   ./publish.sh --vsce-only      # publish to VS Code Marketplace only
#   ./publish.sh --ovsx-only      # publish to Open VSX only
#
# Env vars (loaded from repo root .env if present):
#   VSCE_PAT  — VS Code Marketplace personal access token
#   OVSX_PAT  — Open VSX Registry personal access token
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$SCRIPT_DIR"

# Load .env from repo root
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

DRY_RUN=false
PUBLISH_VSCE=true
PUBLISH_OVSX=true

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=true ;;
    --vsce-only)  PUBLISH_OVSX=false ;;
    --ovsx-only)  PUBLISH_VSCE=false ;;
    *)            echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="$SCRIPT_DIR/hypercanvas-preview-${VERSION}.vsix"

# Build VSIX if not already present
if [[ ! -f "$VSIX_FILE" ]]; then
  echo "=== Installing dependencies ==="
  npm install

  echo "=== Packaging extension (v${VERSION}) ==="
  npm run build && npx @vscode/vsce@^3 package --out "$VSIX_FILE"
fi

if [[ ! -f "$VSIX_FILE" ]]; then
  echo "ERROR: VSIX file not found at $VSIX_FILE"
  exit 1
fi

echo "=== VSIX ready: $(basename "$VSIX_FILE") ==="

if [[ "$DRY_RUN" == true ]]; then
  echo "=== Dry run — skipping publish ==="
  exit 0
fi

# Publish to VS Code Marketplace
if [[ "$PUBLISH_VSCE" == true ]]; then
  if [[ -z "${VSCE_PAT:-}" ]]; then
    echo "ERROR: VSCE_PAT is not set. Set it in .env or export it."
    exit 1
  fi
  echo "=== Publishing to VS Code Marketplace ==="
  npx @vscode/vsce@^3 publish --packagePath "$VSIX_FILE"
  echo "=== VS Code Marketplace: done ==="
fi

# Publish to Open VSX Registry
if [[ "$PUBLISH_OVSX" == true ]]; then
  if [[ -z "${OVSX_PAT:-}" ]]; then
    echo "ERROR: OVSX_PAT is not set. Set it in .env or export it."
    exit 1
  fi
  echo "=== Publishing to Open VSX Registry ==="
  npx ovsx@^0 publish "$VSIX_FILE" -p "$OVSX_PAT"
  echo "=== Open VSX: done ==="
fi

echo "=== Published v${VERSION} successfully ==="
