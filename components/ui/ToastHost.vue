<script setup lang="ts">
import { Icon } from '@iconify/vue'

const { toasts, dismiss } = useToast()

const DEFAULT_ICON = {
  info: 'mdi:information-outline',
  success: 'mdi:check-circle-outline',
  error: 'mdi:alert-circle-outline',
} as const
</script>

<template>
  <div
    class="absolute bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none w-[min(28rem,calc(100%-2rem))]"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150 ease-in absolute"
      leave-to-class="opacity-0"
      move-class="transition-transform duration-200"
    >
      <button
        v-for="t in toasts"
        :key="t.id"
        class="surface pointer-events-auto flex items-center gap-3 rounded-2xl pl-3 pr-4 py-2.5 text-sm text-fg text-left max-w-full"
        @click="dismiss(t.id)"
      >
        <Icon
          :icon="t.icon ?? DEFAULT_ICON[t.kind]"
          width="20"
          height="20"
          class="shrink-0"
          :class="t.kind === 'error' ? 'text-red-400' : 'text-accent'"
        />
        <span class="leading-snug">{{ t.message }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>
