<script setup lang="ts">
defineProps<{
  on: boolean
  label?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <!-- 44px tall hit area around a 32px track -->
  <button
    type="button"
    role="switch"
    :aria-checked="on"
    :aria-label="label"
    :disabled="disabled"
    class="relative shrink-0 h-11 w-16 flex items-center justify-center disabled:opacity-40"
    @click="emit('toggle')"
  >
    <span
      class="block w-14 h-8 rounded-full transition-colors duration-200"
      :class="on ? 'bg-accent' : 'bg-bg-elevated ring-1 ring-inset ring-fg/10'"
    />
    <span
      class="absolute top-1/2 left-2 -translate-y-1/2 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200"
      :class="on ? 'translate-x-6' : 'translate-x-0'"
    />
  </button>
</template>
