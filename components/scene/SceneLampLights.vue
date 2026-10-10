<script setup lang="ts">
/**
 * Pooled point lights for every `light.*` entity on the floorplan.
 *
 * Three.js compiles a shader variant per light count, so mounting a PointLight
 * when a lamp turns on (and unmounting it when it turns off) recompiled every
 * material in the scene on each tap — a visible freeze on a Pi. Instead a pool
 * of lights is kept mounted and lamps that are on are assigned to free slots;
 * idle slots sit at intensity 0. The pool only grows (to the most lamps that
 * have been on at once), so after the first time that many are lit, toggling
 * never recompiles — and the per-pixel cost tracks lamps actually used, not
 * every lamp in the house.
 *
 * Shadow-casting slots are capped by the GPU's texture-unit count: each shadow
 * needs a sampler in every lit material, and Pi-class GPUs only have ~16.
 */
import type { PointLight } from 'three'
import type { HassEntity } from 'home-assistant-js-websocket'
import type { DevicePlacement } from '~/stores/layout'
import { getAdapter } from '~/utils/deviceRegistry'
import { requestShadowUpdate } from '~/composables/useShadowUpdates'

interface LampSource {
  entity: HassEntity
  placement: DevicePlacement
  /** World-space emission point (furniture top or the marker position). */
  position: [number, number, number]
}

const props = defineProps<{ lamps: LampSource[] }>()

const { renderer } = useTresContext()
const quality = useGraphicsQuality()

// Perceptual brightness curve for the emitted lamp light. HA brightness maps
// linearly to `visual.intensity` (0–1), but a linear map looks far too bright
// at low levels — 20% brightness still floods the room. Raising it to a power
// > 1 makes low settings fall off steeply while leaving full brightness
// unchanged (1^n = 1), matching how a dimmed bulb actually looks.
const LAMP_GAMMA = 2.2
/** Texture units kept free for the sun shadow, TV spot shadows and headroom. */
const RESERVED_TEXTURE_UNITS = 5

interface ActiveLamp { id: string; position: [number, number, number]; color: string; intensity: number }

const activeLamps = computed<ActiveLamp[]>(() => {
  const out: ActiveLamp[] = []
  for (const l of props.lamps) {
    const adapter = getAdapter(l.entity)
    if (!adapter) continue
    const v = adapter.getDisplayState(l.entity)
    if (!v.active) continue
    out.push({
      id: l.placement.entity_id,
      position: l.position,
      color: v.color,
      intensity: Math.pow(Math.max(0, v.intensity), LAMP_GAMMA) * 80 * (l.placement.brightnessMultiplier ?? 1),
    })
  }
  return out
})

interface Slot { id: string | null; position: [number, number, number]; color: string; intensity: number }

// Stable lamp → slot assignment so a lamp keeps its light (and its shadow map)
// while other lamps toggle.
const slotOf = new Map<string, number>()
const slots = shallowRef<Slot[]>([])

watch(activeLamps, (lamps) => {
  const ids = new Set(lamps.map((l) => l.id))
  for (const id of [...slotOf.keys()]) if (!ids.has(id)) slotOf.delete(id)
  const used = new Set(slotOf.values())
  for (const l of lamps) {
    if (slotOf.has(l.id)) continue
    let s = 0
    while (used.has(s)) s++
    slotOf.set(l.id, s)
    used.add(s)
  }
  const prev = slots.value
  let size = prev.length
  for (const s of used) size = Math.max(size, s + 1)
  const byId = new Map(lamps.map((l) => [l.id, l]))
  const next: Slot[] = []
  let shadowsDirty = size !== prev.length
  for (let i = 0; i < size; i++) {
    const old = prev[i]
    let lamp: ActiveLamp | undefined
    for (const [id, s] of slotOf) if (s === i) { lamp = byId.get(id); break }
    // Idle slots keep their last position so they don't need a new shadow map.
    const position = lamp?.position ?? old?.position ?? [0, -50, 0]
    if (!old || old.position[0] !== position[0] || old.position[1] !== position[1] || old.position[2] !== position[2])
      shadowsDirty = true
    next.push({ id: lamp?.id ?? null, position, color: lamp?.color ?? old?.color ?? '#ffffff', intensity: lamp?.intensity ?? 0 })
  }
  slots.value = next
  if (shadowsDirty) requestShadowUpdate()
}, { immediate: true })

/** How many pool slots may cast shadows on this GPU. */
const shadowBudget = computed(() => {
  const units = renderer.value?.capabilities.maxTextures ?? 16
  return Math.max(1, units - RESERVED_TEXTURE_UNITS)
})

// ── Shadow map config ────────────────────────────────────────────────────────
const lights: (PointLight | null)[] = []
function setLight(i: number, el: unknown) {
  const light = (el as PointLight | null) ?? null
  if (light === lights[i]) return
  lights[i] = light
  if (light) configureShadow(light)
}

function configureShadow(light: PointLight) {
  const size = quality.settings.value.lampShadowSize
  const s = light.shadow
  if (s.mapSize.x !== size) {
    s.mapSize.set(size, size)
    // A resize only takes effect once the old render target is released.
    s.map?.dispose()
    s.map = null
  }
  s.camera.near = 0.1
  s.camera.far = 8
  s.bias = -0.0005
  // The wall material casts with shadowSide=FrontSide, so the near wall face is
  // recorded and the far (exterior) face stays fully shadowed a full wall
  // thickness back — no light bleeds through. normalBias can stay moderate to
  // avoid acne on the lit interior surfaces.
  s.normalBias = 0.02
  requestShadowUpdate()
}

watch(() => quality.settings.value.lampShadowSize, () => {
  for (const l of lights) if (l) configureShadow(l)
})
</script>

<template>
  <!-- High decay keeps light contained inside the room walls -->
  <TresPointLight
    v-for="(slot, i) in slots"
    :key="i"
    :ref="(el: unknown) => setLight(i, el)"
    :position="slot.position"
    :color="slot.color"
    :intensity="slot.intensity"
    :distance="8"
    :decay="2"
    :cast-shadow="quality.settings.value.shadows && i < shadowBudget"
  />
</template>
