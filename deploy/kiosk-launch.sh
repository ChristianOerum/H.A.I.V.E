#!/usr/bin/env bash
# Launches Chromium full-screen in kiosk mode against the local HAIVE server.
# Works on Debian/Raspberry Pi OS (chromium) and Ubuntu (chromium-browser).
set -euo pipefail

URL="${HAIVE_URL:-http://localhost:3000/?kiosk=1}"

# Pick whichever Chromium binary is installed.
CHROME_BIN="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME_BIN" ]; then
  echo "Chromium is not installed. Install it with: sudo apt-get install -y chromium" >&2
  exit 1
fi

# Disable screen blanking / power management so the kiosk never sleeps.
if command -v xset >/dev/null 2>&1; then
  xset s off || true
  xset -dpms || true
  xset s noblank || true
fi
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root &
fi

# Wait until the server responds before opening the browser (avoids error page).
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:3000/" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

exec "$CHROME_BIN" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --no-first-run \
  --fast \
  --fast-start \
  --disable-translate \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --enable-features=OverlayScrollbar \
  "$URL"
