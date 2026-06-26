# HAIVE

**Home Assistant Interactive Visual Environment** — a 3D Home Assistant interface designed for Raspberry Pi touchscreens (tested on the 7" 1280×800 panel, but the UI scales to any resolution), built with Nuxt 3 + TresJS.

## Features

- Real-time device state via the Home Assistant WebSocket API
- 3D floorplan view with procedural room geometry (walls, doors, windows, furniture)
- Touch-tuned UI with a bottom-sheet device control panel
- Pluggable device adapter system: lights, switches, climate, sensors, media players, covers, cameras
- **2D floorplan editor** — drag vertices, add/remove rooms, set per-wall thickness, place doors & windows, hide individual walls in 3D
- **Furniture library** — JSON-defined furniture items placed and scaled in the 3D scene
- **Saved camera views** — save/lock a camera position; auto-returns after 30 s of inactivity
- **PIN keypad authentication** — optional PIN lock for the editor toolbar (configurable via `AUTH_PIN` env var)
- **WiFi QR code** — one-tap QR overlay to share the local network
- **Custom theme palette editor** — accent hue picker, light/dark/auto mode, scene lighting controls, saveable custom palettes
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

- `.env` — `HA_URL`, `HA_TOKEN`, `ALLOWED_LOCAL_PREFIXES`, `AUTH_PIN` (optional PIN to lock the toolbar), `WIFI_SSID` / `WIFI_PASSWORD` (optional, for the WiFi QR button)
- `config/entities.json` — device placements (entity_id + 3D position)
- `config/floorplan.json` — room polygons, wall thicknesses, door/window openings, hidden walls
- `config/furnitureLibrary/` — furniture item JSON definitions (geometry, scale, materials)

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
- `composables/useAuth.ts` — PIN auth state (session-scoped, 1-hour TTL).
- `composables/useCameraView.ts` — saved/locked camera positions, 30 s auto-return.
- `composables/useSceneColors.ts` — reactive scene colour helpers (accent, room tints).
- `composables/useMarkerOverlay.ts` — device marker overlay state.
- `stores/entities.ts` — reactive entity map (Pinia).
- `stores/layout.ts` — device placements + selection + edit mode.
- `stores/floorplan.ts` — rooms, wall thicknesses, door/window openings, hidden walls.
- `stores/theme.ts` — theme mode (light/dark/auto), accent hue, custom palettes.
- `utils/deviceRegistry.ts` — `DeviceAdapter` registry.
- `utils/furnitureGeometry.ts` — furniture mesh geometry helpers.
- `adapters/` — per-domain adapters.
- `components/scene/` — TresJS 3D scene.
  - `SceneFloorplan.vue` — procedural wall/floor/opening mesh generation.
  - `SceneCameraController.vue` — TresJS orbit camera with save/lock/return logic.
  - `SceneDeviceMarker.vue` — 3D device pin markers.
  - `FurnitureGroupViewer.vue` — 3D furniture placement from library.
- `components/controls/` — per-domain control UIs.
- `components/ui/` — overlay components.
  - `FloorplanDotEditor.vue` — SVG 2D floorplan planner (drag vertices, place openings).
  - `FloorplanEditorPanel.vue` — room/wall/opening property panel.
  - `FurnitureItemForm.vue` — furniture item editor.
  - `LibraryItemPreview.vue` — furniture library item preview.
  - `SaveViewButton.vue` — save/lock camera view button.
  - `WifiQrButton.vue` — WiFi QR code overlay.
  - `PinKeypad.vue` — PIN entry keypad overlay.
  - `ThemeToggle.vue` — light/dark/auto theme toggle.
  - `StatusBar.vue`, `BottomSheet.vue`, `DeviceControlPanel.vue` — core UI chrome.
- `server/api/ha/token.get.ts` — mints HA token to LAN clients only.
- `server/api/layout.ts` — read/write `config/entities.json`.
- `server/api/floorplan.ts` — read/write `config/floorplan.json`.
- `server/api/wifi.get.ts` — serve WiFi credentials for QR generation.
- `server/api/auth/verify.post.ts` — PIN verification endpoint.
