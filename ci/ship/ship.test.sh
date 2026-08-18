#!/usr/bin/env bash
# ci/ship/ship.test.sh — tests for ci/ship/ship.sh + .claude/scripts/gh-attach-image.sh's
# --url-only flag (HYP-1252: SHIP_IMAGE_UPLOAD_CMD wiring). Run: bash ci/ship/ship.test.sh
#
# Pins the contracts agent-tools' real ci/ship/ship.sh is not checked out here to exercise
# live:
#   1. gh-attach-image.sh --url-only prints a bare URL (no markdown wrapper) — the exact
#      shape ship.sh's upload_png() expects on stdout — while the PR-comment side effect
#      (when a PR# is given) always stays the markdown embed form, independent of the flag.
#   2. ci/ship/ship.sh's self-relative uploader resolution / env-export / warn-and-defer /
#      self-exec-guard delegation logic.
# Wired into ci/local-checks.sh (gh ship's billing-block local fallback gate) and the
# ship-image-upload-test.yml CI workflow (normal PR/push path).
set -u
# Sanitize the environment against whatever the CALLER's shell happens to have exported.
# gh-attach-image.sh itself does NOT read $GH_REPO directly (an explicit --repo flag only —
# see the "--repo override" tests below and the design note in ci/ship/ship.sh), but the
# EXPORTED SHIP_IMAGE_UPLOAD_CMD embeds a literal `${GH_REPO:-}` reference that expands at
# `eval` time (section 2a-2's simulation), so an ambient GH_REPO would still silently change
# which repo those simulations target. An ambient SHIP_IMAGE_UPLOAD_CMD would make
# ci/ship/ship.sh (correctly) refuse to override it. Both break section-1/2 tests with a
# false failure that has nothing to do with an actual regression. Every test that WANTS
# either variable sets it explicitly per-invocation.
unset GH_REPO SHIP_IMAGE_UPLOAD_CMD
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && cd .. && pwd -P)
FAILS=0
PASSES=0
fail() { echo "  ✗ $1"; FAILS=$((FAILS + 1)); }
pass() { echo "  ✓ $1"; PASSES=$((PASSES + 1)); }

# Checked explicitly (not just relying on `set -u`/`set -e`, neither of which is armed for
# this whole script — see the `set -u` above with no `-e`): an unchecked, empty $TMP would
# turn every "$TMP/..." path below into a root-relative path (e.g. "/repo", "/bin/gh"), and
# `trap 'rm -rf "$TMP"' EXIT` would then `rm -rf ""`  — a silent no-op, not a catastrophe, but
# every subsequent test would fail confusingly rather than this failing loud immediately.
TMP=$(mktemp -d) || { echo "FATAL: mktemp -d failed" >&2; exit 99; }
if [ -z "$TMP" ]; then
  echo "FATAL: mktemp -d returned an empty path" >&2
  exit 99
fi
trap 'rm -rf "$TMP"' EXIT

# ── 1. gh-attach-image.sh --url-only prints a bare URL ──────────────────────────────────
echo "== gh-attach-image.sh --url-only: bare URL, no markdown =="

# Stub `gh` on PATH so this exercises the real gh-attach-image.sh without a network call.
# Mimics the `gh` invocations gh-attach-image.sh makes: repo lookup, repo id lookup, the
# upload POST, and `gh pr comment` (logs its body to a file so tests can assert on it).
BIN_DIR="$TMP/bin"; mkdir -p "$BIN_DIR"
PR_COMMENT_LOG="$TMP/pr-comment-log"
# The upload case emulates `gh api -q '.url'`'s already-extracted output directly, rather
# than shelling out to jq (not guaranteed on PATH in a test environment).
cat >"$BIN_DIR/gh" <<EOF
#!/usr/bin/env bash
case "\$*" in
  "repo view --json nameWithOwner -q .nameWithOwner")
    echo "stub/repo" ;;
  "api repos/stub/repo --jq .id")
    echo "999" ;;
  "api repos/other-org/other-repo --jq .id")
    echo "888" ;;
  *"uploads.github.com/user-attachments/assets"*"repository_id=888"*)
    echo "https://github.com/user-attachments/assets/other-repo-uuid" ;;
  *"uploads.github.com/user-attachments/assets"*)
    echo "https://github.com/user-attachments/assets/stub-uuid" ;;
  "pr comment "*)
    printf '%s\n' "\$*" >> "$PR_COMMENT_LOG" ;;
  *) echo "stub gh: unhandled invocation: \$*" >&2; exit 1 ;;
esac
EOF
chmod +x "$BIN_DIR/gh"

echo "fake png bytes" >"$TMP/x.png"
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" --url-only "$TMP/x.png" 2>&1)
if [ "$out" = "https://github.com/user-attachments/assets/stub-uuid" ]; then
  pass "--url-only prints a bare URL with no markdown wrapper"
else
  fail "--url-only prints a bare URL with no markdown wrapper — got: $out"
fi

# Without --url-only, the existing markdown-wrapper behavior is unchanged (backward compat).
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$TMP/x.png" 2>&1)
if [ "$out" = "![x.png](https://github.com/user-attachments/assets/stub-uuid)" ]; then
  pass "without --url-only, markdown-wrapper output is unchanged"
else
  fail "without --url-only, markdown-wrapper output is unchanged — got: $out"
fi

# --url-only + PR# together: stdout is the bare URL, but the PR comment is STILL the
# markdown embed (review finding — --url-only must control stdout only, never degrade the
# PR-comment side effect to a bare link).
rm -f "$PR_COMMENT_LOG"
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" --url-only "$TMP/x.png" 42 2>&1)
if [ "$out" = "https://github.com/user-attachments/assets/stub-uuid" ] \
  && grep -qF -- "--body ![x.png](https://github.com/user-attachments/assets/stub-uuid)" "$PR_COMMENT_LOG" 2>/dev/null; then
  pass "--url-only + PR#: stdout is bare, PR comment stays the markdown embed"
else
  fail "--url-only + PR#: stdout is bare, PR comment stays the markdown embed — stdout=$out log=$(cat "$PR_COMMENT_LOG" 2>/dev/null)"
fi

# A non-numeric PR# (e.g. a flag typed after the path by mistake) fails loud, not silently.
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$TMP/x.png" --url-only 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "PR# must be numeric"; then
  pass "a non-numeric PR# (flag typed after the path) fails loudly"
else
  fail "a non-numeric PR# (flag typed after the path) fails loudly — rc=$rc out=$out"
fi

# A flag typed one position further out (after IMAGE_PATH AND a valid numeric PR#) must
# ALSO fail loud — the bare $1/$2 assignment silently drops anything past $2 unless checked
# explicitly (review finding: `img.png 42 --repo other-org/other-repo` would otherwise
# silently discard the --repo override and upload to the cwd repo instead).
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$TMP/x.png" 42 --repo "other-org/other-repo" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "unexpected extra argument"; then
  pass "an argument after PR# (e.g. a misplaced --repo) fails loudly instead of being silently dropped"
else
  fail "an argument after PR# (e.g. a misplaced --repo) fails loudly instead of being silently dropped — rc=$rc out=$out"
fi

# --repo override: with --repo set to a DIFFERENT repo than the stub's bare `gh repo view`
# would report, the upload targets that repo (repo-id lookup + asset upload), not the cwd's
# repo — pins the fix for a real bug (an earlier version silently uploaded to/commented on
# the wrong repo under `gh ship --repo owner/other --screenshot ...`, since bare
# `gh repo view` ignores GH_REPO and always resolves from cwd). Deliberately an explicit
# --repo FLAG here, not an ambient $GH_REPO env var (review finding: reading ambient GH_REPO
# broke/changed behavior for every OTHER caller of this script too, including ones with an
# unrelated GH_REPO exported for their own gh usage) — this is the flag ci/ship/ship.sh's
# exported command passes, with the value resolved from GH_REPO only at eval time (see the
# GH_REPO-at-eval-time test in section 2).
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" --repo "other-org/other-repo" --url-only "$TMP/x.png" 2>&1)
if [ "$out" = "https://github.com/user-attachments/assets/other-repo-uuid" ]; then
  pass "--repo override targets the specified repo, not the cwd's own repo"
else
  fail "--repo override targets the specified repo, not the cwd's own repo — got: $out"
fi

# An EMPTY --repo value (ci/ship/ship.sh's exported `--repo "${GH_REPO:-}"` expands to this
# when GH_REPO is unset, i.e. `gh ship` was invoked without `--repo`) must be treated as "no
# override", not as a request to target a repo literally named "" — falls back to the
# pre-HYP-1252 bare `gh repo view` behavior.
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" --repo "" --url-only "$TMP/x.png" 2>&1)
if [ "$out" = "https://github.com/user-attachments/assets/stub-uuid" ]; then
  pass "an empty --repo value falls back to gh repo view (not treated as an override)"
else
  fail "an empty --repo value falls back to gh repo view (not treated as an override) — got: $out"
fi

# A host-qualified --repo ([HOST/]OWNER/REPO) is rejected loudly rather than silently
# building a garbage API path.
out=$(PATH="$BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" --repo "github.example.com/owner/repo" --url-only "$TMP/x.png" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "host-qualified"; then
  pass "a host-qualified --repo value is rejected loudly"
else
  fail "a host-qualified --repo value is rejected loudly — rc=$rc out=$out"
fi

# --repo unset (not passed at all) AND `gh repo view` itself fails (not authenticated / not a
# git repo) -> the friendly diagnostic actually prints, not a silent bare exit 1 (the
# regression this pins: an earlier `REPO="${GH_REPO:-$(...)}"` form let `set -e` abort at the
# assignment, before the diagnostic branch could ever run).
FAILING_BIN_DIR="$TMP/failing-bin"; mkdir -p "$FAILING_BIN_DIR"
cat >"$FAILING_BIN_DIR/gh" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "repo view --json nameWithOwner -q .nameWithOwner")
    exit 1 ;;
  *) echo "stub gh: unhandled invocation: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$FAILING_BIN_DIR/gh"
out=$(PATH="$FAILING_BIN_DIR:$PATH" "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$TMP/x.png" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "could not resolve repo"; then
  pass "repo-resolution failure prints the friendly diagnostic, not a silent exit"
else
  fail "repo-resolution failure prints the friendly diagnostic, not a silent exit — rc=$rc out=$out"
fi

# ── 2. ci/ship/ship.sh: env export / hard-fail / self-exec guard ────────────────────────
echo "== ci/ship/ship.sh: delegation logic =="

FAKE_REPO="$TMP/repo"; mkdir -p "$FAKE_REPO/.claude/scripts" "$FAKE_REPO/ci/ship"
cp "$SCRIPT_DIR/ship.sh" "$FAKE_REPO/ci/ship/ship.sh"
chmod +x "$FAKE_REPO/ci/ship/ship.sh"
# ci/ship/ship.sh is deliberately git- and cwd-independent (self-relative resolution) —
# no `git init` here, so this also proves it doesn't secretly need a git repo to work.

# A no-op "canonical" ship.sh that just dumps the env var we care about. References
# SHIP_IMAGE_UPLOAD_CMD, {FILE}, GH_REPO, and --screenshot/--shot in a comment (never
# executed) so ci/ship/ship.sh's drift detection sees a HEALTHY canonical here — without
# this, every section-2 test run would exercise only the drift-WARNING paths, never the
# "no warning on a healthy canonical" one.
CANON_DIR="$TMP/agent-tools/ci/ship"; mkdir -p "$CANON_DIR"
cat >"$CANON_DIR/ship.sh" <<'EOF'
#!/usr/bin/env bash
# stub: real upload_png() substitutes {FILE} into $SHIP_IMAGE_UPLOAD_CMD, then evals it;
# real ship.sh also threads --repo through every gh call via GH_REPO, and its own arg
# parser recognizes --screenshot|--shot.
echo "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=${SHIP_IMAGE_UPLOAD_CMD:-<unset>}"
EOF
chmod +x "$CANON_DIR/ship.sh"

# 2a. Uploader present + executable -> SHIP_IMAGE_UPLOAD_CMD exported, canonical reached.
cp "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$FAKE_REPO/.claude/scripts/"
chmod +x "$FAKE_REPO/.claude/scripts/gh-attach-image.sh"
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 2>&1)
out_2a="$out"
if printf '%s' "$out" | grep -qE 'CANON_RAN SHIP_IMAGE_UPLOAD_CMD=".*gh-attach-image\.sh" --repo "\$\{GH_REPO:-\}" --url-only "\{FILE\}"'; then
  pass "exports quoted SHIP_IMAGE_UPLOAD_CMD (--repo \${GH_REPO:-} --url-only) and reaches canonical when uploader is executable"
else
  fail "exports quoted SHIP_IMAGE_UPLOAD_CMD (--repo \${GH_REPO:-} --url-only) and reaches canonical when uploader is executable — got: $out"
fi
# Pins the OTHER side of the drift-detection check too: a HEALTHY canonical (references both
# SHIP_IMAGE_UPLOAD_CMD and {FILE}, per the stub's comment above) must NOT print the drift
# warning — every other section-2 test exercises only the warning-firing path.
if ! printf '%s' "$out" | grep -q "no longer appears to reference"; then
  pass "a healthy canonical does not trigger the drift-detection warning"
else
  fail "a healthy canonical does not trigger the drift-detection warning — got: $out"
fi

# 2a-1b. Uploader present/executable + --screenshot in argv -> refusal branch never triggers
# (it lives entirely in the `else` of the uploader-executable check), delegation proceeds
# normally. Pins the boundary of the HYP-1252-P1 refusal: a WORKING uploader must never be
# refused just because --screenshot was passed — only a broken one is.
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 --screenshot /tmp/whatever.png "a screenshot" 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "CANON_RAN" \
  && ! printf '%s' "$out" | grep -q "REFUSING"; then
  pass "a working uploader + --screenshot delegates normally (refusal is scoped to a broken uploader)"
else
  fail "a working uploader + --screenshot delegates normally (refusal is scoped to a broken uploader) — rc=$rc out=$out"
fi

# A canonical that no longer references GH_REPO at all (simulating upstream dropping the
# --repo threading this design depends on) DOES trigger the drift warning.
NO_GH_REPO_CANON_DIR="$TMP/agent-tools-no-gh-repo/ci/ship"; mkdir -p "$NO_GH_REPO_CANON_DIR"
cat >"$NO_GH_REPO_CANON_DIR/ship.sh" <<'EOF'
#!/usr/bin/env bash
echo "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=${SHIP_IMAGE_UPLOAD_CMD:-<unset>}"
EOF
chmod +x "$NO_GH_REPO_CANON_DIR/ship.sh"
out_no_gh_repo=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools-no-gh-repo" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 2>&1)
if printf '%s' "$out_no_gh_repo" | grep -q "no longer appears to reference GH_REPO"; then
  pass "a canonical missing GH_REPO entirely triggers the drift-detection warning"
else
  fail "a canonical missing GH_REPO entirely triggers the drift-detection warning — got: $out_no_gh_repo"
fi

# 2a-2. The actual integration seam: replicate agent-tools' real upload_png() mechanism
# (`${SHIP_IMAGE_UPLOAD_CMD//\{FILE\}/$png}` substitution, then `eval`, then
# `grep -oE 'https?://[^ ]+' | tail -1`) against the ACTUAL string ci/ship/ship.sh exported
# in 2a (re-extracted from its "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=..." line) — not just the
# string's shape (2a only pins that). A $png containing a SPACE pins the one quoting claim
# this whole design rests on. `ci/ship/ship.sh` is NOT re-sourced here — it `exec`s a
# canonical at the end, which would replace/kill the calling shell — the export string is
# reused from 2a's already-captured output instead.
export_cmd=$(printf '%s' "$out_2a" | sed -n 's/^CANON_RAN SHIP_IMAGE_UPLOAD_CMD=//p')
png_with_space="$TMP/dir with space/shot.png"
mkdir -p "$(dirname "$png_with_space")"; echo x >"$png_with_space"
sim_out=$(PATH="$BIN_DIR:$PATH" bash -c '
  cmd="$1"; png="$2"
  out=$(eval "${cmd//\{FILE\}/$png}" 2>/dev/null)
  printf "%s" "$out" | grep -oE "https?://[^ ]+" | tail -1
' _ "$export_cmd" "$png_with_space")
if [ "$sim_out" = "https://github.com/user-attachments/assets/stub-uuid" ]; then
  pass "the exported SHIP_IMAGE_UPLOAD_CMD survives upstream's actual {FILE}-substitution+eval+grep pipeline, including a space in the path"
else
  fail "the exported SHIP_IMAGE_UPLOAD_CMD survives upstream's actual {FILE}-substitution+eval+grep pipeline, including a space in the path — export_cmd=$export_cmd sim_out=$sim_out"
fi

# Same pipeline, but with GH_REPO set in the environment at EVAL time (simulating canonical
# ship.sh having already processed a `--repo owner/other` flag before calling upload_png())
# — proves the literal `${GH_REPO:-}` embedded in the exported string actually resolves to
# the OTHER repo's asset, not the cwd's, end to end through the real substitution+eval path.
sim_out_other_repo=$(PATH="$BIN_DIR:$PATH" GH_REPO="other-org/other-repo" bash -c '
  cmd="$1"; png="$2"
  out=$(eval "${cmd//\{FILE\}/$png}" 2>/dev/null)
  printf "%s" "$out" | grep -oE "https?://[^ ]+" | tail -1
' _ "$export_cmd" "$png_with_space")
if [ "$sim_out_other_repo" = "https://github.com/user-attachments/assets/other-repo-uuid" ]; then
  pass "with GH_REPO set at eval time, the exported command targets that repo's upload, not the cwd's"
else
  fail "with GH_REPO set at eval time, the exported command targets that repo's upload, not the cwd's — got: $sim_out_other_repo"
fi

# 2b. A caller-set SHIP_IMAGE_UPLOAD_CMD is never overridden.
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  SHIP_IMAGE_UPLOAD_CMD="custom-cmd {FILE}" bash ci/ship/ship.sh 2>&1)
if printf '%s' "$out" | grep -qF 'CANON_RAN SHIP_IMAGE_UPLOAD_CMD=custom-cmd {FILE}'; then
  pass "does not override a caller-set SHIP_IMAGE_UPLOAD_CMD"
else
  fail "does not override a caller-set SHIP_IMAGE_UPLOAD_CMD — got: $out"
fi

# Extracted straight from ship.sh's own source (not re-typed) so tests below can't silently
# drift from the real sentinel string, and so the export side (not just the detection side)
# of the self-poison fix can be pinned by an EXACT-value assertion rather than a `false`-
# prefix substring match, which a regression back to bare `"false"` would still satisfy
# (review finding, PR #724 round 4) — SELF_FAIL_SENTINEL is used by every case below that
# checks what THIS script exports on the broken-uploader/no-screenshot path.
SELF_FAIL_SENTINEL=$(sed -n 's/^_ship_self_fail_sentinel="\(.*\)"$/\1/p' "$SCRIPT_DIR/ship.sh")
if [ -z "$SELF_FAIL_SENTINEL" ]; then
  fail "could not extract _ship_self_fail_sentinel from ship.sh (all sentinel-value assertions below depend on this)"
fi

# 2b-1z. Review finding (round 7): nothing pinned the load-bearing claim that the sentinel
# actually BEHAVES like `false` when `eval`'d — that its message text is a quoted ARGUMENT
# `false` simply ignores (not a `#` comment that would swallow anything canonical appends
# after it on the same eval'd line — see ship.sh's own comment on `_ship_self_fail_sentinel`
# for why the argument form was chosen over a comment), and that it produces no stdout that
# could accidentally look like a URL to upload_png()'s `grep -oE 'https?://[^ ]+'`
# extraction. Evals the exact extracted string directly (the same mechanism canonical's real
# upload_png() uses, minus the {FILE}-substitution step already covered by section 2a-2's
# `eval`-pipeline test) and asserts both a non-zero exit and empty output.
if [ -n "$SELF_FAIL_SENTINEL" ]; then
  sentinel_eval_out=$(eval "$SELF_FAIL_SENTINEL" 2>&1)
  sentinel_eval_rc=$?
  if [ "$sentinel_eval_rc" -ne 0 ] && [ -z "$sentinel_eval_out" ]; then
    pass "the self-fail sentinel evals to a non-zero exit with no output, same as bare false"
  else
    fail "the self-fail sentinel evals to a non-zero exit with no output, same as bare false — rc=$sentinel_eval_rc out=$sentinel_eval_out"
  fi
else
  fail "the self-fail sentinel evals to a non-zero exit with no output, same as bare false — SKIPPED: SELF_FAIL_SENTINEL extraction failed"
fi

# 2b-2. Review finding (Fable, PR #724's own P1 fix): a caller's GENUINE, deliberate preset
# of bare SHIP_IMAGE_UPLOAD_CMD="false" is NOT the self-poison sentinel (a distinct string,
# not bare `false`) and must be passed through unchanged, exactly like the "does not override
# a caller-set" test above — a caller disabling uploads on purpose must not be silently
# reinterpreted or refused. Asserts the EXACT value round-trips as bare `false`, not merely
# that it starts with `false` (which the sentinel also does).
rm -f "$FAKE_REPO/.claude/scripts/gh-attach-image.sh"
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  SHIP_IMAGE_UPLOAD_CMD="false" bash ci/ship/ship.sh 1 --screenshot /tmp/whatever.png 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qxF 'CANON_RAN SHIP_IMAGE_UPLOAD_CMD=false' \
  && ! printf '%s' "$out" | grep -q "REFUSING"; then
  pass "a caller's genuine bare SHIP_IMAGE_UPLOAD_CMD=false override passes through unchanged (exact value), no refusal"
else
  fail "a caller's genuine bare SHIP_IMAGE_UPLOAD_CMD=false override passes through unchanged (exact value), no refusal — rc=$rc out=$out"
fi

# 2b-2b. The actual self-poison guard: presetting the EXACT sentinel ci/ship/ship.sh exports
# on the broken-uploader/no-screenshot path (simulating a downstream re-invocation of this
# same wrapper inheriting that export) — this MUST be re-detected as unset and, with
# --screenshot in argv and the uploader still broken, still REFUSE.
if [ -n "$SELF_FAIL_SENTINEL" ]; then
  out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
    SHIP_IMAGE_UPLOAD_CMD="$SELF_FAIL_SENTINEL" bash ci/ship/ship.sh 1 --screenshot /tmp/whatever.png 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "REFUSING" \
    && ! printf '%s' "$out" | grep -q "CANON_RAN"; then
    pass "a preset SELF-POISON sentinel is re-detected as unset, still refuses on a broken uploader + --screenshot"
  else
    fail "a preset SELF-POISON sentinel is re-detected as unset, still refuses on a broken uploader + --screenshot — rc=$rc out=$out"
  fi
else
  # Uniform failure, not a silent skip (review finding, round 6): if extraction ever breaks,
  # every sentinel-dependent test below must show up as a failure in the PASS/FAIL tally, not
  # quietly vanish — a `[ -n ... ]`-guarded skip here would let the two most important
  # self-poison tests disappear without moving FAILS off zero.
  fail "a preset SELF-POISON sentinel is re-detected as unset, still refuses on a broken uploader + --screenshot — SKIPPED: SELF_FAIL_SENTINEL extraction failed"
fi

# 2b-2c. Same self-poison sentinel, but with NO --screenshot/--shot in argv this time
# (review finding, round 6) — the inherited sentinel must still be re-detected as unset on
# the no-screenshot path too, not just the refusing one: re-exported as the (same) sentinel
# and delegated, exactly like the genuinely-unset case in 2c below.
if [ -n "$SELF_FAIL_SENTINEL" ]; then
  out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
    SHIP_IMAGE_UPLOAD_CMD="$SELF_FAIL_SENTINEL" bash ci/ship/ship.sh 1 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qxF "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=$SELF_FAIL_SENTINEL"; then
    pass "sentinel inherited + broken uploader + no --screenshot -> re-detected as unset, re-exported, delegates"
  else
    fail "sentinel inherited + broken uploader + no --screenshot -> re-detected as unset, re-exported, delegates — rc=$rc out=$out"
  fi
else
  fail "sentinel inherited + broken uploader + no --screenshot -> re-detected as unset, re-exported, delegates — SKIPPED: SELF_FAIL_SENTINEL extraction failed"
fi

# 2b-2d. The sentinel mechanism's main payoff (review finding, round 5): sentinel inherited
# + a HEALTHY uploader this time -> re-detected as unset, the real upload command is
# re-exported (not the sentinel, not left as-is), delegation proceeds normally. Without this,
# 2b-2b only pins "still refuses when still broken"; a regression that re-detects the
# sentinel as unset but then fails to re-resolve a WORKING uploader (e.g. an early-return
# bug) would go uncaught.
cp "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$FAKE_REPO/.claude/scripts/"
chmod +x "$FAKE_REPO/.claude/scripts/gh-attach-image.sh"
if [ -n "$SELF_FAIL_SENTINEL" ]; then
  out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
    SHIP_IMAGE_UPLOAD_CMD="$SELF_FAIL_SENTINEL" bash ci/ship/ship.sh 1 --screenshot /tmp/whatever.png 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qE 'CANON_RAN SHIP_IMAGE_UPLOAD_CMD=".*gh-attach-image\.sh" --repo "\$\{GH_REPO:-\}" --url-only "\{FILE\}"' \
    && ! printf '%s' "$out" | grep -q "REFUSING"; then
    pass "sentinel inherited + a healthy uploader -> re-detected as unset, real upload command re-exported, delegates"
  else
    fail "sentinel inherited + a healthy uploader -> re-detected as unset, real upload command re-exported, delegates — rc=$rc out=$out"
  fi
else
  fail "sentinel inherited + a healthy uploader -> re-detected as unset, real upload command re-exported, delegates — SKIPPED: SELF_FAIL_SENTINEL extraction failed"
fi

# 2b-3. Drift detection: ci/ship/ship.sh's header claims its env-file resolution condition
# mirrors .claude/scripts/pr-ship.sh's own line VERBATIM ("checked side by side — identical
# condition, same env-file path"). Assert that claim literally, so if either file's line
# changes without the other being updated to match, THIS test — not a confusing runtime
# divergence — is what breaks.
#
# NOTE for whoever this test sends here: pr-ship.sh is provisioned by `rig apply` (see its
# own header) — if THIS assertion breaks after a routine `rig apply` regenerated pr-ship.sh
# with a change to this line, the fix is almost always to update ci/ship/ship.sh's mirrored
# line to match the new pr-ship.sh (not to revert the rig regen).
# shellcheck disable=SC2016 # deliberately literal — grep -F pattern, not a shell expansion
SHIP_MIRROR_LINE=$(grep -F 'AGENT_TOOLS_ROOT:-}" && ! -L "$env_file" && -f "$env_file"' "$SCRIPT_DIR/ship.sh")
# An EMPTY $SHIP_MIRROR_LINE (the anchor pattern stops matching ship.sh — e.g. someone
# removes the `! -L` check, exactly the divergence this test exists to catch) must FAIL,
# not vacuously pass: `grep -qF ""` matches every line of any non-empty file, so without
# this guard the test would pass on the precise drift it's meant to detect.
if [ -n "$SHIP_MIRROR_LINE" ] && grep -qF "$SHIP_MIRROR_LINE" "$REPO_ROOT/.claude/scripts/pr-ship.sh" 2>/dev/null; then
  pass "ci/ship/ship.sh's env-file resolution condition still matches pr-ship.sh's verbatim"
else
  fail "ci/ship/ship.sh's env-file resolution condition still matches pr-ship.sh's verbatim — ship.sh's anchor line: '$SHIP_MIRROR_LINE' (if pr-ship.sh changed via a routine 'rig apply' regen, update ci/ship/ship.sh's mirrored line to match, don't revert the regen)"
fi

# 2c. Uploader missing + NO --screenshot/--shot in argv -> warns visibly (before delegating,
# since upstream's own eval swallows stderr) AND exports the SELF-FAIL SENTINEL (not just a
# `false`-prefixed value — see the review finding above the SELF_FAIL_SENTINEL extraction: a
# regression back to bare `"false"` here must fail this assertion, not slide through a
# substring match) instead of leaving it unset, then still delegates — the uploader is not
# needed for a non-screenshot ship, so this is inert either way.
rm -f "$FAKE_REPO/.claude/scripts/gh-attach-image.sh"
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARNING screenshot uploader not found" \
  && [ -n "$SELF_FAIL_SENTINEL" ] \
  && printf '%s\n' "$out" | grep -qxF "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=$SELF_FAIL_SENTINEL"; then
  pass "uploader missing, no --screenshot -> warns, exports the exact self-fail sentinel, still delegates"
else
  fail "uploader missing, no --screenshot -> warns, exports the exact self-fail sentinel, still delegates — rc=$rc out=$out"
fi

# 2c-2. HYP-1252-P1 (Codex, PR #724): uploader missing + --screenshot IS in argv -> REFUSES
# before delegation (does not reach canonical at all). Pins the actual bug fix: canonical's
# own screenshot gate does NOT fail closed on a failed upload (it only requires that a
# screenshot PATH was supplied — see .claude/scripts/pr-ship.test.sh T33), so exporting a
# failing SHIP_IMAGE_UPLOAD_CMD and delegating would have silently shipped a UI-touching PR
# without an embedded image. rc must be non-zero, the delegation must never happen (no
# CANON_RAN in the output), and the failure must be visible on stderr.
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 --screenshot /tmp/whatever.png "a screenshot" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "REFUSING" \
  && ! printf '%s' "$out" | grep -q "CANON_RAN"; then
  pass "uploader missing + --screenshot -> refuses before delegation (HYP-1252 P1)"
else
  fail "uploader missing + --screenshot -> refuses before delegation (HYP-1252 P1) — rc=$rc out=$out"
fi

# 2c-3. Same refusal for the `--shot` spelling (the second flag canonical itself parses).
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 --shot /tmp/whatever.png 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "REFUSING" \
  && ! printf '%s' "$out" | grep -q "CANON_RAN"; then
  pass "uploader missing + --shot -> refuses before delegation (same as --screenshot)"
else
  fail "uploader missing + --shot -> refuses before delegation (same as --screenshot) — rc=$rc out=$out"
fi

# 2c-4. Review finding (independently raised twice on PR #724's own fix): the `=`-joined
# spelling `--screenshot=<path>` — a form canonical does not parse today but the exact
# hypothetical the ORIGINAL pre-P1 code cited as a reason to avoid argv-scanning at all —
# must ALSO refuse, not silently fall through to the unsafe `false`-export path.
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 --screenshot=/tmp/whatever.png 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "REFUSING" \
  && ! printf '%s' "$out" | grep -q "CANON_RAN"; then
  pass "uploader missing + --screenshot=<path> -> refuses before delegation (=-joined spelling)"
else
  fail "uploader missing + --screenshot=<path> -> refuses before delegation (=-joined spelling) — rc=$rc out=$out"
fi

# 2c-5. Sibling of 2c-4 for the `--shot=*` case pattern (review finding, round 10) — 2c-4
# only exercised `--screenshot=*`; a typo in the separate `--shot=*` pattern would otherwise
# go uncaught while every other spelling is regression-pinned.
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 --shot=/tmp/whatever.png 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "REFUSING" \
  && ! printf '%s' "$out" | grep -q "CANON_RAN"; then
  pass "uploader missing + --shot=<path> -> refuses before delegation (=-joined spelling)"
else
  fail "uploader missing + --shot=<path> -> refuses before delegation (=-joined spelling) — rc=$rc out=$out"
fi

# 2d. Uploader present but NOT executable (exec bit lost on checkout) behaves the same as
# missing — same warn + fail-closed export when no --screenshot, same refuse-before-delegation
# when --screenshot IS passed.
cp "$REPO_ROOT/.claude/scripts/gh-attach-image.sh" "$FAKE_REPO/.claude/scripts/"
chmod -x "$FAKE_REPO/.claude/scripts/gh-attach-image.sh"
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "WARNING screenshot uploader not found" \
  && [ -n "$SELF_FAIL_SENTINEL" ] \
  && printf '%s\n' "$out" | grep -qxF "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=$SELF_FAIL_SENTINEL"; then
  pass "uploader present but not executable, no --screenshot -> same warn + exact sentinel export as missing"
else
  fail "uploader present but not executable, no --screenshot -> same warn + exact sentinel export as missing — rc=$rc out=$out"
fi

out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 1 --screenshot /tmp/whatever.png 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "REFUSING" \
  && ! printf '%s' "$out" | grep -q "CANON_RAN"; then
  pass "uploader present but not executable + --screenshot -> refuses before delegation, same as missing"
else
  fail "uploader present but not executable + --screenshot -> refuses before delegation, same as missing — rc=$rc out=$out"
fi
chmod +x "$FAKE_REPO/.claude/scripts/gh-attach-image.sh"

# 2d-2. Drift-detection hedge: if canonical stops referencing --screenshot/--shot entirely
# (the flag spellings the refuse-before-delegation scan above keys off), the argv scan could
# silently stop matching future reality — this must at least surface as a visible warning
# (not fix the scan automatically, which is out of scope here, but make the drift loud).
# Reuses a working uploader (2a's setup) so we reach canonical delegation, and a canonical
# stub that DOES echo SHIP_IMAGE_UPLOAD_CMD (so the OTHER two drift checks stay quiet) but
# has no mention of the screenshot flags anywhere — including in its own comments, since a
# comment merely NAMING the flag it deliberately omits would satisfy the same grep this test
# is trying to prove absent.
NO_SCREENSHOT_FLAG_CANON_DIR="$TMP/agent-tools-no-screenshot-flag/ci/ship"; mkdir -p "$NO_SCREENSHOT_FLAG_CANON_DIR"
cat >"$NO_SCREENSHOT_FLAG_CANON_DIR/ship.sh" <<'EOF'
#!/usr/bin/env bash
# minimal stub: reports the one env var this test cares about, references {FILE} and
# GH_REPO in a comment (so those two drift checks stay quiet), says nothing else.
# {FILE} GH_REPO
echo "CANON_RAN SHIP_IMAGE_UPLOAD_CMD=${SHIP_IMAGE_UPLOAD_CMD:-<unset>}"
EOF
chmod +x "$NO_SCREENSHOT_FLAG_CANON_DIR/ship.sh"
# Deliberately no --screenshot in argv: this exercises the drift-detection WARNING on the
# delegation path, distinct from the P1 REFUSAL path — asserting rc=0 and CANON_RAN too
# (review finding, round 9) pins that this is warn-and-continue, not a second refusal
# mechanism; a regression that turned this warning into a hard failure, or that crashed
# after printing it, would otherwise still pass on the substring check alone.
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools-no-screenshot-flag" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "no longer appears to reference --screenshot / --shot" \
  && printf '%s' "$out" | grep -q "CANON_RAN"; then
  pass "a canonical missing --screenshot/--shot entirely triggers the flag-spelling drift warning, warn-and-continue (rc=0, still delegates)"
else
  fail "a canonical missing --screenshot/--shot entirely triggers the flag-spelling drift warning, warn-and-continue (rc=0, still delegates) — rc=$rc out=$out"
fi

# 2f. env-file resolution path: AGENT_TOOLS_ROOT UNSET, resolved instead via
# $XDG_CONFIG_HOME/agent-tools/env (the fallback pr-ship.sh itself uses) — this is the one
# branch every other test bypasses by presetting AGENT_TOOLS_ROOT directly.
ENV_CONFIG_DIR="$TMP/env-config/agent-tools"; mkdir -p "$ENV_CONFIG_DIR"
printf 'AGENT_TOOLS_ROOT=%s\n' "$TMP/agent-tools" >"$ENV_CONFIG_DIR/env"
out=$(cd "$FAKE_REPO" && env -u AGENT_TOOLS_ROOT XDG_CONFIG_HOME="$TMP/env-config" \
  bash ci/ship/ship.sh 2>&1)
if printf '%s' "$out" | grep -qF 'CANON_RAN SHIP_IMAGE_UPLOAD_CMD='; then
  pass "resolves AGENT_TOOLS_ROOT via the \$XDG_CONFIG_HOME/agent-tools/env fallback file"
else
  fail "resolves AGENT_TOOLS_ROOT via the \$XDG_CONFIG_HOME/agent-tools/env fallback file — got: $out"
fi

# 2g. Neither AGENT_TOOLS_ROOT nor the env file resolve -> exits 127 with the documented
# "canonical ship.sh not found" message (not a silent no-op, not a crash with no guidance).
out=$(cd "$FAKE_REPO" && env -u AGENT_TOOLS_ROOT XDG_CONFIG_HOME="$TMP/nonexistent-config" \
  bash ci/ship/ship.sh 2>&1)
rc=$?
if [ "$rc" -eq 127 ] && printf '%s' "$out" | grep -q "canonical ship.sh not found"; then
  pass "neither AGENT_TOOLS_ROOT nor env file resolve -> exits 127 with guidance"
else
  fail "neither AGENT_TOOLS_ROOT nor env file resolve -> exits 127 with guidance — rc=$rc out=$out"
fi

# 2h. Self-exec guard: AGENT_TOOLS_ROOT points back at THIS repo's own ci/ship -> refuse, not
# hang. No `timeout` wrapper here on purpose: macOS ships no `timeout` binary by default
# (coreutils installs it as `gtimeout`), and the guard's own exit is immediate on the FIRST
# hop (it never actually loops even without a wrapper) — a missing/renamed timeout binary
# would otherwise mask a real guard failure behind a spurious "command not found".
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$FAKE_REPO" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 2>&1)
rc=$?
if [ "$rc" -eq 127 ] && printf '%s' "$out" | grep -q "refusing to self-exec"; then
  pass "self-exec guard refuses instead of looping when AGENT_TOOLS_ROOT points at itself"
else
  fail "self-exec guard refuses instead of looping when AGENT_TOOLS_ROOT points at itself — rc=$rc out=$out"
fi

# 2i. Self-exec guard also catches a SYMLINKED canonical pointing back at $self (not just an
# identical literal path) — the earlier `pwd -P`-on-directory-only version missed this.
SYMLINK_AGENT_TOOLS="$TMP/agent-tools-symlinked/ci/ship"; mkdir -p "$SYMLINK_AGENT_TOOLS"
ln -s "$FAKE_REPO/ci/ship/ship.sh" "$SYMLINK_AGENT_TOOLS/ship.sh"
out=$(cd "$FAKE_REPO" && AGENT_TOOLS_ROOT="$TMP/agent-tools-symlinked" XDG_CONFIG_HOME="$TMP/empty-config" \
  bash ci/ship/ship.sh 2>&1)
rc=$?
if [ "$rc" -eq 127 ] && printf '%s' "$out" | grep -q "refusing to self-exec"; then
  pass "self-exec guard catches a symlinked canonical path pointing back at itself"
else
  fail "self-exec guard catches a symlinked canonical path pointing back at itself — rc=$rc out=$out"
fi

# 2j. _realpath's hop cap: a symlink CYCLE (a -> b -> a) fails fast (non-zero, a clear
# message) instead of hanging forever. Tested in isolation: both of ship.sh's own call
# sites ($self via bash's script loader, $canonical via a `-f` test) reject a genuinely
# cyclic symlink before ever reaching this function, so a real end-to-end `gh ship`
# invocation can't exercise the cap at all — the ONLY way to reach it is a target that
# LOOKS resolvable per-hop (each individual `readlink` succeeds) but cycles overall, which
# is exactly what a real symlink loop under a filesystem's own ELOOP limit looks like from
# a caller's perspective. Extract and source just the function (no side effects to stub —
# it is pure path arithmetic) rather than fabricate a filesystem cycle a portable `readlink`
# reliably detects before this code even runs.
FN_FILE="$TMP/realpath-fn.sh"
sed -n '/^_realpath() {/,/^}/p' "$SCRIPT_DIR/ship.sh" >"$FN_FILE"
if [ ! -s "$FN_FILE" ]; then
  fail "_realpath's hop cap fails fast on a symlink cycle instead of hanging — could not extract _realpath() from ship.sh"
else
  CYCLE_DIR="$TMP/cycle"; mkdir -p "$CYCLE_DIR"
  ln -s "$CYCLE_DIR/b" "$CYCLE_DIR/a"
  ln -s "$CYCLE_DIR/a" "$CYCLE_DIR/b"
  out=$(bash -c "source '$FN_FILE'; _realpath '$CYCLE_DIR/a'" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "symlink cycle"; then
    pass "_realpath's hop cap fails fast on a symlink cycle instead of hanging"
  else
    fail "_realpath's hop cap fails fast on a symlink cycle instead of hanging — rc=$rc out=$out"
  fi
fi

echo
echo "PASS=$PASSES FAIL=$FAILS"
[ "$FAILS" -eq 0 ]
