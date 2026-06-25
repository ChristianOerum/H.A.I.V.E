<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'
const props = defineProps<{ entity: HassEntity }>()
const unit = computed(() => props.entity.attributes.unit_of_measurement ?? '')
</script>

<template>
  <div class="space-y-2">
    <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
    <div class="text-5xl font-light">{{ entity.state }}<span class="text-2xl text-fg-muted ml-1">{{ unit }}</span></div>
    <div class="text-sm text-fg-muted/70">Read-only sensor</div>
  </div>
</template>
