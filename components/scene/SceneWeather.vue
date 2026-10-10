<script setup lang="ts">
/**
 * Renders live weather around the floorplan:
 *  - rain     : wind-slanted streaks fading toward the tail, splashing on the ground
 *  - snow     : tumbling flakes of varied size that sway on the wind and briefly settle
 *  - hail     : fast pellets that bounce-splash on the ground
 *  - clouds   : clustered cumulus billboards, darker underneath, storm-grey in bad
 *               weather; clusters passing over the house dim the sun (cloudShade)
 *  - fog      : low drifting haze puffs plus real exponential scene fog
 *  - lightning: jagged glowing bolts with a scene-wide flash
 *  - stars    : individually twinkling points (clear night)
 * Precipitation never falls inside rooms — drops end at the room's wall height,
 * as if hitting a roof. Every layer eases in/out (as does the sky colour) so a
 * condition change cross-fades instead of popping. Wind speed + bearing from the
 * HA entity drive slant and drift. Lives inside TresCanvas; objects are built
 * on the client (onMounted) so CanvasTextures never touch the SSR pass.
 */
import * as THREE from 'three'
import { useLoop, useTresContext } from '@tresjs/core'

const fp = useFloorplanStore()
const sceneColors = useSceneColors()
const {
  rainAmount, snowAmount, hailAmount, hasLightning, fogDensity, windMs, windDir,
  cloudCoverage, cloudDarkness, cloudShade, isFoggy, showStars, skyColor, skyTintAmount,
} = useWeather()
// Canvas loop (not the global render loop) so we can request frames: the scene
// renders on demand. The ambient gate caps the frame rate on low-end devices.
const { onBeforeRender } = useLoop()
const { scene } = useTresContext()
const quality = useGraphicsQuality()
const gate = useAmbientGate()
/** Fraction of particles / puffs drawn (quality tier); refreshed every frame. */
let scale = 1

const MARGIN = 5
const CLOUD_MARGIN = 14
const CEILING = 7
const RAIN_MAX = 1800
const SNOW_MAX = 1200
const HAIL_MAX = 600
const SPLASH_MAX = 384
const CLUSTERS = 22
const PUFFS = 8
const FOG_MAX = 110
const STAR_MAX = 260
/** Seconds of travel a rain streak spans — sets its length from its velocity. */
const RAIN_STREAK = 0.032
/** Seconds a snowflake rests on the ground before melting away. */
const SNOW_REST = 1.8

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
interface Roof { verts: [number, number][]; h: number; minX: number; maxX: number; minZ: number; maxZ: number }

/** AABB of all room vertices (with margin) — the volume weather falls through. */
const bounds = computed<Bounds>(() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const room of fp.rooms) {
    for (const [x, z] of room.vertices) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
  }
  if (!isFinite(minX)) {
    const [cx, cz] = fp.center
    return { minX: cx - 8, maxX: cx + 8, minZ: cz - 8, maxZ: cz + 8 }
  }
  return { minX: minX - MARGIN, maxX: maxX + MARGIN, minZ: minZ - MARGIN, maxZ: maxZ + MARGIN }
})

/** Room footprints + wall heights: precipitation over a room stops at its "roof". */
const roofs = computed<Roof[]>(() => fp.rooms.map((r) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of r.vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  return { verts: r.vertices, h: r.wallH ?? 2, minX, maxX, minZ, maxZ }
}))
let roofList: Roof[] = []

function pointInPoly(x: number, z: number, verts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, zi] = verts[i], [xj, zj] = verts[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
/** Height a falling particle lands at: a room's wall top, else the ground (0). */
function floorAt(x: number, z: number): number {
  for (const r of roofList) {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue
    if (pointInPoly(x, z, r.verts)) return r.h
  }
  return 0
}

function randX(b: Bounds) { return b.minX + Math.random() * (b.maxX - b.minX) }
function randZ(b: Bounds) { return b.minZ + Math.random() * (b.maxZ - b.minZ) }
function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v }
/** Frame-rate independent exponential approach of `cur` toward `target`. */
function ease(cur: number, target: number, rate: number, dt: number) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt))
}

// ── Shaders ──────────────────────────────────────────────────────────────────
// All weather materials are ShaderMaterials so each particle can carry its own
// size/alpha (PointsMaterial can't) and big puffs are quads, not GL points
// (point size is capped low on Pi-class GPUs).

const SHADE_OUT = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`

const SOFT_POINTS_VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
  }`
const SOFT_POINTS_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    ${SHADE_OUT}
  }`

const BILLBOARD_VERT = /* glsl */`
  attribute vec3 iOffset;
  attribute float iScale;
  attribute float iAlpha;
  attribute float iShade;
  attribute float iRot;
  uniform float uNear;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    float c = cos(iRot), s = sin(iRot);
    mv.xy += mat2(c, s, -s, c) * position.xy * iScale;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vShade = iShade;
    // Fade puffs that get close to the camera instead of filling the screen.
    vAlpha = iAlpha * smoothstep(uNear * 0.35, uNear, -mv.z);
  }`
const BILLBOARD_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  void main() {
    float a = texture2D(uMap, vUv).a * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * vShade, a);
    ${SHADE_OUT}
  }`

const SPLASH_VERT = /* glsl */`
  attribute vec3 iPos;
  attribute float iBirth;
  attribute float iSize;
  uniform float uTime;
  uniform float uLife;
  varying vec2 vUv;
  varying float vT;
  void main() {
    vT = (uTime - iBirth) / uLife;
    if (vT < 0.0 || vT > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position * iSize + iPos, 1.0);
    vUv = uv;
  }`
const SPLASH_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vT;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = 1.0 - smoothstep(0.0, 0.16, abs(r - vT));
    float a = ring * (1.0 - vT) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    ${SHADE_OUT}
  }`

// ── Textures ─────────────────────────────────────────────────────────────────

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  return new THREE.CanvasTexture(c)
}
function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, number][]) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`)
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}
/** Small soft dot — snowflakes, hail, stars. */
const makeDotTexture = () => canvasTexture(32, (ctx) =>
  radial(ctx, 16, 16, 16, [[0, 1], [0.45, 0.75], [1, 0]]))
/** Wide-falloff sprite for fog puffs. */
const makePuffTexture = () => canvasTexture(96, (ctx) =>
  radial(ctx, 48, 48, 48, [[0, 0.88], [0.28, 0.58], [0.55, 0.22], [0.8, 0.05], [1, 0]]))
/**
 * Lumpy cumulus puff: several overlapping soft blobs, masked by a radial falloff
 * so the silhouette is irregular but the edge never shows a hard boundary.
 */
const makeCloudTexture = () => canvasTexture(128, (ctx, s) => {
  const h = s / 2
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2
    const d = Math.random() * h * 0.38
    radial(ctx, h + Math.cos(a) * d, h + Math.sin(a) * d * 0.8, h * (0.3 + Math.random() * 0.25),
      [[0, 0.5], [0.5, 0.32], [1, 0]])
  }
  ctx.globalCompositeOperation = 'destination-in'
  radial(ctx, h, h, h, [[0, 1], [0.55, 0.85], [1, 0]])
})

// ── Object factories ─────────────────────────────────────────────────────────

const _buf = new THREE.Vector2()

interface SoftPoints { obj: THREE.Points; pos: Float32Array; size: Float32Array; alpha: Float32Array; mat: THREE.ShaderMaterial }
function makeSoftPoints(max: number, color: THREE.ColorRepresentation, map: THREE.Texture, opacity: number): SoftPoints {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage))
  const mat = new THREE.ShaderMaterial({
    vertexShader: SOFT_POINTS_VERT, fragmentShader: SOFT_POINTS_FRAG,
    uniforms: {
      uMap: { value: map }, uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity }, uScale: { value: 400 },
    },
    transparent: true, depthWrite: false,
  })
  const obj = new THREE.Points(geo, mat)
  obj.frustumCulled = false
  obj.renderOrder = 3
  // Match PointsMaterial's size attenuation: world size → pixels at this depth.
  obj.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(_buf)
    mat.uniforms.uScale.value = _buf.y * 0.5
  }
  return { obj, pos, size, alpha, mat }
}

interface Billboards {
  obj: THREE.Mesh; mat: THREE.ShaderMaterial
  offset: Float32Array; scale: Float32Array; alpha: Float32Array; shade: Float32Array; rot: Float32Array
}
function makeBillboards(max: number, map: THREE.Texture, depthTest: boolean): Billboards {
  const geo = new THREE.InstancedBufferGeometry()
  geo.copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry)
  geo.instanceCount = max
  const offset = new Float32Array(max * 3), scale = new Float32Array(max)
  const alpha = new Float32Array(max), shade = new Float32Array(max), rot = new Float32Array(max)
  geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offset, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(scale, 1))
  geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('iShade', new THREE.InstancedBufferAttribute(shade, 1))
  geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1))
  const mat = new THREE.ShaderMaterial({
    vertexShader: BILLBOARD_VERT, fragmentShader: BILLBOARD_FRAG,
    uniforms: {
      uMap: { value: map }, uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 1 }, uNear: { value: 4 },
    },
    transparent: true, depthWrite: false, depthTest,
  })
  const obj = new THREE.Mesh(geo, mat)
  obj.frustumCulled = false
  obj.renderOrder = 3
  return { obj, mat, offset, scale, alpha, shade, rot }
}

function flag(geo: THREE.BufferGeometry, ...names: string[]) {
  for (const n of names) (geo.attributes[n] as THREE.BufferAttribute).needsUpdate = true
}

// ── Scene objects (client-only) ──────────────────────────────────────────────

const root = shallowRef<THREE.Group>()
let rain: THREE.LineSegments | undefined
let rainPos = new Float32Array(0)
let snow: SoftPoints | undefined
let hail: SoftPoints | undefined
let stars: SoftPoints | undefined
let clouds: Billboards | undefined
let fogPuffs: Billboards | undefined
let splash: THREE.Mesh | undefined
let splashMat: THREE.ShaderMaterial | undefined
let bolt: THREE.Group | undefined
let flashSun: THREE.DirectionalLight | undefined
let flashFill: THREE.AmbientLight | undefined
let sceneFog: THREE.FogExp2 | undefined
let prevFog: THREE.Fog | THREE.FogExp2 | null = null
let prevBackground: THREE.Scene['background'] = null

// ── Per-particle state (plain typed arrays — intentionally non-reactive) ─────

const rainX = new Float32Array(RAIN_MAX), rainY = new Float32Array(RAIN_MAX), rainZ = new Float32Array(RAIN_MAX)
const rainV = new Float32Array(RAIN_MAX), rainFloor = new Float32Array(RAIN_MAX)

const snowX = new Float32Array(SNOW_MAX), snowY = new Float32Array(SNOW_MAX), snowZ = new Float32Array(SNOW_MAX)
const snowV = new Float32Array(SNOW_MAX), snowPh = new Float32Array(SNOW_MAX), snowSway = new Float32Array(SNOW_MAX)
const snowFloor = new Float32Array(SNOW_MAX), snowRest = new Float32Array(SNOW_MAX)

const hailX = new Float32Array(HAIL_MAX), hailY = new Float32Array(HAIL_MAX), hailZ = new Float32Array(HAIL_MAX)
const hailV = new Float32Array(HAIL_MAX), hailFloor = new Float32Array(HAIL_MAX)

const clX = new Float32Array(CLUSTERS), clY = new Float32Array(CLUSTERS), clZ = new Float32Array(CLUSTERS)
const clSpd = new Float32Array(CLUSTERS), clR = new Float32Array(CLUSTERS)
const puffDX = new Float32Array(CLUSTERS * PUFFS), puffDY = new Float32Array(CLUSTERS * PUFFS)
const puffDZ = new Float32Array(CLUSTERS * PUFFS)

const fogX = new Float32Array(FOG_MAX), fogZ = new Float32Array(FOG_MAX), fogYBase = new Float32Array(FOG_MAX)
const fogPh = new Float32Array(FOG_MAX), fogSpd = new Float32Array(FOG_MAX), fogSide = new Float32Array(FOG_MAX)

const starPh = new Float32Array(STAR_MAX), starF = new Float32Array(STAR_MAX), starBase = new Float32Array(STAR_MAX)

let splashHead = 0
let splashDirty = false

/** Smoothed layer levels — eased toward the reactive targets every frame. */
const lv = {
  rain: 0, snow: 0, hail: 0, cloud: 0, dark: 0, fog: 0, fogDensity: 0, stars: 0,
  windX: 0, windZ: 0, shade: 1,
}
let time = 0

// Wind displacement applied to each layer (fraction of the wind vector).
const RAIN_WIND = 0.35
const SNOW_WIND = 0.5
const HAIL_WIND = 0.2

function spawnSplash(x: number, y: number, z: number, size: number) {
  if (!splash) return
  const geo = splash.geometry
  const i = splashHead
  splashHead = (splashHead + 1) % SPLASH_MAX
  const p = geo.attributes.iPos.array as Float32Array
  p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z
  ;(geo.attributes.iBirth.array as Float32Array)[i] = time
  ;(geo.attributes.iSize.array as Float32Array)[i] = size
  splashDirty = true
}

/** Respawn a falling particle above the bounds, offset upwind so it lands inside. */
function respawnFaller(
  i: number, b: Bounds, xs: Float32Array, ys: Float32Array, zs: Float32Array,
  vs: Float32Array, floors: Float32Array, windK: number, y: number,
) {
  const lx = randX(b), lz = randZ(b)
  const tFall = y / vs[i]
  xs[i] = lx - lv.windX * windK * tFall
  zs[i] = lz - lv.windZ * windK * tFall
  ys[i] = y
  floors[i] = floorAt(lx, lz)
}

function seed() {
  const b = bounds.value
  roofList = roofs.value
  for (let i = 0; i < RAIN_MAX; i++) {
    rainV[i] = 9 + Math.random() * 5
    respawnFaller(i, b, rainX, rainY, rainZ, rainV, rainFloor, RAIN_WIND, Math.random() * CEILING)
  }
  for (let i = 0; i < SNOW_MAX; i++) {
    snowV[i] = 0.6 + Math.random() * 0.8
    snowPh[i] = Math.random() * Math.PI * 2
    snowSway[i] = 0.15 + Math.random() * 0.4
    snowRest[i] = 0
    respawnFaller(i, b, snowX, snowY, snowZ, snowV, snowFloor, SNOW_WIND, Math.random() * CEILING)
    if (snow) snow.size[i] = 0.07 + Math.random() * 0.11
  }
  for (let i = 0; i < HAIL_MAX; i++) {
    hailV[i] = 8 + Math.random() * 4
    respawnFaller(i, b, hailX, hailY, hailZ, hailV, hailFloor, HAIL_WIND, Math.random() * CEILING)
    if (hail) hail.size[i] = 0.05 + Math.random() * 0.04
  }

  // Cloud clusters spread over a wider box so they extend past the walls. Each
  // cluster is a dome of puffs: flat-ish base, piled higher toward the middle,
  // shaded darker underneath.
  const cw = b.minX - CLOUD_MARGIN, ce = b.maxX + CLOUD_MARGIN
  const cn = b.minZ - CLOUD_MARGIN, cs = b.maxZ + CLOUD_MARGIN
  for (let c = 0; c < CLUSTERS; c++) {
    clX[c] = cw + Math.random() * (ce - cw)
    clZ[c] = cn + Math.random() * (cs - cn)
    clY[c] = 5.2 + Math.random() * 1.6
    clSpd[c] = 0.75 + Math.random() * 0.5
    const r = clR[c] = 2.2 + Math.random() * 2.2
    for (let k = 0; k < PUFFS; k++) {
      const i = c * PUFFS + k
      const a = Math.random() * Math.PI * 2
      const d = Math.sqrt(Math.random()) * r
      const dome = 1 - (d / r) ** 2
      puffDX[i] = Math.cos(a) * d
      puffDZ[i] = Math.sin(a) * d * 0.6
      puffDY[i] = dome * (0.4 + Math.random() * 0.6) * r * 0.35
      if (clouds) {
        clouds.scale[i] = (2.2 + Math.random() * 1.6) * (0.75 + 0.5 * dome) * (r / 3.3)
        clouds.shade[i] = 0.7 + 0.3 * (puffDY[i] / (r * 0.35))
        clouds.rot[i] = Math.random() * Math.PI * 2
      }
    }
  }

  for (let i = 0; i < FOG_MAX; i++) {
    fogX[i] = randX(b); fogZ[i] = randZ(b)
    // Bias fog to waist-height; avoids floor-plane z-fighting and keeps it visible
    fogYBase[i] = Math.random() < 0.65 ? 0.5 + Math.random() * 0.8 : 1.3 + Math.random() * 1.2
    fogPh[i] = Math.random() * Math.PI * 2
    fogSpd[i] = 0.06 + Math.random() * 0.18
    fogSide[i] = (Math.random() - 0.5) * 0.15
    if (fogPuffs) {
      fogPuffs.scale[i] = 4.5 + Math.random() * 3
      fogPuffs.shade[i] = 0.92 + Math.random() * 0.08
      fogPuffs.rot[i] = Math.random() * Math.PI * 2
    }
  }

  if (stars) {
    for (let i = 0; i < STAR_MAX; i++) {
      stars.pos[i * 3] = cw + Math.random() * (ce - cw)
      stars.pos[i * 3 + 1] = 5 + Math.random() * 3
      stars.pos[i * 3 + 2] = cn + Math.random() * (cs - cn)
      // Mostly faint pin-pricks with a few bright ones.
      const bright = Math.random() ** 3
      stars.size[i] = 0.05 + bright * 0.12
      starBase[i] = 0.45 + bright * 0.55
      starPh[i] = Math.random() * Math.PI * 2
      starF[i] = 0.8 + Math.random() * 2.8
    }
    flag(stars.obj.geometry, 'position', 'aSize')
  }
  if (snow) flag(snow.obj.geometry, 'aSize')
  if (hail) flag(hail.obj.geometry, 'aSize')
  if (clouds) flag(clouds.obj.geometry, 'iScale', 'iShade', 'iRot')
  if (fogPuffs) flag(fogPuffs.obj.geometry, 'iScale', 'iShade', 'iRot')
}

// ── Lightning ────────────────────────────────────────────────────────────────

let nextStrike = 3
let strikeAt = -10
/** Flicker envelope: a main stroke plus return strokes. */
const PULSES: [number, number][] = [[0, 1], [0.11, 0.55], [0.26, 0.85], [0.5, 0.3]]
const BOLT_LIFE = 0.75

function jaggedPath(from: THREE.Vector3, to: THREE.Vector3, segs: number, jitter: number): THREE.Vector3[] {
  const pts = [from.clone()]
  for (let s = 1; s < segs; s++) {
    const p = from.clone().lerp(to, s / segs)
    p.x += (Math.random() - 0.5) * jitter
    p.z += (Math.random() - 0.5) * jitter
    pts.push(p)
  }
  pts.push(to.clone())
  return pts
}
function tube(pts: THREE.Vector3[], radius: number, mat: THREE.Material): THREE.Mesh {
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]))
  return new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 3, radius, 5, false), mat)
}

/** Build a fresh bolt (main channel + a few branches) somewhere around the house. */
function strike() {
  if (!bolt || !flashSun) return
  for (const c of bolt.children) (c as THREE.Mesh).geometry.dispose()
  bolt.clear()
  const b = bounds.value
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
  const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2 + Math.random() * 9
  const a = Math.random() * Math.PI * 2
  const gx = cx + Math.cos(a) * radius, gz = cz + Math.sin(a) * radius
  const top = new THREE.Vector3(gx + (Math.random() - 0.5) * 3, 9, gz + (Math.random() - 0.5) * 3)
  const main = jaggedPath(top, new THREE.Vector3(gx, 0, gz), 16, 0.9)
  const [core, glow] = bolt.userData.mats as THREE.Material[]
  bolt.add(tube(main, 0.035, core), tube(main, 0.16, glow))
  const branches = 2 + Math.floor(Math.random() * 3)
  for (let k = 0; k < branches; k++) {
    const start = main[2 + Math.floor(Math.random() * (main.length - 8))]
    const end = start.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 5, -(1.5 + Math.random() * 2.5), (Math.random() - 0.5) * 5,
    ))
    const br = jaggedPath(start, end, 6, 0.6)
    bolt.add(tube(br, 0.018, core), tube(br, 0.09, glow))
  }
  flashSun.position.set(gx, 12, gz)
  flashSun.target.position.set(cx, 0, cz)
}

function flashLevel(t: number): number {
  let f = 0
  for (const [at, amp] of PULSES) if (t >= at) f += amp * Math.exp(-(t - at) * 16)
  return Math.min(1, f)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  const dot = makeDotTexture()
  const group = new THREE.Group()

  const rainGeo = new THREE.BufferGeometry()
  rainPos = new Float32Array(RAIN_MAX * 6)
  // Head opaque, tail transparent → streaks taper instead of reading as sticks.
  const rainCol = new Float32Array(RAIN_MAX * 8)
  for (let i = 0; i < RAIN_MAX; i++) {
    const o = i * 8
    rainCol.fill(1, o, o + 7)
    rainCol[o + 3] = 0.35 + Math.random() * 0.65
    rainCol[o + 7] = 0
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage))
  rainGeo.setAttribute('color', new THREE.BufferAttribute(rainCol, 4))
  rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
    color: 0xb4c6e0, vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false,
  }))
  rain.frustumCulled = false
  rain.renderOrder = 3

  snow = makeSoftPoints(SNOW_MAX, 0xffffff, dot, 0.95)
  hail = makeSoftPoints(HAIL_MAX, 0xe4ecf6, dot, 1)
  stars = makeSoftPoints(STAR_MAX, 0xdfe6ff, dot, 1)
  clouds = makeBillboards(CLUSTERS * PUFFS, makeCloudTexture(), true)
  fogPuffs = makeBillboards(FOG_MAX, makePuffTexture(), false)
  fogPuffs.mat.uniforms.uColor.value.set(0xc3ccd6)
  fogPuffs.mat.uniforms.uNear.value = 2.5

  // Splash rings — flat quads on the ground, animated entirely in the shader.
  const sGeo = new THREE.InstancedBufferGeometry()
  sGeo.copy(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) as unknown as THREE.InstancedBufferGeometry)
  sGeo.instanceCount = SPLASH_MAX
  sGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX * 3), 3))
  sGeo.setAttribute('iBirth', new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX).fill(-100), 1))
  sGeo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_MAX), 1))
  splashMat = new THREE.ShaderMaterial({
    vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(0xc8d6ea) }, uOpacity: { value: 0.55 },
      uTime: { value: 0 }, uLife: { value: 0.32 },
    },
    transparent: true, depthWrite: false,
  })
  splash = new THREE.Mesh(sGeo, splashMat)
  splash.frustumCulled = false
  splash.renderOrder = 3

  bolt = new THREE.Group()
  bolt.userData.mats = [
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false, toneMapped: false }),
    new THREE.MeshBasicMaterial({
      color: 0x9fb6ff, transparent: true, opacity: 0.3, fog: false, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  ]
  bolt.visible = false
  flashSun = new THREE.DirectionalLight(0xd8e0ff, 0)
  flashFill = new THREE.AmbientLight(0xc8d2ff, 0)

  group.add(stars.obj, clouds.obj, fogPuffs.obj, rain, snow.obj, hail.obj, splash, bolt,
    flashSun, flashSun.target, flashFill)
  root.value = group

  // Real depth haze. Kept on the scene permanently (density eased to 0 when
  // clear) so materials never recompile as conditions change.
  prevFog = scene.value.fog
  prevBackground = scene.value.background
  sceneFog = new THREE.FogExp2(0x000000, 0)
  scene.value.fog = sceneFog
  updateSkyTarget()
  bgColor.copy(bgTarget)
  bgShown.copy(bgColor)
  scene.value.background = bgShown

  seed()
})

watch([bounds, roofs], () => seed())

onBeforeUnmount(() => {
  root.value?.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (THREE.Material | undefined)[]
    for (const mat of mats) {
      if (!mat) continue
      const u = (mat as THREE.ShaderMaterial).uniforms
      u?.uMap?.value?.dispose()
      mat.dispose()
    }
  })
  for (const mat of (bolt?.userData.mats ?? []) as THREE.Material[]) mat.dispose()
  if (scene.value.fog === sceneFog) scene.value.fog = prevFog
  if (scene.value.background === bgShown) scene.value.background = prevBackground
  cloudShade.value = 1
})

// ── Sky colour (eased, so condition changes fade rather than snap) ──────────

const bgColor = new THREE.Color()
const bgTarget = new THREE.Color()
/** What's actually on screen: the eased sky plus any lightning flash. */
const bgShown = new THREE.Color()
const flashColor = new THREE.Color(0xc8d4ff)

/** Theme clear colour tinted toward the current weather's sky (as SceneRoot does). */
function updateSkyTarget() {
  const clear = sceneColors.value.clear
  bgTarget.set(skyTintAmount.value > 0 ? blendHex(clear, skyColor.value, skyTintAmount.value) : clear)
}

// ── Frame loop ───────────────────────────────────────────────────────────────

onBeforeRender(({ elapsed, invalidate }) => {
  if (!root.value) return
  const step = gate.step(elapsed)
  if (!step) return
  const dt = Math.min(step, 0.05)
  time += dt
  scale = quality.settings.value.weatherScale
  const b = bounds.value
  roofList = roofs.value

  // Ease every layer toward its target.
  lv.rain = ease(lv.rain, rainAmount.value, 0.8, dt)
  lv.snow = ease(lv.snow, snowAmount.value, 0.8, dt)
  lv.hail = ease(lv.hail, hailAmount.value, 0.8, dt)
  lv.cloud = ease(lv.cloud, cloudCoverage.value, 0.5, dt)
  lv.dark = ease(lv.dark, cloudDarkness.value, 0.6, dt)
  lv.fog = ease(lv.fog, isFoggy.value ? 1 : 0, 0.6, dt)
  lv.fogDensity = ease(lv.fogDensity, fogDensity.value, 0.6, dt)
  lv.stars = ease(lv.stars, showStars.value ? 1 : 0, 0.8, dt)
  const [dirX, dirZ] = windDir.value
  lv.windX = ease(lv.windX, dirX * windMs.value, 0.5, dt)
  lv.windZ = ease(lv.windZ, dirZ * windMs.value, 0.5, dt)

  // Sky + lightning flash.
  const sc = sceneColors.value
  updateSkyTarget()
  bgColor.lerp(bgTarget, 1 - Math.exp(-1.5 * dt))

  if (hasLightning.value && time >= nextStrike) {
    strike()
    strikeAt = time
    nextStrike = time + 2.5 + Math.random() * 6
  }
  const st = time - strikeAt
  const flash = st < BOLT_LIFE ? flashLevel(st) : 0
  if (bolt) {
    bolt.visible = flash > 0.02
    const [core, glow] = bolt.userData.mats as THREE.MeshBasicMaterial[]
    core.opacity = flash
    glow.opacity = flash * 0.35
  }
  if (flashSun) flashSun.intensity = flash * 3.2 * sc.sun
  if (flashFill) flashFill.intensity = flash * 0.9 * sc.ambient
  bgShown.copy(bgColor).lerp(flashColor, flash * 0.35)
  if (sceneFog) {
    sceneFog.color.copy(bgShown)
    sceneFog.density = lv.fogDensity
  }

  updateRain(b, dt)
  updateSnow(b, dt)
  updateHail(b, dt)
  updateClouds(b, dt)
  updateFog(b, dt)
  updateStars()

  if (splash && splashMat) {
    splashMat.uniforms.uTime.value = time
    splash.visible = lv.rain > 0.01 || lv.hail > 0.01
    if (splashDirty) { flag(splash.geometry, 'iPos', 'iBirth', 'iSize'); splashDirty = false }
  }

  // The scene renders on demand: only request a frame while something is on
  // screen or still easing. A clear, settled sky costs nothing.
  if (weatherMoving()) invalidate()
})

const SETTLED = 0.002
function settled(cur: number, target: number) { return Math.abs(cur - target) < SETTLED }
function weatherMoving(): boolean {
  if (rain?.visible || snow?.obj.visible || hail?.obj.visible || stars?.obj.visible) return true
  if (clouds?.obj.visible || fogPuffs?.obj.visible || splash?.visible || bolt?.visible) return true
  if (!settled(lv.fogDensity, fogDensity.value) || !settled(lv.shade, 1)) return true
  const [dirX, dirZ] = windDir.value
  if (!settled(lv.windX, dirX * windMs.value) || !settled(lv.windZ, dirZ * windMs.value)) return true
  return Math.abs(bgColor.r - bgTarget.r) + Math.abs(bgColor.g - bgTarget.g) + Math.abs(bgColor.b - bgTarget.b) > SETTLED
}

function updateRain(b: Bounds, dt: number) {
  if (!rain) return
  const n = Math.floor(RAIN_MAX * lv.rain * scale)
  rain.visible = n > 0
  if (!n) return
  const hx = lv.windX * RAIN_WIND, hz = lv.windZ * RAIN_WIND
  for (let i = 0; i < n; i++) {
    rainY[i] -= rainV[i] * dt
    rainX[i] += hx * dt
    rainZ[i] += hz * dt
    if (rainY[i] <= rainFloor[i]) {
      if (rainFloor[i] === 0 && Math.random() < 0.55) spawnSplash(rainX[i], 0.02, rainZ[i], 0.22 + Math.random() * 0.12)
      respawnFaller(i, b, rainX, rainY, rainZ, rainV, rainFloor, RAIN_WIND, CEILING + Math.random() * 2)
    }
    // Head at the drop, tail trailing back along its velocity.
    const o = i * 6, x = rainX[i], y = rainY[i], z = rainZ[i]
    rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z
    rainPos[o + 3] = x - hx * RAIN_STREAK
    rainPos[o + 4] = y + rainV[i] * RAIN_STREAK
    rainPos[o + 5] = z - hz * RAIN_STREAK
  }
  rain.geometry.setDrawRange(0, n * 2)
  flag(rain.geometry, 'position')
}

function updateSnow(b: Bounds, dt: number) {
  if (!snow) return
  const n = Math.floor(SNOW_MAX * lv.snow * scale)
  snow.obj.visible = n > 0
  if (!n) return
  const wx = lv.windX * SNOW_WIND, wz = lv.windZ * SNOW_WIND
  const top = CEILING + 2
  for (let i = 0; i < n; i++) {
    const o = i * 3
    if (snowRest[i] > 0) {
      // Settled on the ground — linger, then melt away and respawn.
      snowRest[i] -= dt
      snow.alpha[i] = Math.max(0, snowRest[i] / SNOW_REST)
      if (snowRest[i] <= 0) respawnFaller(i, b, snowX, snowY, snowZ, snowV, snowFloor, SNOW_WIND, CEILING + Math.random() * 1.5)
      else continue
    }
    const ph = snowPh[i], sway = snowSway[i]
    snowY[i] -= snowV[i] * dt
    snowX[i] += (wx + Math.sin(time * 0.7 + ph) * sway) * dt
    snowZ[i] += (wz + Math.cos(time * 0.53 + ph * 1.3) * sway * 0.7) * dt
    const floor = snowFloor[i]
    if (snowY[i] <= floor) {
      if (floor === 0) { snowY[i] = 0.02; snowRest[i] = SNOW_REST * (0.5 + Math.random() * 0.5) }
      else respawnFaller(i, b, snowX, snowY, snowZ, snowV, snowFloor, SNOW_WIND, CEILING + Math.random() * 1.5)
    }
    // Fade in from the clouds; fade out just above a roof (ground flakes settle).
    const fadeIn = clamp01((top - snowY[i]) / 1.2)
    const fadeOut = floor > 0 ? clamp01((snowY[i] - floor) / 0.3) : 1
    snow.alpha[i] = fadeIn * fadeOut
    snow.pos[o] = snowX[i]; snow.pos[o + 1] = snowY[i]; snow.pos[o + 2] = snowZ[i]
  }
  snow.obj.geometry.setDrawRange(0, n)
  flag(snow.obj.geometry, 'position', 'aAlpha')
}

function updateHail(b: Bounds, dt: number) {
  if (!hail) return
  const n = Math.floor(HAIL_MAX * lv.hail * scale)
  hail.obj.visible = n > 0
  if (!n) return
  const hx = lv.windX * HAIL_WIND, hz = lv.windZ * HAIL_WIND
  for (let i = 0; i < n; i++) {
    hailY[i] -= hailV[i] * dt
    hailX[i] += hx * dt
    hailZ[i] += hz * dt
    if (hailY[i] <= hailFloor[i]) {
      if (hailFloor[i] === 0) spawnSplash(hailX[i], 0.02, hailZ[i], 0.3 + Math.random() * 0.15)
      respawnFaller(i, b, hailX, hailY, hailZ, hailV, hailFloor, HAIL_WIND, CEILING + Math.random() * 2)
    }
    const o = i * 3
    hail.pos[o] = hailX[i]; hail.pos[o + 1] = hailY[i]; hail.pos[o + 2] = hailZ[i]
    hail.alpha[i] = clamp01((CEILING + 2 - hailY[i]) / 1.0)
  }
  hail.obj.geometry.setDrawRange(0, n)
  flag(hail.obj.geometry, 'position', 'aAlpha')
}

const STORM_GREY = new THREE.Color(0x58606d)
const CLOUD_WHITE = new THREE.Color(0xffffff)

function updateClouds(b: Bounds, dt: number) {
  if (!clouds) return
  clouds.obj.visible = lv.cloud > 0.005
  if (!clouds.obj.visible) {
    lv.shade = ease(lv.shade, 1, 1, dt)
    if (Math.abs(cloudShade.value - lv.shade) > 0.004) cloudShade.value = lv.shade
    return
  }
  const cw = b.minX - CLOUD_MARGIN, ce = b.maxX + CLOUD_MARGIN
  const cn = b.minZ - CLOUD_MARGIN, cs = b.maxZ + CLOUD_MARGIN
  const hx = (b.minX + b.maxX) / 2, hz = (b.minZ + b.maxZ) / 2
  const [dirX, dirZ] = windDir.value
  // Clouds ride faster winds aloft; never fully still.
  const speed = 0.25 + windMs.value * 0.07
  let overhead = 0
  // Low tier draws fewer clusters; the rest stay seeded but unused.
  const nc = Math.max(1, Math.round(CLUSTERS * scale))
  ;(clouds.obj.geometry as THREE.InstancedBufferGeometry).instanceCount = nc * PUFFS
  for (let c = 0; c < nc; c++) {
    clX[c] += dirX * speed * clSpd[c] * dt
    clZ[c] += dirZ * speed * clSpd[c] * dt
    if (clX[c] > ce) clX[c] -= ce - cw; else if (clX[c] < cw) clX[c] += ce - cw
    if (clZ[c] > cs) clZ[c] -= cs - cn; else if (clZ[c] < cn) clZ[c] += cs - cn
    // Clusters fade out near the box edge (so wrapping is invisible) and fade
    // in one at a time as coverage rises.
    const edge = Math.min(clX[c] - cw, ce - clX[c], clZ[c] - cn, cs - clZ[c])
    const a = clamp01(edge / 6) * clamp01(lv.cloud * nc - c)
    const dx = clX[c] - hx, dz = clZ[c] - hz
    overhead += a * Math.exp(-(dx * dx + dz * dz) / (clR[c] * clR[c] * 1.5))
    for (let k = 0; k < PUFFS; k++) {
      const i = c * PUFFS + k, o = i * 3
      clouds.offset[o] = clX[c] + puffDX[i]
      clouds.offset[o + 1] = clY[c] + puffDY[i]
      clouds.offset[o + 2] = clZ[c] + puffDZ[i]
      clouds.alpha[i] = a
    }
  }
  const u = clouds.mat.uniforms
  u.uColor.value.copy(CLOUD_WHITE).lerp(STORM_GREY, lv.dark)
  u.uOpacity.value = 0.5 + 0.3 * lv.dark
  flag(clouds.obj.geometry, 'iOffset', 'iAlpha')

  // A cloud drifting over the house dims the sun for a moment.
  lv.shade = ease(lv.shade, 1 - 0.38 * clamp01(overhead), 1, dt)
  if (Math.abs(cloudShade.value - lv.shade) > 0.004) cloudShade.value = lv.shade
}

function updateFog(b: Bounds, dt: number) {
  if (!fogPuffs) return
  fogPuffs.obj.visible = lv.fog > 0.005
  if (!fogPuffs.obj.visible) return
  const ce = b.maxX, cw = b.minX, cn = b.minZ, cs = b.maxZ
  const [dirX, dirZ] = windDir.value
  const drift = 1 + windMs.value * 0.15
  const nf = Math.max(1, Math.round(FOG_MAX * scale))
  ;(fogPuffs.obj.geometry as THREE.InstancedBufferGeometry).instanceCount = nf
  for (let i = 0; i < nf; i++) {
    // Slow drift along the wind, with a little sideways wander.
    fogX[i] += (dirX * fogSpd[i] * drift - dirZ * fogSide[i]) * dt
    fogZ[i] += (dirZ * fogSpd[i] * drift + dirX * fogSide[i]) * dt
    if (fogX[i] > ce) fogX[i] = cw; else if (fogX[i] < cw) fogX[i] = ce
    if (fogZ[i] > cs) fogZ[i] = cn; else if (fogZ[i] < cn) fogZ[i] = cs
    const o = i * 3
    fogPuffs.offset[o] = fogX[i]
    fogPuffs.offset[o + 1] = fogYBase[i] + Math.sin(time * 0.28 + fogPh[i]) * 0.18
    fogPuffs.offset[o + 2] = fogZ[i]
    const edge = Math.min(fogX[i] - cw, ce - fogX[i], fogZ[i] - cn, cs - fogZ[i])
    fogPuffs.alpha[i] = clamp01(edge / 2.5) * lv.fog
  }
  // Subtle global opacity pulse — fog feels alive
  fogPuffs.mat.uniforms.uOpacity.value = 0.24 + 0.04 * Math.sin(time * 0.35)
  flag(fogPuffs.obj.geometry, 'iOffset', 'iAlpha')
}

function updateStars() {
  if (!stars) return
  stars.obj.visible = lv.stars > 0.005
  if (!stars.obj.visible) return
  const ns = Math.max(1, Math.round(STAR_MAX * scale))
  stars.obj.geometry.setDrawRange(0, ns)
  for (let i = 0; i < ns; i++) {
    stars.alpha[i] = starBase[i] * (0.6 + 0.4 * Math.sin(time * starF[i] + starPh[i]))
  }
  stars.mat.uniforms.uOpacity.value = lv.stars
  flag(stars.obj.geometry, 'aAlpha')
}
</script>

<template>
  <primitive v-if="root" :object="root" />
</template>
