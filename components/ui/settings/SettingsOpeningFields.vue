<script setup lang="ts">
import { Icon } from '@iconify/vue'
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

    <template v-if="isDoor">
      <div class="col-span-2 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium">Show door</div>
          <div class="field-hint">Draw the door itself, not just the gap in the wall.</div>
        </div>
        <ToggleSwitch :on="!!opening.doorLeaf" label="Show door" @toggle="fp.updateOpening(opening.id, { doorLeaf: !opening.doorLeaf })" />
      </div>

      <template v-if="opening.doorLeaf">
        <SettingsField label="Open" hint="0° is closed, 90° wide open against the wall." class="col-span-2">
          <SettingsNumber
            label="Open"
            :value="opening.doorAngle ?? 90"
            :step="5"
            :min="0"
            :max="180"
            unit="°"
            @change="(v) => fp.updateOpening(opening.id, { doorAngle: v ?? 90 })"
          />
        </SettingsField>
        <button
          class="btn-touch gap-2 text-sm"
          @click="fp.updateOpening(opening.id, { doorHinge: opening.doorHinge === 'end' ? 'start' : 'end' })"
        >
          <Icon icon="mdi:flip-horizontal" width="18" height="18" />
          Flip hinge
        </button>
        <button
          class="btn-touch gap-2 text-sm"
          @click="fp.updateOpening(opening.id, { doorSwing: opening.doorSwing === 'out' ? 'in' : 'out' })"
        >
          <Icon icon="mdi:flip-vertical" width="18" height="18" />
          Flip swing
        </button>
      </template>
    </template>
  </div>
</template>
