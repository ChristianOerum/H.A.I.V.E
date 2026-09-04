# HAIVE — Home Assistant add-on

Runs the HAIVE 3D dashboard **on the same machine as Home Assistant**. Every
tablet, phone and wall panel in the house then just opens the add-on's address —
they all share one layout, one floorplan, one theme and stay in sync live.

## Install

1. In Home Assistant go to **Settings → Add-ons → Add-on Store**.
2. Open the ⋮ menu → **Repositories**, and add:

   ```
   https://github.com/ChristianOerum/H.A.I.V.E.
   ```
3. Install **HAIVE**, then **Start** it.

## Use

Open `http://<home-assistant-ip>:3000/` on any device on your network.

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

## Ports

| Port | Purpose |
| ---- | ------- |
| 3000 | HAIVE dashboard (HTTP + WebSocket) |
