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

const STATUS = {
  idle:         { dot: 'bg-fg-muted',                 label: 'Starting…' },
  connecting:   { dot: 'bg-yellow-400 animate-pulse', label: 'Connecting…' },
  connected:    { dot: 'bg-emerald-400',              label: 'Connected' },
  disconnected: { dot: 'bg-orange-400 animate-pulse', label: 'Reconnecting…' },
  error:        { dot: 'bg-red-500',                  label: 'Offline' },
} as const
const status = computed(() => STATUS[entities.status] ?? STATUS.idle)

const WALL_LABELS = { solid: 'Walls', dimmed: 'Dimmed', ghost: 'Ghost' } as const

const { authEnabled } = useDeviceConfig()
const showKeypad = ref(false)
const openKeypad = () => { if (!unlocked.value) showKeypad.value = true }
const onKeypadClose = () => { showKeypad.value = false }

// Locked controls stay visible (so people know they exist) but a tap asks
// for the PIN instead of silently doing nothing.
function onGatedClick(e: MouseEvent) {
  if (unlocked.value) return
  e.stopPropagation()
  e.preventDefault()
  openKeypad()
}
</script>

<template>
  <div class="absolute top-0 left-0 right-0 z-10 flex items-start justify-between gap-3 px-4 sm:px-6 pt-3 pointer-events-none">
    <!-- Brand + connection -->
    <div class="flex items-center gap-3 pointer-events-auto min-h-touch">
      <span class="text-sm font-semibold tracking-[0.2em] text-accent">H.A.I.V.E.</span>
      <div
        class="flex items-center gap-2 rounded-full px-2.5 py-1 text-xs"
        :class="entities.status === 'connected' ? 'text-fg-muted' : 'surface text-fg'"
        :title="entities.error || status.label"
      >
        <span class="w-2 h-2 rounded-full" :class="status.dot" />
        <span :class="entities.status === 'connected' ? 'hidden lg:inline' : ''">{{ status.label }}</span>
      </div>
      <span
        v-if="isMock()"
        class="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-500 border border-yellow-500/30"
        title="Running against built-in sample devices (?mock=1)"
      >MOCK</span>
    </div>

    <!-- Toolbar -->
    <div class="surface flex items-center gap-0.5 p-1 rounded-2xl pointer-events-auto">
      <!-- Display toggles: visible to everyone, PIN-gated when locked -->
      <div
        class="flex items-center gap-0.5"
        :class="unlocked ? '' : 'opacity-50'"
        :title="unlocked ? undefined : 'Locked — tap to enter PIN'"
        @click.capture="onGatedClick"
      >
        <ThemeToggle />

        <button
          class="toolbar-btn"
          :aria-pressed="weather.enabled.value"
          :title="weather.enabled.value ? 'Weather effects on — tap to turn off' : 'Weather effects off — tap to turn on'"
          @click="weather.toggle()"
        >
          <Icon :icon="weather.enabled.value ? weatherIcon : 'mdi:weather-cloudy-remove'" width="20" height="20" />
          <span class="hidden md:inline">Weather</span>
        </button>

        <!-- Mock-only weather cycle — step through conditions for testing -->
        <button
          v-if="isMock()"
          class="toolbar-btn"
          :title="`Test weather: ${weatherLabel} — tap to cycle`"
          @click="weather.cycleCondition()"
        >
          <Icon icon="mdi:refresh" width="20" height="20" />
          <span class="hidden md:inline">{{ weatherLabel }}</span>
        </button>

        <button
          class="toolbar-btn"
          :aria-pressed="theme.wallOpacityMode !== 'solid'"
          :title="`Walls: ${theme.wallOpacityMode} — tap to cycle solid / dimmed / ghost`"
          @click="theme.cycleWallOpacity()"
        >
          <Icon
            :icon="theme.wallOpacityMode === 'solid'
              ? 'mdi:wall'
              : theme.wallOpacityMode === 'dimmed'
                ? 'mdi:circle-half-full'
                : 'mdi:circle-outline'"
            width="20"
            height="20"
          />
          <span class="hidden md:inline">{{ WALL_LABELS[theme.wallOpacityMode] }}</span>
        </button>

        <!-- Day cycle demo — hidden; keep for future use -->
        <button
          v-if="false"
          class="toolbar-btn"
          :aria-pressed="theme.isSimulating"
          :title="theme.isSimulating ? 'Stop day simulation' : 'Simulate 24h day cycle (72s)'"
          @click="theme.startDaySimulation()"
        >
          <Icon :icon="theme.isSimulating ? 'mdi:stop-circle-outline' : 'mdi:weather-sunset'" width="20" height="20" />
        </button>
      </div>

      <template v-if="unlocked">
        <div class="w-px h-6 bg-fg/10 mx-1" />
        <SaveViewButton />
        <button
          class="toolbar-btn"
          :aria-pressed="fp.editMode"
          title="Edit floorplan, devices and preferences"
          @click="fp.toggleEditMode()"
        >
          <Icon icon="mdi:cog-outline" width="20" height="20" />
          <!-- Fixed label: changing its width would shift the right-aligned toolbar -->
          <span class="hidden md:inline">Settings</span>
        </button>
      </template>

      <template v-if="authEnabled">
        <div class="w-px h-6 bg-fg/10 mx-1" />
        <button
          class="toolbar-btn"
          :class="unlocked ? 'text-accent' : 'text-fg'"
          :title="unlocked ? 'Lock controls' : 'Unlock controls'"
          @click="unlocked ? lock() : openKeypad()"
        >
          <Icon :icon="unlocked ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'" width="20" height="20" />
          <span class="hidden md:inline">{{ unlocked ? 'Lock' : 'Unlock' }}</span>
        </button>
      </template>
    </div>
  </div>

  <PinKeypad v-if="showKeypad" @close="onKeypadClose" />
</template>
