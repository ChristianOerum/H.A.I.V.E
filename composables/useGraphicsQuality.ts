/**
 * Per-device 3D quality tier, plus small helpers the scene uses to stay cheap
 * on weak hardware (Raspberry Pi panels, old tablets).
 *
 * The setting is stored in localStorage rather than the shared server prefs:
 * every screen has its own GPU, so a Pi panel and a desktop browser opening
 * the same house should each pick what suits them.
 *
 *  - 'auto' guesses from the GPU / device (see detectLowEnd)
 *  - 'high' / 'low' / 'potato' force a tier (Auto never picks potato)
 */

export type GraphicsQuality = 'auto' | 'high' | 'low' | 'potato'
export type GraphicsTier = 'high' | 'low' | 'potato'

export interface TierSettings {
  /** TresCanvas dpr range — high-DPI screens are capped so pixel count stays sane. */
  dpr: [number, number]
  /**
   * Whether any light casts shadows. Off skips every shadow pass and shadow
   * lookup. Toggled per light (castShadow), not on the renderer, because three
   * only rebuilds material shaders when the shadow-casting light count changes.
   */
  shadows: boolean
  /** Cube shadow map face size for lamps / TV spots. 0.12 m walls stay crisp at 256+. */
  lampShadowSize: number
  /** Sun shadow map size (single 2D map). */
  sunShadowSize: number
  /** Fraction of weather particles / cloud puffs / fog puffs drawn. */
  weatherScale: number
  /** Frame-rate cap for ambient animation (weather, speakers, appliances). 0 = uncapped. */
  ambientFps: number
}

const TIERS: Record<GraphicsTier, TierSettings> = {
  high: { dpr: [1, 1.5], shadows: true, lampShadowSize: 512, sunShadowSize: 2048, weatherScale: 1, ambientFps: 0 },
  low: { dpr: [1, 1], shadows: true, lampShadowSize: 256, sunShadowSize: 1024, weatherScale: 0.5, ambientFps: 30 },
  // Last resort for very weak hardware: no shadows (lamp light can then spill
  // through walls), 3/4-resolution 3D, sparse weather, 20 fps ambient motion.
  potato: { dpr: [0.75, 0.75], shadows: false, lampShadowSize: 256, sunShadowSize: 1024, weatherScale: 0.25, ambientFps: 20 },
}

const STORAGE_KEY = 'haive.graphicsQuality'

// Module-level singletons — one setting per page.
const quality = ref<GraphicsQuality>('auto')
const detectedLow = ref(false)
/** While true the main scene's render loop is paused (e.g. a fullscreen 3D editor is open). */
const sceneSuspended = ref(false)

/**
 * Best-effort low-end check: Pi / mobile-class GPUs, software rasterisers, or
 * devices reporting very little memory or few cores.
 */
function detectLowEnd(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number }
    if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return true
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      if (/V3D|VideoCore|Mali|PowerVR|Adreno|SwiftShader|llvmpipe|softpipe|Software/i.test(renderer)) return true
    }
    if ((navigator.hardwareConcurrency ?? 8) <= 2) return true
  } catch {
    // Detection is a hint only — fall through to high.
  }
  return false
}

if (import.meta.client) {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'auto' || saved === 'high' || saved === 'low' || saved === 'potato') quality.value = saved
  detectedLow.value = detectLowEnd()
}

const tier = computed<GraphicsTier>(() =>
  quality.value === 'auto' ? (detectedLow.value ? 'low' : 'high') : quality.value,
)
const settings = computed<TierSettings>(() => TIERS[tier.value])

export function useGraphicsQuality() {
  function setQuality(q: GraphicsQuality) {
    quality.value = q
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, q)
  }
  return { quality, tier, settings, detectedLow, sceneSuspended, setQuality }
}

/**
 * Frame gate for continuously animating scene effects. Call `step(elapsed)`
 * from a loop callback each tick: it returns the seconds since this effect last
 * advanced, or 0 when the effect should skip this tick (low tier caps ambient
 * motion at `ambientFps`). Gating on the shared loop clock keeps every effect
 * landing on the same rendered frames.
 */
export function useAmbientGate() {
  let lastSlot = -1
  let lastElapsed = -1
  return {
    step(elapsed: number): number {
      const fps = settings.value.ambientFps
      if (fps > 0) {
        const slot = Math.floor(elapsed * fps)
        if (slot === lastSlot) return 0
        lastSlot = slot
      }
      // The loop clock restarts from 0 after a pause, so a negative step just re-syncs.
      const dt = lastElapsed < 0 || elapsed < lastElapsed ? 0 : elapsed - lastElapsed
      lastElapsed = elapsed
      return dt
    },
  }
}
