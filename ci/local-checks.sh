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
#   ci/dependency-review/dep-audit.sh → bun audit --audit-level=high (exit 7)
#   security-scan.yml / Semgrep SAST  → semgrep scan --config auto --severity ERROR --error
#                                       (exit 8; ERROR-only scope rationale in the leg —
#                                       the CI job runs the identical policy)
#   security-scan.yml / Trivy scan    → trivy fs --scanners vuln --severity CRITICAL,HIGH
#                                       --skip-dirs cloned-projects,node_modules,docs,templates
#                                       (exit 10)
#
# Missing security tooling (gitleaks / semgrep / trivy) is a HARD FAIL (exit 9), never
# a silent skip: this script is gh ship's billing-block merge gate, and an "advertised
# security gate that quietly does nothing on a fresh ship host" is exactly the HYP-1126
# gap. Each security leg attempts an auto-install (brew first) and only a genuine
# install/operational failure reaches exit 9. Documented manual fix:
# `brew install gitleaks semgrep trivy`. Semgrep's registry ruleset and Trivy's vuln
# DB download need NETWORK but not GH infrastructure — a CI billing block does not cut
# network access, so both legs replicate their CI gate faithfully.
#
# NOT COVERED locally (require GH infrastructure or are informational-only):
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

echo "[local-checks] ── Semgrep SAST (ERROR severity) ─────────────────────────"
# Mirrors the 'Semgrep SAST' job in security-scan.yml: registry "auto" ruleset,
# ERROR-severity gating (`--severity ERROR --error`), one `semgrep scan` over the
# repo. Two things to know about how this policy came to be:
#
# 1. CI's job used to run the pinned semgrep/semgrep-action@713efdd (the
#    returntocorp/semgrep-agent:v1 image, semgrep 1.36.0) with `config: auto`. That
#    image's `semgrep ci` CRASHED on today's registry ruleset (ValueError: invalid
#    rule severity value: MEDIUM — the 2023 binary predates uppercase severities)
#    and the crash was swallowed into a SUCCESS conclusion, so the CI gate scanned
#    NOTHING and always passed (verified against the job log of security-scan.yml
#    run on main, 2026-08-07). The workflow now runs a current semgrep directly
#    with exactly this leg's policy — keep the two in sync.
# 2. Severity scope: a full `--error` scan of current main reports 75 blocking
#    findings (pre-existing debt — e.g. wildcard postMessage targets in the
#    extension iframe scripts) that the (broken) CI gate never enforced. Failing
#    the merge gate on pre-existing debt would false-block every billing-blocked
#    ship, so the gate is ERROR-severity findings only (`--severity ERROR` both
#    filters the ruleset and speeds the scan up); main is clean at that bar,
#    with three individually-justified inline nosemgrep suppressions. Triage the
#    INFO/WARNING backlog deliberately before widening.
#
# The registry ruleset is fetched over the NETWORK (cached under ~/.semgrep) —
# a CI billing block does not cut network access, so the fallback can and must
# run this. Missing-tool posture is the HYP-1126 hard-fail precedent (see the
# gitleaks leg above): attempt brew/pipx install, and FAIL the gate (exit 9) if
# semgrep still can't run — never silently skip a security leg of a merge gate.
if ! command -v semgrep >/dev/null 2>&1; then
  echo "[local-checks] semgrep not found — attempting install (brew | pipx)."
  if command -v brew >/dev/null 2>&1; then
    brew install semgrep || true
  elif command -v pipx >/dev/null 2>&1; then
    pipx install semgrep || true
  fi
fi
if ! command -v semgrep >/dev/null 2>&1; then
  echo "[local-checks] FAIL: semgrep is not installed and could not be auto-installed (brew install semgrep | pipx install semgrep) — this is a tooling error, NOT a SAST finding; the merge gate requires this security leg to actually run"
  exit 9
fi
set +e
semgrep scan --config auto --severity ERROR --error .
semgrep_rc=$?
set -e
if [ "$semgrep_rc" -eq 1 ]; then
  echo "[local-checks] FAIL: semgrep SAST — ERROR-severity finding(s) above; fix them (or justify with an inline nosemgrep comment) before shipping"
  exit 8
elif [ "$semgrep_rc" -ne 0 ]; then
  # semgrep exit codes ≥2 are operational (registry ruleset fetch failed — offline,
  # invalid rules, unparseable targets): the scan did NOT complete, so this is a
  # tooling/environment error, not a finding.
  echo "[local-checks] FAIL: semgrep operational error (exit $semgrep_rc — the registry ruleset fetch needs network; check connectivity/proxy) — the scan did not complete, this is NOT a SAST finding"
  exit 9
fi

echo "[local-checks] ── Trivy vulnerability scan ──────────────────────────────"
# Mirrors the 'Trivy vulnerability scan' step of security-scan.yml's audit job:
# aquasecurity/trivy-action@v0.36.0 with scan-type=fs, scanners=vuln,
# severity=CRITICAL,HIGH, exit-code 1, skip-dirs cloned-projects,node_modules,
# docs,templates. An fs scan reads the repo's lockfiles (bun.lock, the
# extension's package-lock.json) against the trivy vuln DB — the DB download
# needs network (cached in ~/.cache/trivy), which a CI billing block does not
# affect. Same HYP-1126 missing-tool posture as gitleaks/semgrep: attempt brew
# install, hard-fail (exit 9) if trivy still can't run.
if ! command -v trivy >/dev/null 2>&1; then
  echo "[local-checks] trivy not found — attempting install (brew)."
  if command -v brew >/dev/null 2>&1; then
    brew install trivy || true
  fi
fi
if ! command -v trivy >/dev/null 2>&1; then
  echo "[local-checks] FAIL: trivy is not installed and could not be auto-installed (brew install trivy) — this is a tooling error, NOT a vulnerability finding; the merge gate requires this security leg to actually run"
  exit 9
fi
# trivy shells out to the docker credential helper named in ~/.docker/config.json's
# credsStore even for a public-DB fs scan; a stale credsStore whose helper binary is
# gone (e.g. Docker Desktop uninstalled, config left behind) makes every scan FATAL
# with "docker-credential-osxkeychain: executable file not found". A public-DB fs
# scan needs no registry auth at all, so in that case point DOCKER_CONFIG at a
# scratch empty config for the trivy invocation only.
TRIVY_DOCKER_CONFIG_FIX=""
docker_cfg="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
if [ -f "$docker_cfg" ]; then
  creds_store=$(sed -n 's/.*"credsStore"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$docker_cfg" | head -1)
  if [ -n "$creds_store" ] && ! command -v "docker-credential-$creds_store" >/dev/null 2>&1; then
    TRIVY_DOCKER_CONFIG_FIX=$(mktemp -d)
    printf '{}\n' > "$TRIVY_DOCKER_CONFIG_FIX/config.json"
    echo "[local-checks] note: docker credential helper 'docker-credential-$creds_store' not on PATH — running trivy with an isolated empty DOCKER_CONFIG (an fs scan needs no registry auth)."
  fi
fi
# trivy reuses exit code 1 for BOTH "vulnerabilities found" (with --exit-code 1) and
# operational failures (DB download FATALs, cobra flag/usage "Error:" after a version
# drift), so capture the output and disambiguate on those markers — otherwise a network
# hiccup or a renamed flag would be reported as a vulnerability finding, the same
# mislabeled-failure class the secret-scan leg's exit-9-vs-6 split exists to avoid.
trivy_log=$(mktemp)
set +e
DOCKER_CONFIG="${TRIVY_DOCKER_CONFIG_FIX:-${DOCKER_CONFIG:-$HOME/.docker}}" \
  trivy fs --scanners vuln --severity CRITICAL,HIGH --exit-code 1 \
    --skip-dirs cloned-projects,node_modules,docs,templates . >"$trivy_log" 2>&1
trivy_rc=$?
set -e
cat "$trivy_log"
if [ -n "$TRIVY_DOCKER_CONFIG_FIX" ]; then rm -rf "$TRIVY_DOCKER_CONFIG_FIX"; fi
if [ "$trivy_rc" -ne 0 ]; then
  if grep -qE 'FATAL|Error:' "$trivy_log"; then
    rm -f "$trivy_log"
    echo "[local-checks] FAIL: trivy operational error (see FATAL above — usually a vuln-DB download/network problem; retry with connectivity) — this is NOT a vulnerability finding"
    exit 9
  fi
  rm -f "$trivy_log"
  echo "[local-checks] FAIL: trivy found CRITICAL/HIGH vulnerabilities (see table above) — patch or override the affected dependency before shipping"
  exit 10
fi
rm -f "$trivy_log"

echo "[local-checks] ── All local checks PASSED ────────────────────────────────"
