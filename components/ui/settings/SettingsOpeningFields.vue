<script setup lang="ts">
import type { FloorplanOpening } from '~/stores/floorplan'

const props = defineProps<{ opening: FloorplanOpening }>()
const fp = useFloorplanStore()

const isDoor = computed(() => props.opening.type === 'door')
</script>

<template>
  <div class="grid grid-cols-2 gap-3">
    <SettingsField label="Width">
      <SettingsNumber
        label="Width"
        :value="opening.width"
        :step="0.05"
        :min="0.3"
        unit="m"
        @change="(v) => fp.updateOpening(opening.id, { width: v })"
      />
    </SettingsField>
    <SettingsField label="Height">
      <SettingsNumber
        label="Height"
        :value="opening.height ?? (isDoor ? 1.2 : 0.52)"
        :step="0.05"
        :min="0.1"
        unit="m"
        @change="(v) => fp.updateOpening(opening.id, { height: v })"
      />
    </SettingsField>
    <SettingsField v-if="!isDoor" label="Sill height" hint="Distance from the floor to the bottom of the window." class="col-span-2">
      <SettingsNumber
        label="Sill height"
        :value="opening.sill ?? 0.34"
        :step="0.05"
        :min="0"
        unit="m"
        @change="(v) => fp.updateOpening(opening.id, { sill: v })"
      />
    </SettingsField>
  </div>
</template>
