<script setup lang="ts">
import { Icon } from '@iconify/vue'
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
  x: number
  y: number
  color: string
  label: string
  active: boolean
  selected: boolean
  icon: string
}

const markers = computed<MarkerInfo[]>(() => {
  return layout.placements
    .map((p) => {
      const pos = positions.value[p.entity_id]
      if (!pos?.visible) return null
      const entity = entities.get(p.entity_id)
      // Hide markers for placements whose entity doesn't exist in the active source
      if (!entity && entities.status === 'connected') return null
      const adapter = entity ? getAdapter(entity) : undefined
      const visual = adapter && entity
        ? adapter.getDisplayState(entity)
        : { color: '#888', intensity: 0.3, label: '?', active: false }
      return {
        entityId: p.entity_id,
        x: pos.x,
        y: pos.y,
        color: (!p.entity_id.startsWith('light.') && p.color) ? p.color : visual.color,
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
    callService(domain, 'toggle', {}, { entity_id: entityId })
  } else {
    layout.select(entityId)
  }
}

function onPointerCancel(entityId: string) {
  cancelPress(entityId)
  longPressTriggered.delete(entityId)
}
</script>

<template>
  <!-- Overlay sits exactly on top of the TresCanvas (absolute, no pointer events
       on the container itself so OrbitControls still gets empty-space events). -->
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <div
      v-for="m in markers"
      :key="m.entityId"
      class="marker pointer-events-auto"
      :style="{ transform: `translate(${m.x}px, ${m.y}px)` }"
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
