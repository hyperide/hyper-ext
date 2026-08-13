#!/bin/sh
# protect-main.sh — pre-push gate: block DIRECT pushes to main/master (HYP-856).
#
# WHY THIS EXISTS IN-REPO: GitHub branch protection is a paid feature on this
# private free-plan repo (the API returns 403), so the server cannot reject a
# push to main. AND this repo sets a LOCAL core.hooksPath (lefthook), which
# bypasses the machine-wide global-hooks dispatcher entirely — the global
# protect-main fragment never runs here. This committed copy, wired as a
# lefthook pre-push job, is the enforcement for THIS repo.
#
# SYNC: keep the logic in lockstep with the canonical global fragment
#   agent-tools: git-hooks/global-dispatcher/global-hooks.d/pre-push/10-protect-main
#
# Refs arrive on stdin, one line per ref: "<local-ref> <local-sha> <remote-ref> <remote-sha>"
# (lefthook forwards the hook's stdin to the job). Non-main refs and branch
# DELETIONS (local sha = all zeros) pass — this gate targets CODE pushes; deleting
# the DEFAULT branch is refused server-side on every plan (receive.denyDeleteCurrent),
# and deleting a protected NON-default branch (a master that is not the default) is
# deliberately out of scope.
#
# ESCAPE HATCH (honest + audited): legit release flows (build-and-install.sh)
# run  PUSH_MAIN_OK=1 PUSH_MAIN_REASON="why" git push …  — every use is
# APPENDED to ~/.cache/agent-tools/overrides.log, never silent.

ZEROS=0000000000000000000000000000000000000000
blocked=""
# `|| [ -n "$remote_ref" ]` — paranoia against fail-open: process a final line even if
# it somehow lacks the trailing newline (git always sends one; belt and braces).
while read -r _local_ref local_sha remote_ref _remote_sha || [ -n "$remote_ref" ]; do
  [ -n "$remote_ref" ] || continue
  case "$remote_ref" in refs/heads/main|refs/heads/master) ;; *) continue ;; esac
  case "$local_sha" in "$ZEROS"*) continue ;; esac  # deletion, not a code push
  blocked="$blocked $remote_ref"   # accumulate — a push may hit main AND master
done
blocked="${blocked# }"

[ -n "$blocked" ] || exit 0

if [ "${PUSH_MAIN_OK:-}" = "1" ]; then
  log_dir="${XDG_CACHE_HOME:-$HOME/.cache}/agent-tools"
  mkdir -p "$log_dir" 2>/dev/null || true
  repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  total=0; failed=0
  for ref in $blocked; do    # one audit line PER protected ref (refs contain no spaces)
    total=$((total + 1))
    printf '%s protect-main OVERRIDE repo=%s ref=%s reason=%s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$repo" \
      "$ref" "${PUSH_MAIN_REASON:-<none>}" >> "$log_dir/overrides.log" 2>/dev/null || failed=$((failed + 1))
  done
  if [ "$failed" -eq 0 ]; then
    echo "protect-main: PUSH_MAIN_OK=1 — allowing push to $blocked (logged to $log_dir/overrides.log)" >&2
  else
    # Never CLAIM an audit line that was not written; the push is still allowed (a
    # read-only cache must not break releases), but the miss is loud, not silent —
    # and the count stays honest when only SOME of several refs got logged.
    echo "protect-main: PUSH_MAIN_OK=1 — allowing push to $blocked" >&2
    echo "protect-main: WARNING — could NOT append to $log_dir/overrides.log; $failed of $total override line(s) are UNAUDITED." >&2
  fi
  exit 0
fi

echo "" >&2
echo "protect-main: BLOCKED — direct push to $blocked." >&2
echo "  Land it via a PR instead:" >&2
echo "    git push origin HEAD:refs/heads/<feature-branch>  &&  gh pr create  (merge: gh ship)" >&2
echo "  Legit exception (e.g. a release script)?" >&2
echo "    PUSH_MAIN_OK=1 PUSH_MAIN_REASON=\"why\" git push ..." >&2
echo "  Every override is appended to ~/.cache/agent-tools/overrides.log." >&2
exit 1
