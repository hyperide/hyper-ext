#!/usr/bin/env bash
# ci/local-checks.sh — local equivalents of the three required CI jobs.
#
# Called automatically by gh ship when GitHub Actions is billing-blocked (all
# required checks fail with "recent account payments" error before any step runs).
# Also callable manually to pre-verify a branch before pushing.
#
# Mirrors ci.yml jobs exactly:
#   Lint & Typecheck         → bun run typecheck + bun run lint
#   Tests                    → bun test --isolate <main dirs>
#   Extension production build → npm ci + node esbuild.js --production + check-webview-bundles.mjs
#
# Exit 0 = all checks pass → gh ship may proceed with admin merge.
# Non-zero = at least one check failed → merge is blocked.
#
# Env overrides:
#   LOCAL_CHECKS_SKIP_EXT_BUILD=1  skip the extension build (faster, misses HYP-747 class)
#   REPO_ROOT=<path>               run checks in this directory instead of the script's
#                                  parent (pr-ship passes the PR worktree path here so
#                                  checks run against PR code, not the main checkout)
#
# NOTE: security gates (Semgrep SAST, dependency audit) from security-scan.yml
# are NOT included here — they require network access and credentials not
# available in this local context. PRs touching security-sensitive code should
# be manually reviewed before admin-merge under billing-blocked CI.
# Follow-up: HYP-758
#
# Invariants assumed: bun ≥ 1.0 on PATH; node ≥ 22 on PATH; npm on PATH.
# Past bugs: typecheck (tsgo) is NOT included in bun run lint — run separately here.
set -euo pipefail
# Use REPO_ROOT from the caller when provided; otherwise fall back to the git root
# that contains this script. Never hard-code a relative path from the script's own
# location — that always resolves to the main checkout and ignores PR worktrees.
ROOT="${REPO_ROOT:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"
cd "$ROOT"

echo "[local-checks] ── Typecheck (tsgo) ─────────────────────────────────────"
bun run typecheck || { echo "[local-checks] FAIL: typecheck"; exit 1; }

echo "[local-checks] ── Lint (oxlint + knip) ──────────────────────────────────"
bun run lint || { echo "[local-checks] FAIL: lint"; exit 2; }

echo "[local-checks] ── Tests ──────────────────────────────────────────────────"
# Run the same path list CI uses (matches ci.yml "Test" job — ./packages/ is separate
# and excluded to keep local runtime close to CI).
bun test --isolate client lib server shared scripts vscode-extension \
  || { echo "[local-checks] FAIL: unit tests"; exit 3; }

echo "[local-checks] ── Extension production build ────────────────────────────"
# Mirrors the "Extension production build" CI job (ci.yml). Catches the HYP-747
# regression class: node-only imports that esbuild silently bundles and then crash
# the webview at runtime (blank preview panel, no Extension Host error visible).
if [ "${LOCAL_CHECKS_SKIP_EXT_BUILD:-0}" = "1" ]; then
  echo "[local-checks] Extension build SKIPPED (LOCAL_CHECKS_SKIP_EXT_BUILD=1)"
  echo "[local-checks] WARNING: skipping extension build misses the HYP-747 regression class."
else
  EXT_DIR="$ROOT/vscode-extension/hypercanvas-preview"
  (
    cd "$EXT_DIR"
    # Root deps provide @/, @shared/, @lib/ source aliases the extension bundles.
    # Skip postinstall (playwright install + fix-bun-shim) — not needed for build.
    cd "$ROOT" && bun install --frozen-lockfile --ignore-scripts
    cd "$EXT_DIR"
    # Extension is npm-only: @vscode/vsce runs `npm list`; bun.lock breaks `vsce package`.
    npm ci
    # Exits non-zero on any unresolvable import (e.g. node:* built-in in a browser bundle).
    node esbuild.js --production
    # Scans built browser bundles for forbidden node-only tokens (process, __dirname, etc.).
    node scripts/check-webview-bundles.mjs
  ) || { echo "[local-checks] FAIL: extension production build"; exit 4; }
fi

echo "[local-checks] ── All local checks PASSED ────────────────────────────────"
