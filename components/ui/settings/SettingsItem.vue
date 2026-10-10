<script setup lang="ts">
import { Icon } from '@iconify/vue'

/**
 * Expandable list row used by every settings list (rooms, furniture, devices).
 * Tapping the row toggles it; the default slot is the editor shown when open.
 */
defineProps<{
  title: string
  subtitle?: string
  icon?: string
  /** CSS colour for the leading icon chip (e.g. a room's floor colour). */
  iconColor?: string
  open?: boolean
  /** Visually nested (items inside a furniture group). */
  nested?: boolean
}>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <div
    class="shrink-0 rounded-xl border transition-colors"
    :class="open ? 'border-accent/50 bg-accent/5' : nested ? 'border-transparent bg-bg/60' : 'border-fg/10 bg-bg-elevated/40'"
  >
    <div
      class="flex items-center gap-3 pl-3 pr-1.5 min-h-[3.25rem] cursor-pointer select-none"
      role="button"
      :aria-expanded="open"
      @click="emit('toggle')"
    >
      <slot name="leading">
        <div
          v-if="icon || iconColor"
          class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center"
          :class="open ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-fg-muted'"
          :style="iconColor ? { background: iconColor } : undefined"
        >
          <Icon v-if="icon" :icon="icon" width="18" height="18" />
        </div>
      </slot>
      <div class="flex-1 min-w-0 py-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-sm font-medium text-fg truncate">{{ title }}</span>
          <slot name="badges" />
        </div>
        <p v-if="subtitle || $slots.subtitle" class="text-[11px] text-fg-muted truncate">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>
      <div class="flex items-center shrink-0" @click.stop>
        <slot name="actions" />
      </div>
      <Icon
        icon="mdi:chevron-down"
        width="20"
        height="20"
        class="shrink-0 text-fg-muted transition-transform duration-150"
        :class="open ? 'rotate-180' : ''"
      />
    </div>
    <div v-if="open" class="border-t border-fg/10 px-3 pt-3 pb-4 flex flex-col gap-4" @click.stop>
      <slot />
    </div>
  </div>
</template>
