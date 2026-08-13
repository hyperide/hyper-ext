#!/bin/sh
# secret-scan.sh — generic, CI-agnostic secret scan with gitleaks.
#
# For any CI that runs a shell step (GitLab CI, Jenkins, Buildkite, CircleCI, Drone,
# bare cron, a Makefile target). On GitHub Actions prefer ./secret-scan.yml (the pinned
# action). Secret-scanning standard = gitleaks; this is the same engine, scripted.
#
# WHAT IT DOES
#   - Installs gitleaks if missing (brew | apt download | go install), else fails clearly.
#   - BLOCK tier (default): scans the repo; a high-confidence finding => exit 1 (CI red).
#   - WARN tier (SECRET_SCAN_WARN_CONFIG set): a second pass that only prints findings
#     and never fails — for surfacing low-confidence cases without blocking the pipeline.
#
# CONFIG / EXTEND
#   - Repo-root .gitleaks.toml is auto-detected by gitleaks (add [[rules]] / [allowlist]).
#   - SECRET_SCAN_CONFIG=path        -> explicit block-tier config (overrides .gitleaks.toml,
#                                       and overrides the SCOPE=dir auto-default below).
#   - SCOPE=dir with no SECRET_SCAN_CONFIG auto-selects ./.gitleaks-dir.toml if present —
#     it extends .gitleaks.toml with a dir-mode-only build/dependency-directory allowlist
#     (see .gitleaks-dir.toml's header for why that allowlist isn't in the shared config).
#   - SECRET_SCAN_WARN_CONFIG=path   -> enable the warn pass with this config.
#   - SECRET_SCAN_SCOPE=full|staged|dir -> "full" scans all git history (gitleaks git);
#                                       "staged" scans only staged changes (local/hook reuse);
#                                       "dir" scans the working tree only (gitleaks dir .), no
#                                       history walk. Pick "dir" when this script stands in for
#                                       a CI job that itself runs `gitleaks dir .` (see the
#                                       caller's own secret-scan.yml) — "full" re-walks every
#                                       historical commit and its .gitleaksignore fingerprints
#                                       (commit:path:rule:line) go stale on every later commit
#                                       that touches the same file (a new blame commit = a new
#                                       fingerprint), which "dir" mode's path:rule:line
#                                       fingerprints do not. Default stays "full" here (deeper
#                                       check) — callers that need CI-equivalence should pass
#                                       SECRET_SCAN_SCOPE=dir explicitly.
#
# FALSE POSITIVES: inline `gitleaks:allow` comment, or an [allowlist] entry. Never paper
# over a real finding by deleting the step.
set -eu

GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"
SCOPE="${SECRET_SCAN_SCOPE:-full}"

log() { printf '%s\n' "secret-scan: $*" >&2; }

ensure_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then return 0; fi
  log "gitleaks not found — attempting install (v$GITLEAKS_VERSION)."
  if command -v brew >/dev/null 2>&1; then
    brew install gitleaks && return 0
  fi
  if command -v go >/dev/null 2>&1; then
    GOBIN="${GOBIN:-$HOME/go/bin}" go install "github.com/gitleaks/gitleaks/v8@v$GITLEAKS_VERSION" \
      && export PATH="${GOBIN:-$HOME/go/bin}:$PATH" && return 0
  fi
  # Last resort: download the release tarball for linux amd64.
  if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
    url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
    tmp="$(mktemp -d)"
    if curl -fsSL "$url" -o "$tmp/gl.tgz" && tar -xzf "$tmp/gl.tgz" -C "$tmp" gitleaks; then
      install -m 0755 "$tmp/gitleaks" /usr/local/bin/gitleaks 2>/dev/null \
        || { mkdir -p "$HOME/.local/bin"; install -m 0755 "$tmp/gitleaks" "$HOME/.local/bin/gitleaks"; export PATH="$HOME/.local/bin:$PATH"; }
      rm -rf "$tmp"; return 0
    fi
    rm -rf "$tmp"
  fi
  log "could not install gitleaks automatically — install it and re-run: https://github.com/gitleaks/gitleaks"
  return 1
}

scan() { # $1 = optional config path
  cfg="${1:-}"
  # `dir` mode needs the build/dependency-directory allowlist (.gitleaks-dir.toml, see its
  # header) that the SHARED .gitleaks.toml deliberately does NOT carry — a global exclusion
  # there would blind `git`/`--staged` scans to a force-added file under a build dir. Only
  # auto-select it when the caller didn't already pass an explicit config.
  if [ -z "$cfg" ] && [ "$SCOPE" = "dir" ]; then
    if [ -f ".gitleaks-dir.toml" ]; then
      cfg=".gitleaks-dir.toml"
    else
      # Relative path resolves against CWD, not repo root — every known caller `cd`s to
      # the repo root before invoking this script (see ci/local-checks.sh), so this only
      # fires on a genuinely new caller. Warn loudly instead of silently falling back to
      # the shared config: a silent fallback here reintroduces the exact node_modules/
      # dist/out/ dir-mode false-blocks .gitleaks-dir.toml exists to prevent.
      log "WARNING — SECRET_SCAN_SCOPE=dir but .gitleaks-dir.toml not found from cwd $(pwd) — falling back to the shared .gitleaks.toml, which does NOT allowlist build/dependency directories for dir-mode scans. Run this script from the repo root, or pass SECRET_SCAN_CONFIG explicitly."
    fi
  fi
  set -- --redact --no-banner -v
  [ -n "$cfg" ] && set -- "$@" -c "$cfg"
  case "$SCOPE" in
    staged) gitleaks git --staged "$@" ;;
    dir)    gitleaks dir . "$@" ;;        # working tree only, matches secret-scan.yml
    *)      gitleaks git "$@" ;;          # full history
  esac
}

# A bare `ensure_gitleaks` call would let `set -e` abort on its return-1 install
# failure with plain exit code 1 — indistinguishable, to a caller like
# ci/local-checks.sh, from exit 1 meaning "a secret was found" (the `scan` block
# below). Exit 9 instead, joining the existing "dir subcommand too old" tooling-error
# convention (both mean "gitleaks isn't usable here", never "a leak was found").
if ! ensure_gitleaks; then
  log "gitleaks install failed — this is a TOOLING error, not a leaked secret. Install it manually and re-run."
  exit 9
fi

# `dir` is a newer gitleaks subcommand (v8.19+) than `git` (which has existed since
# gitleaks v8). `ensure_gitleaks` above only installs the PINNED version when gitleaks
# is entirely ABSENT — it does not upgrade an already-present older binary already on
# PATH. Without this check, an old `gitleaks` would fail `gitleaks dir .` with an
# "unknown command" error indistinguishable, by exit code alone, from a real secret
# finding — actively misleading whoever is debugging the false ship-block. Exit 9
# (distinct from every other exit path in this script, all of which are 0/1) so a
# caller — ci/local-checks.sh's gh-ship billing-block fallback (HYP-1126) in
# particular — can tell "gitleaks is too old" apart from "a secret was found" and
# print the correct one instead of assuming every non-zero exit means a leak.
if [ "$SCOPE" = "dir" ] && ! gitleaks dir --help >/dev/null 2>&1; then
  log "SECRET_SCAN_SCOPE=dir requires gitleaks >= v8.19 (this repo pins v$GITLEAKS_VERSION);"
  log "  the installed gitleaks does not support the 'dir' subcommand. Upgrade it, or set"
  log "  SECRET_SCAN_SCOPE=full to use the older 'gitleaks git' (history) mode instead."
  exit 9
fi

# --- WARN tier first (optional, never fails the build) ---
if [ -n "${SECRET_SCAN_WARN_CONFIG:-}" ]; then
  if ! scan "$SECRET_SCAN_WARN_CONFIG"; then
    log "WARNING — suspicious string(s) found (not failing the build). Review them above."
  fi
fi

# --- BLOCK tier (fails the build on a high-confidence finding) ---
if ! scan "${SECRET_SCAN_CONFIG:-}"; then
  log "BLOCKED — a high-confidence secret was found. Remove it, rotate it, and re-push."
  log "  false positive? add a 'gitleaks:allow' comment or an [allowlist] entry in .gitleaks.toml."
  exit 1
fi

log "clean — no high-confidence secrets found."
