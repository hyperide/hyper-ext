#!/usr/bin/env bash
# ci/local-checks.sh — local equivalents of the CI jobs that can run without GH Actions.
#
# Called automatically by gh ship when GitHub Actions is billing-blocked (all
# required checks fail with "recent account payments" error before any step runs).
# Also callable manually to pre-verify a branch before pushing.
#
# ── CI coverage map ──────────────────────────────────────────────────────────
# COVERED locally (this script):
#   ci.yml / Lint & Typecheck         → bun run typecheck + bun run lint
#   ci.yml / Tests                    → bun test --isolate <main dirs>
#   ci.yml / Extension production build → npm ci + esbuild + check-webview-bundles.mjs
#   ci/leftover-grep/leftover-grep.sh → focused-test markers, debugger, merge conflicts,
#                                       untracked TODOs, console.log (exit 5)
#   ci/secret-scan/secret-scan.sh     → gitleaks full-history scan (exit 6)
#                                       SKIPPED with a warning if gitleaks is not installed
#   ci/dependency-review/dep-audit.sh → bun audit --audit-level=high (exit 7)
#
# NOT COVERED locally (require GH infrastructure or are informational-only):
#   security-scan.yml / Semgrep SAST  — SAST engine requires network + credentials;
#                                       no local script exists
#   security-scan.yml / Trivy scan    — container/binary scan; same constraint
#   bundle-size.yml                   — informational (comment on PR); no merge gate;
#                                       baseline artifact lives in GH Actions artifacts
#   pr-checklist-gate.yml             — parses the PR body via GH API; no PR = no body
#                                       to parse; handled on the GH side only
#   review-threads check              — handled by pr-ship.sh preflight (GraphQL query),
#                                       not a CI job
#   CodeQL "Analyze (...)"            — GH Advanced Security only; orphaned on private
#                                       repos without GitHub Pro; never a real gate here
#
# Exit 0 = all checks pass → gh ship may proceed with admin merge.
# Non-zero = at least one check failed → merge is blocked.
#
# Env overrides:
#   LOCAL_CHECKS_SKIP_EXT_BUILD=1  skip the extension build (faster, misses HYP-747 class)
#   REPO_ROOT=<path>               run checks in this directory instead of the script's
#                                  parent (pr-ship passes the PR worktree path here so
#                                  checks run against PR code, not the main checkout)
#   LEFTOVER_BASE=<ref>            base ref for leftover-grep diff (default origin/main).
#                                  pr-ship.sh passes origin/<default-branch> so the diff
#                                  is against the actual merge target, not always main.
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

echo "[local-checks] ── Leftover-grep ─────────────────────────────────────────"
# Mirrors the ci/leftover-grep gate. Scans only lines added vs the merge-base so
# pre-existing debt doesn't block a ship. LEFTOVER_BASE is passed by pr-ship.sh
# (origin/<default-branch>); falls back to origin/main when run standalone.
LEFTOVER_BASE="${LEFTOVER_BASE:-origin/main}" \
  LEFTOVER_HEAD="${LEFTOVER_HEAD:-HEAD}" \
  bash "$ROOT/ci/leftover-grep/leftover-grep.sh" \
  || { echo "[local-checks] FAIL: leftover-grep (focused tests, debugger, merge markers, untracked TODOs, console.log)"; exit 5; }

echo "[local-checks] ── Secret scan (gitleaks) ───────────────────────────────"
# Mirrors ci/secret-scan/secret-scan.sh. Skipped with a warning if gitleaks is not
# installed — never fails the build for a missing tool, only for an actual finding.
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[local-checks] secret-scan SKIPPED: gitleaks not found — install it to enable local secret scanning."
  echo "[local-checks]   macOS: brew install gitleaks"
  echo "[local-checks]   other: https://github.com/gitleaks/gitleaks#installing"
else
  SECRET_SCAN_SCOPE="${SECRET_SCAN_SCOPE:-full}" \
    bash "$ROOT/ci/secret-scan/secret-scan.sh" \
    || { echo "[local-checks] FAIL: secret scan — a high-confidence secret was found; remove it before shipping"; exit 6; }
fi

echo "[local-checks] ── Dependency audit ──────────────────────────────────────"
# Mirrors the 'bun audit --audit-level=high' step from security-scan.yml.
# DEP_AUDIT_ALLOW_MISSING=1: local devs may not have pip-audit/cargo-audit/govulncheck;
# allow those to be missing without failing — only bun audit is required here.
DEP_AUDIT_ALLOW_MISSING="${DEP_AUDIT_ALLOW_MISSING:-1}" \
  DEP_AUDIT_LEVEL="${DEP_AUDIT_LEVEL:-high}" \
  bash "$ROOT/ci/dependency-review/dep-audit.sh" \
  || { echo "[local-checks] FAIL: dependency audit — high/critical vulnerability found"; exit 7; }

echo "[local-checks] ── All local checks PASSED ────────────────────────────────"
