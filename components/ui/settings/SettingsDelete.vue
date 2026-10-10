<script setup lang="ts">
import { Icon } from '@iconify/vue'

/**
 * Two-tap delete: the first tap arms the button ("Delete?"), the second
 * confirms. Disarms itself after a few seconds so a stray tap is harmless.
 */
defineProps<{ label?: string }>()
const emit = defineEmits<{ confirm: [] }>()

const armed = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function onClick() {
  if (armed.value) {
    if (timer) clearTimeout(timer)
    armed.value = false
    emit('confirm')
    return
  }
  armed.value = true
  timer = setTimeout(() => { armed.value = false }, 3000)
}
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
</script>

<template>
  <button
    type="button"
    class="shrink-0 h-9 flex items-center justify-center gap-1 rounded-lg text-xs font-semibold transition-colors"
    :class="armed ? 'px-2.5 bg-red-500 text-white' : 'w-9 text-fg-muted active:bg-red-500/15 active:text-red-400'"
    :aria-label="armed ? `Confirm delete ${label ?? ''}` : `Delete ${label ?? ''}`"
    :title="armed ? 'Tap again to delete' : `Delete ${label ?? ''}`"
    @click.stop="onClick"
  >
    <Icon :icon="armed ? 'mdi:check' : 'mdi:trash-can-outline'" width="18" height="18" />
    <span v-if="armed">Delete?</span>
  </button>
</template>
