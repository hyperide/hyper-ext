#!/usr/bin/env bash
# Run e2e matrix on remote k3s server via SSH
# Usage: REMOTE_USER=root REMOTE_HOST=77.42.45.86 ./remote-matrix-run.sh [args]
#
# Prerequisites on the remote server (one-time setup):
#   1. Docker installed: apt-get install -y docker.io && systemctl enable --now docker
#   2. ext-test-projects populated at ~/work/ext-test-projects. The harness repo was renamed
#      hyperide/ext-test-projects -> hyperide/hyper-ext-e2e; keep the LOCAL directory named
#      ext-test-projects regardless (this script and every path in AGENTS.md's "Remote E2E
#      Server" section assume that name). As of 2026-08 the server has no GitHub credentials
#      at all, so `git clone` from the server itself does not work — populate this directory
#      by rsyncing it from a git-capable machine instead, e.g.:
#        rsync -az --delete /local/checkout/of/hyper-ext-e2e/ root@<host>:~/work/ext-test-projects/
#      See AGENTS.md's "Remote E2E Server" > "Known live gaps" for current details.
#   3. hypercanvas-e2e Docker image available (will be built on first matrix run)
#
# Notes:
#   - SSH user is root (ultra user key not authorized on 77.42.45.86)
#   - Server has k3s/containerd but no standalone Docker daemon yet
#   - After Docker install, the hypercanvas-e2e image must be pulled or built
#
# HYP-1301: REMOTE_EXTENSION_DIR defaults to $REMOTE_WORK/hyperide — the SAME
# directory the server's own crontab passes as HYPER_E2E_EXTENSION_REPO to
# matrix-run.sh (`crontab -l` on the server: `HYPER_E2E_EXTENSION_REPO=/root/work/hyperide`).
# Before this fix, this script defaulted to syncing into $REMOTE_WORK/hypercanvas-preview
# instead — a DIFFERENT directory the nightly cron never reads — so a manual
# "refresh the server" run would appear to succeed but have zero effect on
# the next automatic 02:00 trigger. Only override REMOTE_EXTENSION_DIR if you
# deliberately want an isolated/throwaway sync the cron will never see.
#
# SYNC_ONLY=1 skips the final "run the matrix now" SSH call — use this when
# the goal is just to push fresh code ahead of the nightly cron, not to kick
# off a manual run (see e2e/scripts/nightly-server-refresh-cron.sh, HYP-1303).
#
# HYPER_E2E_EXTENSION_REPO must already have the extension BUILT
# (vscode-extension/hypercanvas-preview/out/extension.js present) — that
# path is gitignored, so a fresh clone alone is not enough; run `npm ci &&
# npm run build` in vscode-extension/hypercanvas-preview first (never `bun`
# there — see AGENTS.md).
set -euo pipefail

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-77.42.45.86}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_WORK="${REMOTE_WORK:-/root/work}"
REMOTE_EXTENSION_DIR="${REMOTE_EXTENSION_DIR:-$REMOTE_WORK/hyperide}"
FORCE_REFRESH="${FORCE_REFRESH:-0}"
REMOTE_LOCK="/tmp/hyperide-e2e.lock"

# A blackholed/unreachable host (network dead, host down without an ICMP
# reset) would otherwise hang ssh — and rsync's remote-shell transport —
# indefinitely with no timeout. That matters more here than in an
# interactive session: this script runs unattended from a cron job with a
# tight pre-02:00 window, and an indefinitely hung invocation would keep
# whatever local lock (see nightly-server-refresh-cron.sh) or exit path is
# waiting on it stuck too. BatchMode=yes additionally refuses any
# interactive prompt (password, unknown host key) rather than hanging on
# stdin that a cron job will never supply.
SSH_OPTS=(-o ConnectTimeout=10 -o BatchMode=yes)

# Dedicated exit code for "the nightly's own lock is held" — distinct from a
# genuine failure, so a caller (nightly-server-refresh-cron.sh) can treat an
# expected skip differently from something worth paging over. With runs
# documented to take 30+ hours (HYP-1299), lock-busy is a NORMAL condition
# a pre-nightly refresh will hit routinely, not an error.
EXIT_LOCK_BUSY=75

echo "Running e2e matrix on $REMOTE_USER@$REMOTE_HOST..."

# SYNC_ONLY=1 with no HYPER_E2E_EXTENSION_REPO set would fall through to the
# `if [[ -n ... ]]` guard below doing NOTHING, then hit the SYNC_ONLY exit-0
# below — i.e. it "succeeds" having synced nothing. That is the exact
# HYP-1301 failure class (a refresh that looks fine and changes nothing).
# Fail loudly instead.
if [[ "${SYNC_ONLY:-0}" = "1" && -z "${HYPER_E2E_EXTENSION_REPO:-}" ]]; then
  echo "ERROR: SYNC_ONLY=1 requires HYPER_E2E_EXTENSION_REPO to be set —" \
       "otherwise this call does not sync anything and still exits 0." >&2
  exit 1
fi

# Sync latest extension build to server if HYPER_E2E_EXTENSION_REPO is set locally
if [[ -n "${HYPER_E2E_EXTENSION_REPO:-}" ]]; then
  echo "Syncing extension to server ($REMOTE_EXTENSION_DIR)..."

  # Refuse to rsync an unbuilt checkout. out/extension.js is gitignored, so
  # a fresh clone/mirror alone never has it — and this rsync runs with
  # --delete, so shipping an unbuilt tree doesn't just "fail to update", it
  # WIPES the server's currently-working extension. This is strictly worse
  # than the stale-code bug this script exists to fix, so it's enforced
  # here (not just documented in the header) — the caller is not trusted to
  # have checked it.
  _ext_built="$HYPER_E2E_EXTENSION_REPO/vscode-extension/hypercanvas-preview/out/extension.js"
  if [[ ! -f "$_ext_built" ]]; then
    echo "ERROR: $_ext_built not found — refusing to rsync an unbuilt" \
         "checkout (with --delete this would WIPE the server's working" \
         "extension). Run 'npm ci && npm run build' in" \
         "vscode-extension/hypercanvas-preview first." >&2
    exit 1
  fi

  # HYP-1301/HYP-1299: a nightly matrix run can be mid-flight for 30+ hours
  # under $REMOTE_LOCK (see AGENTS.md "Remote E2E Server"). Rsyncing --delete
  # over REMOTE_EXTENSION_DIR while a run is reading from it corrupts that
  # run's inputs instead of just refreshing the NEXT one.
  #
  # Two layers, not one — a bare check-then-rsync has a race (the nightly's
  # 02:00 trigger can acquire the lock in the gap between this check and the
  # rsync actually starting, which matters here BECAUSE this is designed to
  # run shortly before that trigger):
  #   1. Fast pre-flight check (below) for a quick, friendly refusal in the
  #      common case — does not by itself hold the lock during the rsync.
  #   2. The rsync's OWN remote process is wrapped in `flock -n` via
  #      --rsync-path (unless FORCE_REFRESH=1, see below), so the lock is
  #      actually held for the rsync's full duration on the remote side,
  #      closing the race the pre-flight check alone cannot.
  #
  # The pre-flight check runs the probe over SSH, so its exit code conflates
  # two very different things unless read carefully: ssh itself reserves
  # exit 255 for a connection-level failure (unreachable host, bad key,
  # sshd down) — the remote command never ran at all. `flock -n ... -c true`
  # exits 1 specifically when it could NOT acquire the lock (busy) and 0
  # when it could. Only the flock-busy case (ssh exit 1) is the normal,
  # expected, non-alerting condition; anything else (255, or any other
  # unexpected code) is a real failure and must NOT be silently mapped to
  # the same "busy, skip" outcome — that was the bug: an unreachable server
  # looked identical to a busy one, so a real outage produced a log line
  # saying "expected skip" forever instead of ever alerting.
  # `if CMD; then ...; else _lock_probe_rc=$?; fi` — NOT a bare `CMD; rc=$?` —
  # because the script runs under `set -e`: a bare non-zero-exit statement
  # would abort the script right there, before the next line could ever
  # capture $?. Wrapping the probe in the `if` condition is what keeps
  # `set -e` from firing on it.
  if ssh -i "$SSH_KEY" "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" \
       "flock -n $REMOTE_LOCK -c true" >/dev/null 2>&1; then
    _lock_probe_rc=0
  else
    _lock_probe_rc=$?
  fi
  if [[ "$_lock_probe_rc" -eq 0 ]]; then
    echo "Lock check OK — no matrix run currently in flight on $REMOTE_HOST."
  elif [[ "$_lock_probe_rc" -eq 1 ]]; then
    echo "ERROR: a nightly matrix run appears to be in flight on $REMOTE_HOST" \
         "($REMOTE_LOCK is held). Refusing to rsync over" \
         "$REMOTE_EXTENSION_DIR — this would corrupt the live run's inputs." \
         "Re-run after it finishes, or set FORCE_REFRESH=1 to override." >&2
    if [[ "$FORCE_REFRESH" != "1" ]]; then
      exit "$EXIT_LOCK_BUSY"
    fi
    echo "FORCE_REFRESH=1 set — proceeding despite the held lock." >&2
  else
    echo "ERROR: could not determine remote lock state on $REMOTE_HOST" \
         "(ssh exited $_lock_probe_rc, not the flock-busy 1) — this is NOT" \
         "a normal lock-busy skip, it means the SSH connection or the" \
         "remote command itself failed (unreachable host, bad key, sshd" \
         "down, flock missing on the remote). Treating as a real failure." >&2
    exit 1
  fi

  # Excludes: this is a full hyperide checkout, not a curated export — never
  # ship .git history (huge, and the point of this rsync is a non-git
  # snapshot the server already expects), node_modules (macOS-native
  # binaries onto a Linux box), or .claude/ (this repo's own worktrees/agent
  # state — dozens of them can exist locally, none of it belongs on the
  # server). Deliberately does NOT exclude vscode-extension/*/out/ — that
  # build output is gitignored but is the ONE thing matrix-run.sh actually
  # reads (see the header comment above); a naive ".gitignore-based" exclude
  # list would ship a refresh that "succeeds" and changes nothing, the exact
  # HYP-1301 failure class this script exists to fix.
  #
  # The rest of this list is NOT guesswork — it was built by directly
  # inspecting `ls -la /root/work/hyperide` on the live server (2026-08-20).
  # Before this fix, --delete landed in the inert `hypercanvas-preview`
  # directory the nightly cron never read, so it never mattered what was in
  # there. This is the FIRST version of this script where --delete targets
  # the directory matrix-run.sh actually runs against — and that directory
  # has real, non-git, non-regenerable state sitting in it: a 3.2KB `.env`
  # (server config/secrets, not tracked in git, would not exist in a fresh
  # clone's source tree, so --delete would remove it outright),
  # `cloned-projects/` (very likely live e2e fixture data the matrix run
  # itself creates/uses), `agent-scratch/`, `.hyperide/`, `.cache/`, `dist/`,
  # `data/`, and two sqlite db files. None of these come from git, so a
  # fresh mirror clone never has them either — every one of them would be
  # silently wiped on the very first real sync without these excludes. This
  # is a known-current inventory, not an exhaustive contract — if the server
  # grows a new top-level non-git directory it needs, add it here too (or
  # switch to a git-ls-files-based include-list, tracked as a follow-up so
  # this class of gap can't recur by omission — see
  # https://linear.app/glide-vc/issue/HYP-1305).
  #
  # The 9 server-state excludes below are anchored with a leading `/` —
  # every one of them was observed only at the TOP LEVEL of
  # /root/work/hyperide, and an unanchored rsync exclude pattern matches at
  # ANY depth. Without the anchor, a legitimately git-tracked directory or
  # file sharing one of these names anywhere else in the monorepo (a nested
  # `dist/` build output from some package, a nested `data/` fixtures
  # directory, etc.) would silently stop syncing to the server too — a
  # fresh staleness class this exclude list would otherwise introduce. The
  # 4 pre-existing excludes above (.git/, node_modules/, .claude/,
  # .DS_Store) are deliberately left unanchored — those legitimately need
  # excluding at every depth (nested node_modules/ per JS package, a
  # .DS_Store per directory).
  RSYNC_EXCLUDES=(
    --exclude=.git/
    --exclude=node_modules/
    --exclude=.claude/
    --exclude=.DS_Store
    --exclude=/.env
    --exclude=/.hyperide/
    --exclude=/.cache/
    --exclude=/dist/
    --exclude=/data/
    --exclude=/cloned-projects/
    --exclude=/agent-scratch/
    --exclude=/database.sqlite
    --exclude=/hyper-canvas.db
  )

  # FORCE_REFRESH=1 means "override the busy-lock refusal above and proceed
  # anyway" — that promise is broken if the rsync's own --rsync-path still
  # wraps the remote side in the SAME flock, since the wrapped rsync command
  # would then just fail to start for the same reason the pre-flight check
  # did. Only apply the flock wrapper when NOT force-refreshing, so
  # FORCE_REFRESH actually does what its name says.
  if [[ "$FORCE_REFRESH" = "1" ]]; then
    _rsync_path="rsync"
  else
    _rsync_path="flock -n $REMOTE_LOCK rsync"
  fi

  # The pre-flight probe above only closes the COMMON case. The rsync's own
  # --rsync-path flock wrapper closes the RACE case (nightly grabs the lock
  # in the gap between the probe and rsync actually starting) — but when
  # that race fires, the remote `flock -n ... rsync` never starts and the
  # LOCAL rsync just fails with its own generic transfer-error exit code,
  # which is indistinguishable from a real rsync failure to a caller that
  # only special-cases $EXIT_LOCK_BUSY. Re-probing the lock on any rsync
  # failure and mapping "still busy" onto the same 75 tells the caller this
  # was the expected race, not a genuine failure — the whole point of
  # $EXIT_LOCK_BUSY existing.
  # Same `if CMD; then rc=0; else rc=$?; fi` shape as the lock probe above,
  # for the same reason — but there's a SECOND, sharper trap here: `if !
  # CMD; then _rc=$?; ...` looks equivalent but is NOT. `! CMD` is itself a
  # pipeline whose exit status is the LOGICAL NEGATION of CMD's status (0 if
  # CMD failed, 1 if it succeeded) — so `$?` right after would capture that
  # negated 0/1, not rsync's real exit code. Caught empirically: a mocked
  # rsync exiting 12 produced `_rsync_rc=0` under the `if !` form, and the
  # "real failure, not the race" branch below then exited 0 instead of
  # propagating the failure. Do not reintroduce `if !`.
  if rsync -az --delete "${RSYNC_EXCLUDES[@]}" \
       -e "ssh -i $SSH_KEY -o ConnectTimeout=10 -o BatchMode=yes" \
       --rsync-path="$_rsync_path" \
       "$HYPER_E2E_EXTENSION_REPO/" \
       "$REMOTE_USER@$REMOTE_HOST:$REMOTE_EXTENSION_DIR/"; then
    _rsync_rc=0
  else
    _rsync_rc=$?
  fi
  if [[ "$_rsync_rc" -ne 0 ]]; then
    if [[ "$FORCE_REFRESH" != "1" ]]; then
      # Same three-way 0/1/other disambiguation as the FIRST probe above —
      # NOT "probe failed for any reason = busy". A probe failure here can
      # mean the lock is genuinely free (rc 0, rsync's failure was a real
      # error) OR busy (rc 1, the race) OR the connection/host itself is
      # down (rc 255 or anything else) — and that last case is exactly what
      # rsync's own failure would ALSO look like if the network dropped
      # mid-transfer. Collapsing "probe didn't return 0" onto "busy, expected
      # skip" would misclassify a real outage as a routine, non-alerting
      # skip — the same bug the first probe's fix exists to prevent, just
      # reachable from a different entry point.
      if ssh -i "$SSH_KEY" "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" \
           "flock -n $REMOTE_LOCK -c true" >/dev/null 2>&1; then
        _reprobe_rc=0
      else
        _reprobe_rc=$?
      fi
      if [[ "$_reprobe_rc" -eq 1 ]]; then
        echo "ERROR: rsync failed (exit $_rsync_rc) and the remote lock is" \
             "now held — this is the race the two-layer lock check exists" \
             "for: the nightly trigger grabbed $REMOTE_LOCK between the" \
             "pre-flight check and this rsync starting. Treating as the" \
             "same expected, non-alerting skip as the common case." >&2
        exit "$EXIT_LOCK_BUSY"
      fi
    fi
    echo "ERROR: rsync to $REMOTE_HOST failed (exit $_rsync_rc)." >&2
    exit "$_rsync_rc"
  fi
fi

if [[ "${SYNC_ONLY:-0}" = "1" ]]; then
  echo "SYNC_ONLY=1 — skipping remote matrix run (sync-only mode)."
  exit 0
fi

# Run matrix on server. REMOTE_WORK/REMOTE_EXTENSION_DIR and any forwarded
# args ($*) are shell-escaped with printf %q before going into the remote
# command string — they're config values / caller-supplied flags, not
# attacker input, but escaping them properly means a space or shell
# metacharacter in a misconfigured override breaks loudly (a syntax error)
# instead of silently doing the wrong thing or, worse, executing as root on
# the server. (Forwarded args were unescaped before this fix — pre-existing,
# not introduced by HYP-1301/1303, but fixed here alongside the two
# variables right next to it rather than left as a visible inconsistency.)
_remote_work_q=$(printf '%q' "$REMOTE_WORK")
_remote_ext_dir_q=$(printf '%q' "$REMOTE_EXTENSION_DIR")
# `printf '%q ' "$@"` with ZERO args is NOT a no-op — bash's printf still
# applies the format once with no operand, so it emits a quoted empty
# string (`''` plus the trailing space), which would append a spurious
# empty positional argument to matrix-run.sh on the most common,
# no-extra-args invocation. Verified empirically (`set --; printf '%q '
# "$@" | od -c` -> `'   '`, 3 bytes). Only build the arg string when there
# actually are args to forward.
_remote_args_q=""
if [[ $# -gt 0 ]]; then
  _remote_args_q=$(printf '%q ' "$@")
fi
ssh -i "$SSH_KEY" "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" \
  "cd $_remote_work_q/ext-test-projects && HYPER_E2E_RUNTIME=docker HYPER_E2E_EXTENSION_REPO=$_remote_ext_dir_q bash e2e/scripts/matrix-run.sh $_remote_args_q"
