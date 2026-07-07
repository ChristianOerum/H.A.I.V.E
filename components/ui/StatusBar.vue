<script setup lang="ts">
import { Icon } from '@iconify/vue'
const entities = useEntitiesStore()
const fp = useFloorplanStore()
const theme = useThemeStore()
const { isMock } = useHomeAssistant()
const { unlocked, lock } = useAuth()

const weather = useWeather()
const WEATHER_ICONS: Record<string, string> = {
  sunny: 'mdi:weather-sunny',
  'clear-night': 'mdi:weather-night',
  partlycloudy: 'mdi:weather-partly-cloudy',
  cloudy: 'mdi:weather-cloudy',
  fog: 'mdi:weather-fog',
  rainy: 'mdi:weather-rainy',
  pouring: 'mdi:weather-pouring',
  snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy',
  'lightning-rainy': 'mdi:weather-lightning-rainy',
  lightning: 'mdi:weather-lightning',
  hail: 'mdi:weather-hail',
  windy: 'mdi:weather-windy',
  exceptional: 'mdi:weather-cloudy-alert',
}
const weatherIcon = computed(() => WEATHER_ICONS[weather.condition.value] ?? 'mdi:weather-partly-cloudy')
const weatherLabel = computed(() =>
  weather.condition.value.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
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

const { public: { authEnabled } } = useRuntimeConfig()
const showKeypad = ref(false)
const openKeypad = () => { if (!unlocked.value) showKeypad.value = true }
const onKeypadClose = () => { showKeypad.value = false }
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
    <div class="flex items-center gap-1.5 pointer-events-auto">

      <!-- ThemeToggle — always visible, dimmed when locked -->
      <div :class="unlocked ? '' : 'opacity-30 pointer-events-none select-none'">
        <ThemeToggle />
      </div>

      <!-- Weather effects — toggle all in-scene weather visuals on/off -->
      <button
        class="btn-touch !px-3 gap-2 text-xs"
        :class="[
          weather.enabled.value ? 'text-fg' : 'text-fg-muted',
          unlocked ? '' : 'opacity-30 pointer-events-none select-none',
        ]"
        :title="weather.enabled.value ? 'Weather effects: on — click to disable' : 'Weather effects: off — click to enable'"
        @click="weather.toggle()"
      >
        <Icon :icon="weather.enabled.value ? weatherIcon : 'mdi:weather-cloudy-alert'" width="18" height="18" />
        <span class="hidden md:inline">{{ weather.enabled.value ? 'Weather' : 'Weather off' }}</span>
      </button>

      <!-- Mock-only weather cycle — step through conditions for testing -->
      <button
        v-if="isMock()"
        class="btn-touch !px-3 gap-2 text-xs"
        :class="unlocked ? '' : 'opacity-30 pointer-events-none select-none'"
        :title="`Test weather: ${weatherLabel} — click to cycle`"
        @click="weather.cycleCondition()"
      >
        <Icon :icon="weatherIcon" width="18" height="18" />
        <span class="hidden md:inline">{{ weatherLabel }}</span>
      </button>

      <!-- Day cycle demo — hidden; keep for future use -->
      <button
        v-if="false"
        class="btn-touch !px-3 gap-2 text-xs"
        :class="theme.isSimulating ? 'text-accent border border-accent/50' : 'text-fg-muted'"
        :title="theme.isSimulating ? 'Stop day simulation' : 'Simulate 24h day cycle (72s)'"
        @click="theme.startDaySimulation()"
      >
        <Icon :icon="theme.isSimulating ? 'mdi:stop-circle-outline' : 'mdi:weather-sunset'" width="18" height="18" />
      </button>

      <!-- Walls — always visible, dimmed when locked -->
      <button
        class="btn-touch !px-3 gap-2 text-xs"
        :class="[
          theme.wallOpacityMode !== 'solid' ? 'text-accent border border-accent/50' : 'text-fg-muted',
          unlocked ? '' : 'opacity-30 pointer-events-none select-none',
        ]"
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

      <!-- SaveViewButton — hidden when locked -->
      <SaveViewButton v-if="unlocked" />

      <!-- Edit floorplan — hidden when locked -->
      <button
        v-if="unlocked"
        class="btn-touch !px-3 text-xs"
        :class="fp.editMode ? 'text-accent border border-accent/50' : 'text-fg-muted'"
        @click="fp.toggleEditMode()"
        title="Edit floorplan"
      ><Icon icon="mdi:cog" width="18" height="18" /></button>

      <!-- Lock / unlock button — only shown when auth is enabled -->
      <button
        v-if="authEnabled"
        class="btn-touch !px-3 text-xs transition-colors"
        :class="unlocked ? 'text-accent border border-accent/50' : 'text-fg'"
        :title="unlocked ? 'Lock controls' : 'Unlock controls'"
        @click="unlocked ? lock() : openKeypad()"
      >
        <Icon :icon="unlocked ? 'mdi:lock-open-outline' : 'mdi:lock-outline'" width="18" height="18" />
      </button>
    </div>
  </div>

  <PinKeypad v-if="showKeypad" @close="onKeypadClose" />
</template>
