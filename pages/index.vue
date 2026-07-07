<script setup lang="ts">
const entities = useEntitiesStore()
const layout = useLayoutStore()
const fp = useFloorplanStore()
const theme = useThemeStore()
const { start } = useHomeAssistant()
const { public: { haConfigured } } = useRuntimeConfig()

useHead({
  title: 'H.A.I.V.E.',
  meta: [
    { name: 'description', content: 'Home Assistant Interactive Visual Environment' },
  ],
})

onMounted(async () => {
  theme.init()

  if (new URLSearchParams(location.search).has('kiosk')) {
    document.body.classList.add('kiosk')
  }
  document.addEventListener('contextmenu', (e) => e.preventDefault())

  await layout.load()
  await fp.load()
  await start().catch(() => {
    /* error surfaced via store */
  })
})
</script>

<template>
  <div class="relative w-screen h-screen overflow-hidden bg-bg text-fg">
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

    <div
      v-if="!haConfigured && entities.list.length === 0 && entities.status !== 'connecting'"
      class="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div class="text-center text-fg-muted max-w-md p-6 bg-bg-panel/80 rounded-2xl pointer-events-auto">
        <h2 class="text-xl mb-2 text-fg">No devices placed</h2>
        <p class="text-sm">
          Configure <code>HA_URL</code> and <code>HA_TOKEN</code> in <code>.env</code>, then add
          placements to <code>config/entities.json</code>.
        </p>
      </div>
    </div>
  </div>
</template>
