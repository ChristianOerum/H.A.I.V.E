<script setup lang="ts">
import { Icon } from '@iconify/vue'

const entities = useEntitiesStore()
const layout = useLayoutStore()
const fp = useFloorplanStore()
const theme = useThemeStore()
const { start } = useHomeAssistant()
const device = useDeviceConfig()
useLiveSync()
const { unlocked } = useAuth()

useHead({
  title: 'H.A.I.V.E.',
  meta: [
    { name: 'description', content: 'Home Assistant Interactive Visual Environment' },
  ],
})

// Load device config during SSR so the first-launch gate is correct on first paint.
await useAsyncData('device-config', () => device.refresh(), { server: true })

// ?mock=1 bypasses the first-launch gate and boots straight into mock mode.
const mockMode = ref(false)

async function boot() {
  await layout.load()
  await fp.load()
  await start().catch(() => {
    /* error surfaced via store */
  })
}

const showEmptyState = computed(() =>
  entities.status === 'connected'
  && entities.list.length > 0
  && layout.placements.length === 0
  && !fp.editMode,
)

function openDeviceEditor() {
  fp.editorTab = 'devices'
  if (!fp.editMode) fp.toggleEditMode()
}

function onSetupDone() {
  // Reload so the freshly configured server state is picked up cleanly.
  if (import.meta.client) location.reload()
}

onMounted(async () => {
  theme.init()

  const params = new URLSearchParams(location.search)
  if (params.has('kiosk')) document.body.classList.add('kiosk')
  if (params.has('mock')) mockMode.value = true
  document.addEventListener('contextmenu', (e) => e.preventDefault())

  if (device.configured.value || mockMode.value) await boot()
})
</script>

<template>
  <FirstLaunchSetup v-if="!device.configured.value && !mockMode" @done="onSetupDone" />
  <div v-else class="relative w-screen h-screen overflow-hidden bg-bg text-fg">
    <SceneRoot />
    <StatusBar />
    <ClientOnly><WeatherPanel /></ClientOnly>
    <!-- SceneMarkerOverlay renders 2D icon markers projected from 3D space.
         ClientOnly avoids SSR/hydration mismatches since positions are runtime-only. -->
    <ClientOnly><SceneMarkerOverlay /></ClientOnly>
    <!-- 2D dot-based floorplan editor (overlays scene when edit mode is on) -->
    <FloorplanDotEditor />
    <FloorplanEditorPanel />
    <DeviceControlPanel />
    <WifiQrButton v-if="!layout.selectedEntityId && !fp.editMode" />
    <VersionWatermark />

    <ClientOnly><MarkerHint /></ClientOnly>
    <ConnectionBanner />
    <ToastHost />

    <!-- Empty state: connected, but nothing placed on the floorplan yet -->
    <div
      v-if="showEmptyState"
      class="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none"
    >
      <div class="surface pointer-events-auto rounded-3xl px-8 py-7 max-w-sm text-center flex flex-col items-center gap-3">
        <div class="w-14 h-14 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
          <Icon icon="mdi:floor-plan" width="30" height="30" />
        </div>
        <h2 class="text-lg font-semibold">No devices on your floorplan yet</h2>
        <p class="text-sm text-fg-muted leading-snug">
          Connected to Home Assistant with {{ entities.list.length }} entities available.
          Place them in the rooms to control them from here.
        </p>
        <button v-if="unlocked" class="btn-touch mt-1 gap-2 text-sm bg-accent !text-bg font-semibold" @click="openDeviceEditor">
          <Icon icon="mdi:plus" width="18" height="18" />
          <span>Add devices</span>
        </button>
        <p v-else class="text-xs text-fg-muted">Unlock with the toolbar PIN to add devices.</p>
      </div>
    </div>
  </div>
</template>
