#!/usr/bin/env bash
# Run e2e matrix on remote k3s server via SSH
# Usage: REMOTE_USER=root REMOTE_HOST=77.42.45.86 ./remote-matrix-run.sh [args]
#
# Prerequisites on the remote server (one-time setup):
#   1. Docker installed: apt-get install -y docker.io && systemctl enable --now docker
#   2. ext-test-projects cloned:
#        mkdir -p ~/work && git clone git@github.com:hyperide/ext-test-projects ~/work/ext-test-projects
#   3. hypercanvas-e2e Docker image available (will be built on first matrix run)
#
# Notes:
#   - SSH user is root (ultra user key not authorized on 77.42.45.86)
#   - Server has k3s/containerd but no standalone Docker daemon yet
#   - After Docker install, the hypercanvas-e2e image must be pulled or built
set -euo pipefail

REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-77.42.45.86}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_WORK="${REMOTE_WORK:-/root/work}"

echo "Running e2e matrix on $REMOTE_USER@$REMOTE_HOST..."

# Sync latest extension build to server if HYPER_E2E_EXTENSION_REPO is set locally
if [[ -n "${HYPER_E2E_EXTENSION_REPO:-}" ]]; then
  echo "Syncing extension to server..."
  rsync -az --delete -e "ssh -i $SSH_KEY" \
    "$HYPER_E2E_EXTENSION_REPO/" \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_WORK/hypercanvas-preview/"
fi

# Run matrix on server
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "cd $REMOTE_WORK/ext-test-projects && HYPER_E2E_RUNTIME=docker HYPER_E2E_EXTENSION_REPO=$REMOTE_WORK/hypercanvas-preview bash e2e/scripts/matrix-run.sh $*"
