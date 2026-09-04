#!/usr/bin/env bash
# HAIVE kiosk installer for Debian / Raspberry Pi OS.
#
# HAIVE itself runs as a Home Assistant add-on on your Home Assistant machine.
# This script turns a Pi (or any Debian box with a screen) into one of its
# displays: Chromium, full-screen, auto-starting on boot. Run it on as many
# screens as you like — there is nothing to configure per screen.
#
# Usage:  sudo ./deploy/install-kiosk.sh [haive-url] [kiosk-user]
#   e.g.  sudo ./deploy/install-kiosk.sh http://homeassistant.local:3000
#
set -euo pipefail

INSTALL_DIR="/opt/haive"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

SERVER_URL="${1:-http://homeassistant.local:3000}"
KIOSK_USER="${2:-${SUDO_USER:-pi}}"
# Strip any trailing slash, then always request kiosk mode.
KIOSK_URL="${SERVER_URL%/}/?kiosk=1"

echo "==> Installing HAIVE kiosk (server: ${SERVER_URL}, user: ${KIOSK_USER})"

echo "==> Installing kiosk dependencies (Chromium, xset, unclutter, curl)…"
apt-get update
apt-get install -y chromium x11-xserver-utils unclutter curl || \
  apt-get install -y chromium-browser x11-xserver-utils unclutter curl

echo "==> Copying launcher to ${INSTALL_DIR}…"
mkdir -p "${INSTALL_DIR}/deploy"
cp "${REPO_DIR}/deploy/kiosk-launch.sh" "${INSTALL_DIR}/deploy/"
chmod +x "${INSTALL_DIR}/deploy/kiosk-launch.sh"

echo "==> Installing systemd service…"
sed -e "s/^User=pi/User=${KIOSK_USER}/" \
    -e "s#/home/pi/#/home/${KIOSK_USER}/#g" \
    -e "s#^Environment=HAIVE_URL=.*#Environment=HAIVE_URL=${KIOSK_URL}#" \
    "${REPO_DIR}/deploy/haive-kiosk.service" > /etc/systemd/system/haive-kiosk.service

systemctl daemon-reload
systemctl enable --now haive-kiosk.service

echo ""
echo "==> HAIVE kiosk installed."
echo "    Showing: ${KIOSK_URL}"
echo "    This screen shares its layout, floorplan and theme with every other"
echo "    screen connected to the same HAIVE add-on."
