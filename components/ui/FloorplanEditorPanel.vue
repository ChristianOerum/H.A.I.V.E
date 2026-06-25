<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { getAdapter } from '~/utils/deviceRegistry'
import { hexToHue, hueToHex, hueToHexLight } from '~/stores/theme'

const fp = useFloorplanStore()
const layout = useLayoutStore()
const entities = useEntitiesStore()
const theme = useThemeStore()

const tab = computed({
  get: () => fp.editorTab,
  set: (v) => { fp.editorTab = v },
})
const selectedOpeningId = ref<string | null>(null)
const selectedDeviceId = ref<string | null>(null)
const newDeviceEntityId = ref('')

function selectItem(type: 'room' | 'furniture', id: string) {
  if (fp.selection?.id === id) fp.deselect()
  else fp.select(type, id)
}

function toggleOpening(id: string) {
  selectedOpeningId.value = selectedOpeningId.value === id ? null : id
}

function numVal(e: Event) {
  return +(e.target as HTMLInputElement).value
}

function onKeyDown(e: KeyboardEvent) {
  if (!fp.editMode) return
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); fp.undo() }
  else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); fp.redo() }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

// ---- Devices tab helpers ----
function entityLabel(entityId: string): string {
  const e = entities.get(entityId)
  return (e?.attributes?.friendly_name as string | undefined) ?? entityId
}

function getAutoIcon(entityId: string): string {
  const entity = entities.get(entityId)
  if (entity) {
    const adapter = getAdapter(entity)
    if (adapter?.icon) return adapter.icon
  }
  if (entityId.includes('temperature')) return 'mdi:thermometer'
  if (entityId.includes('humidity'))    return 'mdi:water-percent'
  if (entityId.includes('blinds') || entityId.includes('cover')) return 'mdi:blinds'
  if (entityId.includes('garage'))      return 'mdi:garage'
  if (entityId.includes('tv') || entityId.includes('television')) return 'mdi:television'
  if (entityId.includes('camera'))      return 'mdi:camera'
  if (entityId.includes('door'))        return 'mdi:door'
  if (entityId.includes('lock'))        return 'mdi:lock'
  if (entityId.includes('motion'))      return 'mdi:motion-sensor'
  return 'mdi:help-circle'
}

const placedIds = computed(() => new Set(layout.placements.map((p) => p.entity_id)))

const availableEntities = computed(() =>
  entities.list
    .filter((e) => !placedIds.value.has(e.entity_id))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
)

function onAddDevice() {
  if (!newDeviceEntityId.value) return
  layout.addPlacement(newDeviceEntityId.value)
  selectedDeviceId.value = newDeviceEntityId.value
  newDeviceEntityId.value = ''
}

function onPositionChange(entityId: string, axis: 0 | 1 | 2, e: Event) {
  const p = layout.placements.find((x) => x.entity_id === entityId)
  if (!p) return
  const pos: [number, number, number] = [...p.position]
  pos[axis] = +(e.target as HTMLInputElement).value
  layout.updatePlacement(entityId, { position: pos })
}

// ---- Save (floorplan or layout depending on active tab) ----
const isDirty = computed(() =>
  tab.value === 'preferences'
    ? theme.accentHue !== theme.accentHueSaved
    : tab.value === 'devices' ? layout.dirty : fp.dirty,
)
function onSave() {
  if (tab.value === 'preferences') theme.saveAccentHue()
  else if (tab.value === 'devices') layout.save()
  else fp.save()
}

// ---- Preferences (accent colour) ----
const ACCENT_PRESETS: { label: string; hue: number }[] = [
  { label: 'Teal',   hue: 174 },
  { label: 'Blue',   hue: 217 },
  { label: 'Indigo', hue: 243 },
  { label: 'Purple', hue: 270 },
  { label: 'Rose',   hue: 347 },
  { label: 'Amber',  hue:  38 },
  { label: 'Green',  hue: 142 },
]

// Derived hex for the color-picker input (dark-mode accent swatch for hue)
const accentPickerHex = computed(() => hueToHex(theme.accentHue))
const accentDarkHex = computed(() => hueToHex(theme.accentHue))
const accentLightHex = computed(() => hueToHexLight(theme.accentHue))

function onAccentPickerInput(e: Event) {
  const hex = (e.target as HTMLInputElement).value
  theme.setAccentHue(hexToHue(hex))
}
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="transition-transform duration-150 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="fp.editMode"
      class="absolute top-0 right-0 h-full w-80 bg-bg-panel border-l border-bg-elevated flex flex-col z-20 pointer-events-auto"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-bg-elevated shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-fg">Properties</span>
          <span
            v-if="isDirty"
            class="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-300 rounded"
          >unsaved</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="btn-touch !min-w-0 !px-2 text-fg-muted disabled:opacity-30"
            :disabled="!fp.canUndo"
            title="Undo (Ctrl+Z)"
            @click="fp.undo()"
          >↩</button>
          <button
            class="btn-touch !min-w-0 !px-2 text-fg-muted disabled:opacity-30"
            :disabled="!fp.canRedo"
            title="Redo (Ctrl+Y)"
            @click="fp.redo()"
          >↪</button>
          <button class="btn-touch !min-w-0 !px-3 text-fg-muted" @click="fp.toggleEditMode()">✕</button>
        </div>
      </div>

      <!-- Hint -->
      <div class="px-4 py-2 text-[10px] text-fg-muted border-b border-bg-elevated shrink-0 leading-relaxed">
        Use the <span class="text-accent">canvas on the left</span> to draw rooms, drag vertices, and place door/window openings.
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-bg-elevated shrink-0">
        <button
          v-for="t in (['rooms', 'furniture', 'devices'] as const)"
          :key="t"
          class="flex-1 py-2.5 text-xs capitalize transition-colors"
          :class="tab === t ? 'text-accent border-b-2 border-accent' : 'text-fg-muted'"
          @click="tab = t; fp.deselect(); selectedDeviceId = null"
        >{{ t }}</button>
        <button
          class="flex-1 py-2.5 text-xs capitalize transition-colors"
          :class="tab === 'preferences' ? 'text-accent border-b-2 border-accent' : 'text-fg-muted'"
          @click="tab = 'preferences'; fp.deselect(); selectedDeviceId = null"
        >Prefs</button>
      </div>

      <!-- Scrollable list + forms -->
      <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-1">

        <!-- OPENING PROPERTIES (shown on top when an opening is selected) -->
        <template v-if="fp.selectedOpeningId">
          <div class="rounded-lg bg-bg-elevated border border-orange-400/30 p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  :class="fp.openings.find(o => o.id === fp.selectedOpeningId)?.type === 'door' ? 'bg-orange-400' : 'bg-sky-400'"
                />
                <span class="text-xs font-medium text-fg capitalize">
                  {{ fp.openings.find(o => o.id === fp.selectedOpeningId)?.type }} Properties
                </span>
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="text-xs text-red-400 px-2 py-0.5 rounded hover:bg-red-500/20"
                  @click="fp.deleteOpening(fp.selectedOpeningId!); fp.selectedOpeningId = null"
                >Del</button>
                <button class="text-fg-muted text-xs px-2 py-0.5 rounded hover:bg-bg" @click="fp.selectedOpeningId = null">✕</button>
              </div>
            </div>
            <template v-if="fp.openings.find(o => o.id === fp.selectedOpeningId) as any">
              <div class="grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-1">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Width (m)</span>
                  <input type="number" step="0.05" min="0.3"
                    class="bg-bg text-fg text-xs rounded px-2 py-1.5 border border-bg-elevated w-full"
                    :value="fp.openings.find(o => o.id === fp.selectedOpeningId)!.width"
                    @change="fp.updateOpening(fp.selectedOpeningId!, { width: numVal($event) })"
                  />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Height (m)</span>
                  <input type="number" step="0.05" min="0.1"
                    class="bg-bg text-fg text-xs rounded px-2 py-1.5 border border-bg-elevated w-full"
                    :value="fp.openings.find(o => o.id === fp.selectedOpeningId)!.height ?? (fp.openings.find(o => o.id === fp.selectedOpeningId)!.type === 'door' ? 1.2 : 0.52)"
                    @change="fp.updateOpening(fp.selectedOpeningId!, { height: numVal($event) })"
                  />
                </label>
                <label v-if="fp.openings.find(o => o.id === fp.selectedOpeningId)?.type === 'window'" class="flex flex-col gap-1 col-span-2">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Sill height (m)</span>
                  <input type="number" step="0.05" min="0"
                    class="bg-bg text-fg text-xs rounded px-2 py-1.5 border border-bg-elevated w-full"
                    :value="fp.openings.find(o => o.id === fp.selectedOpeningId)!.sill ?? 0.34"
                    @change="fp.updateOpening(fp.selectedOpeningId!, { sill: numVal($event) })"
                  />
                </label>
              </div>
            </template>
          </div>
          <div class="h-px bg-bg-elevated my-1 shrink-0" />
        </template>

        <!-- ROOMS -->
        <template v-if="tab === 'rooms'">
          <div
            v-for="room in fp.rooms"
            :key="room.id"
            class="rounded-lg px-3 py-2 cursor-pointer transition-colors"
            :class="fp.selection?.id === room.id ? 'bg-accent/15 border border-accent/50' : 'bg-bg-elevated'"
            @click="selectItem('room', room.id)"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm text-fg truncate mr-2">{{ room.name }}</span>
              <button
                class="text-xs text-red-400 px-2 py-1 rounded shrink-0 hover:bg-red-500/20"
                @click.stop="fp.deleteRoom(room.id)"
              >Del</button>
            </div>

            <div v-if="fp.selection?.id === room.id" class="mt-3 flex flex-col gap-3" @click.stop>
              <label class="flex flex-col gap-1">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Name</span>
                <input
                  class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
                  :value="room.name"
                  @change="fp.updateRoom(room.id, { name: ($event.target as HTMLInputElement).value })"
                />
              </label>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-1">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Hue shift °</span>
                  <input type="number" step="5"
                    class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
                    :value="room.tintH"
                    @change="fp.updateRoom(room.id, { tintH: numVal($event) })"
                  />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Brightness</span>
                  <input type="number" step="0.05" min="0.5" max="1.5"
                    class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
                    :value="room.tintV"
                    @change="fp.updateRoom(room.id, { tintV: numVal($event) })"
                  />
                </label>
                <label class="flex flex-col gap-1 col-span-2">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Wall height (m)</span>
                  <input type="number" step="0.05" min="0.5" max="6"
                    class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
                    :value="room.wallH ?? 1.2"
                    @change="fp.updateRoom(room.id, { wallH: numVal($event) })"
                  />
                </label>
                <label class="flex flex-col gap-1 col-span-2">
                  <span class="text-[10px] text-fg-muted uppercase tracking-wide">Floor color</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      class="h-8 w-10 rounded cursor-pointer border border-bg-elevated bg-bg p-0.5 shrink-0"
                      :value="room.color ?? '#808080'"
                      @input="fp.updateRoom(room.id, { color: ($event.target as HTMLInputElement).value })"
                    />
                    <input
                      class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full font-mono"
                      :value="room.color ?? ''"
                      placeholder="auto (theme)"
                      maxlength="7"
                      @change="fp.updateRoom(room.id, { color: ($event.target as HTMLInputElement).value.trim() || undefined })"
                    />
                    <button
                      v-if="room.color"
                      class="text-xs text-fg-muted hover:text-fg shrink-0 px-1"
                      title="Reset to theme color"
                      @click.stop="fp.updateRoom(room.id, { color: undefined })"
                    >✕</button>
                  </div>
                </label>
              </div>
              <!-- Openings list for this room -->
              <div v-if="fp.openings.filter(o => o.roomId === room.id).length > 0">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Openings</span>
                <div class="mt-1 flex flex-col gap-1">
                  <div
                    v-for="op in fp.openings.filter(o => o.roomId === room.id)"
                    :key="op.id"
                    class="rounded bg-bg overflow-hidden"
                  >
                    <!-- Header row -->
                    <div
                      class="flex items-center gap-2 text-xs text-fg-muted px-2 py-1 cursor-pointer hover:bg-bg-elevated"
                      @click.stop="toggleOpening(op.id)"
                    >
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :class="op.type === 'door' ? 'bg-orange-400' : 'bg-sky-400'"
                      />
                      <span class="capitalize flex-1">{{ op.type }} · edge {{ op.edgeIdx }} · {{ op.width }}m</span>
                      <span class="text-fg-muted/50 text-[10px]">{{ selectedOpeningId === op.id ? '▲' : '▼' }}</span>
                      <button class="text-red-400 hover:text-red-300 ml-1" @click.stop="fp.deleteOpening(op.id)">✕</button>
                    </div>
                    <!-- Expanded fields -->
                    <div v-if="selectedOpeningId === op.id" class="px-2 pb-2 grid grid-cols-2 gap-2" @click.stop>
                      <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Width (m)</span>
                        <input type="number" step="0.05" min="0.3"
                          class="bg-bg-elevated text-fg text-xs rounded px-2 py-1 border border-bg w-full"
                          :value="op.width"
                          @change="fp.updateOpening(op.id, { width: numVal($event) })"
                        />
                      </label>
                      <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Height (m)</span>
                        <input type="number" step="0.05" min="0.1"
                          class="bg-bg-elevated text-fg text-xs rounded px-2 py-1 border border-bg w-full"
                          :value="op.height ?? (op.type === 'door' ? 1.2 : 0.52)"
                          @change="fp.updateOpening(op.id, { height: numVal($event) })"
                        />
                      </label>
                      <label v-if="op.type === 'window'" class="flex flex-col gap-1 col-span-2">
                        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Sill height (m)</span>
                        <input type="number" step="0.05" min="0"
                          class="bg-bg-elevated text-fg text-xs rounded px-2 py-1 border border-bg w-full"
                          :value="op.sill ?? 0.34"
                          @change="fp.updateOpening(op.id, { sill: numVal($event) })"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- FURNITURE -->
        <template v-if="tab === 'furniture'">

          <!-- Groups -->
          <div
            v-for="group in fp.furnitureGroups"
            :key="group.id"
            class="rounded-lg border border-bg-elevated overflow-hidden"
          >
            <!-- Group header -->
            <div
              class="flex items-center gap-2 px-3 py-2 bg-bg-elevated cursor-pointer select-none"
              @click="fp.toggleGroupCollapsed(group.id)"
            >
              <span class="text-fg-muted text-xs shrink-0">{{ group.collapsed ? '▶' : '▼' }}</span>
              <input
                class="bg-transparent text-sm font-medium text-fg flex-1 min-w-0 outline-none focus:text-accent"
                :value="group.label"
                @click.stop
                @change="fp.updateFurnitureGroup(group.id, { label: ($event.target as HTMLInputElement).value })"
              />
              <button
                class="text-xs text-accent border border-accent/40 rounded px-2 py-0.5 shrink-0 hover:bg-accent/10"
                title="Add item to group"
                @click.stop="fp.addFurniture(group.id)"
              >+</button>
              <button
                class="text-xs text-red-400 px-1.5 py-0.5 rounded shrink-0 hover:bg-red-500/20"
                title="Delete group (ungroups items)"
                @click.stop="fp.deleteFurnitureGroup(group.id)"
              >Del</button>
            </div>

            <!-- Group children -->
            <div v-if="!group.collapsed" class="flex flex-col gap-px bg-bg">
              <!-- Group position controls -->
              <div class="px-3 py-2 bg-bg border-b border-bg-elevated" @click.stop>
                <span class="text-[10px] text-fg-muted uppercase tracking-wide block mb-1.5">Group position</span>
                <div class="grid grid-cols-4 gap-1.5">
                  <label class="flex flex-col gap-0.5">
                    <span class="text-[9px] text-fg-muted uppercase">X</span>
                    <input type="number" step="0.25"
                      class="bg-bg-elevated text-fg text-xs rounded px-1.5 py-1 border border-bg w-full"
                      :value="group.x ?? 0"
                      @change="fp.updateFurnitureGroup(group.id, { x: numVal($event) })"
                    />
                  </label>
                  <label class="flex flex-col gap-0.5">
                    <span class="text-[9px] text-fg-muted uppercase">Y</span>
                    <input type="number" step="0.05"
                      class="bg-bg-elevated text-fg text-xs rounded px-1.5 py-1 border border-bg w-full"
                      :value="group.y ?? 0"
                      @change="fp.updateFurnitureGroup(group.id, { y: numVal($event) })"
                    />
                  </label>
                  <label class="flex flex-col gap-0.5">
                    <span class="text-[9px] text-fg-muted uppercase">Z</span>
                    <input type="number" step="0.25"
                      class="bg-bg-elevated text-fg text-xs rounded px-1.5 py-1 border border-bg w-full"
                      :value="group.z ?? 0"
                      @change="fp.updateFurnitureGroup(group.id, { z: numVal($event) })"
                    />
                  </label>
                  <label class="flex flex-col gap-0.5">
                    <span class="text-[9px] text-fg-muted uppercase">Rot°</span>
                    <input type="number" step="5"
                      class="bg-bg-elevated text-fg text-xs rounded px-1.5 py-1 border border-bg w-full"
                      :value="group.rotY ?? 0"
                      @change="fp.updateFurnitureGroup(group.id, { rotY: numVal($event) })"
                    />
                  </label>
                </div>
              </div>
              <!-- Items list (scrollable) -->
              <div class="overflow-y-auto max-h-72">
                <div
                  v-for="item in fp.furniture.filter(f => f.groupId === group.id)"
                  :key="item.id"
                  class="px-3 py-2 cursor-pointer transition-colors border-l-2"
                  :class="fp.selection?.id === item.id ? 'bg-accent/10 border-accent' : 'bg-bg-elevated/60 border-transparent hover:border-accent/30'"
                  @click="selectItem('furniture', item.id)"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-sm text-fg truncate mr-2">{{ item.label }}</span>
                    <button
                      class="text-xs text-red-400 px-2 py-1 rounded shrink-0 hover:bg-red-500/20"
                      @click.stop="fp.deleteFurniture(item.id)"
                    >Del</button>
                  </div>
                  <FurnitureItemForm v-if="fp.selection?.id === item.id" :item="item" />
                </div>
                <div v-if="fp.furniture.filter(f => f.groupId === group.id).length === 0" class="px-3 py-2 text-xs text-fg-muted italic">
                  Empty group — click + to add items
                </div>
              </div>
            </div>
          </div>

          <!-- Ungrouped items -->
          <div
            v-for="item in fp.furniture.filter(f => !f.groupId)"
            :key="item.id"
            class="rounded-lg px-3 py-2 cursor-pointer transition-colors"
            :class="fp.selection?.id === item.id ? 'bg-accent/15 border border-accent/50' : 'bg-bg-elevated'"
            @click="selectItem('furniture', item.id)"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm text-fg truncate mr-2">{{ item.label }}</span>
              <button
                class="text-xs text-red-400 px-2 py-1 rounded shrink-0 hover:bg-red-500/20"
                @click.stop="fp.deleteFurniture(item.id)"
              >Del</button>
            </div>

            <FurnitureItemForm v-if="fp.selection?.id === item.id" :item="item" />
          </div>

          <!-- Action buttons -->
          <div class="flex gap-2 mt-1">
            <button
              class="btn-touch text-xs text-accent border border-accent/40 rounded-lg flex-1"
              @click="fp.addFurnitureGroup()"
            >+ Add Group</button>
            <button
              class="btn-touch text-xs text-accent border border-accent/40 rounded-lg flex-1"
              @click="fp.addFurniture()"
            >+ Add Item</button>
          </div>
        </template>

        <!-- DEVICES -->
        <template v-if="tab === 'devices'">
          <!-- datalist for icon autocomplete -->
          <datalist id="device-icon-list">
            <option value="mdi:lightbulb" />
            <option value="mdi:ceiling-light" />
            <option value="mdi:floor-lamp" />
            <option value="mdi:led-strip-variant" />
            <option value="mdi:thermostat" />
            <option value="mdi:thermometer" />
            <option value="mdi:air-conditioner" />
            <option value="mdi:fan" />
            <option value="mdi:toggle-switch" />
            <option value="mdi:power-plug" />
            <option value="mdi:power-socket-eu" />
            <option value="mdi:lock" />
            <option value="mdi:lock-open" />
            <option value="mdi:camera" />
            <option value="mdi:motion-sensor" />
            <option value="mdi:doorbell" />
            <option value="mdi:door" />
            <option value="mdi:window-open" />
            <option value="mdi:smoke-detector" />
            <option value="mdi:blinds" />
            <option value="mdi:curtains" />
            <option value="mdi:garage" />
            <option value="mdi:television" />
            <option value="mdi:speaker" />
            <option value="mdi:remote" />
            <option value="mdi:water-percent" />
            <option value="mdi:molecule-co2" />
            <option value="mdi:weather-partly-cloudy" />
            <option value="mdi:flash" />
            <option value="mdi:robot-vacuum" />
            <option value="mdi:water-pump" />
            <option value="mdi:radiator" />
          </datalist>

          <!-- Placed devices list -->
          <div
            v-for="p in layout.placements"
            :key="p.entity_id"
            class="rounded-lg px-3 py-2 cursor-pointer transition-colors"
            :class="selectedDeviceId === p.entity_id ? 'bg-accent/15 border border-accent/50' : 'bg-bg-elevated'"
            @click="selectedDeviceId = selectedDeviceId === p.entity_id ? null : p.entity_id"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <Icon :icon="p.icon || getAutoIcon(p.entity_id)" class="text-base shrink-0 text-fg-muted" />
                <span class="text-sm text-fg truncate">{{ entityLabel(p.entity_id) }}</span>
              </div>
              <button
                class="text-xs text-red-400 px-2 py-1 rounded shrink-0 hover:bg-red-500/20"
                @click.stop="layout.deletePlacement(p.entity_id); selectedDeviceId = null"
              >Del</button>
            </div>

            <div v-if="selectedDeviceId === p.entity_id" class="mt-3 flex flex-col gap-2" @click.stop>
              <!-- Entity ID (read-only) -->
              <div class="flex flex-col gap-1">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Entity ID</span>
                <span class="text-xs text-fg font-mono bg-bg rounded px-2 py-1.5 truncate">{{ p.entity_id }}</span>
              </div>

              <!-- Icon selector -->
              <label class="flex flex-col gap-1">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Icon</span>
                <div class="flex items-center gap-2">
                  <Icon :icon="p.icon || getAutoIcon(p.entity_id)" class="text-xl shrink-0 text-fg" />
                  <input
                    list="device-icon-list"
                    class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated flex-1 min-w-0"
                    :value="p.icon ?? ''"
                    placeholder="mdi:lightbulb (auto)"
                    @change="layout.updatePlacement(p.entity_id, { icon: ($event.target as HTMLInputElement).value.trim() || undefined })"
                  />
                  <button
                    v-if="p.icon"
                    class="text-xs text-fg-muted hover:text-fg shrink-0 px-1"
                    title="Reset to auto"
                    @click.stop="layout.updatePlacement(p.entity_id, { icon: undefined })"
                  >✕</button>
                </div>
              </label>

              <!-- Marker colour (non-lights only; lights auto-set their own colour) -->
              <label v-if="!p.entity_id.startsWith('light.')" class="flex flex-col gap-1">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Marker colour</span>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="h-8 w-10 rounded cursor-pointer border border-bg-elevated bg-bg p-0.5 shrink-0"
                    :value="p.color ?? '#888888'"
                    @input="layout.updatePlacement(p.entity_id, { color: ($event.target as HTMLInputElement).value })"
                  />
                  <button
                    v-if="p.color"
                    class="text-xs text-fg-muted hover:text-fg shrink-0 px-1"
                    title="Reset to auto"
                    @click.stop="layout.updatePlacement(p.entity_id, { color: undefined })"
                  >✕</button>
                </div>
              </label>

              <!-- Light Source / Emitter Furniture (lights and media players) -->
              <label v-if="p.entity_id.startsWith('light.') || p.entity_id.startsWith('media_player.')" class="flex flex-col gap-1">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Light Source Furniture</span>
                <div class="flex items-center gap-2">
                  <select
                    class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated flex-1 min-w-0"
                    :value="p.lightSourceFurnitureId ?? ''"
                    @change="layout.updatePlacement(p.entity_id, { lightSourceFurnitureId: ($event.target as HTMLSelectElement).value || undefined })"
                  >
                    <option value="">— use marker position —</option>
                    <optgroup v-for="group in fp.furnitureGroups" :key="group.id" :label="group.label">
                      <option
                        v-for="item in fp.furniture.filter(f => f.groupId === group.id)"
                        :key="item.id"
                        :value="item.id"
                      >{{ item.label }}</option>
                    </optgroup>
                    <optgroup v-if="fp.furniture.some(f => !f.groupId)" label="Ungrouped">
                      <option
                        v-for="item in fp.furniture.filter(f => !f.groupId)"
                        :key="item.id"
                        :value="item.id"
                      >{{ item.label }}</option>
                    </optgroup>
                  </select>
                  <button
                    v-if="p.lightSourceFurnitureId"
                    class="text-xs text-fg-muted hover:text-fg shrink-0 px-1"
                    title="Clear"
                    @click.stop="layout.updatePlacement(p.entity_id, { lightSourceFurnitureId: undefined })"
                  >✕</button>
                </div>
                <p class="text-[9px] text-fg-muted leading-snug">Point light emanates from the top of the chosen furniture piece.</p>
              </label>

              <!-- 3D Position -->
              <div>
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">3D Position (metres)</span>
                <div class="mt-1 grid grid-cols-3 gap-2">
                  <label v-for="(axis, i) in (['X', 'Y', 'Z'] as const)" :key="axis" class="flex flex-col gap-1">
                    <span class="text-[10px] text-fg-muted uppercase tracking-wide">{{ axis }}</span>
                    <input
                      type="number" step="0.1"
                      class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
                      :value="p.position[i]"
                      @change="onPositionChange(p.entity_id, i as 0|1|2, $event)"
                    />
                  </label>
                </div>
                <p class="text-[9px] text-fg-muted mt-1 leading-snug">X = left/right · Y = height · Z = front/back</p>
              </div>
            </div>
          </div>

          <!-- Add device section -->
          <div class="mt-2 flex flex-col gap-2 border-t border-bg-elevated pt-2">
            <span class="text-[10px] text-fg-muted uppercase tracking-wide px-1">Add Device</span>
            <select
              v-model="newDeviceEntityId"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
            >
              <option value="">— select entity —</option>
              <option
                v-for="e in availableEntities"
                :key="e.entity_id"
                :value="e.entity_id"
              >{{ (e.attributes?.friendly_name as string | undefined) ?? e.entity_id }}</option>
            </select>
            <button
              class="btn-touch text-xs text-accent border border-accent/40 rounded-lg w-full disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="!newDeviceEntityId"
              @click="onAddDevice"
            >+ Place Device</button>
          </div>
        </template>

        <!-- PREFERENCES -->
        <template v-if="tab === 'preferences'">
          <div class="flex flex-col gap-4 px-1 py-2">
            <!-- Accent colour -->
            <div class="flex flex-col gap-3">
              <span class="text-[10px] text-fg-muted uppercase tracking-wide">Accent colour</span>

              <!-- Hue presets -->
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="preset in ACCENT_PRESETS"
                  :key="preset.hue"
                  class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors"
                  :class="theme.accentHue === preset.hue
                    ? 'border-accent/70 bg-accent/10 text-fg'
                    : 'border-bg-elevated bg-bg text-fg-muted hover:text-fg'"
                  @click="theme.setAccentHue(preset.hue)"
                >
                  <span
                    class="w-3 h-3 rounded-full shrink-0"
                    :style="{ background: hueToHex(preset.hue) }"
                  />
                  {{ preset.label }}
                </button>
              </div>

              <!-- Custom colour picker -->
              <label class="flex flex-col gap-1">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Custom</span>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="h-8 w-10 rounded cursor-pointer border border-bg-elevated bg-bg p-0.5 shrink-0"
                    :value="accentPickerHex"
                    @input="onAccentPickerInput"
                  />
                  <span class="text-xs text-fg-muted font-mono">{{ accentPickerHex }}</span>
                </div>
              </label>

              <!-- Light / Dark preview cards -->
              <div class="flex flex-col gap-2">
                <span class="text-[10px] text-fg-muted uppercase tracking-wide">Preview</span>
                <div class="flex gap-2">
                  <!-- Dark mode card -->
                  <div
                    class="flex-1 rounded-lg p-3 flex flex-col gap-2"
                    style="background:#1e293b"
                  >
                    <span class="text-[9px] uppercase tracking-wide" style="color:#94a3b8">Dark</span>
                    <span class="text-sm font-semibold" :style="{ color: accentDarkHex }">Active text</span>
                    <span
                      class="self-start px-2 py-0.5 rounded text-xs font-medium"
                      :style="{ background: accentDarkHex, color: '#1e293b' }"
                    >Badge</span>
                    <span
                      class="self-start border rounded px-2 py-0.5 text-xs"
                      :style="{ borderColor: accentDarkHex + '80', color: accentDarkHex }"
                    >Border</span>
                  </div>
                  <!-- Light mode card -->
                  <div
                    class="flex-1 rounded-lg p-3 flex flex-col gap-2"
                    style="background:#f8f5ee"
                  >
                    <span class="text-[9px] uppercase tracking-wide" style="color:#78716c">Light</span>
                    <span class="text-sm font-semibold" :style="{ color: accentLightHex }">Active text</span>
                    <span
                      class="self-start px-2 py-0.5 rounded text-xs font-medium"
                      :style="{ background: accentLightHex, color: '#f8f5ee' }"
                    >Badge</span>
                    <span
                      class="self-start border rounded px-2 py-0.5 text-xs"
                      :style="{ borderColor: accentLightHex + '80', color: accentLightHex }"
                    >Border</span>
                  </div>
                </div>
              </div>

              <!-- Reset -->
              <button
                class="btn-touch text-xs text-fg-muted border border-bg-elevated rounded-lg w-full"
                @click="theme.setAccentHue(174)"
              >Reset to default (Teal)</button>
            </div>
          </div>
        </template>

      </div>

      <!-- Footer: Save -->
      <div class="shrink-0 p-3 border-t border-bg-elevated">
        <button
          class="w-full btn-touch text-sm font-semibold transition-colors"
          :class="isDirty ? 'bg-accent text-bg-panel' : 'opacity-40 cursor-not-allowed bg-bg-elevated text-fg'"
          :disabled="!isDirty"
          @click="onSave()"
        >
          {{ isDirty ? (tab === 'devices' ? 'Save Devices' : tab === 'preferences' ? 'Save Preferences' : 'Save Floorplan') : 'No Changes' }}
        </button>
      </div>
    </div>
  </Transition>
</template>