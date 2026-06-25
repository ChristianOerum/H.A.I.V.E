<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()

const isOn = computed(() => props.entity.state === 'on')
const brightness = computed({
  get: () => Number(props.entity.attributes.brightness ?? 0),
  set: (v: number) =>
    callService('light', 'turn_on', { brightness: v }, { entity_id: props.entity.entity_id }),
})

function toggle() {
  callService('light', isOn.value ? 'turn_off' : 'turn_on', undefined, {
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
    <div v-if="entity.attributes.supported_color_modes" class="space-y-2">
      <label class="text-sm text-fg-muted">Brightness</label>
      <input
        type="range"
        min="0"
        max="255"
        :value="brightness"
        @change="(e) => brightness = Number((e.target as HTMLInputElement).value)"
        class="w-full h-3 accent-accent"
      />
    </div>
  </div>
</template>
