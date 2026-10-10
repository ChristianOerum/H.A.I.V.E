<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { FloorplanFurniture } from '~/stores/floorplan'

const fp = useFloorplanStore()
const toast = useToast()

/** Expanded group IDs — start collapsed each time the tab opens. */
const expandedGroupIds = ref(new Set<string>())
function toggleGroup(id: string) {
  const s = new Set(expandedGroupIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expandedGroupIds.value = s
}

function toggleItem(id: string) {
  if (fp.selection?.id === id) fp.deselect()
  else fp.select('furniture', id)
}

const itemsIn = (groupId: string) => fp.furniture.filter((f) => f.groupId === groupId)
const ungrouped = computed(() => fp.furniture.filter((f) => !f.groupId))

function addItemTo(groupId: string) {
  fp.addFurniture(groupId)
  if (!expandedGroupIds.value.has(groupId)) toggleGroup(groupId)
}

/** Group currently open in the isolated 3D editor. */
const viewerGroupId = ref<string | null>(null)

// ── Export / import ──
function exportGroup(groupId: string) {
  const group = fp.furnitureGroups.find((g) => g.id === groupId)
  if (!group) return
  const items = itemsIn(groupId).map(({ id: _id, groupId: _gid, ...rest }) => rest)
  const { id: _id, collapsed: _c, ...groupFields } = group
  navigator.clipboard.writeText(JSON.stringify({ ...groupFields, items }, null, 2))
    .then(() => toast.success(`Copied “${group.label}” to the clipboard`, 'mdi:clipboard-check-outline'))
    .catch(() => toast.error('Couldn’t access the clipboard'))
}

const showImport = ref(false)
const importText = ref('')
const importError = ref('')
function closeImport() {
  showImport.value = false
  importText.value = ''
  importError.value = ''
}
function onImport() {
  importError.value = ''
  try {
    // Strip a single pair of surrounding quotes that can appear when copying
    // from a chat message (e.g. "{ ... }" instead of { ... })
    let text = importText.value.trim()
    if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1)
    const preset = JSON.parse(text)
    if (typeof preset.label !== 'string' || !Array.isArray(preset.items)) {
      importError.value = 'Expected an exported group: { label, x, y, z, rotY, items[] }'
      return
    }
    fp.importFurnitureGroup(preset)
    toast.success(`Imported “${preset.label}”`)
    closeImport()
  } catch {
    importError.value = 'That isn’t valid JSON — check the pasted text.'
  }
}

// ── Library ──
// Load all JSON files from config/furnitureLibrary/ — add new presets by dropping a .json file there
const _libraryModules = import.meta.glob('~/config/furnitureLibrary/*.json', { eager: true })
type LibraryPreset = {
  label: string; x?: number; y?: number; z?: number; rotY?: number
  items: FloorplanFurniture[]
}
const LIBRARY = Object.values(_libraryModules) as LibraryPreset[]

const showLibrary = ref(false)
const librarySearch = ref('')
const filteredLibrary = computed(() => {
  const q = librarySearch.value.trim().toLowerCase()
  return q ? LIBRARY.filter((p) => p.label.toLowerCase().includes(q)) : LIBRARY
})
function closeLibrary() {
  showLibrary.value = false
  librarySearch.value = ''
}
function insertFromLibrary(preset: LibraryPreset) {
  fp.importFurnitureGroup(preset as Parameters<typeof fp.importFurnitureGroup>[0])
  toast.success(`Added “${preset.label}”`)
  closeLibrary()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Actions -->
    <div class="grid grid-cols-2 gap-2 shrink-0 mb-1">
      <button class="btn-touch gap-2 text-xs font-medium" @click="showLibrary = true">
        <Icon icon="mdi:bookshelf" width="18" height="18" />
        <span>Library</span>
      </button>
      <button class="btn-touch gap-2 text-xs font-medium" @click="fp.addFurnitureGroup()">
        <Icon icon="mdi:folder-plus-outline" width="18" height="18" />
        <span>New group</span>
      </button>
      <button class="btn-touch gap-2 text-xs font-medium" @click="fp.addFurniture()">
        <Icon icon="mdi:cube-outline" width="18" height="18" />
        <span>Single item</span>
      </button>
      <button class="btn-touch gap-2 text-xs font-medium" @click="showImport = true">
        <Icon icon="mdi:import" width="18" height="18" />
        <span>Import</span>
      </button>
    </div>

    <div v-if="fp.furnitureGroups.length === 0 && fp.furniture.length === 0" class="flex flex-col items-center text-center gap-2 py-10 px-4">
      <Icon icon="mdi:sofa-outline" width="36" height="36" class="text-fg-muted" />
      <p class="text-sm font-medium">No furniture yet</p>
      <p class="field-hint">Start from the Library for ready-made pieces, or build your own group.</p>
    </div>

    <!-- Groups -->
    <SettingsItem
      v-for="group in fp.furnitureGroups"
      :key="group.id"
      :title="group.label"
      :subtitle="`${itemsIn(group.id).length} ${itemsIn(group.id).length === 1 ? 'part' : 'parts'}`"
      icon="mdi:sofa-outline"
      :open="expandedGroupIds.has(group.id)"
      @toggle="toggleGroup(group.id)"
    >
      <template #actions>
        <button class="w-9 h-9 flex items-center justify-center rounded-lg text-accent active:bg-accent/10" title="Add a part to this group" aria-label="Add part" @click="addItemTo(group.id)">
          <Icon icon="mdi:plus" width="20" height="20" />
        </button>
        <SettingsDelete :label="group.label" @confirm="fp.deleteFurnitureGroup(group.id)" />
      </template>

      <SettingsField label="Name">
        <input
          class="field-input"
          :value="group.label"
          @change="fp.updateFurnitureGroup(group.id, { label: ($event.target as HTMLInputElement).value })"
        />
      </SettingsField>

      <SettingsSection title="Position">
        <div class="grid grid-cols-3 gap-2">
          <SettingsField label="X">
            <SettingsNumber label="Group X" :value="group.x ?? 0" :step="0.25" @change="(v) => fp.updateFurnitureGroup(group.id, { x: v })" />
          </SettingsField>
          <SettingsField label="Y (lift)">
            <SettingsNumber label="Group Y" :value="group.y ?? 0" :step="0.05" @change="(v) => fp.updateFurnitureGroup(group.id, { y: v })" />
          </SettingsField>
          <SettingsField label="Z">
            <SettingsNumber label="Group Z" :value="group.z ?? 0" :step="0.25" @change="(v) => fp.updateFurnitureGroup(group.id, { z: v })" />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="Rotation">
        <div class="grid grid-cols-3 gap-2">
          <SettingsField label="X">
            <SettingsNumber label="Group rotation X" :value="group.rotX ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurnitureGroup(group.id, { rotX: v })" />
          </SettingsField>
          <SettingsField label="Y">
            <SettingsNumber label="Group rotation Y" :value="group.rotY ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurnitureGroup(group.id, { rotY: v })" />
          </SettingsField>
          <SettingsField label="Z">
            <SettingsNumber label="Group rotation Z" :value="group.rotZ ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurnitureGroup(group.id, { rotZ: v })" />
          </SettingsField>
        </div>
      </SettingsSection>

      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">Follow theme colours</div>
          <div class="field-hint">Recolour parts with the scene palette instead of their own colours.</div>
        </div>
        <ToggleSwitch
          :on="group.followTheme ?? false"
          label="Follow theme colours"
          @toggle="fp.updateFurnitureGroup(group.id, { followTheme: !(group.followTheme ?? false) })"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button class="btn-touch gap-2 text-xs font-medium" @click="viewerGroupId = group.id">
          <Icon icon="mdi:cube-scan" width="18" height="18" />
          <span>Edit in 3D</span>
        </button>
        <button class="btn-touch gap-2 text-xs font-medium" @click="exportGroup(group.id)">
          <Icon icon="mdi:export-variant" width="18" height="18" />
          <span>Copy as JSON</span>
        </button>
      </div>

      <SettingsSection :title="`Parts (${itemsIn(group.id).length})`">
        <div class="flex flex-col gap-1.5">
          <SettingsItem
            v-for="item in itemsIn(group.id)"
            :key="item.id"
            nested
            :title="item.label"
            :icon="item.subtract ? 'mdi:minus-box-outline' : 'mdi:cube-outline'"
            :open="fp.selection?.id === item.id"
            @toggle="toggleItem(item.id)"
          >
            <template #actions>
              <SettingsDelete :label="item.label" @confirm="fp.deleteFurniture(item.id)" />
            </template>
            <FurnitureItemForm :item="item" />
          </SettingsItem>
          <button class="btn-touch gap-2 text-xs text-accent !bg-transparent border border-dashed border-fg/15" @click="addItemTo(group.id)">
            <Icon icon="mdi:plus" width="16" height="16" />
            <span>Add part</span>
          </button>
        </div>
      </SettingsSection>
    </SettingsItem>

    <!-- Ungrouped items -->
    <template v-if="ungrouped.length">
      <h3 v-if="fp.furnitureGroups.length" class="section-label mt-3 mb-0.5 px-1">Ungrouped</h3>
      <SettingsItem
        v-for="item in ungrouped"
        :key="item.id"
        :title="item.label"
        icon="mdi:cube-outline"
        :open="fp.selection?.id === item.id"
        @toggle="toggleItem(item.id)"
      >
        <template #actions>
          <SettingsDelete :label="item.label" @confirm="fp.deleteFurniture(item.id)" />
        </template>
        <FurnitureItemForm :item="item" />
      </SettingsItem>
    </template>

    <!-- Library -->
    <SettingsModal :open="showLibrary" title="Furniture library" :subtitle="`${LIBRARY.length} ready-made pieces · tap one to add it`" size="xl" @close="closeLibrary">
      <template #toolbar>
        <div class="px-5 pb-3 shrink-0">
          <div class="relative">
            <Icon icon="mdi:magnify" width="18" height="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            <input v-model="librarySearch" type="search" placeholder="Search pieces…" class="field-input pl-10" />
          </div>
        </div>
      </template>
      <div v-if="filteredLibrary.length" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          v-for="preset in filteredLibrary"
          :key="preset.label"
          class="flex flex-col gap-2 p-2 rounded-2xl border border-fg/10 bg-bg-elevated/30 active:border-accent/60 active:bg-accent/5 transition-colors text-left"
          @click="insertFromLibrary(preset)"
        >
          <LibraryItemPreview :preset="preset" />
          <div class="flex items-center justify-between px-1 pb-1">
            <span class="text-sm font-medium">{{ preset.label }}</span>
            <span class="text-[11px] text-fg-muted">{{ preset.items.length }} parts</span>
          </div>
        </button>
      </div>
      <p v-else class="text-sm text-fg-muted text-center py-10">No pieces match “{{ librarySearch }}”</p>
    </SettingsModal>

    <!-- Import -->
    <SettingsModal :open="showImport" title="Import furniture group" subtitle="Paste a group copied with “Copy as JSON”. It’s added as a new group." @close="closeImport">
      <textarea
        v-model="importText"
        rows="10"
        placeholder='{ "label": "My group", "items": [ … ] }'
        class="w-full rounded-lg bg-bg border border-fg/10 px-3 py-2 text-xs font-mono text-fg outline-none focus:border-accent/60 resize-y"
      />
      <p v-if="importError" class="mt-2 text-xs text-red-400">{{ importError }}</p>
      <template #footer>
        <button class="btn-touch flex-1 text-sm" @click="closeImport">Cancel</button>
        <button class="btn-touch flex-1 text-sm font-semibold bg-accent !text-bg" :disabled="!importText.trim()" @click="onImport">Import</button>
      </template>
    </SettingsModal>

    <!-- Isolated 3D group editor (fullscreen overlay) -->
    <Teleport to="body">
      <FurnitureGroupViewer v-if="viewerGroupId" :group-id="viewerGroupId" @close="viewerGroupId = null" />
    </Teleport>
  </div>
</template>
