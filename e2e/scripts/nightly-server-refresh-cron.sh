#!/usr/bin/env bash
# nightly-server-refresh-cron.sh — local-machine cron entry point that pushes
# fresh hyperide code to the remote e2e matrix server (77.42.45.86) BEFORE
# its own nightly cron trigger, so the 02:00 Europe/Belgrade run never tests
# stale code (HYP-1303, follow-up to HYP-1180/HYP-1301).
#
# Why this exists: the remote server has no GitHub credentials and nothing
# on it can `git pull` itself (see AGENTS.md "Remote E2E Server" > Known live
# gaps) — the ONLY way it gets fresh code is a push FROM a git-capable
# machine. Before this script, that push only ever happened when a human
# remembered to run it by hand — HYP-1180 found the server drifted 8+ days /
# 21 commits stale with zero automatic signal.
#
# Meant to be invoked by a LOCAL scheduler entry on this dev machine, timed a
# few minutes before the server's own 02:00 Europe/Belgrade trigger. Originally designed
# for crontab; actually runs as a macOS LaunchAgent today because `crontab` install
# attempts on this machine failed (see the scheduling callout and rationale in AGENTS.md's
# "Remote E2E Server" section — read that before assuming crontab is what fires this).
#
# What it does, in order:
#   0. Acquires a local, non-blocking mkdir-based lock
#      (/tmp/hyperide-nightly-refresh-cron.lockdir — NOT flock, which this
#      machine does not have installed) so two overlapping invocations (a
#      hung previous run plus the next scheduled one, or a manual re-run)
#      never race on the same shared mirror checkout. Losing this lock exits
#      0 quietly — expected overlap, not a failure. A stale lock (owning PID
#      no longer running) is reclaimed automatically.
#   1. Self-provisions a DEDICATED mirror clone at HYPERIDE_CHECKOUT if one
#      doesn't exist yet (default: ~/work/hyperide-nightly-mirror — NOT
#      /Users/ultra/work/hyperide, which is the interactive daily-driver
#      checkout; running `git checkout main` / failing loudly on a normal
#      uncommitted change there would disrupt actual work and false-alarm
#      every time a feature branch is left checked out overnight).
#   2. Refuses to touch it if it somehow has uncommitted changes anyway (a
#      real anomaly for a directory nothing else should touch — worth
#      alerting on, not silently resetting).
#   3. Fetches + fast-forwards it to origin/main (fails closed — never
#      force-resets or discards anything).
#   4. Builds the VS Code extension (npm ci && npm run build — NEVER bun,
#      see AGENTS.md) so out/extension.js exists and is fresh: that path is
#      gitignored, so a plain git checkout alone does not produce it, and
#      it's the one file matrix-run.sh actually reads.
#   5. Delegates the actual sync to remote-matrix-run.sh in SYNC_ONLY mode,
#      pointed at the SAME directory the server's crontab reads
#      (HYPER_E2E_EXTENSION_REPO defaults to REMOTE_EXTENSION_DIR there,
#      itself defaulting to /root/work/hyperide — the HYP-1301 fix). That
#      script does its own remote-lock check (and holds the lock for the
#      rsync itself) before touching anything, so this script doesn't
#      duplicate that logic — it only distinguishes "lock busy, expected
#      skip" (exit 75) from a genuine failure so it doesn't page over a
#      normal HYP-1299-long-run condition.
#   6. Logs everything with timestamps to LOG_FILE; on any GENUINE failure,
#      sends a Telegram alert via `tg` so a broken refresh is never silent.
#
# Cron runs with a minimal PATH (typically /usr/bin:/bin on macOS) — node,
# npm, rsync (Homebrew), bun (~/.bun/bin), and tg (~/.files/bin) all live
# outside that, so this script sets its own PATH explicitly rather than
# relying on the invoking environment. Adjust below if this machine's
# toolchain moves.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.bun/bin:$HOME/.files/bin:$PATH"

set -uo pipefail

HYPERIDE_CHECKOUT="${HYPERIDE_CHECKOUT:-$HOME/work/hyperide-nightly-mirror}"
HYPERIDE_ORIGIN="${HYPERIDE_ORIGIN:-git@github.com:hyperide/hyper-saas.git}"
LOG_FILE="${NIGHTLY_REFRESH_LOG:-$HOME/Library/Logs/hyperide-nightly-refresh.log}"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '%s %s\n' "$(date '+%F %T %Z')" "$*" | tee -a "$LOG_FILE"
}

alert() {
  local msg="$1"
  log "ALERT: $msg"
  if command -v tg >/dev/null 2>&1; then
    if tg --tag problem --title "Nightly e2e server refresh failed" \
        "$msg"$'\n\n'"Full log: $LOG_FILE" >>"$LOG_FILE" 2>&1; then
      log "alert sent via tg"
    else
      log "ALERT: tg itself failed to send — see $LOG_FILE for the raw failure"
    fi
  else
    log "ALERT: 'tg' not on PATH (checked: $PATH) — could not send Telegram alert"
  fi
}

fail() {
  alert "$1"
  exit 1
}

# Local mutex: HYPERIDE_CHECKOUT is a single shared directory this script
# mutates in place (checkout/fetch/merge, then bun install, then npm ci +
# npm run build in the extension subdir). Two overlapping invocations — a
# cron run that's still going plus a manual re-run, or a hung previous run
# still holding files open when the next 01:45 fires — would race on the
# SAME git checkout and node_modules trees with no coordination, unlike the
# remote side which the two-layer $REMOTE_LOCK check already protects. This
# mirrors that same non-blocking-skip pattern locally: fail to acquire =
# something else is already refreshing, log it and exit quietly, don't page
# over a normal overlap.
#
# Deliberately NOT `flock` — verified empirically that this machine (and
# very possibly any plain macOS dev machine, since it's a Linux util-linux
# tool with no BSD/macOS built-in equivalent) does not have a `flock` binary
# at all, not even via Homebrew's util-linux formula. Under `set -uo
# pipefail` (no `-e` here) a missing binary makes the `if ! flock ...`
# condition true for the WRONG reason — "command not found" instead of
# "lock busy" — so every single invocation would falsely conclude another
# instance is already running and silently no-op forever. That's a strictly
# worse, 100%-reproducible version of the exact HYP-1180 problem this script
# exists to fix. `mkdir` is atomic on any POSIX filesystem and needs no
# external binary; staleness (a crashed previous run that never cleaned up)
# is detected via a recorded PID and `kill -0`, not a timeout guess.
LOCAL_LOCK_DIR="${NIGHTLY_REFRESH_LOCAL_LOCK:-/tmp/hyperide-nightly-refresh-cron.lockdir}"
if ! mkdir "$LOCAL_LOCK_DIR" 2>/dev/null; then
  _lock_pid=""
  [[ -f "$LOCAL_LOCK_DIR/pid" ]] && _lock_pid="$(cat "$LOCAL_LOCK_DIR/pid" 2>/dev/null)"
  if [[ -z "$_lock_pid" ]]; then
    # An empty read here is ambiguous: it's either a genuinely stale lock
    # (pid file never written, e.g. the owner crashed between mkdir and
    # writing it) OR the lock dir was JUST created by another invocation a
    # moment ago and its pid write literally hasn't happened yet (see the
    # residual-race note below `trap` — a real, if narrow, window). A
    # SECOND read after a brief pause resolves the ambiguity: a legitimate
    # owner writes its pid within microseconds of its own mkdir succeeding,
    # so requiring the empty read to survive an entire sleep — not just a
    # scheduler hiccup — converts an instant misclassification into one
    # that would need the owner to be wedged for the whole interval. This
    # matters because two concurrent invocations both proceeding is NOT
    # merely redundant work — `git checkout`/`bun install`/`npm ci` racing
    # on the SAME shared mirror checkout can corrupt it, not just repeat it.
    sleep 0.2
    [[ -f "$LOCAL_LOCK_DIR/pid" ]] && _lock_pid="$(cat "$LOCAL_LOCK_DIR/pid" 2>/dev/null)"
  fi
  if [[ -n "$_lock_pid" ]] && kill -0 "$_lock_pid" 2>/dev/null; then
    log "another nightly-server-refresh-cron.sh invocation (pid $_lock_pid) already holds $LOCAL_LOCK_DIR — exiting without alerting (expected overlap, not a failure)."
    exit 0
  fi
  log "found a stale lock at $LOCAL_LOCK_DIR (pid '$_lock_pid' not running) — reclaiming it"
  # Atomic reclaim, not "rm -rf then mkdir": that pair is two separate,
  # unprotected steps, so two concurrent reclaimers can both pass the
  # staleness check and both `rm -rf`+`mkdir` — one can delete the lock
  # directory the OTHER just freshly (re)created, defeating the mutex in
  # exactly the recovery case it exists to handle (caught by review, not
  # found independently — real bug in the original version of this block).
  # `mv "$LOCAL_LOCK_DIR" <unique-name>` closes it: POSIX rename() on the
  # SOURCE path is atomic, so only ONE concurrent reclaimer's `mv` can ever
  # succeed (it removes the source); every other reclaimer's `mv` of the
  # same now-gone source fails and backs off instead of touching anything.
  # This is deliberately NOT `mv <candidate> "$LOCAL_LOCK_DIR"` (moving
  # something ONTO an existing target) — verified empirically on this
  # machine that when the target already exists as a non-empty directory,
  # `mv` (with or without -n) nests the source INSIDE it instead of
  # replacing it, which would silently fail to claim the lock at all.
  _stale_stage="${LOCAL_LOCK_DIR}.stale.$$"
  if ! mv "$LOCAL_LOCK_DIR" "$_stale_stage" 2>/dev/null; then
    log "lost the race to reclaim a stale lock to another invocation — exiting without alerting (expected overlap, not a failure)."
    exit 0
  fi
  rm -rf "$_stale_stage"
  if ! mkdir "$LOCAL_LOCK_DIR" 2>/dev/null; then
    log "lost the race to recreate $LOCAL_LOCK_DIR to another invocation right after reclaiming it — exiting without alerting (expected overlap, not a failure)."
    exit 0
  fi
fi
echo "$$" > "$LOCAL_LOCK_DIR/pid"
trap 'rm -rf "$LOCAL_LOCK_DIR"' EXIT
# Residual, narrower race NOT fully closed (documented rather than silently
# claimed fixed): a process arriving in the window between a WINNING
# `mkdir` (this one, fresh acquisition OR post-reclaim) and the `echo "$$"
# > pid` line above would see the lock dir exist with no pid file yet — the
# double-read above turns an instant misclassification into one that
# requires the winner to be wedged for a whole 0.2s sleep, but does not
# make the window provably zero. The consequence if it ever fires is NOT
# just redundant work: `git checkout`/`bun install`/`npm ci` from two
# invocations racing on the SAME shared mirror checkout can corrupt it
# (a torn checkout or a half-written node_modules), not merely repeat
# harmlessly — this is a real, if very low-probability (single dev
# machine, at most ~2 realistic contenders, once-nightly cadence), risk to
# the local mirror specifically. The remote server's own separate lock is
# unaffected either way — that's what actually protects the server from a
# corrupted local build ever reaching it. Tracked as a possible follow-up
# (a fully atomic combined create+populate primitive), not blocking.

log "=== nightly-server-refresh-cron starting (HYPERIDE_CHECKOUT=$HYPERIDE_CHECKOUT) ==="

if [[ ! -d "$HYPERIDE_CHECKOUT" ]]; then
  log "$HYPERIDE_CHECKOUT does not exist yet — cloning $HYPERIDE_ORIGIN (first run)"
  if ! git clone "$HYPERIDE_ORIGIN" "$HYPERIDE_CHECKOUT" >>"$LOG_FILE" 2>&1; then
    fail "git clone $HYPERIDE_ORIGIN into $HYPERIDE_CHECKOUT failed — see $LOG_FILE"
  fi
elif [[ ! -d "$HYPERIDE_CHECKOUT/.git" ]]; then
  fail "HYPERIDE_CHECKOUT=$HYPERIDE_CHECKOUT exists but is not a git checkout (no .git dir) — refusing to touch it"
fi

_status_output="$(git -C "$HYPERIDE_CHECKOUT" status --porcelain 2>&1)"
_status_rc=$?
if [[ "$_status_rc" -ne 0 ]]; then
  fail "git status failed in $HYPERIDE_CHECKOUT (exit $_status_rc): $_status_output"
elif [[ -n "$_status_output" ]]; then
  fail "$HYPERIDE_CHECKOUT has uncommitted changes — this is a dedicated mirror nothing else should touch, so this is unexpected. Investigate before re-running (or delete it to force a fresh clone)."
fi

if ! git -C "$HYPERIDE_CHECKOUT" fetch origin main >>"$LOG_FILE" 2>&1; then
  fail "git fetch origin main failed in $HYPERIDE_CHECKOUT — see $LOG_FILE"
fi

if ! git -C "$HYPERIDE_CHECKOUT" checkout main >>"$LOG_FILE" 2>&1; then
  fail "git checkout main failed in $HYPERIDE_CHECKOUT — see $LOG_FILE"
fi

if ! git -C "$HYPERIDE_CHECKOUT" merge --ff-only origin/main >>"$LOG_FILE" 2>&1; then
  fail "git merge --ff-only origin/main failed in $HYPERIDE_CHECKOUT (diverged?) — see $LOG_FILE"
fi

log "checked out fresh main: $(git -C "$HYPERIDE_CHECKOUT" rev-parse --short HEAD)"

# Root deps first: the extension's esbuild imports repo-relative code from
# client/ and shared/ (e.g. zustand, the babel packages used by
# shared/i18n-text) that lives in the MONOREPO ROOT's node_modules, not the
# extension subdirectory's own. Verified empirically — building the
# extension against a fresh clone with only its own `npm ci` fails with
# "Could not resolve zustand/middleware" / "@babel/*" until `bun install`
# has run at the repo root. Root uses bun (bun.lock); the extension
# subdirectory itself stays npm-only per AGENTS.md's hard rule (`bun
# install`/`bun test` there breaks `vsce package` and mis-resolves the
# `vscode` external) — this only runs bun at the ROOT, npm stays confined to
# vscode-extension/hypercanvas-preview below.
log "installing root deps in $HYPERIDE_CHECKOUT (bun install)"
if ! (cd "$HYPERIDE_CHECKOUT" && bun install >>"$LOG_FILE" 2>&1); then
  fail "bun install failed at $HYPERIDE_CHECKOUT root — see $LOG_FILE"
fi

EXT_DIR="$HYPERIDE_CHECKOUT/vscode-extension/hypercanvas-preview"
log "building extension in $EXT_DIR (npm ci && npm run build)"
if ! (cd "$EXT_DIR" && npm ci >>"$LOG_FILE" 2>&1); then
  fail "npm ci failed in $EXT_DIR — see $LOG_FILE"
fi
if ! (cd "$EXT_DIR" && npm run build >>"$LOG_FILE" 2>&1); then
  fail "npm run build failed in $EXT_DIR — see $LOG_FILE"
fi
if [[ ! -f "$EXT_DIR/out/extension.js" ]]; then
  fail "$EXT_DIR/out/extension.js missing after build — build reported success but produced no output"
fi

REMOTE_SCRIPT="$HYPERIDE_CHECKOUT/e2e/scripts/remote-matrix-run.sh"
if [[ ! -x "$REMOTE_SCRIPT" ]]; then
  fail "$REMOTE_SCRIPT missing or not executable after refresh"
fi

HYPER_E2E_EXTENSION_REPO="$HYPERIDE_CHECKOUT" SYNC_ONLY=1 \
  bash "$REMOTE_SCRIPT" >>"$LOG_FILE" 2>&1
sync_rc=$?

if [[ "$sync_rc" -eq 0 ]]; then
  log "=== nightly-server-refresh-cron: sync OK ==="
elif [[ "$sync_rc" -eq 75 ]]; then
  # EXIT_LOCK_BUSY from remote-matrix-run.sh — a matrix run is still in
  # flight on the server (normal under HYP-1299 long-run conditions). Not
  # a failure: log it plainly, don't page over an expected skip.
  log "=== nightly-server-refresh-cron: sync skipped — nightly matrix run still in flight on the server (expected, not alerting) ==="
else
  fail "remote-matrix-run.sh (SYNC_ONLY) failed (exit $sync_rc) — see $LOG_FILE"
fi
