<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

const attrs = computed(() => props.entity.attributes)
const isOn = computed(() => !['off', 'standby', 'unavailable'].includes(props.entity.state))
const isPlaying = computed(() => props.entity.state === 'playing')
const muted = computed(() => !!attrs.value.is_volume_muted)
const volume = computed(() => Number(attrs.value.volume_level ?? 0))

const title = computed(() => attrs.value.media_title as string | undefined)
const artist = computed(() => (attrs.value.media_artist ?? attrs.value.app_name) as string | undefined)

// Artwork goes through the HAIVE server's HA proxy, like camera snapshots.
const artwork = computed(() => {
  const pic = attrs.value.entity_picture as string | undefined
  if (!pic) return ''
  return pic.startsWith('http') ? pic : `/api/ha/proxy${pic}`
})
const artworkFailed = ref(false)
watch(artwork, () => { artworkFailed.value = false })

function call(service: string, data?: Record<string, unknown>) {
  callService('media_player', service, data, { entity_id: props.entity.entity_id })
}
function playPause() {
  entities.patch(props.entity.entity_id, { state: isPlaying.value ? 'paused' : 'playing' })
  call(isPlaying.value ? 'media_pause' : 'media_play')
}
function power() {
  entities.patch(props.entity.entity_id, { state: isOn.value ? 'off' : 'idle' })
  call(isOn.value ? 'turn_off' : 'turn_on')
}
function setVolume(v: number) {
  entities.patch(props.entity.entity_id, { attributes: { volume_level: v } })
  call('volume_set', { volume_level: v })
}
function toggleMute() {
  entities.patch(props.entity.entity_id, { attributes: { is_volume_muted: !muted.value } })
  call('volume_mute', { is_volume_muted: !muted.value })
}
</script>

<template>
  <div class="space-y-5">
    <ControlHeader :entity="entity" :active="isOn" :subtitle="humanizeState(entity.state)">
      <ToggleSwitch :on="isOn" label="Power" @toggle="power" />
    </ControlHeader>

    <!-- Now playing -->
    <div v-if="isOn" class="flex items-center gap-4 rounded-2xl bg-bg-elevated/50 p-3">
      <div class="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-bg-elevated flex items-center justify-center">
        <img
          v-if="artwork && !artworkFailed"
          :src="artwork"
          class="w-full h-full object-cover"
          alt=""
          @error="artworkFailed = true"
        />
        <Icon v-else icon="mdi:music-note" width="32" height="32" class="text-fg-muted" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-semibold truncate">{{ title ?? 'Nothing playing' }}</div>
        <div v-if="artist" class="text-sm text-fg-muted truncate">{{ artist }}</div>
      </div>
    </div>

    <!-- Transport -->
    <div class="flex items-center justify-center gap-4">
      <button class="btn-touch w-16 h-16 !rounded-full" aria-label="Previous track" :disabled="!isOn" @click="call('media_previous_track')">
        <Icon icon="mdi:skip-previous" width="28" height="28" />
      </button>
      <button
        class="btn-touch w-20 h-20 !rounded-full"
        :class="isOn ? '!bg-accent !text-bg' : ''"
        :aria-label="isPlaying ? 'Pause' : 'Play'"
        :disabled="!isOn"
        @click="playPause"
      >
        <Icon :icon="isPlaying ? 'mdi:pause' : 'mdi:play'" width="36" height="36" />
      </button>
      <button class="btn-touch w-16 h-16 !rounded-full" aria-label="Next track" :disabled="!isOn" @click="call('media_next_track')">
        <Icon icon="mdi:skip-next" width="28" height="28" />
      </button>
    </div>

    <!-- Volume -->
    <div class="flex items-end gap-3">
      <button
        class="btn-touch w-14 h-14 shrink-0"
        :class="muted ? 'text-red-400' : ''"
        :aria-label="muted ? 'Unmute' : 'Mute'"
        :disabled="!isOn"
        @click="toggleMute"
      >
        <Icon :icon="muted ? 'mdi:volume-off' : volume < 0.34 ? 'mdi:volume-low' : volume < 0.67 ? 'mdi:volume-medium' : 'mdi:volume-high'" width="24" height="24" />
      </button>
      <RangeSlider
        class="flex-1"
        label="Volume"
        :value="volume"
        :min="0"
        :max="1"
        :step="0.01"
        :disabled="!isOn"
        :format="(v) => (muted ? 'Muted' : `${Math.round(v * 100)}%`)"
        @commit="setVolume"
      />
    </div>
  </div>
</template>
