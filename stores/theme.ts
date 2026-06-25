import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'cove.theme'
const COORD_KEY = 'cove.coords'

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
  }),
  getters: {
    wallOpacity: (state): number => WALL_OPACITY_VALUES[state.wallOpacityMode],
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

      // Enable the slow CSS transition for cycle mode (two rAFs to let the
      // initial instant-apply paint commit first)
      if (typeof document !== 'undefined') {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            document.documentElement.setAttribute('data-cycle', '')
          }),
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
      if (typeof document !== 'undefined') {
        document.documentElement.removeAttribute('data-cycle')
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
      this.isDark = dark
      const html = document.documentElement
      html.classList.toggle('dark', dark)
      html.classList.toggle('light', !dark)

      // Keep theme-color meta in sync
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) {
        const bg = getComputedStyle(html).getPropertyValue('--bg').trim()
        if (bg) meta.setAttribute('content', `rgb(${bg})`)
      }
      this.revision++
    },
  },
})
