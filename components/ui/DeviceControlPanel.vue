<script setup lang="ts">
import { getAdapter } from '~/utils/deviceRegistry'

const entities = useEntitiesStore()
const layout = useLayoutStore()

const entity = computed(() =>
  layout.selectedEntityId ? entities.get(layout.selectedEntityId) : undefined,
)
const adapter = computed(() => (entity.value ? getAdapter(entity.value) : undefined))
const open = computed(() => !!entity.value && !!adapter.value)

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
      class="absolute inset-0 bg-black/30"
      @pointerdown="close"
    />
  </Transition>

  <BottomSheet :open="open" @close="close">
    <component
      v-if="entity && adapter"
      :is="adapter.controls"
      :entity="entity"
    />
  </BottomSheet>
</template>
