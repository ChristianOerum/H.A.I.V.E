<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

// CoverEntityFeature bit flags
const SET_POSITION = 4
const STOP = 8

const features = computed(() => Number(props.entity.attributes.supported_features ?? 0))
const hasPosition = computed(() => props.entity.attributes.current_position !== undefined)
const canSetPosition = computed(() => hasPosition.value && (features.value & SET_POSITION) !== 0)
// Unknown feature flags (0) → assume a basic cover with stop support.
const canStop = computed(() => features.value === 0 || (features.value & STOP) !== 0)
const position = computed(() => Number(props.entity.attributes.current_position ?? 0))

const moving = computed(() => props.entity.state === 'opening' || props.entity.state === 'closing')
const subtitle = computed(() => {
  const s = humanizeState(props.entity.state)
  return hasPosition.value && !moving.value ? `${s} · ${position.value}%` : s
})

function call(service: string, data?: Record<string, unknown>) {
  callService('cover', service, data, { entity_id: props.entity.entity_id })
}
function setPosition(v: number) {
  entities.patch(props.entity.entity_id, { attributes: { current_position: v } })
  call('set_cover_position', { position: v })
}
</script>

<template>
  <div class="space-y-5">
    <ControlHeader :entity="entity" :active="entity.state !== 'closed'" :subtitle="subtitle" />

    <div class="grid gap-3" :class="canStop ? 'grid-cols-3' : 'grid-cols-2'">
      <button class="btn-touch flex-col !gap-1 h-20" :disabled="entity.state === 'open' && position >= 100" @click="call('open_cover')">
        <Icon icon="mdi:arrow-up" width="26" height="26" />
        <span class="text-xs">Open</span>
      </button>
      <button v-if="canStop" class="btn-touch flex-col !gap-1 h-20" @click="call('stop_cover')">
        <Icon icon="mdi:stop" width="26" height="26" />
        <span class="text-xs">Stop</span>
      </button>
      <button class="btn-touch flex-col !gap-1 h-20" :disabled="entity.state === 'closed'" @click="call('close_cover')">
        <Icon icon="mdi:arrow-down" width="26" height="26" />
        <span class="text-xs">Close</span>
      </button>
    </div>

    <RangeSlider
      v-if="canSetPosition"
      label="Position"
      :value="position"
      :format="(v) => (v <= 0 ? 'Closed' : v >= 100 ? 'Open' : `${v}%`)"
      @commit="setPosition"
    />
  </div>
</template>
