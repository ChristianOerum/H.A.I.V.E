<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'
import { getAdapter } from '~/utils/deviceRegistry'
import { detectAppliance } from '~/utils/appliance'
import type { MarkerScreenPos } from '~/composables/useMarkerOverlay'

const layout = useLayoutStore()
const entities = useEntitiesStore()
const { positions } = useMarkerOverlay()
const { callService } = useHomeAssistant()

interface MarkerInfo {
  entityId: string
  color: string
  label: string
  active: boolean
  selected: boolean
  unavailable: boolean
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
        label: entity.state === 'unavailable' ? 'Unavailable' : visual.label,
        active: visual.active && entity.state !== 'unavailable',
        selected: layout.selectedEntityId === p.entity_id,
        unavailable: entity.state === 'unavailable',
        icon: entityIcon(p.entity_id, entity, p.icon),
      } satisfies MarkerInfo
    })
    .filter((m): m is MarkerInfo => m !== null)
})

/**
 * On  → solid glowing orb in the device colour.
 * Off → dark glass orb with only a coloured rim, so state reads at a glance.
 * Unavailable → grey dashed rim (see .orb.unavailable).
 */
function orbStyle(m: MarkerInfo) {
  if (m.unavailable) return undefined
  const hex = m.color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const ring = m.selected ? 'rgba(255,255,255,0.95)' : `rgba(${r},${g},${b},${m.active ? 0.5 : 0.75})`
  if (!m.active) {
    return {
      background: 'rgba(15,23,42,0.62)',
      border: `2px solid ${ring}`,
      boxShadow: m.selected ? '0 0 0 3px rgba(255,255,255,0.25)' : '0 2px 6px rgba(0,0,0,0.35)',
    }
  }
  return {
    background: `rgba(${r},${g},${b},0.85)`,
    border: `2px solid ${ring}`,
    boxShadow: m.selected
      ? `0 0 22px rgba(${r},${g},${b},0.95), 0 0 0 3px rgba(255,255,255,0.25)`
      : `0 0 14px rgba(${r},${g},${b},0.6)`,
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

// Long enough that a deliberate tap never opens the sheet by accident; the
// progress ring (.press-ring) makes the wait visible.
const LONG_PRESS_MS = 400
const pressTimers = new Map<string, ReturnType<typeof setTimeout>>()
const longPressTriggered = new Set<string>()
/** Marker currently held down — drives the press-scale + progress ring. */
const pressingId = ref<string | null>(null)

function onPointerDown(entityId: string, e: PointerEvent) {
  e.stopPropagation()
  longPressTriggered.delete(entityId)
  pressingId.value = entityId
  const timer = setTimeout(() => {
    longPressTriggered.add(entityId)
    pressingId.value = null
    layout.select(entityId)
  }, LONG_PRESS_MS)
  pressTimers.set(entityId, timer)
}

function cancelPress(entityId: string) {
  if (pressingId.value === entityId) pressingId.value = null
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
  const entity = entities.get(entityId)
  // Washers / dryers on a smart plug are `switch` entities — open the panel
  // instead of toggling so a tap can't cut power mid-cycle.
  const isAppliance = !!entity && !!detectAppliance(entity, layout.placementFor(entityId)?.icon)
  // Toggling an unavailable device would just fail; the sheet explains why instead.
  const unavailable = entity?.state === 'unavailable'
  if (TOGGLEABLE.has(domain) && !isAppliance && !unavailable) {
    // Optimistically flip local state so the orb reacts immediately; the
    // authoritative HA state event reconciles this a moment later.
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

// Imperative per-frame transform updates. `positions` is rewritten by
// SceneProjector whenever the camera moves; watching it would re-render the
// whole overlay 60×/sec. Instead we keep per-entity element refs and set
// `transform` / visibility directly on the DOM, bypassing Vue reactivity.
const markerEls = new Map<string, HTMLElement>()
function setMarkerRef(entityId: string) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (el instanceof HTMLElement) {
      if (markerEls.get(entityId) === el) return
      markerEls.set(entityId, el)
      // The projector only publishes when the view changes, so a marker that
      // mounts later must pick up the last known position itself.
      placeMarker(el, positions.value[entityId])
    } else {
      markerEls.delete(entityId)
    }
  }
}
function placeMarker(el: HTMLElement, p: MarkerScreenPos | undefined) {
  if (!p || !p.visible) {
    if (el.style.display !== 'none') el.style.display = 'none'
    return
  }
  if (el.style.display) el.style.display = ''
  const t = `translate(${p.x}px, ${p.y}px)`
  if (el.style.transform !== t) el.style.transform = t
}
watch(positions, (pos) => {
  for (const [id, el] of markerEls) placeMarker(el, pos[id])
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
      :class="{ pressing: pressingId === m.entityId }"
      style="display: none"
      @pointerdown="onPointerDown(m.entityId, $event)"
      @pointerup="onPointerUp(m.entityId, $event)"
      @pointercancel="onPointerCancel(m.entityId)"
      @pointerleave="onPointerCancel(m.entityId)"
    >
      <div class="orb" :class="{ inactive: !m.active, unavailable: m.unavailable }" :style="orbStyle(m)">
        <Icon :icon="m.unavailable ? 'mdi:help' : m.icon" width="22" height="22" color="white" />
        <!-- Long-press progress ring; only rendered while held -->
        <svg v-if="pressingId === m.entityId" class="press-ring" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" />
        </svg>
      </div>
      <span class="label" :class="{ inactive: !m.active }">{{ m.label }}</span>
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
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s ease-out, background-color 0.2s, border-color 0.2s, box-shadow 0.2s;
}
.orb.inactive :deep(svg:not(.press-ring)) {
  opacity: 0.75;
}
.orb.unavailable {
  background: rgba(30, 41, 59, 0.5);
  border: 2px dashed rgba(148, 163, 184, 0.7);
  opacity: 0.7;
}

/* Press feedback: the orb sinks slightly as soon as a finger lands */
.marker.pressing .orb {
  transform: scale(0.9);
}

.press-ring {
  position: absolute;
  inset: -6px;
  width: calc(100% + 12px);
  height: calc(100% + 12px);
  transform: rotate(-90deg);
  pointer-events: none;
}
.press-ring circle {
  fill: none;
  stroke: #fff;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 151;
  stroke-dashoffset: 151;
  /* 400ms matches LONG_PRESS_MS; short delay so quick taps never flash it */
  animation: press-fill 320ms linear 80ms forwards;
}
@keyframes press-fill {
  to { stroke-dashoffset: 0; }
}

.label {
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: #fff;
  background: rgba(15, 23, 42, 0.55);
  padding: 3px 6px 2px;
  border-radius: 9999px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.label.inactive {
  color: rgba(255, 255, 255, 0.7);
}
</style>
