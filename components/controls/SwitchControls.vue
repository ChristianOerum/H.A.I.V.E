<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()

const isOn = computed(() => props.entity.state === 'on')
function toggle() {
  const domain = props.entity.entity_id.split('.')[0]
  callService(domain, isOn.value ? 'turn_off' : 'turn_on', undefined, {
    entity_id: props.entity.entity_id,
  })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
      <button class="btn-touch" :class="isOn ? 'bg-accent text-bg' : ''" @click="toggle">
        {{ isOn ? 'On' : 'Off' }}
      </button>
    </div>
  </div>
</template>
