<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

const isOn = computed(() => props.entity.state !== 'off' && props.entity.state !== 'standby' && props.entity.state !== 'unavailable')
const isPlaying = computed(() => props.entity.state === 'playing')

const volumeDraft = ref<number | null>(null)
const volumeLevel = computed({
  get: () => Number(props.entity.attributes.volume_level ?? 0),
  set: (v: number) => {
    entities.patch(props.entity.entity_id, { attributes: { volume_level: v } })
    callService('media_player', 'volume_set', { volume_level: v }, { entity_id: props.entity.entity_id })
  },
})
const volumeDisplay = computed(() => volumeDraft.value ?? volumeLevel.value)

const sourceLabel = computed(() => {
  const source = props.entity.attributes.app_name as string | undefined
  const title = props.entity.attributes.media_title as string | undefined
  if (source && title) return `${source}: ${title}`
  if (source) return source
  return title ?? null
})

function call(service: string, data?: Record<string, unknown>) {
  callService('media_player', service, data, { entity_id: props.entity.entity_id })
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
    <div v-if="sourceLabel" class="text-sm text-fg-muted truncate">{{ sourceLabel }}</div>
    <div v-else class="text-sm text-fg-muted">{{ entity.state }}</div>

    <!-- Playback controls -->
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

    <!-- Volume -->
    <div class="space-y-2">
      <label class="text-sm text-fg-muted">Volume</label>
      <div class="relative h-14 rounded-xl overflow-hidden"
           :style="`background: linear-gradient(to right, rgb(var(--accent)) ${volumeDisplay * 100}%, white ${volumeDisplay * 100}%)`">
        <div class="absolute top-1/2 -translate-y-1/2 -translate-x-3 w-1.5 h-8 rounded-full bg-white/70 pointer-events-none"
             :style="`left: calc(${volumeDisplay * 100}%)`" />
        <input type="range" min="0" max="1" step="0.01" :value="volumeDisplay"
          :disabled="!isOn"
          @input="(e) => volumeDraft = Number((e.target as HTMLInputElement).value)"
          @change="(e) => { volumeLevel = Number((e.target as HTMLInputElement).value); volumeDraft = null }"
          class="brightness-slider absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
    </div>
  </div>
</template>
