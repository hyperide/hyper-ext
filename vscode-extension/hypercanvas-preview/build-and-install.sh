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

# Derives the list of webview browser-bundle file NAMES this build is
# expected to produce -- see the WEBVIEW_STATE_FILE comment below for why
# this exists and how it's used. Errors are NOT swallowed here (HYP-1414
# review round 4, Opus-caught): the earlier version piped node's stderr to
# /dev/null and hashed webview.css unconditionally in the same function, so a
# broken extractor still produced a non-empty combined hash (webview.css's
# own hash) and the "found nothing" safety net never fired.
derive_webview_js_bundle_names() {
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    import { extractBrowserOutfiles } from './scripts/lib/esbuild-browser-outfiles.mjs';
    const names = extractBrowserOutfiles(readFileSync('./esbuild.js', 'utf8'));
    if (names.length === 0) { console.error('extractBrowserOutfiles returned zero entries'); process.exit(1); }
    // Writing directly to stdout here is deliberate, not a swapped-in
    // substitute for a debug statement: this IS the function's real output
    // (the bash caller captures it via command substitution). A console
    // logging call would trip this repo's leftover-grep CI gate, which
    // blocks that pattern on sight with no per-line suppression mechanism
    // -- the direct write avoids a false-positive block on legitimate
    // program output.
    for (const f of names) process.stdout.write(f + '\n');
  "
}

# WHY THIS EXISTS: webview panels use retainContextWhenHidden:true (see the
# reload block below), so an already-open panel keeps running its OLD
# bundle/stylesheet across an extension-host restart -- only a full window
# reload re-fetches them. This hashes the webview-delivered outputs after
# the build and compares against a PERSISTED baseline (WEBVIEW_STATE_FILE
# below) to decide whether a build actually changed anything a live webview
# would notice, so the reload block can auto-upgrade to a full reload only
# when it's actually needed.
#
# KNOWN GAP (HYP-1414 review round 7, Codex-caught, tracked as HYP-1418, not
# fixed here): this only covers the emitted browser bundles and webview.css --
# it does NOT cover src/preview-html.ts, host-side TS that generates the
# webview's HTML/CSP shell at panel-creation time. A change there is
# invisible to this detector; HYP-1418 needs to confirm live whether an
# already-open panel's HTML survives a restartExtensionHost unchanged before
# deciding whether to extend detection to that file too.
#
# The JS bundle list is derived from esbuild.js itself via the SAME
# extractor scripts/check-webview-bundles.mjs already uses -- HYP-1414 review
# round 3 (Codex-caught P1): a hand-maintained file list here missed
# webview-ai-chat.js and the injected iframe-*.js scripts, so changing any of
# those left an already-open webview silently running stale code. webview.css
# is a separate Tailwind build step, not an esbuild browser context, so it's
# hashed alongside explicitly. Every file is REQUIRED to exist post-build --
# a derived bundle name whose out/$f file doesn't exist, or any hash failure,
# emits the "EXTRACTION_FAILED" sentinel (instead of a silent partial/missing
# hash) so the caller forces the safe full-reload path rather than mistaking
# extractor breakage or a missing file for "nothing changed" (HYP-1414 review
# round 6, Opus-caught). Every hash is buffered into $digest and only emitted
# once, at the very end, all-or-nothing (HYP-1414 review round 5,
# Codex-caught P2): printing each hash line as soon as it's computed meant a
# partial digest (a file replaced/removed mid-loop by a concurrent watcher)
# could still happen to differ in a way that hides exactly the changed
# bundle.
hash_webview_bundles() {
  local f names digest="" line
  if ! names="$(derive_webview_js_bundle_names)"; then
    echo "EXTRACTION_FAILED"
    return 0
  fi
  while IFS= read -r f; do
    if [[ -f "out/$f" ]]; then
      if ! line="$(shasum -a 256 "out/$f")"; then
        echo "EXTRACTION_FAILED"
        return 0
      fi
      digest+="${line}"$'\n'
    else
      echo "EXTRACTION_FAILED"
      return 0
    fi
  done <<< "$names"
  if [[ -f out/webview.css ]]; then
    if ! line="$(shasum -a 256 out/webview.css)"; then
      echo "EXTRACTION_FAILED"
      return 0
    fi
    digest+="${line}"$'\n'
  else
    echo "EXTRACTION_FAILED"
    return 0
  fi
  printf '%s' "$digest"
  return 0
}

echo "=== Installing dependencies ==="
npm install

echo "=== Packaging extension (v${VERSION}) ==="
npm run build && npx @vscode/vsce package --out "$VSIX_FILE"

# STATE FILE, keyed per TARGET WINDOW, not before/after-this-run comparison
# (HYP-1414 review round 9, Codex-caught P1, and round 10, Codex+GLM-caught
# P1): the earlier version hashed out/ at the START of this script and
# compared it to the hash AFTER this script's own build -- equivalent to
# "did THIS invocation's own build change anything", which misses out/
# having been rebuilt by something else (a background `npm run watch`, a
# prior run of this script whose reload was never confirmed) since the
# window under test last actually reloaded. Comparing against a hash
# PERSISTED at the end of the last CONFIRMED-successful reload fixes that --
# but round 9's first attempt persisted ONE state file per CHECKOUT, shared
# across every EXT_RELOAD_PROJECT_PATH target: window A gets a full reload
# and its confirmed hash persists; window B (same checkout, different
# target) is then compared against A's hash, not its own, and can silently
# get only a restartExtensionHost while still running a stale bundle -- the
# exact regression class this mechanism exists to prevent, just relocated.
# Keying the state file by (a hash of) the resolved target path ties each
# persisted baseline to the specific window it was confirmed for. No target
# (EXT_RELOAD_PROJECT_PATH unset, the print-only branch below) reads/writes
# no keyed file at all -- LAST_RELOADED_HASH stays empty, which conservatively
# reports "changed" in the printed instructions since nothing was ever
# confirmed for an unspecified target.
WEBVIEW_STATE_FILE=""
if [[ -n "${EXT_RELOAD_PROJECT_PATH:-}" ]]; then
  TARGET_KEY="$(printf '%s' "$EXT_RELOAD_PROJECT_PATH" | shasum -a 256 | cut -c1-16)"
  WEBVIEW_STATE_FILE="$SCRIPT_DIR/.webview-bundle-hash.$TARGET_KEY"
fi

WEBVIEW_HASH_AFTER="$(hash_webview_bundles)"
LAST_RELOADED_HASH=""
if [[ -n "$WEBVIEW_STATE_FILE" && -f "$WEBVIEW_STATE_FILE" ]]; then
  # `|| true`, not a bare `$(cat ...)` (review-caught P3): under
  # `set -euo pipefail`, a `cat` failure (e.g. a state file left
  # root-owned by an earlier sudo run) would otherwise abort the WHOLE
  # script right here -- after packaging, before install/reload -- instead
  # of the documented "unreadable state is treated the same as unknown"
  # fallback.
  LAST_RELOADED_HASH="$(cat "$WEBVIEW_STATE_FILE" 2>/dev/null || true)"
fi

if [[ "$WEBVIEW_HASH_AFTER" == "EXTRACTION_FAILED" ]]; then
  # esbuild.js's browser-bundle names couldn't be derived (extractor broke,
  # esbuild.js/esbuild-browser-outfiles.mjs got moved or restructured) --
  # can't safely tell "changed" from "unchanged", so fail toward the safe
  # side (full reload) instead of silently picking the light restart
  # (HYP-1414 review round 3, Opus-caught).
  echo "WARNING: could not derive the webview browser-bundle list from esbuild.js (see node's stderr above) -- cannot safely detect a webview change. Defaulting to a full reload to be safe." >&2
  WEBVIEW_CHANGED=true
elif [[ -z "$WEBVIEW_HASH_AFTER" ]]; then
  # Defense-in-depth, believed unreachable in practice: hash_webview_bundles
  # now requires every derived name (and webview.css) to exist post-build,
  # emitting EXTRACTION_FAILED (caught above) rather than skipping a missing
  # one -- so a non-empty, non-sentinel digest should be guaranteed whenever
  # the sentinel check above didn't already fire. Kept as a backstop in case
  # that invariant is ever broken by a future edit.
  echo "WARNING: webview-bundle change detection found no out/webview*.js or out/webview.css files after a successful build -- the extracted paths may not match this build's actual output directory. Defaulting to a full reload to be safe." >&2
  WEBVIEW_CHANGED=true
elif [[ -z "$LAST_RELOADED_HASH" ]]; then
  # No record of what's actually loaded in the window under test (first run
  # ever with this mechanism, or the state file was removed/never written
  # because a prior run's reload was never confirmed) -- can't claim
  # "unchanged" against an unknown baseline, so force a full reload.
  WEBVIEW_CHANGED=true
elif [[ "$LAST_RELOADED_HASH" != "$WEBVIEW_HASH_AFTER" ]]; then
  WEBVIEW_CHANGED=true
else
  WEBVIEW_CHANGED=false
fi

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

echo "=== Reloading extension host ==="
# Installing a VSIX (`code --install-extension --force`) puts EVERY open window
# on this profile into "Reload Required" state, not just the window that ran
# this script. A full `workbench.action.reloadWindow` respawns the entire
# renderer process (re-parses the workspace, re-runs indexing, reopens
# webviews) -- expensive on its own, and lethal when several concurrent agent
# sessions each rebuild+reload their own window around the same time (this is
# believed to be a contributing mechanism in the 2026-08-27/28 near-total
# memory-exhaustion incident: many concurrent full-window reloads, not one
# reload cascading to other windows). `workbench.action.restartExtensionHost`
# only respawns the much lighter extension host process, not the whole
# window, so it is the DEFAULT here -- EXCEPT it must NOT be used when the
# webview UI bundles changed (HYP-1414 review round 2, Codex-caught P1): the
# webview panels are created with `retainContextWhenHidden: true`
# (src/extension.ts, src/PreviewPanel.ts) so an already-open panel keeps
# running its OLD webview.js/webview-left.js/webview-right.js/
# webview-preview-panel.js bundle across an extension-host restart --
# restarting the host does not make an open webview re-fetch its script. Only
# a full window reload (or closing+reopening every open panel) picks up a
# changed webview bundle. This script hashes those bundle files after `npm
# run build` and compares against the hash persisted at the end of the last
# CONFIRMED-successful reload (see WEBVIEW_STATE_FILE above -- not simply
# "did this run's own build change anything", which misses out/ having been
# rebuilt by something else since the window was last actually reloaded), and
# auto-upgrades to a full reload when they differ, so this is not something
# the caller has to remember.
#
# This script does NOT know which VS Code window is actually running the
# extension under test -- that's almost never $REPO_ROOT (this hyperide repo)
# itself, it's whatever project the agent/developer is previewing in (e.g. an
# ext-test-projects fixture). Hardcoding $REPO_ROOT as the vscmd target was
# tried and reviewed as wrong (HYP-1414 review round 1, Codex-caught): when
# that path isn't already open, vscmd opens a BRAND NEW window for it and
# reloads that -- one extra renderer process, and the actual test-project
# window is left un-reloaded, running the old extension. So the caller must
# say which window to target via EXT_RELOAD_PROJECT_PATH; without it, this
# only prints the correct command to run instead of guessing a target.
if [[ "$WEBVIEW_CHANGED" == true ]]; then
  NEED_FULL_RELOAD=true
  echo "=== Webview bundle(s) changed -- a full window reload is required, not just restartExtensionHost ==="
elif [[ "${EXT_FULL_RELOAD:-}" == "1" ]]; then
  NEED_FULL_RELOAD=true
else
  NEED_FULL_RELOAD=false
fi

if [[ -n "${EXT_RELOAD_PROJECT_PATH:-}" ]] && command -v vscmd >/dev/null 2>&1; then
  # Check vscmd's own exit status (HYP-1414 review round 8, Opus-caught) --
  # it used to be swallowed and "=== Done. ===" printed unconditionally, so a
  # failed reload (vscmd error, target window not found, etc.) looked
  # identical to a successful one and left the window silently un-reloaded.
  if [[ "$NEED_FULL_RELOAD" == true ]]; then
    vscmd workbench.action.reloadWindow -p "$EXT_RELOAD_PROJECT_PATH" || {
      echo "ERROR: vscmd reloadWindow failed -- the target window was NOT reloaded, it is still running the old extension." >&2
      exit 1
    }
  else
    vscmd workbench.action.restartExtensionHost -p "$EXT_RELOAD_PROJECT_PATH" || {
      echo "ERROR: vscmd restartExtensionHost failed -- the target window was NOT reloaded, it is still running the old extension." >&2
      exit 1
    }
  fi
  # Record what the window under test is now actually running -- ONLY after
  # a CONFIRMED-successful reload (both branches above `exit 1` before
  # reaching here on failure). A full reload re-fetches everything, so it
  # always now matches WEBVIEW_HASH_AFTER; a restartExtensionHost reload was
  # only reachable here because WEBVIEW_CHANGED was already false, i.e.
  # WEBVIEW_HASH_AFTER already equalled the PRIOR persisted value -- so
  # writing it in both cases is correct and idempotent. Guard against ever
  # persisting the EXTRACTION_FAILED sentinel (reached this branch because
  # extraction failure forces NEED_FULL_RELOAD=true, not because the hash is
  # trustworthy) -- doing so would silently poison every future run's
  # baseline instead of just failing safe for this one.
  if [[ -n "$WEBVIEW_HASH_AFTER" && "$WEBVIEW_HASH_AFTER" != "EXTRACTION_FAILED" ]]; then
    # `|| true`: this write happens AFTER a confirmed-successful reload --
    # a failure here (e.g. a read-only SCRIPT_DIR) shouldn't abort the
    # script under `set -euo pipefail` at the very last step. Worst case is
    # the next run's baseline stays stale and conservatively reports
    # "changed" again, not a crash after the reload already succeeded.
    printf '%s' "$WEBVIEW_HASH_AFTER" > "$WEBVIEW_STATE_FILE" || true
  fi
  echo "=== Done. ==="
else
  if [[ "$NEED_FULL_RELOAD" == true ]]; then
    echo "=== Done. Webview bundle(s) changed -- do a FULL reload in the window under test:"
    echo "    vscmd workbench.action.reloadWindow -p <project-path>"
  else
    echo "=== Done. Reload the extension host in the window under test:"
    echo "    vscmd workbench.action.restartExtensionHost -p <project-path>"
    echo "  (only use 'workbench.action.reloadWindow' instead if this build changed"
    echo "  package.json contribution points -- commands/menus/keybindings/views)."
  fi
  echo "  Set EXT_RELOAD_PROJECT_PATH=<project-path> to have this script do it for you next time."
fi
