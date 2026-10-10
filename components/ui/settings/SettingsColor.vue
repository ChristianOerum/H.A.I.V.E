<script setup lang="ts">
/** Colour swatch + hex text field. `undefined` means "auto" (theme/derived colour). */
const props = withDefaults(defineProps<{
  value: string | undefined
  /** Colour the swatch shows while the value is auto. */
  fallback?: string
  placeholder?: string
  /** Whether the value can be cleared back to auto. */
  clearable?: boolean
}>(), {
  fallback: '#808080',
  placeholder: 'Auto',
  clearable: true,
})
const emit = defineEmits<{ update: [value: string | undefined] }>()

function onText(e: Event) {
  const el = e.target as HTMLInputElement
  let v = el.value.trim()
  if (v && !v.startsWith('#')) v = `#${v}`
  if (!v) { if (props.clearable) emit('update', undefined); return }
  if (/^#[0-9a-f]{6}$/i.test(v)) emit('update', v.toLowerCase())
  else el.value = props.value ?? ''
}
</script>

<template>
  <div class="flex items-center gap-2 min-w-0">
    <label class="relative w-10 h-10 shrink-0 rounded-lg border border-fg/10 overflow-hidden cursor-pointer" :style="{ background: value ?? fallback }">
      <input
        type="color"
        class="absolute inset-0 opacity-0 cursor-pointer"
        :value="value ?? fallback"
        @input="emit('update', ($event.target as HTMLInputElement).value)"
        @click.stop
      />
      <span v-if="!value" class="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-white/90 bg-black/25">AUTO</span>
    </label>
    <input
      class="field-input font-mono uppercase"
      :value="value ?? ''"
      :placeholder="placeholder"
      maxlength="7"
      spellcheck="false"
      @change="onText"
      @click.stop
    />
    <button
      v-if="clearable && value"
      type="button"
      class="field-action shrink-0"
      title="Back to automatic colour"
      @click.stop="emit('update', undefined)"
    >Auto</button>
  </div>
</template>
