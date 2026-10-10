<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

const attrs = computed(() => props.entity.attributes)
const unit = computed(() => (attrs.value.temperature_unit as string | undefined) ?? '°')
const current = computed(() => attrs.value.current_temperature as number | undefined)
const step = computed(() => Number(attrs.value.target_temp_step ?? (unit.value.includes('F') ? 1 : 0.5)))
const minTemp = computed(() => Number(attrs.value.min_temp ?? 7))
const maxTemp = computed(() => Number(attrs.value.max_temp ?? 35))
const hasTarget = computed(() => attrs.value.temperature != null)

// Local target so rapid taps accumulate instantly; the service call is
// debounced so five taps send one request instead of five.
const pending = ref<number | null>(null)
const target = computed(() => pending.value ?? Number(attrs.value.temperature ?? 0))
let timer: ReturnType<typeof setTimeout> | null = null

function commit() {
  if (timer) { clearTimeout(timer); timer = null }
  const next = pending.value
  if (next === null) return
  entities.patch(props.entity.entity_id, { attributes: { temperature: next } })
  callService('climate', 'set_temperature', { temperature: next }, { entity_id: props.entity.entity_id })
  pending.value = null
}
function nudge(dir: 1 | -1) {
  pending.value = Math.min(maxTemp.value, Math.max(minTemp.value, +(target.value + dir * step.value).toFixed(1)))
  if (timer) clearTimeout(timer)
  timer = setTimeout(commit, 600)
}
// Closing the sheet mid-debounce must still send the last value.
onBeforeUnmount(commit)

const fmt = (t: number | undefined) => (t == null ? '—' : (Math.round(t * 10) / 10).toString())

const MODE_ICONS: Record<string, string> = {
  off: 'mdi:power',
  heat: 'mdi:fire',
  cool: 'mdi:snowflake',
  heat_cool: 'mdi:sun-snowflake-variant',
  auto: 'mdi:thermostat-auto',
  dry: 'mdi:water-percent',
  fan_only: 'mdi:fan',
}
const modes = computed(() => (attrs.value.hvac_modes as string[] | undefined) ?? [])
function setMode(mode: string) {
  entities.patch(props.entity.entity_id, { state: mode })
  callService('climate', 'set_hvac_mode', { hvac_mode: mode }, { entity_id: props.entity.entity_id })
}

const subtitle = computed(() => {
  const action = attrs.value.hvac_action as string | undefined
  return action ? humanizeState(action) : humanizeState(props.entity.state)
})
</script>

<template>
  <div class="space-y-5">
    <ControlHeader :entity="entity" :active="entity.state !== 'off'" :subtitle="subtitle" />

    <div v-if="hasTarget" class="flex items-center gap-3">
      <button class="btn-touch w-16 h-16 !rounded-2xl" aria-label="Lower target temperature" :disabled="target <= minTemp" @click="nudge(-1)">
        <Icon icon="mdi:minus" width="28" height="28" />
      </button>
      <div class="flex-1 text-center">
        <div class="section-label">Target</div>
        <div class="text-5xl font-light tabular-nums leading-tight" :class="pending !== null ? 'text-accent' : ''">
          {{ fmt(target) }}<span class="text-2xl text-fg-muted">{{ unit }}</span>
        </div>
        <div class="text-sm text-fg-muted">Currently {{ fmt(current) }}{{ unit }}</div>
      </div>
      <button class="btn-touch w-16 h-16 !rounded-2xl" aria-label="Raise target temperature" :disabled="target >= maxTemp" @click="nudge(1)">
        <Icon icon="mdi:plus" width="28" height="28" />
      </button>
    </div>
    <div v-else class="text-center py-4">
      <div class="section-label">Current</div>
      <div class="text-5xl font-light tabular-nums">{{ fmt(current) }}<span class="text-2xl text-fg-muted">{{ unit }}</span></div>
    </div>

    <div v-if="modes.length" class="space-y-2">
      <div class="section-label">Mode</div>
      <div class="segmented flex-wrap">
        <button
          v-for="m in modes"
          :key="m"
          :aria-pressed="entity.state === m"
          @click="setMode(m)"
        >
          <Icon :icon="MODE_ICONS[m] ?? 'mdi:thermostat'" width="18" height="18" />
          <span>{{ humanizeState(m) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
