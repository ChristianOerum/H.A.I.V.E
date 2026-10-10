<script setup lang="ts">
import { Icon } from '@iconify/vue'

// One-time coach mark teaching the marker gestures. Dismissed for good the
// first time someone opens a device sheet (they've learned it) or taps ✕.
const STORAGE_KEY = 'haive.hint.markers'

const layout = useLayoutStore()
const fp = useFloorplanStore()
const entities = useEntitiesStore()

const dismissed = ref(true)
onMounted(() => {
  try { dismissed.value = localStorage.getItem(STORAGE_KEY) === '1' } catch { dismissed.value = false }
})

function dismiss() {
  dismissed.value = true
  try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* storage unavailable — hint just reappears next load */ }
}
watch(() => layout.selectedEntityId, (id) => { if (id) dismiss() })

const visible = computed(() =>
  !dismissed.value
  && !fp.editMode
  && !layout.selectedEntityId
  && entities.status === 'connected'
  && layout.placements.length > 0,
)
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out delay-1000"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible"
      class="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 surface rounded-2xl flex items-center gap-4 pl-4 pr-1 py-1 text-sm pointer-events-auto max-w-[calc(100%-2rem)]"
    >
      <div class="flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1 py-1.5">
      <div class="flex items-center gap-2">
        <Icon icon="mdi:gesture-tap" width="20" height="20" class="text-accent shrink-0" />
        <span><strong class="font-semibold">Tap</strong> a device to switch it</span>
      </div>
      <div class="flex items-center gap-2">
        <Icon icon="mdi:gesture-tap-hold" width="20" height="20" class="text-accent shrink-0" />
        <span><strong class="font-semibold">Hold</strong> for more controls</span>
      </div>
      </div>
      <button class="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-fg-muted active:bg-bg-elevated" aria-label="Dismiss hint" @click="dismiss">
        <Icon icon="mdi:close" width="18" height="18" />
      </button>
    </div>
  </Transition>
</template>
