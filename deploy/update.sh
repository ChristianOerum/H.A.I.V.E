#!/usr/bin/env bash
# Manually pull the latest HAIVE image and restart the stack.
# (Watchtower does this automatically; this is for on-demand updates.)
set -euo pipefail

cd "$(dirname "$0")/.." 2>/dev/null || cd /opt/haive

echo "==> Pulling latest HAIVE image…"
docker compose pull

echo "==> Restarting stack…"
docker compose up -d

echo "==> Pruning old images…"
docker image prune -f

echo "==> Update complete."
