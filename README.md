# HAIVE

**Home Assistant Interactive Visual Environment** — a 3D Home Assistant interface designed for touchscreens (tested on the 7" 1280×800 Raspberry Pi panel, but the UI scales to any resolution), built with Nuxt 3 + TresJS.

HAIVE runs as a **Home Assistant add-on**, so it lives on the same box as Home Assistant itself. Every screen in the house — tablets, phones, wall panels — just opens that address in a browser. They all share one layout, one floorplan, one theme, and stay in sync live.

## Features

- Real-time device state via the Home Assistant WebSocket API
- **One server, unlimited screens** — every browser on the network shows the same live dashboard
- 3D floorplan view with procedural room geometry (walls, doors, windows, furniture)
- Touch-tuned UI with a bottom-sheet device control panel
- Pluggable device adapter system: lights, switches, climate, sensors, media players, covers, cameras
- **2D floorplan editor** — drag vertices, add/remove rooms, set per-wall thickness, place doors & windows, hide individual walls in 3D
- **Furniture library** — JSON-defined furniture items placed and scaled in the 3D scene
- **Saved camera views** — save/lock a camera position; auto-returns after 30 s of inactivity
- **PIN keypad authentication** — optional PIN lock for the editor toolbar, set from the setup screen
- **WiFi QR code** — one-tap QR overlay to share the local network
- **Custom theme palette editor** — accent hue picker, light/dark/auto mode, scene lighting controls, saveable custom palettes
- Installs as a Home Assistant OS add-on — no URL, no token, no extra machine

## Install on Home Assistant OS

1. **Settings → Add-ons → Add-on Store**, ⋮ menu → **Repositories**, add this repo.
2. Install **HAIVE**, then **Start**.
3. Open `http://<home-assistant-ip>:3000/` on any screen in the house.

The Supervisor hands the add-on its own Home Assistant credentials, so the connection is already made — there is no URL and no long-lived token to enter. Browsers never receive a Home Assistant token either; they reach it through the add-on, so a tablet with no Home Assistant credentials still works. The add-on lives in [haive](haive) (Home Assistant requires [repository.yaml](repository.yaml) and the add-on folder at the repo root).

### Turning a Raspberry Pi into a screen

The Pi doesn't run HAIVE — it only needs a browser pointed at the add-on:

```bash
git clone https://github.com/ChristianOerum/H.A.I.V.E.git
cd HAIVE
sudo bash deploy/install-kiosk.sh http://homeassistant.local:3000
sudo reboot
```

Repeat on as many screens as you like. There is nothing to configure per screen.

## Develop locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 with `?mock=1` to run against a built-in fake Home Assistant (16 sample devices, yellow `MOCK` badge). To develop against a real instance, complete the setup screen with your HA URL and a long-lived token (HA → Profile → Long-Lived Access Tokens) — that path exists for development only; installs use the add-on.

## First-time setup

The first browser that opens the add-on shows a short **setup screen** — no config files to edit, no environment variables to set. It runs **once, for the whole house**.

The Home Assistant connection is already made by the Supervisor, so everything on that screen is optional: a **toolbar PIN** (locks the editor controls on every screen) and **WiFi QR credentials** (shown to guests via the corner WiFi button).

To start over, use **Factory Reset** (Settings → Prefs tab). Your floorplan and device layout are kept.

## Publishing your own image

The add-on references the image directly (`image:` in [haive/config.yaml](haive/config.yaml)) — Supervisor pulls it, it never builds anything on-device, so updates are just a version bump. From your **dev machine**:

```powershell
docker login                              # once
$env:DOCKER_USER = "yourdockerhubname"    # once per shell
npm run image:push                        # multi-arch build + push to Docker Hub
```

That publishes `yourdockerhubname/haive:<version>` and `:latest` for both PC (`linux/amd64`) and Raspberry Pi (`linux/arm64`).

If you forked the repo, point [haive/config.yaml](haive/config.yaml) `image:` at your registry namespace, and make sure its `version:` exactly matches the tag you just pushed (Home Assistant requires an exact match). Bump `version` on every release — that's what makes Home Assistant offer the update — commit + push, and the "Update" button on the add-on page pulls the new tag.

## Advanced options

<details>
<summary>Config files</summary>

- Everything the app needs is entered on the setup screen — there are no environment variables to set.
- `config/device.json` — HA URL/token, WiFi QR credentials, toolbar PIN, allowed LAN prefixes (written by the setup screen). As an add-on this lives in `/data/config`.
- `config/entities.json` — device placements. `config/floorplan.json` — rooms/walls/openings. `config/furnitureLibrary/` — furniture definitions.
- Handy URLs: `?mock=1` (force mock), `?kiosk=1` (hide cursor).
</details>

## Adding a new device type

1. Create `components/controls/MyDomainControls.vue` (takes an `entity` prop).
2. Add an adapter to `adapters/index.ts` and include it in `registerBuiltInAdapters()`.

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
- `server/api/ha/token.get.ts` — tells browsers how to reach HA (no credentials returned).
- `server/api/ha/proxy/api/websocket.ts` — transparent WebSocket bridge to Home Assistant; injects the server-held token.
- `server/api/ha/proxy/[...path].ts` — read-only HTTP proxy for camera snapshots and artwork.
- `server/utils/haTarget.ts` — resolves the HA connection (Supervisor add-on or manual URL + token).
- `server/api/config.*.ts` — read/write runtime server config (setup + factory reset).
- `server/utils/deviceConfig.ts` — persisted server config (HA creds, PIN, WiFi, LAN prefixes).
- `server/utils/lanGuard.ts` — shared LAN-only request guard.
- `server/api/events.get.ts` — SSE stream that keeps every screen in sync.
- `server/api/layout.ts` — read/write `config/entities.json`.
- `server/api/floorplan.ts` — read/write `config/floorplan.json`.
- `server/api/wifi.get.ts` — serve WiFi credentials for QR generation.
- `server/api/auth/verify.post.ts` — PIN verification endpoint.
