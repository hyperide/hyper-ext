#!/usr/bin/env bash
# Publish the site — but only from a green tree.
#
#   ./deploy.sh            # gates, local Vercel build, then production
#   ./deploy.sh --preview  # gates, local Vercel build, then a preview URL
#   ./deploy.sh --skip-checks   # only immediately after a green check
#
# Install dependencies and Chromium before running this script:
#   bun install --frozen-lockfile
#   bunx playwright install chromium
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
  if ! bun run check; then
    echo "REFUSING TO DEPLOY: a gate is red." >&2
    exit 1
  fi
else
  echo "== gates explicitly skipped"
fi

echo "== local Vercel build (includes static prerendering)"
# Use the same local environment that ran the browser checks. A plain `vercel`
# upload would rebuild remotely, where the required Chromium may not exist.
# Vercel build reads this package's buildCommand and writes .vercel/output.
# --scope fixes the project scope; credentials still need access to this team.
# shellcheck disable=SC2086
vercel build $target --yes --scope inventorems-projects

echo "== publishing the prebuilt output"
# shellcheck disable=SC2086
vercel deploy --prebuilt $target --yes --scope inventorems-projects
