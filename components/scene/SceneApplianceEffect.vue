<script setup lang="ts">
/**
 * Running washing machine / tumble dryer visualisation. A ring of droplets
 * orbits a glowing porthole rim like a drum seen from above:
 *  - washing / rinsing: the drum agitates back and forth while soap bubbles
 *    wobble upward and pop
 *  - spinning: the drum ramps up to a fast blur and the whole effect shakes
 *  - drying / cooling: warm tumbling particles and rising heat wisps (cool
 *    blue-white while cooling down)
 * A washer-dryer cross-fades between the water and heat looks as its phase
 * changes. Objects are built on the client (onMounted) because the sprite
 * glyphs are drawn to CanvasTextures.
 */
import { shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { useLoop } from '@tresjs/core'
import type { AppliancePhase } from '~/utils/appliance'

const props = defineProps<{
  active: boolean
  phase: AppliancePhase
  /** True for the heat look (dryer, or a washer-dryer while drying). */
  drying: boolean
  /** Marker colour (hex) the effect is tinted with. */
  color?: string
}>()

const DRUM_COUNT = 22
const BUBBLE_COUNT = 10
const WISP_COUNT = 7
const DRUM_R = 0.3
const FADE_TIME = 1.1
const BUBBLE_LIFE = 2.6
const WISP_LIFE = 3.2

const group = shallowRef<THREE.Group>()
const shaker = new THREE.Group()
const drum: THREE.Sprite[] = []
const bubbles: THREE.Sprite[] = []
const wisps: THREE.Sprite[] = []
let rim: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null
let water: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null
const textures: THREE.Texture[] = []

// Per-particle state (plain typed arrays — intentionally non-reactive).
const dOffset = new Float32Array(DRUM_COUNT)
const dRadius = new Float32Array(DRUM_COUNT)
const dBob = new Float32Array(DRUM_COUNT)
const dSize = new Float32Array(DRUM_COUNT)
const dLight = new Float32Array(DRUM_COUNT)
for (let i = 0; i < DRUM_COUNT; i++) {
  dOffset[i] = (i / DRUM_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.2
  dRadius[i] = 0.7 + Math.random() * 0.3
  dBob[i] = Math.random() * Math.PI * 2
  dSize[i] = 0.05 + Math.random() * 0.04
  dLight[i] = (Math.random() - 0.5) * 0.2
}

const bT = new Float32Array(BUBBLE_COUNT)
const bAngle = new Float32Array(BUBBLE_COUNT)
const bDist = new Float32Array(BUBBLE_COUNT)
const bSpeed = new Float32Array(BUBBLE_COUNT)
const bSway = new Float32Array(BUBBLE_COUNT)
const bSize = new Float32Array(BUBBLE_COUNT)
const bHue = new Float32Array(BUBBLE_COUNT)

function respawnBubble(i: number, t = 0) {
  bT[i] = t
  bAngle[i] = Math.random() * Math.PI * 2
  bDist[i] = Math.sqrt(Math.random()) * DRUM_R
  bSpeed[i] = 0.7 + Math.random() * 0.6
  bSway[i] = Math.random() * Math.PI * 2
  bSize[i] = 0.07 + Math.random() * 0.07
  bHue[i] = Math.random()
}

const wT = new Float32Array(WISP_COUNT)
const wAngle = new Float32Array(WISP_COUNT)
const wSpeed = new Float32Array(WISP_COUNT)
const wSway = new Float32Array(WISP_COUNT)

function respawnWisp(i: number, t = 0) {
  wT[i] = t
  wAngle[i] = Math.random() * Math.PI * 2
  wSpeed[i] = 0.7 + Math.random() * 0.5
  wSway[i] = Math.random() * Math.PI * 2
}

// Marker hue the effect is tinted with. Lightness/saturation are clamped so
// very dark or desaturated markers still read against the floor.
const base = { h: 0, s: 0.85, l: 0.6 }
watch(
  () => props.color,
  (hex) => {
    new THREE.Color(hex || '#38bdf8').getHSL(base)
    base.s = Math.max(base.s, 0.3)
    base.l = Math.min(0.7, Math.max(0.45, base.l))
  },
  { immediate: true },
)

function wrapHue(h: number) {
  return ((h % 1) + 1) % 1
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  draw(c.getContext('2d')!, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  textures.push(tex)
  return tex
}

/** Soft round droplet — white so the sprite colour tints it. */
function makeDotTexture() {
  return canvasTexture((ctx, n) => {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, n, n)
  })
}

/** Soap bubble: thin bright rim, faint film and a specular highlight. */
function makeBubbleTexture() {
  return canvasTexture((ctx, n) => {
    const c = n / 2
    const film = ctx.createRadialGradient(c, c, c * 0.55, c, c, c * 0.9)
    film.addColorStop(0, 'rgba(255,255,255,0.05)')
    film.addColorStop(1, 'rgba(255,255,255,0.35)')
    ctx.fillStyle = film
    ctx.beginPath()
    ctx.arc(c, c, c * 0.88, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(c, c, c * 0.86, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.ellipse(c * 0.68, c * 0.62, c * 0.16, c * 0.09, -0.7, 0, Math.PI * 2)
    ctx.fill()
  })
}

/** Large, very soft puff for heat / steam wisps. */
function makeWispTexture() {
  return canvasTexture((ctx, n) => {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.7)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, n, n)
  })
}

function sprite(map: THREE.Texture, order: number, additive = false): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }))
  s.renderOrder = order
  return s
}

function flatMaterial() {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

onMounted(() => {
  const g = new THREE.Group()
  g.add(shaker)

  rim = new THREE.Mesh(new THREE.RingGeometry(DRUM_R * 1.08, DRUM_R * 1.2, 64), flatMaterial())
  rim.rotation.x = -Math.PI / 2
  rim.renderOrder = 2
  shaker.add(rim)

  water = new THREE.Mesh(new THREE.CircleGeometry(DRUM_R * 1.06, 48), flatMaterial())
  water.rotation.x = -Math.PI / 2
  water.renderOrder = 1
  shaker.add(water)

  const dot = makeDotTexture()
  for (let i = 0; i < DRUM_COUNT; i++) {
    const s = sprite(dot, 3, true)
    drum.push(s)
    shaker.add(s)
  }

  const bubble = makeBubbleTexture()
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const s = sprite(bubble, 4)
    respawnBubble(i, i / BUBBLE_COUNT)
    bubbles.push(s)
    shaker.add(s)
  }

  const wisp = makeWispTexture()
  for (let i = 0; i < WISP_COUNT; i++) {
    const s = sprite(wisp, 4, true)
    respawnWisp(i, i / WISP_COUNT)
    wisps.push(s)
    shaker.add(s)
  }

  group.value = g
})

onBeforeUnmount(() => {
  rim?.geometry.dispose()
  rim?.material.dispose()
  water?.geometry.dispose()
  water?.material.dispose()
  for (const s of [...drum, ...bubbles, ...wisps]) s.material.dispose()
  for (const t of textures) t.dispose()
})

let env = 0
let dryMix = props.drying ? 1 : 0
let spinMix = 0
let omega = 0
let drumAngle = 0

/**
 * Target drum angular velocity (rad/s). Washing agitates: the drum turns one
 * way, pauses and reverses — tanh() of a sine gives those flat plateaus.
 */
function targetOmega(elapsed: number): number {
  switch (props.phase) {
    case 'spin': return 11
    case 'rinse': return 3.4 * Math.tanh(3 * Math.sin((elapsed * Math.PI * 2) / 4))
    case 'cool': return 1.6
    case 'dry': return 3.2
    case 'wash': return 2.8 * Math.tanh(3 * Math.sin((elapsed * Math.PI * 2) / 6))
    default: return props.drying ? 3.2 : 2.8 * Math.tanh(3 * Math.sin((elapsed * Math.PI * 2) / 6))
  }
}

// Canvas loop (not the global render loop) so we can request frames: the
// scene renders on demand and only redraws while this effect is moving.
const { onBeforeRender } = useLoop()
const gate = useAmbientGate()
onBeforeRender(({ elapsed, invalidate }) => {
  const g = group.value
  if (!g) return
  // Stopped and fully faded out — nothing to animate or draw.
  if (!props.active && env === 0) return
  const step = gate.step(elapsed)
  if (!step) return
  const dt = Math.min(step, 0.05)

  // Envelope ramps the whole effect in/out so start/stop cross-fades.
  env = Math.min(1, Math.max(0, env + ((props.active ? 1 : -1) * dt) / FADE_TIME))
  g.visible = env > 0.001
  invalidate()   // also draws the frame that hides it
  if (!g.visible) return
  const fade = env * env * (3 - 2 * env)

  const ease = Math.min(1, dt * 1.5)
  dryMix += ((props.drying ? 1 : 0) - dryMix) * ease
  spinMix += ((props.phase === 'spin' ? 1 : 0) - spinMix) * ease
  const wetMix = 1 - dryMix
  const cooling = props.phase === 'cool'

  // The drum ramps up/down instead of snapping — a spin cycle visibly winds up.
  omega += (targetOmega(elapsed) - omega) * Math.min(1, dt * 2)
  drumAngle += omega * dt

  // Spinning machines rattle; offset the whole effect by a tiny jitter.
  const shake = 0.014 * spinMix
  shaker.position.set(Math.sin(elapsed * 53) * shake, Math.abs(Math.sin(elapsed * 41)) * shake * 0.6, Math.cos(elapsed * 47) * shake)

  // Warm orange while drying, the marker hue while washing, icy while cooling.
  const hue = cooling ? 0.55 : base.h
  const sat = cooling ? 0.45 : base.s
  const light = cooling ? 0.72 : base.l

  if (rim) {
    rim.material.opacity = (0.32 + 0.12 * Math.sin(elapsed * 2.2)) * fade
    rim.material.color.setHSL(hue, sat, light)
  }
  if (water) {
    // Water drains out during the spin cycle.
    water.material.opacity = 0.12 * wetMix * (1 - spinMix * 0.7) * fade
    water.material.color.setHSL(hue, sat, light * 0.8)
  }

  for (let i = 0; i < drum.length; i++) {
    const s = drum[i]
    const a = drumAngle + dOffset[i]
    // Spin flings droplets to the drum wall; tumbling lifts and drops them.
    const r = DRUM_R * (dRadius[i] + (1 - dRadius[i]) * spinMix)
    const bob = dryMix * Math.abs(Math.sin(a * 1.5 + dBob[i])) * 0.12 +
      wetMix * Math.sin(elapsed * 3 + dBob[i]) * 0.02 * (1 - spinMix)
    s.position.set(Math.cos(a) * r, 0.04 + bob, Math.sin(a) * r)
    const sc = dSize[i] * (1 + dryMix * 0.5) * (1 - spinMix * 0.25)
    s.scale.set(sc, sc, 1)
    // At full spin the individual droplets blur into a translucent ring.
    s.material.opacity = (0.8 - spinMix * 0.35) * fade
    s.material.color.setHSL(wrapHue(hue + dLight[i] * 0.15), sat, Math.min(0.85, light + dLight[i]))
  }

  // Soap bubbles — fewer while rinsing, a few stragglers during the spin.
  const bubbleRate = props.phase === 'rinse' ? 0.7 : 1 - spinMix * 0.7
  const bubblesShown = Math.round(BUBBLE_COUNT * bubbleRate * wetMix)
  for (let i = 0; i < bubbles.length; i++) {
    const s = bubbles[i]
    bT[i] += (dt * bSpeed[i]) / BUBBLE_LIFE
    if (bT[i] >= 1) respawnBubble(i)
    if (i >= bubblesShown) {
      s.visible = false
      continue
    }
    s.visible = true
    const t = bT[i]
    s.position.set(
      Math.cos(bAngle[i]) * bDist[i] + Math.sin(elapsed * 2.1 + bSway[i]) * 0.05,
      0.08 + t * 0.85,
      Math.sin(bAngle[i]) * bDist[i] + Math.cos(elapsed * 1.7 + bSway[i]) * 0.05,
    )
    // Grows as it rises, then pops: a quick swell while it fades out.
    const pop = t > 0.88 ? (t - 0.88) / 0.12 : 0
    const sc = bSize[i] * (0.6 + t * 0.6) * (1 + pop * 0.8)
    s.scale.set(sc, sc, 1)
    s.material.opacity = Math.min(1, t / 0.12) * (1 - pop) * 0.9 * wetMix * fade
    // Soapy iridescence: each bubble drifts slightly around the base hue.
    s.material.color.setHSL(wrapHue(hue + (bHue[i] - 0.5) * 0.25 + elapsed * 0.05), 0.6, 0.8)
  }

  // Heat wisps rise, widen and thin out while drying.
  for (let i = 0; i < wisps.length; i++) {
    const s = wisps[i]
    wT[i] += (dt * wSpeed[i]) / WISP_LIFE
    if (wT[i] >= 1) respawnWisp(i)
    const t = wT[i]
    const spread = 0.08 + t * 0.25
    s.position.set(
      Math.cos(wAngle[i]) * spread + Math.sin(elapsed * 1.3 + wSway[i]) * 0.08 * t,
      0.1 + t * 0.9,
      Math.sin(wAngle[i]) * spread + Math.cos(elapsed * 1.1 + wSway[i]) * 0.08 * t,
    )
    const sc = 0.22 + t * 0.4
    s.scale.set(sc, sc, 1)
    s.material.opacity = Math.min(1, t / 0.2) * Math.min(1, (1 - t) / 0.5) * 0.3 * dryMix * fade
    s.material.color.setHSL(hue, sat * (1 - t * 0.6), Math.min(0.9, light + t * 0.2))
  }
})
</script>

<template>
  <primitive v-if="group" :object="group" />
</template>
