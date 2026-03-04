#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$SCRIPT_DIR"

BUMPED=false

# Accept optional version bump: ./build-and-install.sh [patch|minor|major]
if [[ "${1:-}" =~ ^(patch|minor|major)$ ]]; then
  echo "=== Bumping version ($1) ==="
  npm version "$1" --no-git-tag-version
  BUMPED=true
fi

VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="$SCRIPT_DIR/hypercanvas-preview-${VERSION}.vsix"

echo "=== Installing dependencies ==="
npm install

echo "=== Packaging extension (v${VERSION}) ==="
npm run build && npx @vscode/vsce package --out "$VSIX_FILE"

if [[ ! -f "$VSIX_FILE" ]]; then
  echo "ERROR: VSIX file not found at $VSIX_FILE"
  exit 1
fi

echo "=== Installing extension ==="
code --install-extension "$VSIX_FILE" --force

# Commit version bump, tag, and push
if [[ "$BUMPED" == true ]]; then
  TAG="ext-v${VERSION}"
  echo "=== Committing version bump and tagging ${TAG} ==="
  git -C "$REPO_ROOT" add "$SCRIPT_DIR/package.json"
  git -C "$REPO_ROOT" commit -m "chore: bump hypercanvas-preview to v${VERSION}"
  git -C "$REPO_ROOT" tag -a "$TAG" -m "hypercanvas-preview v${VERSION}"
  git -C "$REPO_ROOT" push origin HEAD
  git -C "$REPO_ROOT" push origin "$TAG"
  echo "=== Pushed branch and tag ${TAG} ==="
fi

echo "=== Done. Reload VS Code window (Cmd+Shift+P → 'Reload Window') ==="
