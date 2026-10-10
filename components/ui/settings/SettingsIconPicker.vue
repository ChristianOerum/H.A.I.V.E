<script setup lang="ts">
import { Icon } from '@iconify/vue'

/** Grid of common device icons plus a free-text field for any Iconify name. */
const props = defineProps<{
  value: string | undefined
  /** Icon used when no override is set. */
  auto: string
}>()
const emit = defineEmits<{ update: [value: string | undefined] }>()

const COMMON = [
  'mdi:lightbulb', 'mdi:ceiling-light', 'mdi:floor-lamp', 'mdi:led-strip-variant', 'mdi:desk-lamp',
  'mdi:thermostat', 'mdi:thermometer', 'mdi:radiator', 'mdi:air-conditioner', 'mdi:fan',
  'mdi:toggle-switch', 'mdi:power-plug', 'mdi:power-socket-eu', 'mdi:flash', 'mdi:water-pump',
  'mdi:lock', 'mdi:door', 'mdi:doorbell', 'mdi:window-open', 'mdi:garage',
  'mdi:blinds', 'mdi:curtains', 'mdi:motion-sensor', 'mdi:smoke-detector', 'mdi:camera',
  'mdi:television', 'mdi:speaker', 'mdi:remote', 'mdi:robot-vacuum', 'mdi:coffee',
  'mdi:washing-machine', 'mdi:tumble-dryer', 'mdi:water-percent', 'mdi:molecule-co2', 'mdi:weather-partly-cloudy',
]

const showAll = ref(false)
const visible = computed(() => (showAll.value ? COMMON : COMMON.slice(0, 14)))

function onCustom(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  emit('update', v || undefined)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="grid grid-cols-8 gap-1">
      <button
        type="button"
        class="col-span-2 h-10 flex items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors"
        :class="!value ? 'border-accent bg-accent/10 text-accent' : 'border-fg/10 text-fg-muted active:bg-bg-elevated'"
        title="Pick automatically from the device type"
        @click="emit('update', undefined)"
      >
        <Icon :icon="auto" width="18" height="18" />
        Auto
      </button>
      <button
        v-for="icon in visible"
        :key="icon"
        type="button"
        class="h-10 flex items-center justify-center rounded-lg border transition-colors"
        :class="value === icon ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-fg-muted active:bg-bg-elevated'"
        :aria-label="icon"
        :title="icon"
        @click="emit('update', icon)"
      >
        <Icon :icon="icon" width="20" height="20" />
      </button>
    </div>
    <div class="flex items-center gap-2">
      <input
        class="field-input font-mono text-xs"
        :value="value && !COMMON.includes(value) ? value : ''"
        placeholder="Other: any Iconify name, e.g. mdi:lamp"
        spellcheck="false"
        @change="onCustom"
      />
      <button type="button" class="field-action shrink-0" @click="showAll = !showAll">{{ showAll ? 'Fewer' : 'More icons' }}</button>
    </div>
  </div>
</template>
