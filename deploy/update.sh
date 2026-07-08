#!/usr/bin/env bash
# HAIVE — one-command update on the Pi.
#
# Assumes the repo is cloned somewhere on this machine and this script is run
# from inside it (e.g. `~/H.A.I.V.E`). Steps:
#   1. git pull       — grabs latest docker-compose.yml, deploy files, etc.
#   2. sync files     — copies compose + service units to /opt/haive.
#   3. pull image     — Docker Hub pull of the newest app image.
#   4. up -d          — recreates containers with the new image / config.
#
# Usage (from anywhere inside the cloned repo):
#   sudo bash deploy/update.sh
#
set -euo pipefail

# Locate the repo root (parent of this script).
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="/opt/haive"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root:  sudo bash $0" >&2
  exit 1
fi

echo "==> Pulling latest repo changes…"
if [ -d "${REPO_DIR}/.git" ]; then
  # Run git as the invoking user so .git/objects don't end up owned by root
  # (which would break subsequent unprivileged `git pull` invocations).
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    sudo -u "${SUDO_USER}" git -C "${REPO_DIR}" pull --ff-only
  else
    git -C "${REPO_DIR}" pull --ff-only
  fi
else
  echo "    (${REPO_DIR} is not a git checkout — skipping git pull.)"
fi

echo "==> Syncing deploy files to ${INSTALL_DIR}…"
mkdir -p "${INSTALL_DIR}"
cp "${REPO_DIR}/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
cp -r "${REPO_DIR}/deploy" "${INSTALL_DIR}/"
chmod +x "${INSTALL_DIR}/deploy/"*.sh

# Refresh any installed systemd units so service changes take effect.
if [ -f /etc/systemd/system/haive-docker.service ]; then
  cp "${INSTALL_DIR}/deploy/haive-docker.service" /etc/systemd/system/haive-docker.service
  systemctl daemon-reload
fi

echo "==> Pulling latest HAIVE image…"
docker compose -f "${INSTALL_DIR}/docker-compose.yml" pull

echo "==> Recreating containers…"
docker compose -f "${INSTALL_DIR}/docker-compose.yml" up -d --force-recreate

echo "==> Restarting HAIVE container…"
docker restart haive >/dev/null

echo "==> Pruning old images…"
docker image prune -f >/dev/null

# If the kiosk service is installed, bounce it so Chromium reloads against the
# freshly restarted container instead of showing a cached page.
if systemctl list-unit-files | grep -q '^haive-kiosk\.service'; then
  echo "==> Restarting Chromium kiosk…"
  systemctl restart haive-kiosk.service || true
fi

echo ""
echo "==> Update complete."
docker compose -f "${INSTALL_DIR}/docker-compose.yml" ps
