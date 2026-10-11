/**
 * Where the phone's back camera points, from the motion sensors. Used by the
 * room scanner on phones without WebXR AR (iPhones): the user holds the phone
 * at a known height and aims at the floor, and the tilt and heading give the
 * floor point (pages/scan.vue).
 *
 * World frame: x east, y up, z south, like a WebXR session. The heading has an
 * arbitrary but fixed zero for as long as the page is open.
 */
export type Vec3 = [number, number, number]

/** Below this angle under the horizon a floor point is too far off to be useful. */
const MIN_DIP = Math.sin((6 * Math.PI) / 180)
const SAMPLE_WINDOW_MS = 1500

/** Direction of the back camera (device -Z) for a deviceorientation reading. */
export function cameraDirection(alpha: number, beta: number, gamma: number): Vec3 {
  const r = Math.PI / 180
  const cA = Math.cos(alpha * r), sA = Math.sin(alpha * r)
  const cB = Math.cos(beta * r), sB = Math.sin(beta * r)
  const cG = Math.cos(gamma * r), sG = Math.sin(gamma * r)
  // Third column of the W3C rotation matrix Rz(α)·Rx(β)·Ry(γ), in east/north/up, negated.
  const east = -(cA * sG + cG * sA * sB)
  const north = -(sA * sG - cA * cG * sB)
  const up = -(cB * cG)
  return [east, up, -north]
}

/** Where a ray from a camera `height` metres above the floor at `from` meets the floor, or null if it doesn't. */
export function floorPoint(dir: Vec3, height: number, from: Vec3): Vec3 | null {
  const len = Math.hypot(...dir)
  if (!len || dir[1] / len > -MIN_DIP) return null
  const t = height / -dir[1]
  return [from[0] + dir[0] * t, 0, from[2] + dir[2] * t]
}

export function useAimTracker() {
  const samples: { t: number; d: Vec3 }[] = []
  let listening = false

  function onOrientation(e: DeviceOrientationEvent) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    const t = performance.now()
    samples.push({ t, d: cameraDirection(e.alpha, e.beta, e.gamma) })
    while (samples.length && samples[0]!.t < t - SAMPLE_WINDOW_MS) samples.shift()
  }

  /**
   * Asks for sensor access. iOS only shows the prompt when this runs straight
   * from a tap, so call it before awaiting anything else.
   */
  function requestPermission(): Promise<boolean> {
    const D = (globalThis as any).DeviceOrientationEvent
    if (typeof D?.requestPermission !== 'function') return Promise.resolve(true)
    return D.requestPermission().then((r: string) => r === 'granted', () => false)
  }

  /** Starts listening; resolves false if no reading arrives (no sensors). */
  async function start(): Promise<boolean> {
    if (!listening) {
      window.addEventListener('deviceorientation', onOrientation)
      listening = true
    }
    for (let i = 0; i < 20 && !samples.length; i++) await new Promise((r) => setTimeout(r, 50))
    return samples.length > 0
  }

  function stop() {
    window.removeEventListener('deviceorientation', onOrientation)
    listening = false
    samples.length = 0
  }

  /**
   * Average camera direction between `fromMs` and `toMs` ago. The default
   * window ends just before now, so the jolt of a tap doesn't move the point.
   */
  function direction(fromMs = 300, toMs = 40): Vec3 | null {
    const now = performance.now()
    const sum: Vec3 = [0, 0, 0]
    let n = 0
    for (const s of samples) {
      if (s.t < now - fromMs || s.t > now - toMs) continue
      sum[0] += s.d[0]; sum[1] += s.d[1]; sum[2] += s.d[2]
      n++
    }
    if (!n) {
      // Sensors report only on change; a perfectly still phone keeps its last reading.
      const last = samples.at(-1)
      return last && last.t > now - SAMPLE_WINDOW_MS ? last.d : null
    }
    return [sum[0] / n, sum[1] / n, sum[2] / n]
  }

  /** True while readings keep arriving. */
  function alive() {
    const last = samples.at(-1)
    return !!last && performance.now() - last.t < SAMPLE_WINDOW_MS
  }

  return { requestPermission, start, stop, direction, alive }
}
