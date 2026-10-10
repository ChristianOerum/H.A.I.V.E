<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{
  entity: HassEntity
  /** Secondary line under the name; defaults to the humanised state. */
  subtitle?: string
  /** Lights the icon chip in the accent (or `tint`) colour. */
  active?: boolean
  /** Optional CSS colour for the active icon chip (e.g. a light's current colour). */
  tint?: string
}>()

const layout = useLayoutStore()

const name = computed(() => props.entity.attributes.friendly_name ?? props.entity.entity_id)
const icon = computed(() =>
  entityIcon(props.entity.entity_id, props.entity, layout.placementFor(props.entity.entity_id)?.icon),
)
const chipStyle = computed(() =>
  props.active && props.tint ? { background: props.tint, color: '#fff' } : undefined,
)
</script>

<template>
  <div class="flex items-center gap-3 min-w-0">
    <div
      class="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-colors"
      :class="active ? (tint ? '' : 'bg-accent text-bg') : 'bg-bg-elevated text-fg-muted'"
      :style="chipStyle"
    >
      <Icon :icon="icon" width="26" height="26" />
    </div>
    <div class="flex-1 min-w-0">
      <h3 class="text-lg font-semibold leading-tight truncate">{{ name }}</h3>
      <p class="text-sm text-fg-muted truncate">{{ subtitle ?? humanizeState(entity.state) }}</p>
    </div>
    <slot />
  </div>
</template>
