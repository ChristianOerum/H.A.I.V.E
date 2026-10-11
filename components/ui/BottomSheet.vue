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

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

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
      role="dialog"
      aria-modal="true"
      class="absolute left-0 right-0 bottom-0 mx-auto w-full max-w-2xl z-20 bg-bg-panel text-fg border border-b-0 border-fg/10 rounded-t-3xl shadow-2xl max-h-[78%] flex flex-col touch-none"
      :style="sheetStyle"
    >
      <!-- Drag handle row: the whole strip is draggable; close button sits at the right -->
      <div class="relative h-11 shrink-0">
        <div
          class="absolute inset-0 flex justify-center items-center cursor-grab active:cursor-grabbing select-none"
          @pointerdown="onDragStart"
          @pointermove="onDragMove"
          @pointerup="onDragEnd"
          @pointercancel="onDragEnd"
        >
          <div class="w-12 h-1.5 rounded-full bg-fg/20" />
        </div>
        <button
          class="absolute right-2 top-1 w-11 h-11 flex items-center justify-center rounded-full text-fg-muted active:bg-bg-elevated"
          aria-label="Close"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <!-- Content scrolls; drag is restricted to the handle to avoid scroll conflicts -->
      <div class="px-4 sm:px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto touch-pan-y">
        <slot />
      </div>
    </div>
  </Transition>
</template>
