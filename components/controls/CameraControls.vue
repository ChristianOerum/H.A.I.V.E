<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const config = useRuntimeConfig()

// Live snapshot URL exposed by HA — requires token; for kiosk use we pass it
// via the camera_proxy_stream or entity_picture. Here we use entity_picture.
const src = computed(() => {
  const pic = props.entity.attributes.entity_picture
  if (!pic) return ''
  return pic.startsWith('http') ? pic : `${config.public.haUrl}${pic}`
})
</script>

<template>
  <div class="space-y-2">
    <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
    <div class="aspect-video bg-bg-elevated rounded-lg overflow-hidden">
      <img v-if="src" :src="src" class="w-full h-full object-cover" alt="" />
      <div v-else class="w-full h-full flex items-center justify-center text-fg-muted">
        No preview
      </div>
    </div>
    <div class="text-sm text-fg-muted/70">State: {{ entity.state }}</div>
  </div>
</template>
