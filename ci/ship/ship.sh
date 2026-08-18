#!/usr/bin/env bash
# ci/ship/ship.sh — repo-local override target for the ship_delegator
# (`.claude/scripts/pr-ship.sh`). That script checks `<repo>/ci/ship/ship.sh`
# FIRST, ahead of `$AGENT_TOOLS_ROOT/ci/ship/ship.sh` — see its own header
# ("Repo-local ci/ship/ship.sh wins (agent-tools self-hosts)"). Its intended
# use is agent-tools bootstrapping itself; we reuse the same documented
# extension point for a narrower reason (HYP-1252): to export
# SHIP_IMAGE_UPLOAD_CMD before delegating, so `gh ship <PR#> --screenshot
# <path> "<desc>"` actually uploads and embeds an image instead of silently
# falling back to a local-path note (SHIP_IMAGE_UPLOAD_CMD is a pure env-var
# knob in agent-tools' ship.sh — it is NOT one of the two keys `.ship-config`
# recognizes, and rig.yaml's schema has no env-var section, so there is no
# committed-config place to set it; this file is the only repo-committed hook
# ahead of the gate).
#
# Deliberately NOT edited: pr-ship.sh itself, which is provisioned by rig
# (`ship_delegator`) and documented as portable/"a repo may commit it
# verbatim" — `rig apply` may regenerate it, so repo-specific logic does not
# belong there. This file is not rig-managed and is safe to keep customized.
#
# Delegation logic below mirrors pr-ship.sh's own AGENT_TOOLS_ROOT resolution
# (env var, else the machine-level ~/.config/agent-tools/env pointer written
# by `rig apply`) since choosing this repo-local path means pr-ship.sh's own
# resolution never runs.
set -euo pipefail

# Resolves a path through every symlink along it, including a symlink on the final
# (file) component — `cd "$(dirname p)" && pwd -P` alone only canonicalizes the
# DIRECTORY part and leaves a symlinked final component unresolved. No `readlink -f`
# (GNU-only, not on stock macOS) / no python3 dependency: a plain loop over POSIX
# `readlink` is portable to both platforms agent-tools targets. Hop-capped (40, matching
# Linux's own MAXSYMLINKS) so a symlink CYCLE (a -> b -> a) fails fast instead of hanging
# `gh ship` forever — this function is called unconditionally on both $self and
# $canonical, so a bad symlink anywhere on either path must not be able to wedge a merge.
_realpath() {
  local p="$1" target hops=0
  while [[ -L "$p" ]]; do
    hops=$((hops + 1))
    if [[ "$hops" -gt 40 ]]; then
      echo "ci/ship/ship.sh: _realpath: symlink cycle resolving '$1' (>40 hops) — refusing to loop forever." >&2
      return 1
    fi
    target="$(readlink "$p")"
    case "$target" in
      /*) p="$target" ;;
      *) p="$(dirname "$p")/$target" ;;
    esac
  done
  # A failed `cd` (dirname($p) doesn't exist) must not silently yield a garbage path like
  # "/basename" — this function feeds the self-exec-guard comparison, where a wrong-but-
  # non-empty answer is a wrong DECISION, not a visible error. `set -e` does not catch a
  # failing command substitution used as a printf argument, so check explicitly.
  local dir
  dir="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s\n' "$dir" "$(basename "$p")"
}

self="$(_realpath "${BASH_SOURCE[0]}")"
# self = <repo>/ci/ship/ship.sh, so its own repo root is two directories UP from
# dirname(self) (ci/ship -> ci -> <repo>) — three dirname hops from $self itself.
self_repo_root="$(dirname "$(dirname "$(dirname "$self")")")"

# Resolved relative to THIS script's own location ($self), not `git rev-parse
# --show-toplevel` / the caller's cwd. cwd-independent. A cwd-based resolution silently
# produces an EMPTY $uploader (skipping both the export below AND the warning) whenever
# gh ship is invoked from outside a git repo, or from a different repo than the one this
# file lives in — reproducing the exact silent local-path-note fallback HYP-1252 exists
# to close, just one layer up.
#
# Points directly at gh-attach-image.sh --url-only rather than a separate wrapper script:
# an earlier version added a wrapper here that re-parsed gh-attach-image.sh's markdown
# output back into a bare URL for ship.sh's "print a bare URL" uploader contract — that
# round-trip (format out, then parse back) was itself a source of extraction bugs across
# several review rounds. gh-attach-image.sh's `--url-only` flag (HYP-1252) prints the bare
# URL directly, so no downstream parsing is needed at all.
uploader="$self_repo_root/.claude/scripts/gh-attach-image.sh"
# The HYP-1252-P1 refuse-before-delegation scan below lives entirely inside this branch, by
# design (see the "does not override a caller-set SHIP_IMAGE_UPLOAD_CMD" test) — a caller
# that presets a REAL custom upload command (including a genuine, deliberate `false` — this
# repo's own AGENTS.md documents plain `false` as *this script's* internal fail-closed value,
# not a caller-facing API, but a caller is still free to set it) skips this file's uploader
# check AND its P1 refusal scan on purpose ("an explicit override wins" is an existing,
# intentional boundary).
#
# A DISTINCT sentinel (not bare `false`) is treated as UNSET here (not just empty) — this
# exact sentinel string is what THIS SCRIPT itself exports on the broken-uploader/
# no-screenshot path below, `exec`'d into canonical's process tree. Without this, any
# downstream re-invocation of this same wrapper that inherits that exported sentinel (a
# nested ship, a retry) would skip both the uploader check and the P1 refusal scan and
# silently delegate with the poisoned value — self-inflicting the exact regression this scan
# exists to close, one level down (review finding, PR #724). Deliberately NOT matching on
# bare `false` for this: that would silently reinterpret a caller's genuine, deliberate
# `SHIP_IMAGE_UPLOAD_CMD=false` override too (a second review finding on the same PR) — the
# sentinel is functionally still `false` when `eval`'d — a single-quoted ARGUMENT, not a
# trailing `#` comment (`false` ignores every argument it's given, same exit 1 either way) —
# so this stays composition-safe even if canonical's eval ever appends more text on the same
# line (a `#` comment would silently swallow anything appended after it; an argument does
# not). The message is a string no real caller would type, so only OUR OWN prior export
# round-trips through this check.
_ship_self_fail_sentinel="false 'ci/ship/ship.sh: uploader unavailable (HYP-1252-P1)'"
if [[ -z "${SHIP_IMAGE_UPLOAD_CMD:-}" || "${SHIP_IMAGE_UPLOAD_CMD:-}" == "$_ship_self_fail_sentinel" ]]; then
  if [[ -x "$uploader" ]]; then
    # {FILE} is quoted so ship.sh's `${SHIP_IMAGE_UPLOAD_CMD//\{FILE\}/$png}` substitution
    # (then `eval`) survives a $png containing SPACES. This is only a partial defense, not
    # full injection-proofing: the substituted text still reaches `eval` raw, so a $png
    # containing `"`, `$(...)`, or a backtick still breaks out of these quotes / gets
    # expanded by the eval — this quoting cannot close that class, only bash-level argv
    # construction (or fixing upstream to not use eval) can. Tracked upstream as HYP-1260;
    # low real-world severity today because $png is normally a trusted local screenshot path,
    # not attacker input, but do not read this line as "safe against arbitrary paths".
    #
    # `\${GH_REPO:-}` is embedded LITERALLY (escaped `$`) — it is NOT expanded here, because
    # $GH_REPO does not exist yet at THIS point: canonical ship.sh's own `--repo`/GH_REPO
    # handling runs later, well after this shim has already exec'd into it. The literal
    # `${GH_REPO:-}` text survives into the exported string and is expanded by canonical's
    # OWN `eval` at actual upload time — by then, if `gh ship --repo owner/other` was used,
    # GH_REPO is already exported and this correctly targets the right repo; if not, it
    # expands to an empty string and gh-attach-image.sh's `--repo ""` is treated as "no
    # override" (falls back to the pre-HYP-1252 bare `gh repo view` behavior). Deliberately
    # NOT reading $GH_REPO directly inside gh-attach-image.sh (an earlier version did): that
    # made ANY caller with an ambient GH_REPO exported for unrelated `gh` usage silently
    # retarget uploads, or hard-fail on a host-qualified value it never asked to honor
    # (review finding) — an explicit --repo flag scopes the override to callers that ask for it.
    export SHIP_IMAGE_UPLOAD_CMD="\"$uploader\" --repo \"\${GH_REPO:-}\" --url-only \"{FILE}\""
  else
    # Uploader missing/non-executable.
    #
    # HYP-1252-P1 (Codex review, PR #724): the previous version of this branch exported a
    # reliably-FAILING command (`false`) and delegated anyway, on the assumption that
    # upstream's own screenshot gate "correctly refuses" a UI-touching merge whenever the
    # upload fails. That assumption is FALSE for the canonical behavior this repo's own tests
    # pin: `.claude/scripts/pr-ship.test.sh` (T33, "upload failure -> visible note in PR
    # comment, merge proceeds") documents that canonical treats "a screenshot PATH was
    # supplied" as satisfying the gate even when the upload itself fails — it posts a path
    # note and ships anyway ("Gate is satisfied because --screenshot was supplied — the gap
    # is surfaced, not silent"). So delegating with a poisoned SHIP_IMAGE_UPLOAD_CMD does NOT
    # fail closed: a UI-touching PR with a real local screenshot silently ships WITHOUT an
    # embedded image whenever this uploader happens to be broken — exactly the silent
    # regression HYP-1252 exists to close, just moved one layer down.
    #
    # Fix: REFUSE here, before delegating, whenever --screenshot/--shot is actually in play —
    # do not rely on canonical's gate to catch it (it doesn't). This does reintroduce the
    # argv scan an earlier version deliberately avoided ("agent-tools could add a
    # --screenshot=<path> spelling or an alias at any time, silently un-matching a hand-rolled
    # scan") — accepted now because the alternative (trust the downstream gate) is proven
    # unsafe, not just theoretically fragile. Matched against both the space-separated form
    # canonical's arg parser recognizes TODAY (`--screenshot|--shot)` in agent-tools'
    # ci/ship/ship.sh) and an `=`-joined form it does not yet accept — review finding
    # (independently raised by two reviewers on PR #724's own fix): matching only the exact
    # current spelling would silently fall through to the unsafe `false`-export path below
    # the moment canonical (or a caller) adds `--screenshot=<path>`, reviving precisely the
    # gap this scan exists to close. The drift-detection block below (which already warns
    # when canonical stops referencing SHIP_IMAGE_UPLOAD_CMD/{FILE}/GH_REPO) also warns if
    # canonical's flag spelling appears to have moved on, so a future mismatch on the
    # space-separated forms is a loud warning, not a silent gap — the `=`-joined patterns
    # below are a forward-compatible hedge, not something drift-detected.
    for _ship_arg in "$@"; do
      case "$_ship_arg" in
        --screenshot | --shot | --screenshot=* | --shot=*)
          echo "ci/ship/ship.sh: REFUSING — screenshot uploader not found/executable ($uploader) and --screenshot/--shot was passed. Delegating anyway would silently ship without an embedded image: canonical's screenshot gate does NOT fail closed on a failed upload, it only requires that a screenshot PATH was supplied (HYP-1252 P1 / pr-ship.test.sh T33). Fix the uploader (check it exists and is executable) or drop --screenshot from this ship." >&2
          exit 1
          ;;
      esac
    done
    # No --screenshot/--shot (in any recognized spelling) in this invocation, so the uploader
    # is not needed — this is inert either way. Still print a diagnostic HERE (upstream's own
    # `eval "$SHIP_IMAGE_UPLOAD_CMD ..." 2>/dev/null` throws stderr away, so this is the only
    # point in the whole flow where a message is actually visible) and still export a
    # reliably-FAILING command rather than leaving SHIP_IMAGE_UPLOAD_CMD unset. This is
    # best-effort surfacing, NOT a safety net for a spelling the scan above misses — per the
    # T33 analysis this whole fix is built on, a failing upload command does not block a ship
    # here either; it only earns a visible "upload failed" note. The real backstop against a
    # missed spelling is the scan covering every spelling canonical accepts, not this export.
    echo "ci/ship/ship.sh: WARNING screenshot uploader not found/executable ($uploader) — no --screenshot/--shot in this invocation, so this is inert; exporting a reliably-failing command as best-effort surfacing." >&2
    export SHIP_IMAGE_UPLOAD_CMD="$_ship_self_fail_sentinel"
  fi
fi

env_file="${XDG_CONFIG_HOME:-${HOME:-}/.config}/agent-tools/env"
# `! -L "$env_file"` mirrors .claude/scripts/pr-ship.sh's own resolution line VERBATIM
# (checked side by side — identical condition, same env-file path) — not a divergence
# introduced here. If pr-ship.sh's check ever changes, update this line to match; do not
# "fix" it here in isolation.
if [[ -z "${AGENT_TOOLS_ROOT:-}" && ! -L "$env_file" && -f "$env_file" ]]; then
  # shellcheck source=/dev/null
  source "$env_file"
fi
canonical="${AGENT_TOOLS_ROOT:+$AGENT_TOOLS_ROOT/ci/ship/ship.sh}"
if [[ -n "$canonical" && -x "$canonical" ]]; then
  # Guard against a self-exec loop: if AGENT_TOOLS_ROOT is ever misconfigured to point at
  # THIS repo (plausible — this override slot exists because agent-tools self-hosts with
  # the identical ci/ship/ship.sh layout), `exec "$canonical"` would re-exec this same file
  # forever with no growing stack to crash it. Resolved via the same full-symlink-aware
  # _realpath as $self (not just `pwd -P` on the containing dir) so a symlinked final
  # component on either side still converges to the same real path.
  canonical_real="$(_realpath "$canonical")"
  if [[ "$canonical_real" == "$self" ]]; then
    echo "ci/ship/ship.sh: AGENT_TOOLS_ROOT resolves back to this same file ($self) — refusing to self-exec. Check AGENT_TOOLS_ROOT / $env_file." >&2
    exit 127
  fi
  # Drift detection (best-effort, non-fatal): if the canonical ship.sh no longer mentions
  # SHIP_IMAGE_UPLOAD_CMD's {FILE} substitution token, or GH_REPO (the cross-repo threading
  # this whole `--repo "${GH_REPO:-}"` design rests on — see the export above), an upstream
  # agent-tools change likely renamed/removed a hook this file exists to wire — everything
  # above (the export) would then silently stop doing anything useful, or silently stop
  # honoring --repo. A grep can't prove the CONTRACT still matches, only that the SYMBOL is
  # still there, but a symbol disappearing entirely is the cheapest, most common form of this
  # drift to catch, and free to check.
  if ! grep -q 'SHIP_IMAGE_UPLOAD_CMD' "$canonical" 2>/dev/null || ! grep -q '{FILE}' "$canonical" 2>/dev/null; then
    echo "ci/ship/ship.sh: WARNING canonical ship.sh ($canonical) no longer appears to reference SHIP_IMAGE_UPLOAD_CMD / {FILE} — the upstream hook this file wires may have changed or been removed (HYP-1252 may need re-verifying against the new contract)." >&2
  fi
  if ! grep -q 'GH_REPO' "$canonical" 2>/dev/null; then
    echo "ci/ship/ship.sh: WARNING canonical ship.sh ($canonical) no longer appears to reference GH_REPO — a --repo owner/other ship may silently upload the screenshot to the wrong repo (the embedded \${GH_REPO:-} would expand empty)." >&2
  fi
  # HYP-1252-P1: the uploader-missing branch above refuses BEFORE delegation by scanning "$@"
  # for the literal `--screenshot`/`--shot` spellings canonical currently parses. If canonical
  # stops recognizing either spelling (renamed flag, new alias), that refuse-before-delegation
  # scan silently stops matching too — warn here so the gap is visible, not silent.
  if ! grep -q -- '--screenshot' "$canonical" 2>/dev/null || ! grep -q -- '--shot' "$canonical" 2>/dev/null; then
    echo "ci/ship/ship.sh: WARNING canonical ship.sh ($canonical) no longer appears to reference --screenshot / --shot — the argv scan this file uses to refuse a ship when the uploader is unavailable (HYP-1252 P1) may no longer match canonical's actual flag spelling; re-verify." >&2
  fi
  export AGENT_TOOLS_ROOT
  exec "$canonical" "$@"
fi
echo "ci/ship/ship.sh: canonical ship.sh not found or not executable (AGENT_TOOLS_ROOT=${AGENT_TOOLS_ROOT:-<unset>}; env file $env_file)." >&2
echo "Set AGENT_TOOLS_ROOT (or write $env_file), or re-run 'rig apply'." >&2
exit 127
