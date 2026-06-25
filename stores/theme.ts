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
      this._applyAccentVars(this.isDark)
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
      if (_cycleTimer) {
        clearInterval(_cycleTimer)
        _cycleTimer = null
      }
    },

    /** Apply theme with no transition (used on page load / mode switch). */
    _applyInstant() {
      if (typeof document === 'undefined') return
      const html = document.documentElement
      html.classList.add('no-transition')
      html.offsetHeight // force reflow
      this._setDark(this._resolveDark())
      html.offsetHeight // force reflow
      html.classList.remove('no-transition')
    },

    /** Apply theme with the normal (or cycle) transition. */
    apply() {
      if (typeof document === 'undefined') return
      this._setDark(this._resolveDark())
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
