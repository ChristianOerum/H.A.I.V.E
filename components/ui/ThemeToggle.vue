<script setup lang="ts">
import { Icon } from '@iconify/vue'

const theme = useThemeStore()

const icon = computed(() =>
  theme.mode === 'auto'
    ? 'mdi:theme-light-dark'
    : theme.mode === 'light'
      ? 'heroicons:sun'
      : 'heroicons:moon',
)
const label = computed(() =>
  theme.mode === 'auto' ? 'Cycle' : theme.mode === 'light' ? 'Light' : 'Dark',
)
</script>

<template>
  <button
    class="btn-touch text-xs gap-2 px-3 py-1 min-h-touch"
    :aria-label="`Theme: ${label}`"
    :title="`Theme: ${label} (tap to cycle)`"
    @click="theme.toggle()"
  >
    <Icon :icon="icon" width="18" height="18" />
    <span class="hidden md:inline">{{ label }}</span>
  </button>
</template>
