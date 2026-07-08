<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'
import { getAdapter } from '~/utils/deviceRegistry'

const layout = useLayoutStore()
const entities = useEntitiesStore()
const { positions } = useMarkerOverlay()
const { callService } = useHomeAssistant()

function getIcon(entityId: string): string {
  if (entityId.includes('temperature')) return 'mdi:thermometer'
  if (entityId.includes('humidity'))    return 'mdi:water-percent'
  if (entityId.includes('outdoor'))     return 'mdi:weather-partly-cloudy'
  if (entityId.includes('blinds'))      return 'mdi:blinds'
  if (entityId.includes('garage'))      return 'mdi:garage'
  if (entityId.includes('tv') || entityId.includes('television')) return 'mdi:television'
  if (entityId.includes('coffee'))      return 'mdi:coffee'
  if (entityId.includes('front_door') || entityId.includes('door_cam')) return 'mdi:doorbell-video'
  const domain = entityId.split('.')[0]
  const entity = entities.get(entityId)
  if (entity) {
    const adapter = getAdapter(entity)
    if (adapter?.icon) return adapter.icon
  }
  return 'mdi:help-circle'
}

interface MarkerInfo {
  entityId: string
  color: string
  label: string
  active: boolean
  selected: boolean
  icon: string
}

// Visual info re-computes only when placements, entity states, or selection
// change — NOT when the projected screen position changes. The projector
// (SceneProjector.vue) rewrites `positions` every render frame, so keeping
// position out of this computed avoids running the adapter lookups + array
// rebuild 60×/sec, which was starving UI input on the Pi.
// Cache each light's last-known "on" colour/brightness. HA strips these
// attributes while a light is off, so an optimistic turn-on would otherwise
// briefly render the adapter's default warm fallback before the real state
// event arrives. Recorded here (cheap Map write, no reactivity) as we already
// iterate every entity on each state change.
const lastOnLightAttrs = new Map<string, Record<string, unknown>>()
function rememberIfOnLight(entity: HassEntity) {
  if (!entity.entity_id.startsWith('light.') || entity.state !== 'on') return
  const a = entity.attributes
  lastOnLightAttrs.set(entity.entity_id, {
    rgb_color: a.rgb_color,
    hs_color: a.hs_color,
    xy_color: a.xy_color,
    color_temp: a.color_temp,
    brightness: a.brightness,
  })
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Colour to paint a light's orb. While a light is on we use its live colour;
 * while it's off HA strips the colour attributes (adapter would fall back to
 * the default warm yellow), so we reuse the last-known "on" colour from the
 * cache so the orb keeps its identity instead of reverting to yellow.
 */
function lightMarkerColor(entity: HassEntity, liveColor: string): string {
  if (entity.state === 'on') return liveColor
  const cached = lastOnLightAttrs.get(entity.entity_id)?.rgb_color as number[] | undefined
  return cached ? rgbToHex(cached) : liveColor
}

const markers = computed<MarkerInfo[]>(() => {
  return layout.placements
    .map((p) => {
      const entity = entities.get(p.entity_id)
      if (!entity) return null
      rememberIfOnLight(entity)
      const adapter = getAdapter(entity)
      const visual = adapter
        ? adapter.getDisplayState(entity)
        : { color: '#888', intensity: 0.3, label: '?', active: false }
      const isLight = p.entity_id.startsWith('light.')
      return {
        entityId: p.entity_id,
        color: isLight
          ? lightMarkerColor(entity, visual.color)
          : (p.color || visual.color),
        label: visual.label,
        active: visual.active,
        selected: layout.selectedEntityId === p.entity_id,
        icon: p.icon || getIcon(p.entity_id),
      } satisfies MarkerInfo
    })
    .filter((m): m is MarkerInfo => m !== null)
})

function orbStyle(m: MarkerInfo) {
  const hex = m.color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return {
    background: `rgba(${r},${g},${b},0.78)`,
    border: m.selected
      ? '2px solid rgba(255,255,255,0.9)'
      : `2px solid rgba(${r},${g},${b},0.4)`,
    boxShadow: m.selected
      ? `0 0 20px rgba(${r},${g},${b},0.9), 0 0 6px rgba(255,255,255,0.5)`
      : `0 0 10px rgba(${r},${g},${b},0.5)`,
  }
}

/** Domains that support the generic `toggle` service call */
const TOGGLEABLE = new Set(['light', 'switch', 'fan', 'media_player', 'cover', 'input_boolean', 'automation'])

/**
 * Best-effort optimistic next state for a `toggle`, so the orb flips instantly
 * instead of waiting for the HA websocket round-trip. The real state event
 * reconciles a moment later. Returns null for domains we can't guess safely.
 */
function optimisticToggleState(entity: HassEntity): string | null {
  const domain = entity.entity_id.split('.')[0]
  switch (domain) {
    case 'cover':
      return entity.state === 'open' ? 'closed' : 'open'
    case 'media_player':
      return entity.state === 'playing' ? 'paused' : 'playing'
    default:
      // light / switch / fan / input_boolean / automation are all on/off
      return entity.state === 'on' ? 'off' : 'on'
  }
}

const LONG_PRESS_MS = 300
const pressTimers = new Map<string, ReturnType<typeof setTimeout>>()
const longPressTriggered = new Set<string>()

function onPointerDown(entityId: string, e: PointerEvent) {
  e.stopPropagation()
  longPressTriggered.delete(entityId)
  const timer = setTimeout(() => {
    longPressTriggered.add(entityId)
    layout.select(entityId)
  }, LONG_PRESS_MS)
  pressTimers.set(entityId, timer)
}

function cancelPress(entityId: string) {
  const timer = pressTimers.get(entityId)
  if (timer !== undefined) {
    clearTimeout(timer)
    pressTimers.delete(entityId)
  }
}

function onPointerUp(entityId: string, e: PointerEvent) {
  e.stopPropagation()
  const wasLong = longPressTriggered.has(entityId)
  cancelPress(entityId)
  longPressTriggered.delete(entityId)
  if (wasLong) return
  // Short tap — toggle if possible, otherwise open the control panel
  const domain = entityId.split('.')[0]
  if (TOGGLEABLE.has(domain)) {
    // Optimistically flip local state so the orb reacts immediately; the
    // authoritative HA state event reconciles this a moment later.
    const entity = entities.get(entityId)
    const next = entity ? optimisticToggleState(entity) : null
    if (next) {
      const partial: Partial<HassEntity> = { state: next }
      // Restore the last-known colour when turning a light on so it doesn't
      // flash the default warm fallback before HA reports the real colour.
      if (next === 'on' && entityId.startsWith('light.')) {
        const cached = lastOnLightAttrs.get(entityId)
        if (cached) partial.attributes = cached
      }
      entities.patch(entityId, partial)
    }
    callService(domain, 'toggle', {}, { entity_id: entityId })
  } else {
    layout.select(entityId)
  }
}

function onPointerCancel(entityId: string) {
  cancelPress(entityId)
  longPressTriggered.delete(entityId)
}

// Imperative per-frame transform updates. `positions` is rewritten every
// render frame by SceneProjector; watching it would re-render the whole
// overlay 60×/sec. Instead we keep per-entity element refs and set
// `transform` / visibility directly on the DOM, bypassing Vue reactivity.
const markerEls = new Map<string, HTMLElement>()
function setMarkerRef(entityId: string) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (el instanceof HTMLElement) markerEls.set(entityId, el)
    else markerEls.delete(entityId)
  }
}
watch(positions, (pos) => {
  for (const [id, el] of markerEls) {
    const p = pos[id]
    if (!p || !p.visible) {
      el.style.display = 'none'
      continue
    }
    el.style.display = ''
    el.style.transform = `translate(${p.x}px, ${p.y}px)`
  }
}, { flush: 'post' })
</script>

<template>
  <!-- Overlay sits exactly on top of the TresCanvas (absolute, no pointer events
       on the container itself so OrbitControls still gets empty-space events). -->
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <div
      v-for="m in markers"
      :key="m.entityId"
      :ref="setMarkerRef(m.entityId)"
      class="marker pointer-events-auto"
      style="display: none"
      @pointerdown="onPointerDown(m.entityId, $event)"
      @pointerup="onPointerUp(m.entityId, $event)"
      @pointercancel="onPointerCancel(m.entityId)"
      @pointerleave="onPointerCancel(m.entityId)"
    >
      <div class="orb" :style="orbStyle(m)">
        <Icon :icon="m.icon" width="22" height="22" color="white" />
      </div>
      <span class="label">{{ m.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.marker {
  position: absolute;
  top: 0;
  left: 0;
  /* Offset so the orb is centred on the projected point */
  margin-top: -30px;
  margin-left: -26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  /* Prevent browser scroll/context-menu from interfering with long-press */
  touch-action: none;
  /* 52px min tap target including padding */
  padding: 4px;
}

.orb {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border 0.15s, box-shadow 0.15s;
}

.label {
  font-size: 9px;
  font-family: system-ui, sans-serif;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
</style>
