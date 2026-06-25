<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dragY = ref(0)
const dragging = ref(false)
let startY = 0
let startT = 0
let pointerId: number | null = null

const CLOSE_THRESHOLD_PX = 110
const CLOSE_VELOCITY_PX_PER_MS = 0.4

function onDragStart(e: PointerEvent) {
  dragging.value = true
  startY = e.clientY
  startT = performance.now()
  pointerId = e.pointerId
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onDragMove(e: PointerEvent) {
  if (!dragging.value || pointerId !== e.pointerId) return
  dragY.value = Math.max(0, e.clientY - startY)
}
function onDragEnd(e: PointerEvent) {
  if (!dragging.value || pointerId !== e.pointerId) return
  const dy = dragY.value
  const dt = Math.max(1, performance.now() - startT)
  const velocity = dy / dt
  dragging.value = false
  pointerId = null
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  if (dy > CLOSE_THRESHOLD_PX || velocity > CLOSE_VELOCITY_PX_PER_MS) {
    emit('close')
  }
  dragY.value = 0
}

// Reset transient drag state whenever the sheet opens/closes externally
watch(() => props.open, (v) => {
  if (!v) {
    dragY.value = 0
    dragging.value = false
    pointerId = null
  }
})

const sheetStyle = computed(() =>
  dragging.value
    ? { transform: `translateY(${dragY.value}px)`, transition: 'none' }
    : {},
)
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="open"
      class="absolute left-0 right-0 bottom-0 z-20 bg-bg-panel text-fg border-t border-bg-elevated rounded-t-2xl shadow-2xl max-h-[70%] flex flex-col touch-none"
      :style="sheetStyle"
    >
      <!-- Drag handle: large hit area so it's easy to grab -->
      <div
        class="flex justify-center py-3 cursor-grab active:cursor-grabbing select-none"
        @pointerdown="onDragStart"
        @pointermove="onDragMove"
        @pointerup="onDragEnd"
        @pointercancel="onDragEnd"
      >
        <div class="w-14 h-1.5 rounded-full bg-bg-elevated" />
      </div>
      <!-- Content scrolls; drag is restricted to the handle to avoid scroll conflicts -->
      <div class="px-6 pb-6 overflow-y-auto">
        <slot />
      </div>
    </div>
  </Transition>
</template>
