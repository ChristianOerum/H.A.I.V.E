<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'
import { detectAppliance } from '~/utils/appliance'
import type { DevicePlacement } from '~/stores/layout'
import type { FloorplanRoom } from '~/stores/floorplan'

const fp = useFloorplanStore()
const layout = useLayoutStore()
const entities = useEntitiesStore()
const toast = useToast()

const openId = ref<string | null>(null)
function toggle(id: string) {
  openId.value = openId.value === id ? null : id
}

function label(entityId: string): string {
  return (entities.get(entityId)?.attributes?.friendly_name as string | undefined) ?? entityId
}
const domainOf = (id: string) => id.split('.')[0]
const iconFor = (p: Pick<DevicePlacement, 'entity_id' | 'icon'>) => entityIcon(p.entity_id, entities.get(p.entity_id), p.icon)
const autoIcon = (id: string) => entityIcon(id, entities.get(id))

function isAppliance(p: DevicePlacement): boolean {
  const e = entities.get(p.entity_id)
  return !!e && !!detectAppliance(e, p.icon)
}
const isLight = (p: DevicePlacement) => p.entity_id.startsWith('light.')
const hasEmitter = (p: DevicePlacement) => isLight(p) || p.entity_id.startsWith('media_player.') || isAppliance(p)

// ── Rooms: which room a device sits in, and "move to room centre" ──
// Floorplan 2D [x, y] maps to world [x, ·, z].
function contains(room: FloorplanRoom, x: number, z: number): boolean {
  const v = room.vertices
  let inside = false
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, zi] = v[i]
    const [xj, zj] = v[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
function roomOf(p: DevicePlacement): FloorplanRoom | undefined {
  return fp.rooms.find((r) => r.vertices.length >= 3 && contains(r, p.position[0], p.position[2]))
}
function centroid(room: FloorplanRoom): [number, number] {
  const v = room.vertices
  let a = 0, cx = 0, cz = 0
  for (let i = 0; i < v.length; i++) {
    const [x1, z1] = v[i]
    const [x2, z2] = v[(i + 1) % v.length]
    const f = x1 * z2 - x2 * z1
    a += f
    cx += (x1 + x2) * f
    cz += (z1 + z2) * f
  }
  if (Math.abs(a) < 1e-6) return [v[0][0], v[0][1]]
  return [cx / (3 * a), cz / (3 * a)]
}
function moveToRoom(p: DevicePlacement, roomId: string) {
  const room = fp.rooms.find((r) => r.id === roomId)
  if (!room) return
  const [x, z] = centroid(room)
  layout.updatePlacement(p.entity_id, { position: [+x.toFixed(2), p.position[1], +z.toFixed(2)] })
}

function setAxis(p: DevicePlacement, axis: 0 | 1 | 2, v: number | undefined) {
  if (v === undefined) return
  const pos: [number, number, number] = [...p.position]
  pos[axis] = v
  layout.updatePlacement(p.entity_id, { position: pos })
}

// ── List + search ──
const search = ref('')
const visiblePlacements = computed(() => {
  const q = search.value.toLowerCase().trim()
  return layout.placements.filter((p) => {
    // Hide saved placements until entities load, instead of listing stale
    // devices before HA is actually up.
    if (entities.status !== 'idle' && !entities.get(p.entity_id) && !isOrphan(p.entity_id)) return false
    if (!q) return true
    return label(p.entity_id).toLowerCase().includes(q) || p.entity_id.toLowerCase().includes(q)
  })
})

// ── Orphans: placements whose entity no longer exists in Home Assistant ──
function isOrphan(entityId: string): boolean {
  return entities.status === 'connected' && !entities.get(entityId)
}
const orphans = computed(() => layout.placements.filter((p) => isOrphan(p.entity_id)))
function removeOrphans() {
  const n = orphans.value.length
  for (const p of orphans.value) layout.deletePlacement(p.entity_id)
  openId.value = null
  toast.success(`Removed ${n} missing ${n === 1 ? 'device' : 'devices'}`)
}

function remove(entityId: string) {
  layout.deletePlacement(entityId)
  if (openId.value === entityId) openId.value = null
}

// Per-light 3D brightness multiplier bounds.
const LIGHT_MULT_MIN = 0.1
const LIGHT_MULT_MAX = 5

// ── Add device ──
const showAdd = ref(false)
const addSearch = ref('')
const addDomain = ref<string | null>(null)
const addInput = ref<HTMLInputElement | null>(null)

const placedIds = computed(() => new Set(layout.placements.map((p) => p.entity_id)))
const available = computed(() =>
  entities.list
    .filter((e) => !placedIds.value.has(e.entity_id))
    .sort((a, b) => label(a.entity_id).localeCompare(label(b.entity_id))),
)
const DOMAIN_LABELS: Record<string, string> = {
  light: 'Lights', switch: 'Switches', sensor: 'Sensors', binary_sensor: 'Binary sensors',
  media_player: 'Media', climate: 'Climate', cover: 'Covers', camera: 'Cameras', fan: 'Fans', lock: 'Locks',
}
/** Most common domains among available entities, as filter chips. */
const domainChips = computed(() => {
  const counts = new Map<string, number>()
  for (const e of available.value) counts.set(domainOf(e.entity_id), (counts.get(domainOf(e.entity_id)) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => ({ domain: d, count: n }))
})
const filteredAvailable = computed(() => {
  const q = addSearch.value.toLowerCase().trim()
  return available.value
    .filter((e) => !addDomain.value || domainOf(e.entity_id) === addDomain.value)
    .filter((e) => !q || label(e.entity_id).toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))
    .slice(0, 100)
})

watch(showAdd, async (v) => {
  if (!v) return
  addSearch.value = ''
  addDomain.value = null
  await nextTick()
  addInput.value?.focus()
})

function add(e: HassEntity) {
  showAdd.value = false
  layout.addPlacement(e.entity_id)
  // Drop it in the first room so it starts somewhere visible rather than at the origin.
  const p = layout.placementFor(e.entity_id)
  const room = fp.rooms[0]
  if (p && room) moveToRoom(p, room.id)
  openId.value = e.entity_id
  toast.success(room ? `Added ${label(e.entity_id)} to ${room.name} — change the room below` : `Added ${label(e.entity_id)}`)
}

const ACTIVE_STATES = ['on', 'open', 'playing', 'unlocked', 'true', 'heat', 'cool']
</script>

<template>
  <div class="flex flex-col gap-2">
    <button class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg shrink-0" @click="showAdd = true">
      <Icon icon="mdi:plus" width="20" height="20" />
      <span>Add device</span>
    </button>

    <!-- Orphans -->
    <div v-if="orphans.length" class="shrink-0 flex items-center gap-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-3 py-2.5">
      <Icon icon="mdi:link-variant-off" width="20" height="20" class="shrink-0 text-yellow-500" />
      <p class="flex-1 text-xs leading-snug">
        {{ orphans.length }} placed {{ orphans.length === 1 ? 'device no longer exists' : 'devices no longer exist' }} in Home Assistant.
      </p>
      <button class="field-action shrink-0" @click="removeOrphans">Remove</button>
    </div>

    <div v-if="layout.placements.length > 5" class="relative shrink-0">
      <Icon icon="mdi:magnify" width="18" height="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
      <input v-model="search" type="search" placeholder="Filter placed devices…" class="field-input pl-10" />
    </div>

    <div v-if="layout.placements.length === 0" class="flex flex-col items-center text-center gap-2 py-10 px-4">
      <Icon icon="mdi:devices" width="36" height="36" class="text-fg-muted" />
      <p class="text-sm font-medium">No devices placed yet</p>
      <p class="field-hint">Add a Home Assistant device to show it as a marker on your floorplan.</p>
    </div>
    <p v-else-if="visiblePlacements.length === 0 && search" class="text-xs text-fg-muted text-center py-6">No devices match “{{ search }}”</p>

    <SettingsItem
      v-for="p in visiblePlacements"
      :key="p.entity_id"
      :title="label(p.entity_id)"
      :icon="iconFor(p)"
      :open="openId === p.entity_id"
      @toggle="toggle(p.entity_id)"
    >
      <template #badges>
        <span
          v-if="isOrphan(p.entity_id)"
          class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-300"
          title="This entity no longer exists in Home Assistant"
        >Missing</span>
        <span
          v-else-if="entities.get(p.entity_id)?.state"
          class="shrink-0 w-2 h-2 rounded-full"
          :class="ACTIVE_STATES.includes(entities.get(p.entity_id)!.state) ? 'bg-accent' : 'bg-fg/20'"
          :title="entities.get(p.entity_id)!.state"
        />
      </template>
      <template #subtitle>
        {{ roomOf(p)?.name ?? 'Not in a room' }} · <span class="font-mono">{{ p.entity_id }}</span>
      </template>
      <template #actions>
        <SettingsDelete :label="label(p.entity_id)" @confirm="remove(p.entity_id)" />
      </template>

      <SettingsSection title="Location">
        <SettingsField label="Room" hint="Moves the marker to the middle of the room. Fine-tune with the position below.">
          <select
            class="field-input"
            :value="roomOf(p)?.id ?? ''"
            @change="moveToRoom(p, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Choose a room…</option>
            <option v-for="room in fp.rooms" :key="room.id" :value="room.id">{{ room.name }}</option>
          </select>
        </SettingsField>
        <div class="grid grid-cols-3 gap-2">
          <SettingsField label="Left / right">
            <SettingsNumber label="X position" :value="p.position[0]" :step="0.1" unit="m" @change="(v) => setAxis(p, 0, v)" />
          </SettingsField>
          <SettingsField label="Height">
            <SettingsNumber label="Height" :value="p.position[1]" :step="0.1" unit="m" @change="(v) => setAxis(p, 1, v)" />
          </SettingsField>
          <SettingsField label="Front / back">
            <SettingsNumber label="Z position" :value="p.position[2]" :step="0.1" unit="m" @change="(v) => setAxis(p, 2, v)" />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="Marker">
        <SettingsField label="Icon">
          <SettingsIconPicker :value="p.icon" :auto="autoIcon(p.entity_id)" @update="(v) => layout.updatePlacement(p.entity_id, { icon: v })" />
        </SettingsField>
        <SettingsField v-if="!isLight(p)" label="Colour" hint="Lights use their real colour automatically.">
          <SettingsColor :value="p.color" fallback="#888888" placeholder="Device default" @update="(v) => layout.updatePlacement(p.entity_id, { color: v })" />
        </SettingsField>
      </SettingsSection>

      <SettingsSection v-if="hasEmitter(p)" title="3D effect">
        <SettingsField
          :label="isAppliance(p) ? 'Effect comes from' : 'Light comes from'"
          :hint="isAppliance(p) ? 'The running animation plays on this furniture piece.' : 'The light glows from the top of this furniture piece, e.g. a lamp shade.'"
          :resettable="!!p.lightSourceFurnitureId"
          reset-label="Use marker"
          @reset="layout.updatePlacement(p.entity_id, { lightSourceFurnitureId: undefined })"
        >
          <select
            class="field-input"
            :value="p.lightSourceFurnitureId ?? ''"
            @change="layout.updatePlacement(p.entity_id, { lightSourceFurnitureId: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">The marker itself</option>
            <optgroup v-for="group in fp.furnitureGroups" :key="group.id" :label="group.label">
              <option v-for="item in fp.furniture.filter((f) => f.groupId === group.id)" :key="item.id" :value="item.id">{{ item.label }}</option>
            </optgroup>
            <optgroup v-if="fp.furniture.some((f) => !f.groupId)" label="Ungrouped">
              <option v-for="item in fp.furniture.filter((f) => !f.groupId)" :key="item.id" :value="item.id">{{ item.label }}</option>
            </optgroup>
          </select>
        </SettingsField>

        <SettingsField
          v-if="isLight(p)"
          hint="How bright this light looks in the 3D scene compared with the real room."
          :resettable="(p.brightnessMultiplier ?? 1) !== 1"
          reset-label="Reset to 1×"
          @reset="layout.updatePlacement(p.entity_id, { brightnessMultiplier: undefined })"
        >
          <template #label>3D brightness <span class="text-accent tabular-nums ml-1">{{ (p.brightnessMultiplier ?? 1).toFixed(1) }}×</span></template>
          <input
            type="range"
            :min="LIGHT_MULT_MIN"
            :max="LIGHT_MULT_MAX"
            step="0.1"
            class="w-full h-8 accent-accent"
            :value="p.brightnessMultiplier ?? 1"
            @input="layout.updatePlacement(p.entity_id, { brightnessMultiplier: +($event.target as HTMLInputElement).value })"
          />
        </SettingsField>
      </SettingsSection>
    </SettingsItem>

    <!-- Add device -->
    <SettingsModal
      :open="showAdd"
      title="Add device"
      :subtitle="`${available.length} Home Assistant entities not yet on the floorplan`"
      size="lg"
      @close="showAdd = false"
    >
      <template #toolbar>
        <div class="px-5 pb-3 shrink-0 flex flex-col gap-2">
          <div class="relative">
            <Icon icon="mdi:magnify" width="18" height="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            <input ref="addInput" v-model="addSearch" type="search" placeholder="Search by name or entity ID…" class="field-input pl-10" />
          </div>
          <div class="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
            <button
              class="shrink-0 h-8 px-3 rounded-full text-xs font-medium border transition-colors"
              :class="addDomain === null ? 'bg-accent text-bg border-accent' : 'border-fg/10 text-fg-muted'"
              @click="addDomain = null"
            >All</button>
            <button
              v-for="c in domainChips"
              :key="c.domain"
              class="shrink-0 h-8 px-3 rounded-full text-xs font-medium border transition-colors"
              :class="addDomain === c.domain ? 'bg-accent text-bg border-accent' : 'border-fg/10 text-fg-muted'"
              @click="addDomain = addDomain === c.domain ? null : c.domain"
            >{{ DOMAIN_LABELS[c.domain] ?? c.domain }} <span class="opacity-60">{{ c.count }}</span></button>
          </div>
        </div>
      </template>

      <p v-if="filteredAvailable.length === 0" class="text-sm text-fg-muted text-center py-10">
        {{ available.length === 0 ? 'Every entity is already on the floorplan.' : `Nothing matches “${addSearch}”` }}
      </p>
      <div class="flex flex-col -mx-2">
        <button
          v-for="e in filteredAvailable"
          :key="e.entity_id"
          class="flex items-center gap-3 px-2 py-2.5 rounded-xl active:bg-accent/10 transition-colors text-left"
          @click="add(e)"
        >
          <div class="w-10 h-10 rounded-xl bg-bg-elevated flex items-center justify-center shrink-0">
            <Icon :icon="autoIcon(e.entity_id)" width="20" height="20" class="text-fg-muted" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">{{ label(e.entity_id) }}</div>
            <div class="text-[11px] text-fg-muted font-mono truncate">{{ e.entity_id }}</div>
          </div>
          <span class="text-[11px] text-fg-muted shrink-0">{{ humanizeState(e.state) }}</span>
          <Icon icon="mdi:plus-circle-outline" width="22" height="22" class="text-accent shrink-0" />
        </button>
      </div>
      <p v-if="filteredAvailable.length === 100" class="field-hint text-center mt-3">Showing the first 100 — search to narrow it down.</p>
    </SettingsModal>
  </div>
</template>
