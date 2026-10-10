<script setup lang="ts">
/**
 * Large touch slider used across the device control sheets.
 *
 * Shows the dragged value live (draft) but only emits `commit` when the
 * finger lifts, so a drag sends one service call instead of dozens.
 * `input` fires on every move for callers that preview the draft elsewhere
 * (e.g. the saturation track following the hue being dragged).
 */
const props = withDefaults(defineProps<{
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
  /** Formats the readout shown next to the label. */
  format?: (v: number) => string
  /** CSS background for the track. When omitted, an accent fill up to the value is used. */
  background?: string
  disabled?: boolean
}>(), {
  min: 0,
  max: 100,
  step: 1,
})

const emit = defineEmits<{
  input: [value: number]
  commit: [value: number]
}>()

const draft = ref<number | null>(null)
const display = computed(() => draft.value ?? props.value)
const pct = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((display.value - props.min) / span) * 100))
})

const trackStyle = computed(() => ({
  background: props.background
    ?? `linear-gradient(to right, rgb(var(--accent)) ${pct.value}%, rgb(var(--bg-elevated)) ${pct.value}%)`,
}))

function onInput(e: Event) {
  draft.value = Number((e.target as HTMLInputElement).value)
  emit('input', draft.value)
}
function onChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  draft.value = null
  emit('commit', v)
}
</script>

<template>
  <div class="space-y-2" :class="disabled ? 'opacity-40' : ''">
    <div v-if="label || format" class="flex items-baseline justify-between">
      <span v-if="label" class="section-label">{{ label }}</span>
      <span v-if="format" class="text-sm font-medium tabular-nums text-fg">{{ format(display) }}</span>
    </div>
    <div class="relative h-14 rounded-xl overflow-hidden ring-1 ring-inset ring-fg/10" :style="trackStyle">
      <!-- Thumb: inset so it never clips at the track ends -->
      <div
        class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-9 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_2px_6px_rgba(0,0,0,0.35)] pointer-events-none"
        :style="{ left: `calc(10px + (100% - 20px) * ${pct / 100})` }"
      />
      <input
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="display"
        :disabled="disabled"
        :aria-label="label"
        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        @input="onInput"
        @change="onChange"
      />
    </div>
  </div>
</template>
