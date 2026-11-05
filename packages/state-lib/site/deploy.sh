#!/usr/bin/env bash
# Publish only a checked tree. --skip-checks is valid immediately after a green run.
# Build locally so Chromium is available for the static prerender step.
set -euo pipefail
cd "$(dirname "$0")"
target=--prod
skip=0
for arg in "$@"; do
  case "$arg" in
    --preview) target="" ;;
    --skip-checks) skip=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done
if [ "$skip" -eq 0 ]; then
  echo "== gates"
  bun run check || { echo "REFUSING TO DEPLOY: a gate is red." >&2; exit 1; }
else
  echo "== gates explicitly skipped"
fi
echo "== local Vercel build"
# shellcheck disable=SC2086
vercel build $target --yes --scope inventorems-projects
# Bun's cache symlinks must not escape the uploaded function artifact.
bunx tsx tools/package-server.mts
bunx tsx tools/package-server.test.mts
echo "== publishing the prebuilt output"
# shellcheck disable=SC2086
vercel deploy --prebuilt $target --yes --scope inventorems-projects
