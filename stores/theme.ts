import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'cove.theme'
const COORD_KEY = 'cove.coords'
const ACCENT_KEY = 'cove.accentHue'

// Default teal hue (≈174°)
const DEFAULT_ACCENT_HUE = 174

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Convert HSL (0-360, 0-100, 0-100) to a CSS RGB triplet string "R G B". */
function hslToRgbTriplet(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`
}

/** Extract the hue (0-360) from a CSS hex color string. */
export function hexToHue(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return DEFAULT_ACCENT_HUE
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h = 0
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6
  return Math.round(h * 360)
}

/** Convert a hue to the hex color used as the dark-mode accent swatch. */
export function hueToHex(hue: number): string {
  const [r, g, b] = hslToRgbTriplet(hue, 78, 62)
    .split(' ')
    .map(Number)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Convert a hue to the hex color used as the light-mode accent swatch. */
export function hueToHexLight(hue: number): string {
  const [r, g, b] = hslToRgbTriplet(hue, 70, 42)
    .split(' ')
    .map(Number)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// Fallback coordinates (used until geolocation resolves)
const FALLBACK_LAT = 52
const FALLBACK_LON = 5

// Module-level state kept outside Pinia (not serialisable / not reactive)
let _lat = FALLBACK_LAT
let _lon = FALLBACK_LON
let _cycleTimer: ReturnType<typeof setInterval> | null = null
let _simTimer:   ReturnType<typeof setInterval> | null = null
// Small hysteresis to avoid rapid toggling right at the horizon
const ELEVATION_HYSTERESIS = 0.5 // degrees

// ── Solar position helpers ────────────────────────────────────────────────────

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000)
}

/** Equation of time in minutes (approximate). */
function equationOfTime(doy: number): number {
  const B = (360 / 365) * (doy - 81) * (Math.PI / 180)
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)
}

/** Sun elevation angle in degrees (+ve = above horizon). */
function sunElevation(date: Date, lat: number, lon: number): number {
  const doy = getDayOfYear(date)
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60

  const declination = 23.45 * Math.sin((Math.PI / 180) * (360 / 365) * (doy - 81))
  const eot = equationOfTime(doy)
  const lst = utcHour + lon / 15 + eot / 60
  const hourAngle = 15 * (lst - 12)

  const latR = lat * (Math.PI / 180)
  const decR = declination * (Math.PI / 180)
  const haR = hourAngle * (Math.PI / 180)

  const sinEl =
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR)

  return Math.asin(Math.max(-1, Math.min(1, sinEl))) * (180 / Math.PI)
}

// ── Brightness / interpolation helpers ───────────────────────────────────────

/**
 * Continuous brightness for a given hour-of-day (0–24).
 *   h=0  (midnight) → 0   (full dark)
 *   h=12 (noon)     → 1   (full light)
 *   h=6  (dawn/dusk)→ 0.5 (midpoint)
 */
function brightnessFromHour(h: number): number {
  return (Math.cos(Math.PI * (h / 12 - 1)) + 1) / 2
}

function timeBrightness(date: Date): number {
  return brightnessFromHour(date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600)
}

/** Linear interpolation of two space-separated RGB triplet strings (e.g. "30 41 59"). */
function lerpRgbTriplet(dark: string, light: string, t: number): string {
  const [dr, dg, db] = dark.split(' ').map(Number)
  const [lr, lg, lb] = light.split(' ').map(Number)
  return `${Math.round(dr + (lr - dr) * t)} ${Math.round(dg + (lg - dg) * t)} ${Math.round(db + (lb - db) * t)}`
}

/** Linear interpolation of two CSS hex colour strings (e.g. "#1e293b"). */
function lerpHex(dark: string, light: string, t: number): string {
  const dr = parseInt(dark.slice(1, 3), 16), dg = parseInt(dark.slice(3, 5), 16), db = parseInt(dark.slice(5, 7), 16)
  const lr = parseInt(light.slice(1, 3), 16), lg = parseInt(light.slice(3, 5), 16), lb = parseInt(light.slice(5, 7), 16)
  const r = Math.round(dr + (lr - dr) * t)
  const g = Math.round(dg + (lg - dg) * t)
  const b = Math.round(db + (lb - db) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────

export type WallOpacityMode = 'solid' | 'dimmed' | 'ghost'
const WALL_OPACITY_VALUES: Record<WallOpacityMode, number> = {
  solid: 1.0,
  dimmed: 0.35,
  ghost: 0.08,
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'auto' as ThemeMode,
    /** Resolved value derived from mode + sun position / manual override. */
    isDark: true,
    /** Bumps when scene-color CSS variables may have changed, so scene
     *  components can re-read them. */
    revision: 0,
    /** Controls wall transparency to reveal furniture. */
    wallOpacityMode: 'solid' as WallOpacityMode,
    /** Accent hue (0–360). Applied as appropriate HSL tones for dark/light. */
    accentHue: DEFAULT_ACCENT_HUE,
    /** Last persisted accent hue — used to detect unsaved changes. */
    accentHueSaved: DEFAULT_ACCENT_HUE,
    /** Continuous brightness in auto mode: 0 = midnight (full dark), 1 = noon (full light). */
    brightness: 0,
    /** True while the 72-second day-cycle demo is running. */
    isSimulating: false,
  }),
  getters: {
    wallOpacity: (state): number => WALL_OPACITY_VALUES[state.wallOpacityMode],
    accentDirty: (state): boolean => state.accentHue !== state.accentHueSaved,
  },
  actions: {
    init() {
      if (typeof window === 'undefined') return

      const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
      this.mode = saved ?? 'auto'

      // Restore previously approved coordinates
      const savedCoords = localStorage.getItem(COORD_KEY)
      if (savedCoords) {
        try {
          const [lat, lon] = JSON.parse(savedCoords) as [number, number]
          _lat = lat
          _lon = lon
        } catch { /* ignore */ }
      }

      // Restore accent hue
      const savedHue = localStorage.getItem(ACCENT_KEY)
      if (savedHue !== null) {
        const hue = parseInt(savedHue, 10)
        if (!isNaN(hue)) {
          this.accentHue = hue
          this.accentHueSaved = hue
        }
      }

      // Apply immediately with no transition so the page starts in the right state
      this._applyInstant()

      if (this.mode === 'auto') {
        this._startCycle()
      }
    },

    set(mode: ThemeMode) {
      const wasAuto = this.mode === 'auto'
      this.mode = mode
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, mode)
      }

      if (mode === 'auto') {
        this._applyInstant()
        this._startCycle()
      } else {
        if (wasAuto) this._stopCycle()
        this.apply()
      }
    },

    /** Preview accent hue live (updates CSS vars) without persisting. */
    setAccentHue(hue: number) {
      this.accentHue = hue
      if (this.mode === 'auto') {
        this._applyBrightness(this.brightness)
      } else {
        this._applyAccentVars(this.isDark)
      }
    },

    /** Persist the current accent hue to localStorage. */
    saveAccentHue() {
      if (typeof window !== 'undefined') {
        localStorage.setItem(ACCENT_KEY, String(this.accentHue))
      }
      this.accentHueSaved = this.accentHue
    },

    /** Write --accent and --accent-dim CSS vars for the given dark/light state. */
    _applyAccentVars(dark: boolean) {
      if (typeof document === 'undefined') return
      const h = this.accentHue
      const root = document.documentElement
      if (dark) {
        root.style.setProperty('--accent',     hslToRgbTriplet(h, 78, 62))
        root.style.setProperty('--accent-dim', hslToRgbTriplet(h, 72, 46))
      } else {
        root.style.setProperty('--accent',     hslToRgbTriplet(h, 70, 42))
        root.style.setProperty('--accent-dim', hslToRgbTriplet(h, 72, 35))
      }
    },

    /**
     * Interpolate all theme CSS variables for auto mode.
     * t=0 → full dark (midnight), t=1 → full light (noon).
     * The existing 0.35s CSS transitions on elements provide per-minute smoothing.
     */
    _applyBrightness(t: number) {
      if (typeof document === 'undefined') return
      this.brightness = t
      const root = document.documentElement

      // Remove binary dark/light classes — inline vars take over
      root.classList.remove('dark', 'light')

      // RGB triplet vars
      const triplets: [string, string, string][] = [
        ['--bg',          '30 41 59',    '248 245 238'],
        ['--bg-panel',    '51 65 85',    '243 238 226'],
        ['--bg-elevated', '71 85 105',   '229 222 207'],
        ['--fg',          '226 232 240', '41 37 36'],
        ['--fg-muted',    '148 163 184', '120 113 108'],
      ]
      for (const [prop, dark, light] of triplets) {
        root.style.setProperty(prop, lerpRgbTriplet(dark, light, t))
      }

      // Hex scene colour vars (stored as quoted strings in CSS)
      const hexVars: [string, string, string][] = [
        ['--scene-clear',     '#1e293b', '#efe8d8'],
        ['--scene-floor',     '#334155', '#e6dec7'],
        ['--scene-wall',      '#475569', '#c7bba0'],
        ['--scene-furniture', '#64748b', '#a8987a'],
      ]
      for (const [prop, dark, light] of hexVars) {
        root.style.setProperty(prop, `"${lerpHex(dark, light, t)}"`)
      }

      // Numeric scene vars (quoted strings)
      root.style.setProperty('--scene-ambient', `"${(0.45 + (0.7  - 0.45) * t).toFixed(3)}"`)
      root.style.setProperty('--scene-sun',     `"${(1.1  + (0.9  - 1.1)  * t).toFixed(3)}"`)

      // Accent — interpolate saturation and lightness between dark and light values
      const h = this.accentHue
      const s    = 78  + (70  - 78)  * t
      const l    = 62  + (42  - 62)  * t
      const lDim = 46  + (35  - 46)  * t
      root.style.setProperty('--accent',     hslToRgbTriplet(h, s, l))
      root.style.setProperty('--accent-dim', hslToRgbTriplet(h, 72, lDim))

      // Update boolean isDark (used by mode-agnostic callers)
      this.isDark = t < 0.5

      // Update theme-color meta
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) {
        const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
        if (bg) meta.setAttribute('content', `rgb(${bg})`)
      }

      this.revision++
    },

    toggle() {
      // Cycle: auto -> light -> dark -> auto
      const next: ThemeMode =
        this.mode === 'auto' ? 'light' : this.mode === 'light' ? 'dark' : 'auto'
      this.set(next)
    },

    cycleWallOpacity() {
      const order: WallOpacityMode[] = ['solid', 'dimmed', 'ghost']
      const idx = order.indexOf(this.wallOpacityMode)
      this.wallOpacityMode = order[(idx + 1) % order.length]
    },

    /**
     * Run a 72-second demo that sweeps through a full 24-hour brightness cycle
     * starting from midnight (full dark) → noon (full light) → midnight again.
     * Calls stopDaySimulation() automatically when done.
     */
    startDaySimulation() {
      if (this.isSimulating) {
        this.stopDaySimulation()
        return
      }
      const DURATION = 72_000 // ms for one full 24-hour sweep
      const start = Date.now()
      this.isSimulating = true
      if (_simTimer) clearInterval(_simTimer)
      _simTimer = setInterval(() => {
        // Abort if mode was changed to manual while sim was running
        if (this.mode !== 'auto') { this.stopDaySimulation(); return }
        const elapsed = Date.now() - start
        const fraction = Math.min(elapsed / DURATION, 1)
        // fraction 0→1 maps to hour 0→24 (midnight → midnight via noon)
        this._applyBrightness(brightnessFromHour(fraction * 24))
        if (fraction >= 1) this.stopDaySimulation()
      }, 50) // ~20 fps
    },

    stopDaySimulation() {
      if (_simTimer) { clearInterval(_simTimer); _simTimer = null }
      this.isSimulating = false
      // Restore current real-time brightness
      if (this.mode === 'auto') this._applyBrightness(timeBrightness(new Date()))
    },

    /** Start sun-cycle mode: request geolocation and set up a per-minute tick. */
    _startCycle() {
      if (typeof window === 'undefined') return

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            _lat = pos.coords.latitude
            _lon = pos.coords.longitude
            localStorage.setItem(COORD_KEY, JSON.stringify([_lat, _lon]))
            // Re-apply now that we have accurate coordinates (with transition)
            this.apply()
          },
          () => { /* permission denied — keep fallback/saved coords */ },
        )
      }

      if (_cycleTimer) clearInterval(_cycleTimer)
      _cycleTimer = setInterval(() => {
        if (this.mode === 'auto') this.apply()
      }, 60_000)
    },

    _stopCycle() {
      if (_cycleTimer) { clearInterval(_cycleTimer); _cycleTimer = null }
      // Also cancel any running demo simulation
      if (_simTimer) { clearInterval(_simTimer); _simTimer = null }
      this.isSimulating = false
    },

    /** Apply theme with no transition (used on page load / mode switch). */
    _applyInstant() {
      if (typeof document === 'undefined') return
      const html = document.documentElement
      html.classList.add('no-transition')
      html.offsetHeight // force reflow
      if (this.mode === 'auto') {
        this._applyBrightness(timeBrightness(new Date()))
      } else {
        this._setDark(this._resolveDark())
      }
      html.offsetHeight // force reflow
      html.classList.remove('no-transition')
    },

    /** Apply theme with the normal (or cycle) transition. */
    apply() {
      if (typeof document === 'undefined') return
      if (this.mode === 'auto') {
        this._applyBrightness(timeBrightness(new Date()))
      } else {
        this._setDark(this._resolveDark())
      }
    },

    _resolveDark(): boolean {
      if (this.mode !== 'auto') return this.mode === 'dark'
      const el = sunElevation(new Date(), _lat, _lon)
      // Hysteresis: only flip when clearly past the threshold
      if (el > ELEVATION_HYSTERESIS) return false  // daytime
      if (el < -ELEVATION_HYSTERESIS) return true   // nighttime
      return this.isDark                             // stay put in transition band
    },

    _setDark(dark: boolean) {
      if (typeof document === 'undefined') return
      const html = document.documentElement

      // Clear any inline vars left by _applyBrightness so class-based CSS takes over
      for (const prop of [
        '--bg', '--bg-panel', '--bg-elevated', '--fg', '--fg-muted',
        '--accent', '--accent-dim',
        '--scene-clear', '--scene-floor', '--scene-wall', '--scene-furniture',
        '--scene-ambient', '--scene-sun',
      ]) {
        html.style.removeProperty(prop)
      }

      const apply = () => {
        this.isDark = dark
        html.classList.toggle('dark', dark)
        html.classList.toggle('light', !dark)
        this._applyAccentVars(dark)

        // Keep theme-color meta in sync
        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta) {
          const bg = getComputedStyle(html).getPropertyValue('--bg').trim()
          if (bg) meta.setAttribute('content', `rgb(${bg})`)
        }
        this.revision++
      }

      // Use View Transitions for a compositor-level cross-fade that bypasses
      // all CSS cascade issues. Skip for instant (no-transition) applies.
      if (
        'startViewTransition' in document &&
        !html.classList.contains('no-transition')
      ) {
        ;(document as any).startViewTransition(apply)
      } else {
        apply()
      }
    },
  },
})
