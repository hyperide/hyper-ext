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
  git -C "$REPO_ROOT" add "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/package-lock.json"
  git -C "$REPO_ROOT" commit -m "chore: bump hypercanvas-preview to v${VERSION}"
  git -C "$REPO_ROOT" tag -a "$TAG" -m "hypercanvas-preview v${VERSION}"
  # The pre-push protect-main gate (lefthook, HYP-856) blocks direct pushes to main;
  # this release script is the SANCTIONED exception — run from main, it pushes the
  # version-bump commit together with the ext-v* tag ("push origin HEAD" targets the
  # CURRENT branch; the gate only engages when that is main/master). PUSH_MAIN_OK is
  # the audited escape hatch: the override is appended to
  # ~/.cache/agent-tools/overrides.log. Scoped as per-command prefix assignments
  # (not export) so it can never leak past these two pushes — not even if this file
  # is ever sourced.
  PUSH_MAIN_REASON_TEXT="build-and-install.sh release: hypercanvas-preview v${VERSION} (${TAG})"
  if ! PUSH_MAIN_OK=1 PUSH_MAIN_REASON="$PUSH_MAIN_REASON_TEXT" git -C "$REPO_ROOT" push origin HEAD \
     || ! PUSH_MAIN_OK=1 PUSH_MAIN_REASON="$PUSH_MAIN_REASON_TEXT" git -C "$REPO_ROOT" push origin "$TAG"; then
    echo "ERROR: Failed to push branch and/or tag ${TAG}. Please resolve the issue and push manually." >&2
    exit 1
  fi
  echo "=== Pushed branch and tag ${TAG} ==="
fi

echo "=== Done. Reload VS Code window (Cmd+Shift+P → 'Reload Window') ==="
