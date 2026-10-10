<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { getAdapter } from '~/utils/deviceRegistry'

const entities = useEntitiesStore()
const layout = useLayoutStore()

const entity = computed(() =>
  layout.selectedEntityId ? entities.get(layout.selectedEntityId) : undefined,
)
const adapter = computed(() => (entity.value ? getAdapter(entity.value) : undefined))
const open = computed(() => !!entity.value && !!adapter.value)
const unavailable = computed(() => entity.value?.state === 'unavailable')

function close() {
  layout.select(null)
}
</script>

<template>
  <!-- Backdrop: tap anywhere outside the sheet to dismiss -->
  <Transition
    enter-active-class="transition-opacity duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-150"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="absolute inset-0 z-[15] bg-black/30"
      @pointerdown="close"
    />
  </Transition>

  <BottomSheet :open="open" @close="close">
    <template v-if="entity && adapter">
      <div
        v-if="unavailable"
        class="mb-4 flex items-center gap-3 rounded-2xl border border-orange-400/40 bg-orange-400/10 px-4 py-3 text-sm"
      >
        <Icon icon="mdi:lan-disconnect" width="20" height="20" class="shrink-0 text-orange-400" />
        <span>This device is unavailable in Home Assistant. Controls will work again once it reconnects.</span>
      </div>
      <!-- Keyed so switching devices remounts the controls (flushing any pending debounced change) -->
      <component
        :is="adapter.controls"
        :key="entity.entity_id"
        :entity="entity"
        :class="unavailable ? 'opacity-50 pointer-events-none' : ''"
      />
    </template>
  </BottomSheet>
</template>
