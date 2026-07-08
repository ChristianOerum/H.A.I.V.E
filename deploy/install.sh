#!/usr/bin/env bash
# HAIVE installer for Debian / Raspberry Pi OS.
#
# Installs Docker (if missing), deploys HAIVE to /opt/haive, and sets up systemd
# services so the server (Docker) and Chromium kiosk both auto-start on boot.
#
# Usage:  sudo ./deploy/install.sh [kiosk-user]
#
set -euo pipefail

INSTALL_DIR="/opt/haive"
KIOSK_USER="${1:-${SUDO_USER:-pi}}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

echo "==> Installing HAIVE to ${INSTALL_DIR} (kiosk user: ${KIOSK_USER})"

# ── 1. Docker ────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "==> Installing Docker Compose plugin…"
  apt-get update
  apt-get install -y docker-compose-plugin
fi
systemctl enable --now docker

# ── 2. Chromium + X helpers for the kiosk ────────────────────
echo "==> Installing kiosk dependencies (Chromium, xset, unclutter, curl)…"
apt-get update
apt-get install -y chromium x11-xserver-utils unclutter curl || \
  apt-get install -y chromium-browser x11-xserver-utils unclutter curl

# ── 3. Copy project files ────────────────────────────────────
echo "==> Copying deployment files to ${INSTALL_DIR}…"
mkdir -p "${INSTALL_DIR}"
cp -r "${REPO_DIR}/deploy" "${INSTALL_DIR}/"
cp "${REPO_DIR}/docker-compose.yml" "${INSTALL_DIR}/"
chmod +x "${INSTALL_DIR}/deploy/"*.sh

# ── 4. systemd services ──────────────────────────────────────
echo "==> Installing systemd services…"
# Point the kiosk service at the chosen user.
sed "s/^User=pi/User=${KIOSK_USER}/; s#/home/pi/#/home/${KIOSK_USER}/#g" \
  "${INSTALL_DIR}/deploy/haive-kiosk.service" > /etc/systemd/system/haive-kiosk.service
cp "${INSTALL_DIR}/deploy/haive-docker.service" /etc/systemd/system/haive-docker.service

systemctl daemon-reload
systemctl enable --now haive-docker.service
systemctl enable --now haive-kiosk.service

echo ""
echo "==> HAIVE installed."
echo "    Server:  http://localhost:3000/"
echo "    On first boot the on-screen setup will ask for HA URL/token or a Master URL."
echo "    Auto-updates run via Watchtower (see docker-compose.yml)."
