import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY    = 'haive.theme'
const COORD_KEY      = 'haive.coords'
const ACCENT_KEY     = 'haive.accentHue'
const ACCENT_SAT_KEY = 'haive.accentSat'
const ACCENT_LIT_KEY = 'haive.accentLit'
const DARK_VAR_KEY   = 'haive.darkVariant'
const LIGHT_VAR_KEY  = 'haive.lightVariant'
const CUSTOM_PALETTES_KEY = 'haive.customPalettes'
const UI_SCALE_KEY   = 'haive.uiScale'

// Default teal hue (≈174°) with default dark-mode S/L
const DEFAULT_ACCENT_HUE = 174
const DEFAULT_ACCENT_SAT = 78
const DEFAULT_ACCENT_LIT = 62

// UI scale — multiplies the root font-size (rem base), scaling all rem-based
// UI utilities while leaving the viewport-sized 3D scene untouched.
const DEFAULT_UI_SCALE = 1
const MIN_UI_SCALE = 0.75
const MAX_UI_SCALE = 1.5
const BASE_FONT_SIZE_PX = 16

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
  return hexToHsl(hex)[0]
}

/** Extract H (0-360), S (0-100), L (0-100) from a CSS hex color string. */
export function hexToHsl(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return [DEFAULT_ACCENT_HUE, DEFAULT_ACCENT_SAT, DEFAULT_ACCENT_LIT]
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else                h = ((r - g) / d + 4) / 6
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/** Convert H (0-360), S (0-100), L (0-100) to a CSS hex color. */
export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgbTriplet(h, s, l).split(' ').map(Number)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Convert a hue to the hex color used as the dark-mode accent swatch (default S/L). */
export function hueToHex(hue: number): string {
  return hslToHex(hue, DEFAULT_ACCENT_SAT, DEFAULT_ACCENT_LIT)
}

/** Convert a hue to the hex color used as the light-mode accent swatch (default S/L). */
export function hueToHexLight(hue: number): string {
  return hslToHex(hue, 70, 42)
}

/** Convert an RGB triplet string (e.g. "30 41 59") to a CSS hex color. */
export function rgbTripletToHex(triplet: string): string {
  const [r, g, b] = triplet.split(' ').map(Number)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Convert a CSS hex color to an RGB triplet string (e.g. "30 41 59"). */
export function hexToRgbTriplet(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r} ${g} ${b}`
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

// ── Theme palette variants ────────────────────────────────────────────────────

export type DarkVariant  = 'slate' | 'deep' | 'neutral'
export type LightVariant = 'warm'  | 'white' | 'beige'

export interface Palette {
  bg: string; bgPanel: string; bgElevated: string
  fg: string; fgMuted: string
  sceneClear: string; sceneFloor: string; sceneWall: string; sceneFurniture: string
  sceneAmbient: string; sceneSun: string
}

export const DARK_PALETTES: Record<DarkVariant, Palette> = {
  slate: {
    bg: '30 41 59',  bgPanel: '51 65 85',   bgElevated: '71 85 105',
    fg: '226 232 240', fgMuted: '148 163 184',
    sceneClear: '#1e293b', sceneFloor: '#334155', sceneWall: '#475569', sceneFurniture: '#64748b',
    sceneAmbient: '0.45', sceneSun: '1.1',
  },
  deep: {
    bg: '7 11 22',   bgPanel: '17 24 39',   bgElevated: '30 41 59',
    fg: '226 232 240', fgMuted: '148 163 184',
    sceneClear: '#07070e', sceneFloor: '#111827', sceneWall: '#1e293b', sceneFurniture: '#334155',
    sceneAmbient: '0.35', sceneSun: '1.2',
  },
  neutral: {
    bg: '24 24 27',  bgPanel: '39 39 42',   bgElevated: '63 63 70',
    fg: '228 228 231', fgMuted: '161 161 170',
    sceneClear: '#18181b', sceneFloor: '#27272a', sceneWall: '#3f3f46', sceneFurniture: '#52525b',
    sceneAmbient: '0.45', sceneSun: '1.0',
  },
}

export const LIGHT_PALETTES: Record<LightVariant, Palette> = {
  warm: {
    bg: '248 245 238', bgPanel: '243 238 226', bgElevated: '229 222 207',
    fg: '41 37 36', fgMuted: '120 113 108',
    sceneClear: '#efe8d8', sceneFloor: '#e6dec7', sceneWall: '#c7bba0', sceneFurniture: '#a8987a',
    sceneAmbient: '0.7', sceneSun: '0.9',
  },
  white: {
    bg: '255 255 255', bgPanel: '245 245 247', bgElevated: '229 229 235',
    fg: '24 24 27', fgMuted: '113 113 122',
    sceneClear: '#f5f5f7', sceneFloor: '#e5e5eb', sceneWall: '#d4d4d8', sceneFurniture: '#a1a1aa',
    sceneAmbient: '0.75', sceneSun: '0.85',
  },
  beige: {
    bg: '237 228 210', bgPanel: '224 213 190', bgElevated: '207 193 166',
    fg: '41 37 36', fgMuted: '120 113 108',
    sceneClear: '#e0d4bb', sceneFloor: '#d0c2a0', sceneWall: '#bfaa80', sceneFurniture: '#a08f62',
    sceneAmbient: '0.68', sceneSun: '0.92',
  },
}

/** A user-created palette saved in localStorage. */
export interface CustomPalette extends Palette {
  id: string
  name: string
  type: 'dark' | 'light'
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
    /** Accent saturation (0–100) for dark mode. */
    accentSat: DEFAULT_ACCENT_SAT,
    /** Accent lightness (0–100) for dark mode. */
    accentLit: DEFAULT_ACCENT_LIT,
    /** Last persisted accent hue — used to detect unsaved changes. */
    accentHueSaved: DEFAULT_ACCENT_HUE,
    accentSatSaved: DEFAULT_ACCENT_SAT,
    accentLitSaved: DEFAULT_ACCENT_LIT,
    /** Continuous brightness in auto mode: 0 = midnight (full dark), 1 = noon (full light). */
    brightness: 0,
    /** True while the 72-second day-cycle demo is running. */
    isSimulating: false,
    /** Selected dark-mode palette variant (preset key or custom palette ID). */
    darkVariant:      'slate' as string,
    darkVariantSaved: 'slate' as string,
    /** Selected light-mode palette variant (preset key or custom palette ID). */
    lightVariant:      'warm' as string,
    lightVariantSaved: 'warm' as string,
    /** User-created custom palettes, persisted to localStorage. */
    customPalettes: [] as CustomPalette[],
    /** UI scale factor (multiplies the root font-size). */
    uiScale:      DEFAULT_UI_SCALE,
    /** Last persisted UI scale — used to detect unsaved changes. */
    uiScaleSaved: DEFAULT_UI_SCALE,
  }),
  getters: {
    wallOpacity: (state): number => WALL_OPACITY_VALUES[state.wallOpacityMode],
    accentDirty:  (state): boolean =>
      state.accentHue !== state.accentHueSaved ||
      state.accentSat !== state.accentSatSaved ||
      state.accentLit !== state.accentLitSaved,
    variantDirty: (state): boolean =>
      state.darkVariant !== state.darkVariantSaved ||
      state.lightVariant !== state.lightVariantSaved,
    uiScaleDirty: (state): boolean => state.uiScale !== state.uiScaleSaved,
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

      // Restore accent hue, saturation, and lightness
      const savedHue = localStorage.getItem(ACCENT_KEY)
      if (savedHue !== null) {
        const hue = parseInt(savedHue, 10)
        if (!isNaN(hue)) {
          this.accentHue = hue
          this.accentHueSaved = hue
        }
      }
      const savedSat = localStorage.getItem(ACCENT_SAT_KEY)
      if (savedSat !== null) {
        const sat = parseInt(savedSat, 10)
        if (!isNaN(sat)) { this.accentSat = sat; this.accentSatSaved = sat }
      }
      const savedLit = localStorage.getItem(ACCENT_LIT_KEY)
      if (savedLit !== null) {
        const lit = parseInt(savedLit, 10)
        if (!isNaN(lit)) { this.accentLit = lit; this.accentLitSaved = lit }
      }

      // Restore palette variants (preset key or custom ID)
      const savedDark = localStorage.getItem(DARK_VAR_KEY)
      if (savedDark) { this.darkVariant = savedDark; this.darkVariantSaved = savedDark }
      const savedLight = localStorage.getItem(LIGHT_VAR_KEY)
      if (savedLight) { this.lightVariant = savedLight; this.lightVariantSaved = savedLight }

      // Restore custom palettes
      try {
        const raw = localStorage.getItem(CUSTOM_PALETTES_KEY)
        if (raw) this.customPalettes = JSON.parse(raw) as CustomPalette[]
      } catch { /* ignore corrupt data */ }

      // Restore UI scale
      const savedScale = localStorage.getItem(UI_SCALE_KEY)
      if (savedScale !== null) {
        const scale = parseFloat(savedScale)
        if (!isNaN(scale)) {
          this.uiScale = this.uiScaleSaved = this._clampUiScale(scale)
        }
      }
      this._applyUiScale()

      // Apply immediately with no transition so the page starts in the right state
      this._applyInstant()

      if (this.mode === 'auto') {
        this._startCycle()
      }

      // Fetch shared prefs from the master (async — overrides localStorage
      // once resolved). Silently ignored if offline / server unreachable.
      this.pullPrefs().catch(() => {})
    },

    /**
     * Serialise the persisted prefs and PUT to the server so every other
     * screen (via SSE) picks them up. Fire-and-forget.
     */
    _pushPrefs() {
      if (!import.meta.client) return
      const payload = {
        mode:           this.mode,
        accentHue:      this.accentHueSaved,
        accentSat:      this.accentSatSaved,
        accentLit:      this.accentLitSaved,
        darkVariant:    this.darkVariantSaved,
        lightVariant:   this.lightVariantSaved,
        customPalettes: this.customPalettes,
        uiScale:        this.uiScaleSaved,
      }
      $fetch('/api/preferences', { method: 'PUT', body: payload }).catch(() => {})
    },

    /**
     * Fetch shared prefs from the server and apply them locally, mirroring
     * everything to localStorage so the next cold boot starts in-sync.
     */
    async pullPrefs() {
      if (!import.meta.client) return
      const prefs = await $fetch<Record<string, unknown>>('/api/preferences').catch(() => null)
      if (!prefs) return

      const wasAuto = this.mode === 'auto'
      let changed = false

      if (typeof prefs.mode === 'string' && ['light', 'dark', 'auto'].includes(prefs.mode) && prefs.mode !== this.mode) {
        this.mode = prefs.mode as ThemeMode
        localStorage.setItem(STORAGE_KEY, this.mode)
        changed = true
      }
      if (typeof prefs.accentHue === 'number' && prefs.accentHue !== this.accentHueSaved) {
        this.accentHue = this.accentHueSaved = prefs.accentHue as number
        localStorage.setItem(ACCENT_KEY, String(prefs.accentHue))
        changed = true
      }
      if (typeof prefs.accentSat === 'number' && prefs.accentSat !== this.accentSatSaved) {
        this.accentSat = this.accentSatSaved = prefs.accentSat as number
        localStorage.setItem(ACCENT_SAT_KEY, String(prefs.accentSat))
        changed = true
      }
      if (typeof prefs.accentLit === 'number' && prefs.accentLit !== this.accentLitSaved) {
        this.accentLit = this.accentLitSaved = prefs.accentLit as number
        localStorage.setItem(ACCENT_LIT_KEY, String(prefs.accentLit))
        changed = true
      }
      if (typeof prefs.darkVariant === 'string' && prefs.darkVariant !== this.darkVariantSaved) {
        this.darkVariant = this.darkVariantSaved = prefs.darkVariant as string
        localStorage.setItem(DARK_VAR_KEY, this.darkVariant)
        changed = true
      }
      if (typeof prefs.lightVariant === 'string' && prefs.lightVariant !== this.lightVariantSaved) {
        this.lightVariant = this.lightVariantSaved = prefs.lightVariant as string
        localStorage.setItem(LIGHT_VAR_KEY, this.lightVariant)
        changed = true
      }
      if (Array.isArray(prefs.customPalettes)) {
        this.customPalettes = prefs.customPalettes as CustomPalette[]
        localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(this.customPalettes))
        changed = true
      }
      if (typeof prefs.uiScale === 'number') {
        const scale = this._clampUiScale(prefs.uiScale as number)
        if (scale !== this.uiScaleSaved) {
          this.uiScale = this.uiScaleSaved = scale
          localStorage.setItem(UI_SCALE_KEY, String(scale))
          this._applyUiScale()
          changed = true
        }
      }

      if (!changed) return

      // Re-apply everything based on the (possibly new) mode.
      if (this.mode === 'auto') {
        if (!wasAuto) this._startCycle()
        this._applyBrightness(this.brightness)
      } else {
        if (wasAuto) this._stopCycle()
        this.apply()
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
      this._pushPrefs()
    },

    /** Preview accent hue live — resets S/L to defaults (used by presets). */
    setAccentHue(hue: number) {
      this.accentHue = hue
      this.accentSat = DEFAULT_ACCENT_SAT
      this.accentLit = DEFAULT_ACCENT_LIT
      if (this.mode === 'auto') {
        this._applyBrightness(this.brightness)
      } else {
        this._applyAccentVars(this.isDark)
      }
    },

    /** Preview a fully custom accent color (hue + saturation + lightness). */
    setAccentColor(hue: number, sat: number, lit: number) {
      this.accentHue = hue
      this.accentSat = sat
      this.accentLit = lit
      if (this.mode === 'auto') {
        this._applyBrightness(this.brightness)
      } else {
        this._applyAccentVars(this.isDark)
      }
    },

    /** Persist the current accent color (hue, sat, lit) to localStorage. */
    saveAccentHue() {
      if (typeof window !== 'undefined') {
        localStorage.setItem(ACCENT_KEY,     String(this.accentHue))
        localStorage.setItem(ACCENT_SAT_KEY, String(this.accentSat))
        localStorage.setItem(ACCENT_LIT_KEY, String(this.accentLit))
      }
      this.accentHueSaved = this.accentHue
      this.accentSatSaved = this.accentSat
      this.accentLitSaved = this.accentLit
      this._pushPrefs()
    },

    /** Set dark palette variant and apply immediately. */
    setDarkVariant(v: string) {
      this.darkVariant = v
      if (this.mode === 'auto') this._applyBrightness(this.brightness)
      else if (this.isDark) this._setDark(true)
    },

    /** Set light palette variant and apply immediately. */
    setLightVariant(v: string) {
      this.lightVariant = v
      if (this.mode === 'auto') this._applyBrightness(this.brightness)
      else if (!this.isDark) this._setDark(false)
    },

    /** Persist the current palette variants to localStorage. */
    savePaletteVariants() {
      if (typeof window !== 'undefined') {
        localStorage.setItem(DARK_VAR_KEY,  this.darkVariant)
        localStorage.setItem(LIGHT_VAR_KEY, this.lightVariant)
      }
      this.darkVariantSaved  = this.darkVariant
      this.lightVariantSaved = this.lightVariant
      this._pushPrefs()
    },

    // ── UI scale ─────────────────────────────────────────────────────────────

    _clampUiScale(v: number): number {
      if (isNaN(v)) return DEFAULT_UI_SCALE
      return Math.max(MIN_UI_SCALE, Math.min(MAX_UI_SCALE, v))
    },

    /** Apply the current UI scale to the root font-size (rem base). */
    _applyUiScale() {
      if (typeof document === 'undefined') return
      document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * this.uiScale}px`
    },

    /** Preview a UI scale value live (rounded to the nearest 5%). */
    setUiScale(v: number) {
      this.uiScale = this._clampUiScale(Math.round(v * 20) / 20)
      this._applyUiScale()
    },

    /** Persist the current UI scale to localStorage. */
    saveUiScale() {
      if (typeof window !== 'undefined') {
        localStorage.setItem(UI_SCALE_KEY, String(this.uiScale))
      }
      this.uiScaleSaved = this.uiScale
      this._pushPrefs()
    },

    // ── Custom palette CRUD ──────────────────────────────────────────────────

    _saveCustomPalettes() {
      if (typeof window !== 'undefined')
        localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(this.customPalettes))
      this._pushPrefs()
    },

    /** Resolve the active dark palette (preset or custom). */
    _getDarkPalette(): Palette {
      if (this.darkVariant in DARK_PALETTES) return DARK_PALETTES[this.darkVariant as DarkVariant]
      return (this.customPalettes.find(p => p.id === this.darkVariant) ?? DARK_PALETTES.slate)
    },

    /** Resolve the active light palette (preset or custom). */
    _getLightPalette(): Palette {
      if (this.lightVariant in LIGHT_PALETTES) return LIGHT_PALETTES[this.lightVariant as LightVariant]
      return (this.customPalettes.find(p => p.id === this.lightVariant) ?? LIGHT_PALETTES.warm)
    },

    /** Clone the current active palette for the given type and save as a new custom palette. */
    addCustomPalette(type: 'dark' | 'light'): string {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
      const base: Palette = type === 'dark' ? this._getDarkPalette() : this._getLightPalette()
      const count = (this.customPalettes ?? []).filter(p => p.type === type).length + 1
      const p: CustomPalette = { ...base, id, name: `Custom ${type} ${count}`, type }
      this.customPalettes.push(p)
      this._saveCustomPalettes()
      // Auto-select the new palette
      if (type === 'dark') this.setDarkVariant(id)
      else this.setLightVariant(id)
      return id
    },

    updateCustomPalette(id: string, updates: Partial<CustomPalette>) {
      const idx = this.customPalettes.findIndex(p => p.id === id)
      if (idx === -1) return
      Object.assign(this.customPalettes[idx], updates)
      this._saveCustomPalettes()
      // Re-render if currently active
      if (this.darkVariant === id || this.lightVariant === id) this.apply()
    },

    deleteCustomPalette(id: string) {
      this.customPalettes = this.customPalettes.filter(p => p.id !== id)
      this._saveCustomPalettes()
      if (this.darkVariant === id)  this.setDarkVariant('slate')
      if (this.lightVariant === id) this.setLightVariant('warm')
    },

    /** Export all custom palettes as a JSON string. */
    exportCustomPalettes(): string {
      return JSON.stringify({ version: 1, palettes: this.customPalettes }, null, 2)
    },

    /** Import palettes from a JSON string (merges by ID). */
    importCustomPalettes(json: string) {
      const data = JSON.parse(json)
      const incoming: CustomPalette[] = data.palettes ?? (Array.isArray(data) ? data : [])
      for (const p of incoming) {
        if (!p.id || !p.name || !p.type) continue
        const idx = this.customPalettes.findIndex(x => x.id === p.id)
        if (idx !== -1) this.customPalettes[idx] = p
        else this.customPalettes.push(p)
      }
      this._saveCustomPalettes()
    },

    /** Write --accent and --accent-dim CSS vars for the given dark/light state. */
    _applyAccentVars(dark: boolean) {
      if (typeof document === 'undefined') return
      const h = this.accentHue
      const s = this.accentSat
      const l = this.accentLit
      // Scale S/L proportionally for light mode to match the canonical dark→light ratio
      const sLight = Math.round(s * (70 / 78))
      const lLight = Math.round(l * (42 / 62))
      const root = document.documentElement
      if (dark) {
        root.style.setProperty('--accent',     hslToRgbTriplet(h, s, l))
        root.style.setProperty('--accent-dim', hslToRgbTriplet(h, Math.max(0, s - 6), Math.max(0, l - 16)))
      } else {
        root.style.setProperty('--accent',     hslToRgbTriplet(h, sLight, lLight))
        root.style.setProperty('--accent-dim', hslToRgbTriplet(h, Math.max(0, sLight - 2), Math.max(0, lLight - 7)))
      }
    },

    /** Write all palette CSS vars (bg, fg, scene) for the given dark/light state. */
    _applyPaletteVars(dark: boolean) {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      const p = dark ? this._getDarkPalette() : this._getLightPalette()
      root.style.setProperty('--bg',          p.bg)
      root.style.setProperty('--bg-panel',    p.bgPanel)
      root.style.setProperty('--bg-elevated', p.bgElevated)
      root.style.setProperty('--fg',          p.fg)
      root.style.setProperty('--fg-muted',    p.fgMuted)
      root.style.setProperty('--scene-clear',     `"${p.sceneClear}"`)
      root.style.setProperty('--scene-floor',     `"${p.sceneFloor}"`)
      root.style.setProperty('--scene-wall',      `"${p.sceneWall}"`)
      root.style.setProperty('--scene-furniture', `"${p.sceneFurniture}"`)
      root.style.setProperty('--scene-ambient',   `"${p.sceneAmbient}"`)
      root.style.setProperty('--scene-sun',       `"${p.sceneSun}"`)
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

      const dk = this._getDarkPalette()
      const lk = this._getLightPalette()

      // Main background — smooth linear sweep (ambient "sky" lighting effect only)
      root.style.setProperty('--bg', lerpRgbTriplet(dk.bg, lk.bg, t))

      // Panel backgrounds + text — wider window (t 0.35→0.65) with smoothstep easing
      // so the dawn/dusk crossfade feels organic rather than linear.
      const tUIRaw = Math.max(0, Math.min(1, (t - 0.35) / 0.3))
      const tUI = tUIRaw * tUIRaw * (3 - 2 * tUIRaw) // smoothstep
      root.style.setProperty('--bg-panel',    lerpRgbTriplet(dk.bgPanel,    lk.bgPanel,    tUI))
      root.style.setProperty('--bg-elevated', lerpRgbTriplet(dk.bgElevated, lk.bgElevated, tUI))
      root.style.setProperty('--fg',          lerpRgbTriplet(dk.fg,         lk.fg,         tUI))
      root.style.setProperty('--fg-muted',    lerpRgbTriplet(dk.fgMuted,    lk.fgMuted,    tUI))

      // Hex scene colour vars (stored as quoted strings in CSS)
      root.style.setProperty('--scene-clear',     `"${lerpHex(dk.sceneClear,     lk.sceneClear,     t)}"`)
      root.style.setProperty('--scene-floor',     `"${lerpHex(dk.sceneFloor,     lk.sceneFloor,     t)}"`)
      root.style.setProperty('--scene-wall',      `"${lerpHex(dk.sceneWall,      lk.sceneWall,      t)}"`)
      root.style.setProperty('--scene-furniture', `"${lerpHex(dk.sceneFurniture, lk.sceneFurniture, t)}"`)

      // Numeric scene vars (quoted strings) — interpolate between palette endpoints
      const dkAmb = parseFloat(dk.sceneAmbient), lkAmb = parseFloat(lk.sceneAmbient)
      const dkSun = parseFloat(dk.sceneSun),     lkSun = parseFloat(lk.sceneSun)
      root.style.setProperty('--scene-ambient', `"${(dkAmb + (lkAmb - dkAmb) * t).toFixed(3)}"`)
      root.style.setProperty('--scene-sun',     `"${(dkSun + (lkSun - dkSun) * t).toFixed(3)}"`)

      // Accent — interpolate saturation and lightness between dark and light values
      const h = this.accentHue
      const sDark = this.accentSat
      const lDark = this.accentLit
      const sLight = Math.round(sDark * (70 / 78))
      const lLight = Math.round(lDark * (42 / 62))
      const s    = sDark + (sLight - sDark) * t
      const l    = lDark + (lLight - lDark) * t
      const lDim = (lDark - 16) + ((lLight - 7) - (lDark - 16)) * t
      root.style.setProperty('--accent',     hslToRgbTriplet(h, s, l))
      root.style.setProperty('--accent-dim', hslToRgbTriplet(h, Math.max(0, s - 4), Math.max(0, lDim)))

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
      // Restore correct state for current mode
      this.apply()
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
        this._applyPaletteVars(dark)
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
