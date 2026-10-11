# HAIVE — Home Assistant add-on

Runs the HAIVE 3D dashboard **on the same machine as Home Assistant**. Every
tablet, phone and wall panel in the house then just opens the add-on's address —
they all share one layout, one floorplan, one theme and stay in sync live.

## Install

Requires Home Assistant OS or a Supervised install — Container and Core installs
have no add-on support.

1. In Home Assistant go to **Settings → Apps → Install app** (called
   **Settings → Add-ons → Add-on Store** on older versions).
2. Open the ⋮ menu → **Repositories**, and add:

   ```
   https://github.com/ChristianOerum/H.A.I.V.E.
   ```
   If this is blocked with "supervisor needs to be updated first", install the
   pending Supervisor update under **Settings** and try again.
3. Refresh the page, open **HAIVE**, click **Install**, then **Start**. Turn on
   **Start on boot** so it comes back after a restart.

## Use

Open `http://<home-assistant-ip>:3000/` on any device on your network — the same
address you use for Home Assistant, with port `3000` instead of `8123` (for
example `http://homeassistant.local:3000/`).

The first screen you open shows a short setup form for optional extras (toolbar
PIN, WiFi QR). The Home Assistant connection itself is already done — the
Supervisor provides it, so there is no URL or long-lived token to enter.

For a wall-mounted kiosk, append `?kiosk=1` to hide the cursor and lock zoom:

```
http://<home-assistant-ip>:3000/?kiosk=1
```

## How it connects

The add-on talks to Home Assistant over the Supervisor proxy
(`http://supervisor/core`) using the `SUPERVISOR_TOKEN` that Home Assistant
injects. Browsers never receive that token — they connect to the add-on, which
bridges WebSocket traffic and camera snapshots on their behalf. That is why a
phone on the guest VLAN can show the dashboard without any Home Assistant
credentials of its own.

## Data

Everything you edit (device placements, floorplan, furniture, theme, PIN, WiFi
QR) is stored in the add-on's `/data/config` directory, which survives updates
and restarts. Use **Factory Reset** in the in-app settings to clear the server
configuration; layout and floorplan data are kept.

## Updating

New versions show up under **Settings → System → Updates**. To check right away,
use ⋮ → **Check for updates** there. Your layout and settings in `/data/config`
are kept across updates.

## Troubleshooting

If the app shows **Error** after starting, open its **Log** tab — the reason it
stopped is printed there. Include the log when reporting an issue.

## Ports

| Port | Purpose |
| ---- | ------- |
| 3000 | HAIVE dashboard (HTTP + WebSocket) |
| 3443 | The same app over HTTPS with a self-signed certificate. Needed for room scanning on an iPhone |
