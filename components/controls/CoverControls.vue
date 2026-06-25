<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()

function call(service: string) {
  callService('cover', service, undefined, { entity_id: props.entity.entity_id })
}
const position = computed(() => Number(props.entity.attributes.current_position ?? 0))
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
    <div class="text-sm text-fg-muted">{{ entity.state }} · {{ position }}%</div>
    <div class="flex gap-3 justify-center">
      <button class="btn-touch" @click="call('open_cover')">▲ Open</button>
      <button class="btn-touch" @click="call('stop_cover')">■ Stop</button>
      <button class="btn-touch" @click="call('close_cover')">▼ Close</button>
    </div>
  </div>
</template>
