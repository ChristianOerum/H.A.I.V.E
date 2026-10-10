<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { FloorplanEditorTab } from '~/stores/floorplan'

const fp = useFloorplanStore()
const layout = useLayoutStore()
const theme = useThemeStore()
const toast = useToast()

const TABS: { id: FloorplanEditorTab; label: string; icon: string }[] = [
  { id: 'rooms', label: 'Rooms', icon: 'mdi:floor-plan' },
  { id: 'furniture', label: 'Furniture', icon: 'mdi:sofa-outline' },
  { id: 'devices', label: 'Devices', icon: 'mdi:devices' },
  { id: 'preferences', label: 'Appearance', icon: 'mdi:palette-outline' },
  { id: 'system', label: 'System', icon: 'mdi:cog-outline' },
]

const tab = computed({
  get: () => fp.editorTab,
  set: (v: FloorplanEditorTab) => {
    fp.editorTab = v
    fp.deselect()
  },
})

// Undo/redo only covers the floorplan (rooms + furniture).
const showHistory = computed(() => tab.value === 'rooms' || tab.value === 'furniture')

function onKeyDown(e: KeyboardEvent) {
  if (!fp.editMode) return
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); fp.undo() }
  else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); fp.redo() }
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

// ── Unsaved changes, across every tab ──
const appearanceDirty = computed(() => theme.accentDirty || theme.variantDirty || theme.uiScaleDirty)
const dirtyByTab = computed<Record<FloorplanEditorTab, boolean>>(() => ({
  rooms: fp.dirty,
  furniture: fp.dirty,
  devices: layout.dirty,
  preferences: appearanceDirty.value,
  system: false,
}))
const anyDirty = computed(() => fp.dirty || layout.dirty || appearanceDirty.value)

const saving = ref(false)
async function saveAll(): Promise<boolean> {
  saving.value = true
  try {
    const jobs: Promise<unknown>[] = []
    if (fp.dirty) jobs.push(fp.save())
    if (layout.dirty) jobs.push(layout.save())
    if (appearanceDirty.value) {
      theme.saveAccentHue()
      theme.savePaletteVariants()
      theme.saveUiScale()
    }
    await Promise.all(jobs)
    toast.success('Changes saved')
    return true
  } catch (err) {
    toast.error(`Couldn’t save — ${(err as Error)?.message ?? 'server unreachable'}`)
    return false
  } finally {
    saving.value = false
  }
}

async function discardAll() {
  if (fp.dirty) {
    await fp.load()
    fp._history = []
    fp._future = []
    fp.selectedOpeningId = null
    fp.deselect()
  }
  if (layout.dirty) await layout.load()
  if (appearanceDirty.value) {
    theme.setAccentColor(theme.accentHueSaved, theme.accentSatSaved, theme.accentLitSaved)
    theme.setDarkVariant(theme.darkVariantSaved)
    theme.setLightVariant(theme.lightVariantSaved)
    theme.setUiScale(theme.uiScaleSaved)
  }
  discardArmed.value = false
  toast.show('Changes discarded', 'info', 'mdi:undo-variant')
}

// Discard needs a second tap, like the delete buttons.
const discardArmed = ref(false)
let discardTimer: ReturnType<typeof setTimeout> | null = null
function onDiscard() {
  if (discardArmed.value) { void discardAll(); return }
  discardArmed.value = true
  if (discardTimer) clearTimeout(discardTimer)
  discardTimer = setTimeout(() => { discardArmed.value = false }, 3000)
}

// ── Closing ──
const confirmClose = ref(false)
function requestClose() {
  if (anyDirty.value) confirmClose.value = true
  else fp.toggleEditMode()
}
async function saveAndClose() {
  if (await saveAll()) {
    confirmClose.value = false
    fp.toggleEditMode()
  }
}
async function discardAndClose() {
  await discardAll()
  confirmClose.value = false
  fp.toggleEditMode()
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
      class="absolute top-0 right-0 h-full w-96 max-w-full bg-bg-panel text-fg border-l border-fg/10 shadow-2xl flex flex-col z-20 pointer-events-auto"
    >
      <!-- Header -->
      <div class="flex items-center gap-1 pl-4 pr-1.5 h-14 shrink-0">
        <h2 class="text-base font-semibold">Settings</h2>
        <span v-if="anyDirty" class="ml-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-300">Unsaved</span>
        <div class="flex-1" />
        <template v-if="showHistory">
          <button
            class="w-10 h-10 flex items-center justify-center rounded-full text-fg-muted active:bg-bg-elevated disabled:opacity-30"
            :disabled="!fp.canUndo"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            @click="fp.undo()"
          ><Icon icon="mdi:undo" width="20" height="20" /></button>
          <button
            class="w-10 h-10 flex items-center justify-center rounded-full text-fg-muted active:bg-bg-elevated disabled:opacity-30"
            :disabled="!fp.canRedo"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            @click="fp.redo()"
          ><Icon icon="mdi:redo" width="20" height="20" /></button>
          <div class="w-px h-5 bg-fg/10 mx-1" />
        </template>
        <button
          class="w-11 h-11 flex items-center justify-center rounded-full text-fg-muted active:bg-bg-elevated"
          aria-label="Close settings"
          @click="requestClose"
        ><Icon icon="mdi:close" width="22" height="22" /></button>
      </div>

      <!-- Tabs -->
      <nav class="grid grid-cols-5 border-b border-fg/10 shrink-0 px-1" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.id"
          role="tab"
          :aria-selected="tab === t.id"
          class="relative flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium transition-colors"
          :class="tab === t.id ? 'text-accent' : 'text-fg-muted active:text-fg'"
          @click="tab = t.id"
        >
          <span class="relative">
            <Icon :icon="t.icon" width="22" height="22" />
            <span v-if="dirtyByTab[t.id]" class="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-yellow-500 ring-2 ring-bg-panel" />
          </span>
          {{ t.label }}
          <span v-if="tab === t.id" class="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-accent" />
        </button>
      </nav>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto overscroll-contain p-3">
        <SettingsRoomsTab v-if="tab === 'rooms'" />
        <SettingsFurnitureTab v-else-if="tab === 'furniture'" />
        <SettingsDevicesTab v-else-if="tab === 'devices'" />
        <SettingsAppearanceTab v-else-if="tab === 'preferences'" />
        <SettingsSystemTab v-else-if="tab === 'system'" />
      </div>

      <!-- Footer: one save for everything -->
      <div class="shrink-0 px-3 py-3 border-t border-fg/10">
        <div v-if="anyDirty" class="flex gap-2">
          <button
            class="btn-touch flex-1 text-sm"
            :class="discardArmed ? '!bg-red-500 !text-white' : ''"
            :disabled="saving"
            @click="onDiscard"
          >{{ discardArmed ? 'Tap again to discard' : 'Discard' }}</button>
          <button class="btn-touch flex-[2] gap-2 text-sm font-semibold bg-accent !text-bg" :disabled="saving" @click="saveAll">
            <Icon v-if="saving" icon="mdi:loading" class="animate-spin" width="18" height="18" />
            <span>{{ saving ? 'Saving…' : 'Save changes' }}</span>
          </button>
        </div>
        <div v-else class="h-11 flex items-center justify-center gap-2 text-xs text-fg-muted">
          <Icon icon="mdi:check-circle-outline" width="16" height="16" />
          All changes saved
        </div>
      </div>
    </div>
  </Transition>

  <SettingsModal :open="confirmClose" title="Save your changes?" size="sm" @close="confirmClose = false">
    <p class="text-sm text-fg-muted leading-relaxed">
      You have unsaved changes. Save them so every screen gets them, or discard them to go back to the last saved version.
    </p>
    <template #footer>
      <div class="flex flex-col gap-2 w-full">
        <button class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg" :disabled="saving" @click="saveAndClose">
          <Icon v-if="saving" icon="mdi:loading" class="animate-spin" width="18" height="18" />
          <span>Save and close</span>
        </button>
        <div class="flex gap-2">
          <button class="btn-touch flex-1 text-sm text-red-500" :disabled="saving" @click="discardAndClose">Discard</button>
          <button class="btn-touch flex-1 text-sm" @click="confirmClose = false">Keep editing</button>
        </div>
      </div>
    </template>
  </SettingsModal>
</template>
