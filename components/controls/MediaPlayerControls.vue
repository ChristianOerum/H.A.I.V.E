<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()

const isOn = computed(() => props.entity.state !== 'off' && props.entity.state !== 'standby' && props.entity.state !== 'unavailable')
const isPlaying = computed(() => props.entity.state === 'playing')
function call(service: string, data?: Record<string, unknown>) {
  callService('media_player', service, data, { entity_id: props.entity.entity_id })
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
    <div class="text-sm text-fg-muted">{{ entity.attributes.media_title ?? entity.state }}</div>
    <div class="flex gap-3 justify-center">
      <button
        class="btn-touch"
        :class="isOn ? 'text-red-400' : 'text-fg-muted'"
        @click="call(isOn ? 'turn_off' : 'turn_on')"
      >⏻</button>
      <button class="btn-touch" :disabled="!isOn" @click="call('media_previous_track')">⏮</button>
      <button class="btn-touch" :disabled="!isOn" @click="call(isPlaying ? 'media_pause' : 'media_play')">
        {{ isPlaying ? '⏸' : '▶' }}
      </button>
      <button class="btn-touch" :disabled="!isOn" @click="call('media_next_track')">⏭</button>
    </div>
  </div>
</template>
