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
- **PIN keypad authentication** — optional PIN lock for the editor toolbar, set from the first-launch setup screen
- **WiFi QR code** — one-tap QR overlay to share the local network
- **Custom theme palette editor** — accent hue picker, light/dark/auto mode, scene lighting controls, saveable custom palettes
- Runs as an SSR Nitro server on the Pi with Chromium kiosk

## Try it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The **setup screen** appears on first run — see [First-time setup](#first-time-setup).

Want to explore without a real Home Assistant? Just finish setup as a **Master** without a valid token, or add `?mock=1` to the URL. The app runs a built-in fake HA (16 sample devices) with a yellow `MOCK` badge.

## First-time setup

On first launch the app shows a **setup screen** — no config files to edit, no environment variables to set. You choose a **role**:

- **Master** — enter your **HA URL** and **token** (HA → Profile → Long-Lived Access Tokens). This device connects to Home Assistant and holds all the data.
- **Slave** — enter the **Master's URL** (e.g. `http://192.168.1.50:3000`). It just mirrors the Master, so every screen shows the same thing.

The setup screen also lets you optionally configure a **toolbar PIN** (locks the editor controls) and **WiFi QR credentials** (shown to guests via the corner WiFi button).

Settings are saved on the device. To start over, use **Factory Reset** (Settings → Preferences tab), which returns you to this screen. Your floorplan and device layout are kept.

## Run with Docker (recommended for a permanent install)

On the target machine (your PC, a NAS, or a Raspberry Pi), install Docker first if you don't have it:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out + back in after this
```

Grab the compose file and start the stack:

```bash
git clone https://github.com/ChristianOerum/H.A.I.V.E.git
cd HAIVE
docker compose up -d
```

Then open `http://<device-ip>:3000/` and complete the setup screen. That's it:

- Your config and layout are saved in a Docker volume (survives updates).
- The app **auto-updates itself** — a bundled Watchtower service pulls new versions every hour.

To update immediately:

```bash
sudo bash deploy/update.sh
```

That single command pulls the latest repo, syncs the compose file, pulls the latest image, and restarts the stack.

> Want to publish your own image? See [Publishing your own image](#publishing-your-own-image) below.

## Auto-start as a kiosk (Raspberry Pi / Debian)

One installer sets up Docker + Chromium + systemd so HAIVE launches full-screen on every boot:

```bash
git clone https://github.com/ChristianOerum/H.A.I.V.E.git
cd HAIVE
sudo bash deploy/install.sh
sudo reboot
```

> **Note:** run it as `sudo bash deploy/install.sh` (not `./deploy/install.sh`). Cloning on Windows can strip the executable bit or add CRLF line endings; going through `bash` sidesteps both.

After reboot the touchscreen shows the setup screen. Fill in HA URL + token, done.

To update the whole stack later:

```bash
cd ~/HAIVE && sudo bash deploy/update.sh
```

## Publishing your own image

Fork or clone the repo, then from your **dev machine**:

```powershell
docker login                              # once
$env:DOCKER_USER = "yourdockerhubname"    # once per shell
npm run image:push                        # multi-arch build + push to Docker Hub
```

That publishes `yourdockerhubname/haive:<version>` and `:latest` for both PC (`linux/amd64`) and Raspberry Pi (`linux/arm64`).

Then edit `docker-compose.yml` so the `haive` service points at your image:

```yaml
image: yourdockerhubname/haive:latest
```

Commit + push. On the target: `sudo bash deploy/update.sh` picks it up.

## Advanced options

<details>
<summary>Run without Docker (bare Node)</summary>

```bash
npm install
npm run build
# Copy .output, config/, deploy/ to /home/pi/haive, then:
sudo cp deploy/haive.service deploy/kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now haive.service kiosk.service
```
</details>

<details>
<summary>Config files</summary>

- Everything the app needs is entered on the first-launch setup screen — there are no environment variables to set.
- `config/device.json` — HA URL/token, role, WiFi QR credentials, toolbar PIN, allowed LAN prefixes (written by the setup screen).
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
- `server/api/ha/token.get.ts` — mints HA token to LAN clients only.
- `server/api/config.*.ts` — read/write runtime device config (first-launch + factory reset).
- `server/utils/deviceConfig.ts` — persisted device config (role, HA creds, master URL, PIN, WiFi).
- `server/utils/lanGuard.ts` — shared LAN-only request guard.
- `server/utils/masterProxy.ts` — forwards Slave API requests to the Master.
- `server/api/layout.ts` — read/write `config/entities.json`.
- `server/api/floorplan.ts` — read/write `config/floorplan.json`.
- `server/api/wifi.get.ts` — serve WiFi credentials for QR generation.
- `server/api/auth/verify.post.ts` — PIN verification endpoint.
