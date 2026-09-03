<script setup lang="ts">
/**
 * Playing-speaker visualisation: colour-cycling rings ripple outward from the
 * speaker while music-note sprites float up and drift away. Objects are built
 * on the client (onMounted) because the note glyphs are drawn to a CanvasTexture.
 */
import { shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { useRenderLoop } from '@tresjs/core'

const props = defineProps<{
  active: boolean
  /** Marker colour (hex) the ripples and notes are tinted with. */
  color?: string
  /** 0–1 playback volume; scales ripple reach and note density. */
  volume?: number
}>()

const RING_COUNT = 4
const NOTE_COUNT = 8
const RING_PERIOD = 2.4
const NOTE_LIFE = 3.4
const FADE_TIME = 1.1

const group = shallowRef<THREE.Group>()
const rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
const notes: THREE.Sprite[] = []
const noteTextures: THREE.Texture[] = []

// Per-note state (plain typed arrays — intentionally non-reactive).
const nT = new Float32Array(NOTE_COUNT)
const nAngle = new Float32Array(NOTE_COUNT)
const nSpeed = new Float32Array(NOTE_COUNT)
const nSway = new Float32Array(NOTE_COUNT)
const nHue = new Float32Array(NOTE_COUNT)
const nSize = new Float32Array(NOTE_COUNT)

function respawn(i: number, t = 0) {
  nT[i] = t
  nAngle[i] = Math.random() * Math.PI * 2
  nSpeed[i] = 0.75 + Math.random() * 0.55
  nSway[i] = Math.random() * Math.PI * 2
  nHue[i] = Math.random()
  nSize[i] = 0.18 + Math.random() * 0.09
}

// Marker hue the whole effect is tinted with. Lightness/saturation are clamped
// so very dark or fully desaturated markers still read against the floor.
const base = { h: 0, s: 0.85, l: 0.6 }
watch(
  () => props.color,
  (hex) => {
    new THREE.Color(hex || '#ffffff').getHSL(base)
    base.s = Math.max(base.s, 0.25)
    base.l = Math.min(0.7, Math.max(0.45, base.l))
  },
  { immediate: true },
)

/** Wraps a hue into 0–1 including negative offsets. */
function wrapHue(h: number) {
  return ((h % 1) + 1) % 1
}

/** Draws a music note glyph as white-on-transparent so the sprite colour tints it. */
function makeNoteTexture(variant: number): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const head = (cx: number, cy: number) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.32)
    ctx.beginPath()
    ctx.ellipse(0, 0, 10, 7.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  const stem = (x: number, yBottom: number, yTop: number) => {
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(x, yBottom)
    ctx.lineTo(x, yTop)
    ctx.stroke()
  }

  if (variant === 0) {
    // Eighth note with a flag
    head(21, 48)
    stem(30, 46, 12)
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(30, 12)
    ctx.quadraticCurveTo(47, 19, 43, 35)
    ctx.stroke()
  } else if (variant === 1) {
    // Beamed pair
    head(15, 50)
    head(43, 44)
    stem(24, 48, 15)
    stem(52, 42, 9)
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(24, 15)
    ctx.lineTo(52, 9)
    ctx.stroke()
  } else {
    // Quarter note
    head(24, 46)
    stem(33, 44, 11)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

onMounted(() => {
  const g = new THREE.Group()

  const ringGeo = new THREE.RingGeometry(0.9, 1, 64, 1)
  ringGeo.rotateX(-Math.PI / 2)
  for (let i = 0; i < RING_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(ringGeo, mat)
    mesh.renderOrder = 2
    rings.push(mesh)
    g.add(mesh)
  }

  for (let v = 0; v < 3; v++) noteTextures.push(makeNoteTexture(v))
  for (let i = 0; i < NOTE_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: noteTextures[i % noteTextures.length],
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.renderOrder = 3
    respawn(i, i / NOTE_COUNT)
    notes.push(sprite)
    g.add(sprite)
  }

  group.value = g
})

onBeforeUnmount(() => {
  for (const m of rings) {
    m.geometry.dispose()
    m.material.dispose()
  }
  for (const s of notes) (s.material as THREE.SpriteMaterial).dispose()
  for (const t of noteTextures) t.dispose()
})

let hue = 0
let env = 0

const { onLoop } = useRenderLoop()
onLoop(({ delta, elapsed }: { delta: number; elapsed: number }) => {
  const g = group.value
  if (!g) return
  const dt = Math.min(delta, 0.05)

  // Envelope ramps the whole effect in/out so playback start/stop cross-fades.
  env = Math.min(1, Math.max(0, env + ((props.active ? 1 : -1) * dt) / FADE_TIME))
  g.visible = env > 0.001
  if (!g.visible) return
  const fade = env * env * (3 - 2 * env)

  const vol = Math.min(1, Math.max(0.15, props.volume ?? 0.5))
  hue = (hue + dt * 0.02) % 1

  const reach = 0.7 + vol * 1.4
  for (let i = 0; i < rings.length; i++) {
    const p = (elapsed / RING_PERIOD + i / RING_COUNT) % 1
    const m = rings[i]
    const r = 0.12 + p * reach
    m.scale.set(r, 1, r)
    m.position.y = p * 0.3
    m.material.opacity = Math.sin(Math.PI * p) * 0.38 * (0.5 + vol * 0.5) * fade
    m.material.color.setHSL(
      wrapHue(base.h + Math.sin((hue + p * 0.5) * Math.PI * 2) * 0.05),
      base.s,
      base.l,
    )
  }

  const shown = Math.max(2, Math.round(NOTE_COUNT * (0.4 + vol * 0.6)))
  for (let i = 0; i < notes.length; i++) {
    const s = notes[i]
    if (i >= shown) {
      s.visible = false
      continue
    }
    s.visible = true
    nT[i] += (dt * nSpeed[i]) / NOTE_LIFE
    if (nT[i] >= 1) respawn(i)
    const t = nT[i]
    const spread = 0.15 + t * 0.5
    s.position.set(
      Math.cos(nAngle[i]) * spread + Math.sin(elapsed * 1.6 + nSway[i]) * 0.1,
      0.1 + t * (0.9 + vol * 0.6),
      Math.sin(nAngle[i]) * spread + Math.cos(elapsed * 1.3 + nSway[i]) * 0.1,
    )
    const mat = s.material as THREE.SpriteMaterial
    mat.opacity = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.35) * 0.95 * fade
    mat.color.setHSL(wrapHue(base.h + (nHue[i] - 0.5) * 0.14 + hue * 0.1), base.s, base.l + 0.1)
    const sc = nSize[i] * (0.75 + t * 0.5)
    s.scale.set(sc, sc, 1)
  }
})
</script>

<template>
  <primitive v-if="group" :object="group" />
</template>
