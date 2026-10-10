<script setup lang="ts">
/** Titled group of related fields inside a tab or an expanded item. */
defineProps<{
  title?: string
  hint?: string
  /** Render the body inside a bordered card. */
  card?: boolean
}>()
</script>

<template>
  <section class="flex flex-col gap-2.5">
    <div v-if="title || $slots.actions" class="flex items-center justify-between gap-2">
      <h3 v-if="title" class="section-label">{{ title }}</h3>
      <div class="flex items-center gap-1"><slot name="actions" /></div>
    </div>
    <div :class="card ? 'rounded-xl border border-fg/10 bg-bg-elevated/30 p-3 flex flex-col gap-3' : 'flex flex-col gap-3'">
      <slot />
    </div>
    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </section>
</template>
