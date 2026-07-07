<script setup lang="ts">
import { Icon } from '@iconify/vue'

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
const iconFor = (c: string) => WEATHER_ICONS[c] ?? 'mdi:weather-partly-cloudy'

const conditionLabel = computed(() =>
  weather.condition.value.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
)

// Live clock — ticks every second.
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const time = computed(() =>
  now.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
)
const dateLong = computed(() =>
  now.value.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }),
)

const roundTemp = (t: number | null) => (t == null ? '—' : `${Math.round(t)}°`)

// Limit to the next few days for a compact panel.
const days = computed(() => weather.forecast.value.slice(0, 5))
const dayLabel = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString([], { weekday: 'short' })
}
</script>

<template>
  <div class="absolute top-14 left-0 right-0 flex justify-start px-6 pointer-events-none z-10">
    <div
      class="pointer-events-auto flex flex-col gap-3 rounded-2xl"
    >
      <!-- Current: time, date, temperature & condition -->
      <div class="flex items-center gap-5">
        <div class="text-left">
          <div class="text-3xl font-light leading-none">{{ time }}</div>
          <div class="text-xs text-fg-muted mt-1">{{ dateLong }}</div>
        </div>

        <div class="w-px self-stretch bg-fg/10" />

        <div class="flex items-center gap-3">
          <Icon :icon="iconFor(weather.condition.value)" width="40" height="40" class="text-accent" />
          <div>
            <div class="text-2xl font-light leading-none">
              {{ roundTemp(weather.temperature.value) }}<span class="text-sm text-fg-muted">{{ weather.temperatureUnit.value }}</span>
            </div>
            <div class="text-xs text-fg-muted">{{ conditionLabel }}</div>
          </div>
        </div>

        <div class="w-px self-stretch bg-fg/10 hidden sm:block" />

        <div class="hidden sm:flex flex-col gap-1 text-xs text-fg-muted">
          <div v-if="weather.humidity.value != null" class="flex items-center gap-1">
            <Icon icon="mdi:water-percent" width="14" height="14" />
            <span>{{ weather.humidity.value }}%</span>
          </div>
          <div class="flex items-center gap-1">
            <Icon icon="mdi:weather-windy" width="14" height="14" />
            <span>{{ Math.round(weather.windSpeed.value) }} {{ weather.windSpeedUnit.value }}</span>
          </div>
        </div>
      </div>

      <!-- Forecast: other days -->
      <div v-if="days.length" class="flex items-start justify-between gap-3 pt-1 border-t border-fg/10">
        <div
          v-for="(d, i) in days"
          :key="i"
          class="flex flex-col items-center gap-1 min-w-[3rem]"
        >
          <span class="text-[11px] text-fg-muted">{{ dayLabel(d.datetime) }}</span>
          <Icon :icon="iconFor(d.condition)" width="22" height="22" class="text-fg/80" />
          <span class="text-xs">
            {{ roundTemp(d.tempHigh) }}<span v-if="d.tempLow != null" class="text-fg-muted"> / {{ roundTemp(d.tempLow) }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
