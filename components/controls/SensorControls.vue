<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'
const props = defineProps<{ entity: HassEntity }>()

const unit = computed(() => props.entity.attributes.unit_of_measurement ?? '')
const numeric = computed(() => {
  const n = Number(props.entity.state)
  return props.entity.state !== '' && Number.isFinite(n) ? n : null
})
// Trim noisy precision (21.4372 → 21.4) but keep integers as-is.
const value = computed(() =>
  numeric.value === null
    ? humanizeState(props.entity.state)
    : String(Math.round(numeric.value * 10) / 10),
)
const deviceClass = computed(() => {
  const c = props.entity.attributes.device_class as string | undefined
  return c ? humanizeState(c) : 'Sensor'
})
</script>

<template>
  <div class="space-y-5">
    <ControlHeader
      :entity="entity"
      active
      :subtitle="`${deviceClass} · updated ${relativeTime(entity.last_updated)}`"
    />
    <div class="rounded-2xl bg-bg-elevated/50 py-8 text-center">
      <span class="text-6xl font-light tabular-nums">{{ value }}</span>
      <span v-if="unit" class="text-2xl text-fg-muted ml-1">{{ unit }}</span>
    </div>
  </div>
</template>
