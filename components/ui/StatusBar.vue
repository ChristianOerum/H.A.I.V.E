<script setup lang="ts">
import { Icon } from '@iconify/vue'
const entities = useEntitiesStore()
const fp = useFloorplanStore()
const theme = useThemeStore()
const { isMock } = useHomeAssistant()
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const time = computed(() =>
  now.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
)
const date = computed(() =>
  now.value.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
)

const statusColor = computed(() => {
  switch (entities.status) {
    case 'connected': return 'bg-accent'
    case 'connecting': return 'bg-yellow-400 animate-pulse'
    case 'disconnected': return 'bg-orange-400'
    case 'error': return 'bg-red-500'
    default: return 'bg-fg-muted'
  }
})
</script>

<template>
  <div class="absolute top-0 left-0 right-0 h-14 flex items-center justify-between px-6 pointer-events-none">
    <div class="flex items-center gap-3 pointer-events-auto">
      <div class="flex items-baseline gap-2 mr-2">
        <span class="text-sm font-semibold tracking-[0.2em] text-accent">H.A.I.V.E.</span>
        <span class="text-[10px] text-fg-muted hidden sm:inline">Home Assistant Interactive Visual Environment</span>
      </div>
      <div class="w-3 h-3 rounded-full" :class="statusColor" :title="entities.status" />
      <span class="text-sm text-fg/80">{{ entities.status }}</span>
      <span
        v-if="isMock()"
        class="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
      >MOCK</span>
      <span v-if="entities.error" class="text-xs text-red-400">{{ entities.error }}</span>
    </div>
    <div class="flex items-center gap-3 pointer-events-auto">
      <ThemeToggle />
      <button
        v-if="false"
        class="btn-touch !px-3 gap-1.5 text-sm"
        :class="theme.isSimulating
          ? 'text-accent border border-accent/50 animate-pulse'
          : 'text-fg-muted'"
        :title="theme.isSimulating ? 'Stop day-cycle demo' : 'Demo: simulate 24 h in 72 s'"
        @click="theme.isSimulating ? theme.stopDaySimulation() : theme.startDaySimulation()"
      >
        <Icon :icon="theme.isSimulating ? 'mdi:stop-circle-outline' : 'mdi:play-circle-outline'" width="18" height="18" />
        <span class="hidden md:inline">{{ theme.isSimulating ? 'Stop' : 'Demo' }}</span>
      </button>
      <SaveViewButton />
      <button
        class="btn-touch !px-3 gap-2 text-sm"
        :class="theme.wallOpacityMode !== 'solid' ? 'text-accent border border-accent/50' : 'text-fg-muted'"
        :title="`Walls: ${theme.wallOpacityMode} — click to cycle`"
        @click="theme.cycleWallOpacity()"
      >
        <Icon
          :icon="theme.wallOpacityMode === 'solid'
            ? 'mdi:circle'
            : theme.wallOpacityMode === 'dimmed'
              ? 'mdi:circle-half-full'
              : 'mdi:circle-outline'"
          width="18"
          height="18"
        />
        <span class="hidden md:inline">Walls</span>
      </button>
      <button
        class="btn-touch !px-3 text-sm"
        :class="fp.editMode ? 'text-accent border border-accent/50' : 'text-fg-muted'"
        @click="fp.toggleEditMode()"
        title="Edit floorplan"
      ><Icon icon="mdi:cog" width="18" height="18" /></button>
      <div class="text-right">
        <div class="text-xl font-light leading-none">{{ time }}</div>
        <div class="text-xs text-fg-muted">{{ date }}</div>
      </div>
    </div>
  </div>
</template>
