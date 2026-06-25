# HAIVE

**Home Assistant Interactive Visual Environment** — a 3D Home Assistant interface designed for Raspberry Pi touchscreens (tested on the 7" 1280×800 panel, but the UI scales to any resolution), built with Nuxt 3 + TresJS.

## Features

- Real-time device state via the Home Assistant WebSocket API
- 3D floorplan view (procedural placeholder, glTF/GLB supported)
- Touch-tuned UI with a bottom-sheet device control panel
- Pluggable device adapter system: lights, switches, climate, sensors, media players, covers, cameras
- Runs as an SSR Nitro server on the Pi with Chromium kiosk

## Quick start (dev)

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### Testing without Home Assistant (mock mode)

If `.env` doesn't exist or `HA_TOKEN` is empty, the app automatically falls back to **mock mode**: a built-in fake Home Assistant with 16 sample devices (lights, switches, climate, sensors, media player, covers, camera) backed by a small simulator. A yellow `MOCK` badge appears in the top status bar.

You can also force mock mode at any time by appending `?mock=1` to the URL.

What you can do in mock mode:
- Tap any device marker — control panel opens.
- Toggle lights, switches, blinds; change thermostat target temp; play/pause media.
- State changes are visible in the 3D scene (lights glow brighter, etc.).
- Sensor values drift over time so you can see live updates.

### Testing with a real Home Assistant

```bash
cp .env.example .env
# edit .env: set HA_URL and HA_TOKEN (Profile → Long-Lived Access Tokens in HA)
npm run dev
```

The status indicator turns green when connected. Toggling a device should round-trip to your Home Assistant within ~200 ms.

### Useful URLs

- `http://localhost:3000/` — main interface
- `http://localhost:3000/?mock=1` — force mock mode
- `http://localhost:3000/?kiosk=1` — adds the `kiosk` body class (hides cursor)
- `http://localhost:3000/api/ha/token` — what the client sees (mocks if no token)
- `http://localhost:3000/api/layout` — current device placements

## Configuration

- `.env` — `HA_URL`, `HA_TOKEN`, `ALLOWED_LOCAL_PREFIXES`
- `config/entities.json` — device placements (entity_id + 3D position)

## Adding a new device type

1. Create `components/controls/MyDomainControls.vue` (takes an `entity` prop).
2. Add an adapter to `adapters/index.ts` and include it in `registerBuiltInAdapters()`.

## Deploying to the Pi

```bash
# On a build machine (or the Pi)
npm install
npm run build

# Copy .output, .env, config/, deploy/ to /home/pi/CoveHome
sudo cp deploy/covehome.service /etc/systemd/system/
sudo cp deploy/kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now covehome.service
sudo systemctl enable --now kiosk.service
```

The Pi launches Chromium full-screen against `http://localhost:3000/?kiosk=1`.

## Architecture

- `composables/useHomeAssistant.ts` — singleton WS connection, auto-reconnect.
- `stores/entities.ts` — reactive entity map (Pinia).
- `stores/layout.ts` — device placements + selection + edit mode.
- `utils/deviceRegistry.ts` — `DeviceAdapter` registry.
- `adapters/` — per-domain adapters.
- `components/scene/` — TresJS 3D scene.
- `components/controls/` — per-domain control UIs.
- `components/ui/` — overlay components (status bar, bottom sheet).
- `server/api/ha/token.get.ts` — mints HA token to LAN clients only.
- `server/api/layout.ts` — read/write `config/entities.json`.
