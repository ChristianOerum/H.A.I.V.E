<script setup lang="ts">
/**
 * Renders live weather as particles above the floorplan:
 *  - rain  : fast falling line-streaks
 *  - snow  : slowly drifting soft dots
 *  - clouds: big soft puffs drifting high above (partly cloudy / cloudy)
 *  - fog   : dense low-lying haze
 *  - stars : static twinkling points (clear night)
 * Density/colour follow the HA condition; each layer hides when not relevant.
 * Lives inside TresCanvas and animates via useRenderLoop; objects are built on
 * the client (onMounted) so the CanvasTexture never touches the SSR pass.
 */
import * as THREE from 'three'

const fp = useFloorplanStore()
const { precipitation, intensity, cloudCoverage, isFoggy, showStars, condition } = useWeather()
const { onLoop } = useRenderLoop()

const MARGIN = 1.5
const CLOUD_MARGIN = 5
const CEILING = 6
const RAIN_MAX = 1600
const SNOW_MAX = 1100
const CLOUD_MAX = 80
const FOG_MAX = 150
const STAR_MAX = 240
const RAIN_LEN = 0.4
const RAIN_TILT = 0.12

interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

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

const rainObj = shallowRef<THREE.LineSegments>()
const snowObj = shallowRef<THREE.Points>()
const cloudObj = shallowRef<THREE.Points>()
const fogObj = shallowRef<THREE.Points>()
const starObj = shallowRef<THREE.Points>()

// Per-particle state (plain typed arrays — intentionally non-reactive).
const rainX = new Float32Array(RAIN_MAX)
const rainZ = new Float32Array(RAIN_MAX)
const rainY = new Float32Array(RAIN_MAX)
const rainV = new Float32Array(RAIN_MAX)
let rainPos = new Float32Array(RAIN_MAX * 6)

const snowX = new Float32Array(SNOW_MAX)
const snowZ = new Float32Array(SNOW_MAX)
const snowY = new Float32Array(SNOW_MAX)
const snowV = new Float32Array(SNOW_MAX)
const snowPh = new Float32Array(SNOW_MAX)
const snowDrift = new Float32Array(SNOW_MAX)
let snowPos = new Float32Array(SNOW_MAX * 3)

const cloudX = new Float32Array(CLOUD_MAX)
const cloudY = new Float32Array(CLOUD_MAX)
const cloudZ = new Float32Array(CLOUD_MAX)
const cloudV = new Float32Array(CLOUD_MAX)
let cloudPos = new Float32Array(CLOUD_MAX * 3)

const fogX = new Float32Array(FOG_MAX)
const fogY = new Float32Array(FOG_MAX)
const fogZ = new Float32Array(FOG_MAX)
const fogV = new Float32Array(FOG_MAX)
let fogPos = new Float32Array(FOG_MAX * 3)

const starX = new Float32Array(STAR_MAX)
const starY = new Float32Array(STAR_MAX)
const starZ = new Float32Array(STAR_MAX)
let starPos = new Float32Array(STAR_MAX * 3)

function randX(b: Bounds) {
  return b.minX + Math.random() * (b.maxX - b.minX)
}
function randZ(b: Bounds) {
  return b.minZ + Math.random() * (b.maxZ - b.minZ)
}

function seed() {
  const b = bounds.value
  for (let i = 0; i < RAIN_MAX; i++) {
    rainX[i] = randX(b); rainZ[i] = randZ(b)
    rainY[i] = Math.random() * CEILING
    rainV[i] = 9 + Math.random() * 5
  }
  for (let i = 0; i < SNOW_MAX; i++) {
    snowX[i] = randX(b); snowZ[i] = randZ(b)
    snowY[i] = Math.random() * CEILING
    snowV[i] = 0.7 + Math.random() * 0.9
    snowPh[i] = Math.random() * Math.PI * 2
    snowDrift[i] = 0.2 + Math.random() * 0.4
  }
  // Clouds + stars spread over a wider box so they extend past the walls.
  const cw = b.minX - CLOUD_MARGIN, ce = b.maxX + CLOUD_MARGIN
  const cn = b.minZ - CLOUD_MARGIN, cs = b.maxZ + CLOUD_MARGIN
  for (let i = 0; i < CLOUD_MAX; i++) {
    cloudX[i] = cw + Math.random() * (ce - cw)
    cloudZ[i] = cn + Math.random() * (cs - cn)
    cloudY[i] = 4.6 + Math.random() * 1.6
    cloudV[i] = 0.25 + Math.random() * 0.3
  }
  for (let i = 0; i < FOG_MAX; i++) {
    fogX[i] = randX(b); fogZ[i] = randZ(b)
    fogY[i] = 0.4 + Math.random() * 1.8
    fogV[i] = 0.1 + Math.random() * 0.25
  }
  for (let i = 0; i < STAR_MAX; i++) {
    starX[i] = cw + Math.random() * (ce - cw)
    starZ[i] = cn + Math.random() * (cs - cn)
    starY[i] = 5 + Math.random() * 2.5
  }
  writeRain(RAIN_MAX)
  writeSnow(SNOW_MAX)
  writeXYZ(cloudPos, cloudX, cloudY, cloudZ, CLOUD_MAX, cloudObj.value)
  writeXYZ(fogPos, fogX, fogY, fogZ, FOG_MAX, fogObj.value)
  writeXYZ(starPos, starX, starY, starZ, STAR_MAX, starObj.value)
}

function writeRain(count: number) {
  for (let i = 0; i < count; i++) {
    const o = i * 6
    const x = rainX[i], z = rainZ[i], y = rainY[i]
    rainPos[o] = x + RAIN_TILT; rainPos[o + 1] = y + RAIN_LEN; rainPos[o + 2] = z
    rainPos[o + 3] = x;         rainPos[o + 4] = y;           rainPos[o + 5] = z
  }
  const geo = rainObj.value?.geometry
  if (geo) (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
}

function writeSnow(count: number) {
  for (let i = 0; i < count; i++) {
    const o = i * 3
    snowPos[o] = snowX[i]; snowPos[o + 1] = snowY[i]; snowPos[o + 2] = snowZ[i]
  }
  const geo = snowObj.value?.geometry
  if (geo) (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
}

/** Copy separate x/y/z arrays into an interleaved position buffer and flag it. */
function writeXYZ(
  pos: Float32Array, xs: Float32Array, ys: Float32Array, zs: Float32Array,
  count: number, obj?: THREE.Points,
) {
  for (let i = 0; i < count; i++) {
    const o = i * 3
    pos[o] = xs[i]; pos[o + 1] = ys[i]; pos[o + 2] = zs[i]
  }
  const geo = obj?.geometry
  if (geo) (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
}

function makeDotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Very soft, wide falloff sprite for cloud/fog puffs. */
function makePuffTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makePoints(max: number, mat: THREE.PointsMaterial): { obj: THREE.Points; pos: Float32Array } {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(max * 3)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const obj = new THREE.Points(geo, mat)
  obj.frustumCulled = false
  obj.renderOrder = 3
  return { obj, pos }
}

onMounted(() => {
  const dot = makeDotTexture()
  const puff = makePuffTexture()

  const rainGeo = new THREE.BufferGeometry()
  rainPos = new Float32Array(RAIN_MAX * 6)
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: 0x9db4d6, transparent: true, opacity: 0.35 }),
  )
  rain.frustumCulled = false
  rain.renderOrder = 3
  rainObj.value = rain

  const snow = makePoints(SNOW_MAX, new THREE.PointsMaterial({
    color: 0xffffff, map: dot, size: 0.13, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  }))
  snowObj.value = snow.obj; snowPos = snow.pos

  const cloud = makePoints(CLOUD_MAX, new THREE.PointsMaterial({
    color: 0xffffff, map: puff, size: 3.2, sizeAttenuation: true,
    transparent: true, opacity: 0.5, depthWrite: false,
  }))
  cloudObj.value = cloud.obj; cloudPos = cloud.pos

  const fog = makePoints(FOG_MAX, new THREE.PointsMaterial({
    color: 0xc8ced8, map: puff, size: 3.6, sizeAttenuation: true,
    transparent: true, opacity: 0.28, depthWrite: false,
  }))
  fogObj.value = fog.obj; fogPos = fog.pos

  const star = makePoints(STAR_MAX, new THREE.PointsMaterial({
    color: 0xdfe6ff, map: dot, size: 0.09, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  }))
  starObj.value = star.obj; starPos = star.pos

  seed()
})

watch(bounds, () => seed())

onBeforeUnmount(() => {
  for (const o of [rainObj, snowObj, cloudObj, fogObj, starObj]) {
    o.value?.geometry.dispose()
    const m = o.value?.material as (THREE.Material & { map?: THREE.Texture }) | undefined
    m?.map?.dispose()
    m?.dispose()
  }
})

onLoop(({ delta, elapsed }: { delta: number; elapsed: number }) => {
  const dt = Math.min(delta, 0.05)
  const type = precipitation.value
  const b = bounds.value

  if (type === 'rain' && rainObj.value) {
    const active = Math.max(1, Math.floor(RAIN_MAX * (0.5 + 0.5 * intensity.value)))
    for (let i = 0; i < active; i++) {
      rainY[i] -= rainV[i] * dt
      if (rainY[i] < 0) {
        rainY[i] = CEILING + Math.random() * 1.5
        rainX[i] = randX(b); rainZ[i] = randZ(b)
      }
    }
    rainObj.value.geometry.setDrawRange(0, active * 2)
    writeRain(active)
  } else if (type === 'snow' && snowObj.value) {
    const active = Math.max(1, Math.floor(SNOW_MAX * (0.5 + 0.5 * intensity.value)))
    for (let i = 0; i < active; i++) {
      snowY[i] -= snowV[i] * dt
      snowX[i] += Math.sin(elapsed * 0.6 + snowPh[i]) * snowDrift[i] * dt
      if (snowY[i] < 0) {
        snowY[i] = CEILING + Math.random() * 1.5
        snowX[i] = randX(b); snowZ[i] = randZ(b)
      }
    }
    snowObj.value.geometry.setDrawRange(0, active)
    writeSnow(active)
  }

  // Clouds — drift on the wind; colour + count follow coverage.
  const cov = cloudCoverage.value
  if (cov > 0 && cloudObj.value) {
    const active = Math.max(1, Math.floor(CLOUD_MAX * cov))
    const ce = b.maxX + CLOUD_MARGIN, cw = b.minX - CLOUD_MARGIN
    for (let i = 0; i < active; i++) {
      cloudX[i] += cloudV[i] * dt
      if (cloudX[i] > ce) cloudX[i] = cw
    }
    const mat = cloudObj.value.material as THREE.PointsMaterial
    // Overcast clouds read grey; scattered ones stay white.
    mat.color.set(condition.value === 'cloudy' ? 0xb4bcc8 : 0xffffff)
    mat.opacity = condition.value === 'cloudy' ? 0.62 : 0.5
    cloudObj.value.geometry.setDrawRange(0, active)
    writeXYZ(cloudPos, cloudX, cloudY, cloudZ, active, cloudObj.value)
  }

  // Fog — slow low-lying drift.
  if (isFoggy.value && fogObj.value) {
    const ce = b.maxX + MARGIN, cw = b.minX - MARGIN
    for (let i = 0; i < FOG_MAX; i++) {
      fogX[i] += fogV[i] * dt
      if (fogX[i] > ce) fogX[i] = cw
    }
    writeXYZ(fogPos, fogX, fogY, fogZ, FOG_MAX, fogObj.value)
  }

  // Stars — gentle global twinkle.
  if (showStars.value && starObj.value) {
    const mat = starObj.value.material as THREE.PointsMaterial
    mat.opacity = 0.75 + 0.2 * Math.sin(elapsed * 2.2)
  }
})
</script>

<template>
  <primitive v-if="starObj" :object="starObj" :visible="showStars" />
  <primitive v-if="cloudObj" :object="cloudObj" :visible="cloudCoverage > 0" />
  <primitive v-if="fogObj" :object="fogObj" :visible="isFoggy" />
  <primitive v-if="rainObj" :object="rainObj" :visible="precipitation === 'rain'" />
  <primitive v-if="snowObj" :object="snowObj" :visible="precipitation === 'snow'" />
</template>

