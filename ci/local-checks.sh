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
#   ci.yml / Extension production build → npm ci + tsc --noEmit + esbuild + check-webview-bundles.mjs
#   ci.yml / Typecheck extension        → npx tsc --noEmit -p ./ (part of the extension build step)
#   ci/leftover-grep/leftover-grep.sh → focused-test markers, debugger, merge conflicts,
#                                       untracked TODOs, console.log (exit 5)
#   ci/secret-scan/secret-scan.sh     → gitleaks working-tree scan, SECRET_SCAN_SCOPE=dir
#                                       (matches secret-scan.yml's `gitleaks dir .`, exit 6)
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
# CLI flags:
#   --skip-ext-build               skip the extension build (faster local iteration,
#                                  misses the HYP-747 regression class). A CLI FLAG, not
#                                  an env var, deliberately — this script doubles as
#                                  gh ship's billing-block merge gate (.ship-config), and
#                                  an env var can leak in from an unrelated inherited
#                                  shell/CI environment and silently skip a merge-gate
#                                  check nobody meant to skip; a flag is only set by
#                                  whoever explicitly typed it for THIS invocation.
#
# Env overrides:
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

skip_ext_build=0
for arg in "$@"; do
  case "$arg" in
    --skip-ext-build) skip_ext_build=1 ;;
    *) echo "[local-checks] unknown argument: $arg" >&2; exit 64 ;;
  esac
done
# LOCAL_CHECKS_SKIP_EXT_BUILD (the old env-var form) is intentionally NOT honored anymore
# (see the CLI flags doc above) — warn instead of silently ignoring it, so anyone/anything
# still exporting it gets a signal rather than an unexplained full extension build.
if [ -n "${LOCAL_CHECKS_SKIP_EXT_BUILD:-}" ] && [ "${LOCAL_CHECKS_SKIP_EXT_BUILD}" != "0" ]; then
  echo "[local-checks] note: LOCAL_CHECKS_SKIP_EXT_BUILD is ignored (removed as a self-bypass-able env var) — use --skip-ext-build instead."
fi

echo "[local-checks] ── Typecheck (tsgo) ─────────────────────────────────────"
bun run typecheck || { echo "[local-checks] FAIL: typecheck"; exit 1; }

echo "[local-checks] ── Lint (oxlint + knip) ──────────────────────────────────"
bun run lint || { echo "[local-checks] FAIL: lint"; exit 2; }

echo "[local-checks] ── Secret scan (gitleaks) ───────────────────────────────"
# Uses the SAME ruleset/scan-mode family as the CI gate (.github/workflows/
# secret-scan.yml runs `gitleaks dir .`, working tree only) — not
# ci/secret-scan/secret-scan.sh's own "full" (git-history) default. History mode
# re-walks every commit, and .gitleaksignore's commit-pinned fingerprints
# (commit:path:rule:line) go stale every time a LATER commit touches the same file
# (a new blame commit = a new fingerprint) — so a "full" scan here would
# false-positive-block a ship on already-vetted, unrelated pre-existing findings
# (found the hard way running this against a real billing-blocked PR, HYP-1126).
# "dir" mode's path:rule:line fingerprints (already present in .gitleaksignore for
# this exact reason) don't have that staleness problem.
#
# NOT byte-for-byte equivalent to CI, and deliberately so: `gitleaks dir` scans
# the literal filesystem and does not honor .gitignore, so unlike CI's pristine
# `actions/checkout` (nothing but tracked source), this local run also sees
# whatever gitignored local state actually exists on disk (installed
# dependencies, build output, a developer's own untracked .env). node_modules/
# and the extension's out/ build dir are allowlisted in .gitleaks.toml because
# they are routine local/build noise, not source anyone wrote or reviewed — a
# REAL secret sitting in some other untracked local file (e.g. a dev's .env)
# is intentionally still caught here even though CI would never see it; that is
# the local gate being stricter in a useful direction, not a bug to paper over.
#
# Runs BEFORE the "Extension production build" step below on general principle (no
# reason to scan generated output at all), but this is belt-and-suspenders, NOT the
# actual fix for build-artifact false positives: `gitleaks dir` scans the literal
# filesystem and does not honor .gitignore, so a STALE out/extension.js left on disk
# from a PRIOR run would still be picked up regardless of step order. The real fix is
# the `node_modules` / `vscode-extension/hypercanvas-preview/out/` paths allowlist in
# .gitleaks.toml (both are gitignored, neither is source a human wrote or reviewed —
# node_modules is walked here too, unlike CI's pristine `actions/checkout` with no
# install step, since typecheck/lint/test above need it installed).
#
# Always runs — no longer skipped when gitleaks isn't on PATH. This script is
# .ship-config's designated gh-ship merge gate (HYP-1126): a "SKIPPED, never fails for
# a missing tool" posture was fine for a developer's own convenience run, but on a
# fresh ship host with no gitleaks installed it silently dropped BOTH secret-scan
# passes below while still reporting overall success — exactly the "advertised
# security gate that quietly does nothing" gap Codex flagged on this PR (thread on
# ci/local-checks.sh:123, HYP-1126). secret-scan.sh's own ensure_gitleaks() already
# attempts an install (brew | go install | direct release download) before scanning;
# only a genuine install failure reaches the tooling-error path below, which now FAILS
# the gate (exit 9) instead of silently passing.
{
  # Capture the exit code instead of a plain `||` short-circuit: secret-scan.sh exits
  # 9 specifically for "gitleaks too old to support SECRET_SCAN_SCOPE=dir" (its own
  # version guard), distinct from exit 1 for an actual finding. Collapsing both into
  # one "a high-confidence secret was found" message (the old behavior) is actively
  # wrong for the tooling-error case — it sends whoever's debugging a false ship-block
  # looking for a leak that was never found. `set +e` around the call is required:
  # under this script's `set -e`, a plain command's non-zero exit would abort
  # immediately, before this line gets to inspect $?.
  # SECRET_SCAN_SCOPE is hardcoded to "dir" here, NOT honoring an ambient env var
  # (unlike the naive "${SECRET_SCAN_SCOPE:-dir}" this used to be) — this script is a
  # gh-ship merge gate, and an inherited SECRET_SCAN_SCOPE=staged would scan an empty
  # index on a clean committed tree and trivially pass with zero signal; an inherited
  # SECRET_SCAN_SCOPE=full would reintroduce the exact stale-fingerprint false-block
  # this script exists to avoid (see the comment block above). No caller of this script
  # needs a different scope — if one ever does, add an explicit LOCAL_CHECKS_* override
  # here, not a pass-through of the ambient shell var.
  set +e
  SECRET_SCAN_SCOPE=dir bash "$ROOT/ci/secret-scan/secret-scan.sh"
  secret_scan_rc=$?
  set -e
  if [ "$secret_scan_rc" -eq 9 ]; then
    echo "[local-checks] FAIL: secret-scan tooling error (gitleaks missing and could not be auto-installed, OR the installed version is too old for SECRET_SCAN_SCOPE=dir — see log above); install/upgrade gitleaks, this is NOT a leaked secret"
    exit 9
  elif [ "$secret_scan_rc" -ne 0 ]; then
    echo "[local-checks] FAIL: secret scan — a high-confidence secret was found; remove it before shipping"
    exit 6
  fi

  # SECOND pass, closing a real gap the first (dir-mode) pass structurally cannot: the
  # SCOPE=dir scan above uses .gitleaks-dir.toml's build/dependency-directory allowlist,
  # because `gitleaks dir` walks the literal filesystem and cannot tell a genuinely
  # gitignored node_modules/ apart from a file FORCE-ADDED under the same path — so it
  # must allowlist the whole path or drown in installed-dependency noise. That means a
  # secret this PR's own commits force-add under node_modules/, dist/, out/, etc. would
  # sail through the dir-mode scan (flagged by Codex review on this exact PR — see PR
  # #686 thread on .gitleaks-dir.toml). This second pass scans ONLY the commit range
  # this PR actually introduces via `gitleaks git`, which reads git objects per-commit
  # rather than the filesystem — so it correctly distinguishes "tracked because
  # force-added in this PR" from "untracked local build noise" regardless of what's
  # sitting in node_modules/ on disk. Uses the SHARED .gitleaks.toml (no build-dir
  # exclusion), matching what CI's pristine-checkout secret-scan.yml would have caught
  # had it not been billing-blocked. RANGE_BASE reads the SAME ambient LEFTOVER_BASE
  # env var (default origin/main) the leftover-grep step below also reads inline — both
  # are reads of one external input with the same default, not one assigning the other.
  RANGE_BASE="${LEFTOVER_BASE:-origin/main}"
  # A stale/never-fetched RANGE_BASE (e.g. a bare clone that never fetched origin/main)
  # makes `gitleaks git`'s underlying `git log <base>..HEAD` fail outright — an
  # operational error, not a leak — which would otherwise surface through the SAME
  # non-zero exit path as a real finding below and wrongly tell the caller to rotate a
  # secret that doesn't exist. Verify the ref resolves first so that failure mode gets
  # its own distinct, correctly-worded message instead.
  if ! git rev-parse --verify --quiet "${RANGE_BASE}" >/dev/null; then
    echo "[local-checks] FAIL: secret-scan range base '${RANGE_BASE}' does not resolve (fetch it, e.g. \`git fetch origin main\`, or set LEFTOVER_BASE to a ref that exists) — this is a tooling/fetch problem, NOT a leaked secret"
    exit 9
  fi
  set +e
  gitleaks git --log-opts="${RANGE_BASE}..HEAD" -c .gitleaks.toml --redact --no-banner
  range_scan_rc=$?
  set -e
  if [ "$range_scan_rc" -ne 0 ]; then
    echo "[local-checks] FAIL: secret scan (PR commit range ${RANGE_BASE}..HEAD) — a high-confidence secret was found in a commit this PR introduces; remove it, rotate it, and re-push"
    exit 6
  fi
}

echo "[local-checks] ── Tests ──────────────────────────────────────────────────"
# Run the same path list CI uses (matches ci.yml "Test" job — ./packages/ is separate
# and excluded to keep local runtime close to CI).
bun test --isolate client lib server shared scripts vscode-extension \
  || { echo "[local-checks] FAIL: unit tests"; exit 3; }

echo "[local-checks] ── Extension production build ────────────────────────────"
# Mirrors the "Extension production build" CI job (ci.yml). Catches the HYP-747
# regression class: node-only imports that esbuild silently bundles and then crash
# the webview at runtime (blank preview panel, no Extension Host error visible).
if [ "$skip_ext_build" = "1" ]; then
  echo "[local-checks] Extension build SKIPPED (--skip-ext-build)"
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
    # Mirrors ci.yml's "Typecheck extension" job (P-8 retrospective, HYP-947): the
    # extension previously had NO tsc gate anywhere — root `bun run typecheck` (tsgo)
    # does not cover it (root tsconfig.json excludes it, and tsgo mis-infers `rootDir`
    # for this tsconfig's ../../lib and ../../shared includes). Without this line the
    # local fallback could report success on a PR that would fail CI's real gate.
    npx tsc --noEmit -p ./
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

echo "[local-checks] ── Dependency audit ──────────────────────────────────────"
# Mirrors the 'bun audit --audit-level=high' step from security-scan.yml.
# DEP_AUDIT_ALLOW_MISSING=1: local devs may not have pip-audit/cargo-audit/govulncheck;
# allow those to be missing without failing — only bun audit is required here.
DEP_AUDIT_ALLOW_MISSING="${DEP_AUDIT_ALLOW_MISSING:-1}" \
  DEP_AUDIT_LEVEL="${DEP_AUDIT_LEVEL:-high}" \
  bash "$ROOT/ci/dependency-review/dep-audit.sh" \
  || { echo "[local-checks] FAIL: dependency audit — high/critical vulnerability found"; exit 7; }

echo "[local-checks] ── All local checks PASSED ────────────────────────────────"
