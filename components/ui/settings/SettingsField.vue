<script setup lang="ts">
/** Label + control + optional hint, with an optional inline "Reset" action. */
defineProps<{
  label?: string
  hint?: string
  /** Shows a Reset action next to the label (e.g. when a value overrides an auto default). */
  resettable?: boolean
  resetLabel?: string
}>()
const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <div class="flex flex-col gap-1.5 min-w-0">
    <div v-if="label || resettable || $slots.label" class="flex items-center justify-between gap-2 min-h-[1.25rem]">
      <span class="field-label truncate"><slot name="label">{{ label }}</slot></span>
      <button v-if="resettable" type="button" class="field-action shrink-0" @click.stop="emit('reset')">
        {{ resetLabel ?? 'Reset' }}
      </button>
    </div>
    <slot />
    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>
