<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { FloorplanRoom } from '~/stores/floorplan'

const fp = useFloorplanStore()

const expandedOpeningId = ref<string | null>(null)

const selectedOpening = computed(() =>
  fp.selectedOpeningId ? fp.openings.find((o) => o.id === fp.selectedOpeningId) : undefined,
)

function toggleRoom(id: string) {
  if (fp.selection?.id === id) fp.deselect()
  else fp.select('room', id)
}

/** Length in metres of edge `i` of a room (vertex i → vertex i+1). */
function edgeLength(room: FloorplanRoom, i: number): number {
  const n = room.vertices.length
  const a = room.vertices[i]
  const b = room.vertices[(i + 1) % n]
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/** Floor area via the shoelace formula. */
function area(room: FloorplanRoom): number {
  const v = room.vertices
  let s = 0
  for (let i = 0; i < v.length; i++) {
    const [x1, y1] = v[i]
    const [x2, y2] = v[(i + 1) % v.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

const totalArea = computed(() => fp.rooms.reduce((sum, r) => sum + area(r), 0))

function roomOpenings(roomId: string) {
  return fp.openings.filter((o) => o.roomId === roomId)
}

// ── Phone scan ──
const toast = useToast()
const scan = usePendingScan()
const scanModalOpen = ref(false)
onMounted(() => scan.refresh())

// Close the QR dialog as soon as the phone has sent its scan.
watch(() => scan.pending.value, (s) => { if (s) scanModalOpen.value = false })

async function importScan() {
  const result = await scan.importIntoFloorplan()
  if (!result) return
  const dropped = result.droppedOpenings ? ` (${result.droppedOpenings} door/window not near a wall, skipped)` : ''
  toast.success(`Imported ${result.rooms.length} room${result.rooms.length === 1 ? '' : 's'}${dropped}. Check and save.`, 'mdi:cellphone-arrow-down')
}

function highlight(roomId: string, edgeIdx: number) {
  fp.highlightedWall = { roomId, edgeIdx }
}
function unhighlight() {
  fp.highlightedWall = null
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Door / window picked on the canvas -->
    <div
      v-if="selectedOpening"
      class="shrink-0 rounded-xl border p-3 flex flex-col gap-3"
      :class="selectedOpening.type === 'door' ? 'border-orange-400/50 bg-orange-400/5' : 'border-sky-400/50 bg-sky-400/5'"
    >
      <div class="flex items-center gap-2">
        <Icon
          :icon="selectedOpening.type === 'door' ? 'mdi:door' : 'mdi:window-closed-variant'"
          width="20"
          height="20"
          :class="selectedOpening.type === 'door' ? 'text-orange-400' : 'text-sky-400'"
        />
        <span class="flex-1 text-sm font-semibold capitalize">Selected {{ selectedOpening.type }}</span>
        <SettingsDelete :label="selectedOpening.type" @confirm="fp.deleteOpening(selectedOpening.id); fp.selectedOpeningId = null" />
        <button class="w-9 h-9 flex items-center justify-center rounded-lg text-fg-muted active:bg-bg-elevated" aria-label="Deselect" @click="fp.selectedOpeningId = null">
          <Icon icon="mdi:close" width="18" height="18" />
        </button>
      </div>
      <SettingsOpeningFields :opening="selectedOpening" />
    </div>

    <!-- Phone scan waiting to be imported -->
    <div v-if="scan.pending.value" class="shrink-0 rounded-xl border border-accent/50 bg-accent/5 p-3 flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <Icon icon="mdi:cellphone-arrow-down" width="20" height="20" class="text-accent" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold">Phone scan received</div>
          <div class="text-xs text-fg-muted">
            {{ scan.pending.value.rooms.length }} room{{ scan.pending.value.rooms.length === 1 ? '' : 's' }}
            · {{ scan.pending.value.openings.length }} door{{ scan.pending.value.openings.length === 1 ? '' : 's' }}/windows
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <SettingsDelete label="scan" @confirm="scan.discard()" />
        <button class="btn-touch flex-1 gap-2 text-sm font-semibold bg-accent !text-bg" @click="importScan">
          <Icon icon="mdi:import" width="18" height="18" />
          Import into floorplan
        </button>
      </div>
    </div>

    <button v-else class="btn-touch shrink-0 gap-2 text-sm" @click="scanModalOpen = true">
      <Icon icon="mdi:cube-scan" width="18" height="18" />
      Import room scan
    </button>
    <SettingsScanModal :open="scanModalOpen" @close="scanModalOpen = false" />

    <!-- Empty state -->
    <div v-if="fp.rooms.length === 0" class="flex flex-col items-center text-center gap-2 py-10 px-4">
      <Icon icon="mdi:floor-plan" width="36" height="36" class="text-fg-muted" />
      <p class="text-sm font-medium">No rooms yet</p>
      <p class="field-hint">Use the canvas on the left to draw your first room, or import a Polycam scan.</p>
    </div>

    <SettingsItem
      v-for="room in fp.rooms"
      :key="room.id"
      :title="room.name"
      :subtitle="`${area(room).toFixed(1)} m² · ${room.vertices.length} walls${roomOpenings(room.id).length ? ` · ${roomOpenings(room.id).length} openings` : ''}`"
      icon="mdi:floor-plan"
      :icon-color="room.color"
      :open="fp.selection?.id === room.id"
      @toggle="toggleRoom(room.id)"
    >
      <template #actions>
        <SettingsDelete :label="room.name" @confirm="fp.deleteRoom(room.id)" />
      </template>

      <SettingsField label="Name">
        <input
          class="field-input"
          :value="room.name"
          @change="fp.updateRoom(room.id, { name: ($event.target as HTMLInputElement).value })"
        />
      </SettingsField>

      <SettingsSection title="Walls">
        <div class="grid grid-cols-2 gap-3">
          <SettingsField label="Height">
            <SettingsNumber label="Wall height" :value="room.wallH ?? 1.2" :step="0.05" :min="0.5" :max="6" unit="m" @change="(v) => fp.updateRoom(room.id, { wallH: v })" />
          </SettingsField>
          <SettingsField label="Thickness">
            <SettingsNumber label="Default wall thickness" :value="room.wallThickness ?? 0.15" :step="0.01" :min="0.05" :max="1" unit="m" @change="(v) => fp.updateRoom(room.id, { wallThickness: v })" />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="Floor">
        <SettingsField label="Colour">
          <SettingsColor
            :value="room.color"
            placeholder="Theme colour"
            @update="(v) => fp.updateRoom(room.id, { color: v })"
          />
        </SettingsField>
        <div class="grid grid-cols-2 gap-3">
          <SettingsField label="Hue shift">
            <SettingsNumber label="Hue shift" :value="room.tintH" :step="5" unit="°" @change="(v) => fp.updateRoom(room.id, { tintH: v })" />
          </SettingsField>
          <SettingsField label="Brightness">
            <SettingsNumber label="Brightness" :value="room.tintV" :step="0.05" :min="0.5" :max="1.5" unit="×" @change="(v) => fp.updateRoom(room.id, { tintV: v })" />
          </SettingsField>
        </div>
      </SettingsSection>

      <!-- Per-wall overrides: thickness + visibility in one row per wall -->
      <SettingsSection
        v-if="room.vertices.length >= 3"
        title="Individual walls"
        hint="Leave thickness empty to use the room default. Hidden walls show only as an outline in 3D."
      >
        <template #actions>
          <button
            v-if="room.wallThicknesses && Object.keys(room.wallThicknesses).length"
            class="field-action"
            @click="fp.updateRoom(room.id, { wallThicknesses: undefined })"
          >Reset thickness</button>
          <button
            v-if="room.hiddenWalls?.length"
            class="field-action"
            @click="fp.updateRoom(room.id, { hiddenWalls: undefined })"
          >Show all</button>
        </template>
        <div class="flex flex-col gap-1.5">
          <div
            v-for="(_v, i) in room.vertices"
            :key="`wall-${room.id}-${i}`"
            class="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
            :class="fp.highlightedWall?.roomId === room.id && fp.highlightedWall.edgeIdx === i ? 'bg-accent/10' : 'bg-bg/50'"
            @pointerenter="highlight(room.id, i)"
            @pointerleave="unhighlight"
            @focusin="highlight(room.id, i)"
            @focusout="unhighlight"
          >
            <div class="w-16 shrink-0 leading-tight">
              <div class="text-xs font-medium" :class="room.hiddenWalls?.includes(i) ? 'text-fg-muted line-through' : 'text-fg'">Wall {{ i + 1 }}</div>
              <div class="text-[10px] text-fg-muted tabular-nums">{{ edgeLength(room, i).toFixed(2) }} m</div>
            </div>
            <SettingsNumber
              class="flex-1"
              :label="`Wall ${i + 1} thickness`"
              :value="room.wallThicknesses?.[i]"
              :placeholder="String(room.wallThickness ?? 0.15)"
              :step="0.01"
              :min="0.05"
              :max="1"
              unit="m"
              nullable
              @change="(v) => fp.setWallThickness(room.id, i, v)"
            />
            <button
              class="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg active:bg-bg-elevated"
              :class="room.hiddenWalls?.includes(i) ? 'text-fg-muted' : 'text-accent'"
              :aria-label="room.hiddenWalls?.includes(i) ? `Show wall ${i + 1} in 3D` : `Hide wall ${i + 1} in 3D`"
              :aria-pressed="!room.hiddenWalls?.includes(i)"
              @click="fp.setWallHidden(room.id, i, !room.hiddenWalls?.includes(i))"
            >
              <Icon :icon="room.hiddenWalls?.includes(i) ? 'mdi:eye-off-outline' : 'mdi:eye-outline'" width="20" height="20" />
            </button>
            <SettingsDelete v-if="room.vertices.length > 3" :label="`wall ${i + 1}`" @confirm="fp.removeWall(room.id, i)" />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection v-if="roomOpenings(room.id).length" title="Doors & windows">
        <div class="flex flex-col gap-1.5">
          <SettingsItem
            v-for="op in roomOpenings(room.id)"
            :key="op.id"
            nested
            :title="op.type === 'door' ? 'Door' : 'Window'"
            :subtitle="`Wall ${op.edgeIdx + 1} · ${op.width} m wide`"
            :open="expandedOpeningId === op.id"
            @toggle="expandedOpeningId = expandedOpeningId === op.id ? null : op.id"
          >
            <template #leading>
              <Icon
                :icon="op.type === 'door' ? 'mdi:door' : 'mdi:window-closed-variant'"
                width="20"
                height="20"
                class="shrink-0"
                :class="op.type === 'door' ? 'text-orange-400' : 'text-sky-400'"
              />
            </template>
            <template #actions>
              <SettingsDelete :label="op.type" @confirm="fp.deleteOpening(op.id)" />
            </template>
            <SettingsOpeningFields :opening="op" />
          </SettingsItem>
        </div>
      </SettingsSection>
    </SettingsItem>

    <!-- Total floor area -->
    <div v-if="fp.rooms.length > 1" class="shrink-0 flex items-center justify-between px-3 py-2 mt-1 border-t border-fg/10 text-sm">
      <span class="text-fg-muted">Total · {{ fp.rooms.length }} rooms</span>
      <span class="font-semibold tabular-nums">{{ totalArea.toFixed(1) }} m²</span>
    </div>
  </div>
</template>
