<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()

const targetTemp = computed(() => Number(props.entity.attributes.temperature ?? 0))
const current = computed(() => Number(props.entity.attributes.current_temperature ?? 0))
const unit = computed(() => props.entity.attributes.temperature_unit ?? '°')

function setTemp(t: number) {
  callService('climate', 'set_temperature', { temperature: t }, {
    entity_id: props.entity.entity_id,
  })
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
    <div class="flex items-baseline gap-4">
      <div class="text-4xl font-light">{{ current }}{{ unit }}</div>
      <div class="text-sm text-fg-muted">Current</div>
    </div>
    <div class="flex items-center gap-3">
      <button class="btn-touch text-xl" @click="setTemp(targetTemp - 1)">−</button>
      <div class="flex-1 text-center text-2xl">{{ targetTemp }}{{ unit }}</div>
      <button class="btn-touch text-xl" @click="setTemp(targetTemp + 1)">+</button>
    </div>
    <div class="text-sm text-fg-muted">Mode: {{ entity.state }}</div>
  </div>
</template>
