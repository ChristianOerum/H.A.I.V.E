<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

const isOn = computed(() => props.entity.state === 'on')
function toggle() {
  const domain = props.entity.entity_id.split('.')[0]
  entities.patch(props.entity.entity_id, { state: isOn.value ? 'off' : 'on' })
  callService(domain, isOn.value ? 'turn_off' : 'turn_on', undefined, {
    entity_id: props.entity.entity_id,
  })
}
</script>

<template>
  <div class="space-y-5">
    <ControlHeader
      :entity="entity"
      :active="isOn"
      :subtitle="`${isOn ? 'On' : 'Off'} · changed ${relativeTime(entity.last_changed)}`"
    >
      <ToggleSwitch :on="isOn" label="Power" @toggle="toggle" />
    </ControlHeader>

    <!-- Large power tile: the whole surface is one easy target -->
    <button
      class="w-full h-28 rounded-2xl flex items-center justify-center gap-3 text-lg font-semibold transition-colors active:scale-[0.98]"
      :class="isOn ? 'bg-accent text-bg' : 'bg-bg-elevated text-fg-muted'"
      @click="toggle"
    >
      <Icon icon="mdi:power" width="32" height="32" />
      {{ isOn ? 'Turn off' : 'Turn on' }}
    </button>
  </div>
</template>
