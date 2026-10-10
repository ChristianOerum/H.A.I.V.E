<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()

// Snapshots are fetched through the HAIVE server's HA proxy, so any screen on
// the network can show them without reaching Home Assistant directly.
const base = computed(() => {
  const pic = props.entity.attributes.entity_picture as string | undefined
  if (!pic) return ''
  return pic.startsWith('http') ? pic : `/api/ha/proxy${pic}`
})

// Refresh the still every few seconds while the sheet is open so it reads
// as a (slow) live view rather than a frozen frame.
const REFRESH_MS = 5000
const tick = ref(0)
const loaded = ref(false)
const failed = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => tick.value++, REFRESH_MS) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const src = computed(() => {
  if (!base.value) return ''
  const sep = base.value.includes('?') ? '&' : '?'
  return `${base.value}${sep}_t=${tick.value}`
})
watch(base, () => { loaded.value = false; failed.value = false })
// A failed frame (camera briefly offline) shouldn't stick — retry on the next tick.
watch(tick, () => { if (failed.value) { failed.value = false; loaded.value = false } })
</script>

<template>
  <div class="space-y-4">
    <ControlHeader :entity="entity" :active="entity.state === 'recording' || entity.state === 'streaming'" />
    <div class="relative aspect-video bg-bg-elevated rounded-2xl overflow-hidden">
      <img
        v-if="src && !failed"
        :src="src"
        class="w-full h-full object-cover transition-opacity duration-300"
        :class="loaded ? 'opacity-100' : 'opacity-0'"
        alt=""
        @load="loaded = true"
        @error="failed = true"
      />
      <div
        v-if="!src || failed || !loaded"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fg-muted"
      >
        <Icon
          :icon="src && !failed ? 'mdi:loading' : 'mdi:cctv-off'"
          width="32"
          height="32"
          :class="src && !failed ? 'animate-spin' : ''"
        />
        <span class="text-sm">{{ src && !failed ? 'Loading snapshot…' : 'No preview available' }}</span>
      </div>
    </div>
  </div>
</template>
