<script setup lang="ts">
const entities = useEntitiesStore()
const layout = useLayoutStore()
const fp = useFloorplanStore()
const theme = useThemeStore()
const { start } = useHomeAssistant()
const device = useDeviceConfig()

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

    <div
      v-if="!device.config.value.haConfigured && device.role.value === 'master' && entities.list.length === 0 && entities.status !== 'connecting'"
      class="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div class="text-center text-fg-muted max-w-md p-6 bg-bg-panel/80 rounded-2xl pointer-events-auto">
        <h2 class="text-xl mb-2 text-fg">No devices placed</h2>
        <p class="text-sm">
          No Home Assistant connection yet. Run <strong>Factory Reset</strong> in settings to reconfigure, then add
          placements to <code>config/entities.json</code>.
        </p>
      </div>
    </div>
  </div>
</template>
