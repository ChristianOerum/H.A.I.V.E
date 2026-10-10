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
  theme.mode === 'auto' ? 'Auto' : theme.mode === 'light' ? 'Light' : 'Dark',
)
</script>

<template>
  <button
    class="toolbar-btn"
    :aria-label="`Theme: ${label}`"
    :title="`Theme: ${label} (tap to cycle auto / light / dark)`"
    @click="theme.toggle()"
  >
    <Icon :icon="icon" width="20" height="20" />
    <span class="hidden md:inline">{{ label }}</span>
  </button>
</template>
