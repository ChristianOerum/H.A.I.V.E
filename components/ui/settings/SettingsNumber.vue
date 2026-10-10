<script setup lang="ts">
/**
 * Touch-friendly number input: − / value / + instead of the browser's tiny
 * spinner arrows. Emits `change` once per commit (stepper tap, Enter or blur),
 * matching the `@change` semantics the stores expect.
 */
const props = withDefaults(defineProps<{
  value: number | undefined
  step?: number
  min?: number
  max?: number
  unit?: string
  placeholder?: string
  /** When true, clearing the field emits `undefined` (falls back to an auto/default value). */
  nullable?: boolean
  label?: string
}>(), {
  step: 0.1,
})
const emit = defineEmits<{ change: [value: number | undefined] }>()

const decimals = computed(() => {
  const s = String(props.step)
  return s.includes('.') ? s.split('.')[1].length : 0
})
const round = (v: number) => +v.toFixed(Math.max(decimals.value, 2))
function clamp(v: number) {
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  return round(v)
}

const display = computed(() => (props.value === undefined || Number.isNaN(props.value) ? '' : String(round(props.value))))

function stepBy(dir: 1 | -1) {
  // Stepping from an empty (auto) value starts at the placeholder if it's numeric.
  const base = props.value ?? (Number(props.placeholder) || 0)
  emit('change', clamp(base + dir * props.step))
}

function commit(e: Event) {
  const el = e.target as HTMLInputElement
  const raw = el.value.trim()
  if (raw === '') {
    if (props.nullable) emit('change', undefined)
    else el.value = display.value
    return
  }
  const n = Number(raw.replace(',', '.'))
  if (Number.isNaN(n)) { el.value = display.value; return }
  const v = clamp(n)
  el.value = String(v)
  if (v !== props.value) emit('change', v)
}

const atMin = computed(() => props.min !== undefined && props.value !== undefined && props.value <= props.min)
const atMax = computed(() => props.max !== undefined && props.value !== undefined && props.value >= props.max)
</script>

<template>
  <div class="flex h-10 w-full min-w-0 rounded-lg bg-bg border border-fg/10 focus-within:border-accent/60 transition-colors overflow-hidden">
    <button
      type="button"
      tabindex="-1"
      class="w-8 shrink-0 flex items-center justify-center text-fg-muted active:bg-bg-elevated disabled:opacity-30"
      :aria-label="`Decrease ${label ?? ''}`"
      :disabled="atMin"
      @click.stop="stepBy(-1)"
    >
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
    </button>
    <div class="relative flex-1 min-w-0">
      <input
        type="text"
        inputmode="decimal"
        class="w-full h-full bg-transparent text-center text-sm tabular-nums text-fg outline-none placeholder:text-fg-muted/50"
        :class="unit ? 'pr-4' : ''"
        :value="display"
        :placeholder="placeholder"
        :aria-label="label"
        @change="commit"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @click.stop
      />
      <span v-if="unit" class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-fg-muted pointer-events-none">{{ unit }}</span>
    </div>
    <button
      type="button"
      tabindex="-1"
      class="w-8 shrink-0 flex items-center justify-center text-fg-muted active:bg-bg-elevated disabled:opacity-30"
      :aria-label="`Increase ${label ?? ''}`"
      :disabled="atMax"
      @click.stop="stepBy(1)"
    >
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
    </button>
  </div>
</template>
