<script setup lang="ts">
import { Icon } from '@iconify/vue'

/** Shared modal shell for the settings dialogs (library, import, add device, confirmations). */
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}>(), {
  size: 'md',
})
const emit = defineEmits<{ close: [] }>()

const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4"
        @pointerdown.self="emit('close')"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          class="w-full max-h-[calc(100dvh-1.5rem)] sm:max-h-[88dvh] flex flex-col bg-bg-panel text-fg rounded-3xl border border-fg/10 shadow-2xl overflow-hidden"
          :class="WIDTH[size]"
        >
          <div class="flex items-start gap-3 pl-5 pr-2 pt-4 pb-3 shrink-0">
            <div class="flex-1 min-w-0 pt-1">
              <h2 class="text-base font-semibold leading-tight">{{ title }}</h2>
              <p v-if="subtitle" class="text-xs text-fg-muted mt-0.5">{{ subtitle }}</p>
            </div>
            <button class="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-fg-muted active:bg-bg-elevated" aria-label="Close" @click="emit('close')">
              <Icon icon="mdi:close" width="20" height="20" />
            </button>
          </div>
          <slot name="toolbar" />
          <div class="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
            <slot />
          </div>
          <div v-if="$slots.footer" class="shrink-0 flex gap-2 px-5 py-4 border-t border-fg/10">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
