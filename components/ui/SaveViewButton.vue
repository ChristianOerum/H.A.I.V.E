<script setup lang="ts">
import { Icon } from '@iconify/vue'

const { saveView, toggleLock, isLocked } = useCameraView()

const saveFlash = ref(false)
const showDropdown = ref(false)
const lockItemRef = ref<HTMLElement | null>(null)
const lockItemActive = ref(false)

let holdTimer: ReturnType<typeof setTimeout> | null = null
let holdFired = false
let startY = 0
let swiped = false
let lastPointerX = 0
let lastPointerY = 0

function clearHoldTimer() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
}

// Window-level listeners added on each pointerdown, removed on up/cancel.
// These survive DOM re-renders (unlike setPointerCapture which can be dropped
// when Vue patches the button element during showDropdown state change).
function onWindowMove(e: PointerEvent) {
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  if (swiped) return

  if (holdFired) {
    checkLockItem(e.clientX, e.clientY)
    return
  }

  // Pre-dropdown: swipe-down-to-lock shortcut
  if (e.clientY - startY > 44) {
    swiped = true
    clearHoldTimer()
    cleanupWindowListeners()
    doToggleLock()
  }
}

function checkLockItem(x: number, y: number) {
  if (!lockItemRef.value) return
  const r = lockItemRef.value.getBoundingClientRect()
  const over = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  lockItemActive.value = over
  if (over) { doToggleLock(); cleanupWindowListeners() }
}

function onWindowUp() {
  cleanupWindowListeners()
  clearHoldTimer()
  if (!swiped && !holdFired) {
    saveView()
    saveFlash.value = true
    setTimeout(() => (saveFlash.value = false), 1200)
  }
}

function cleanupWindowListeners() {
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointerup', onWindowUp)
  window.removeEventListener('pointercancel', onWindowUp)
  document.removeEventListener('touchmove', onDocTouchMove)
}

// touchmove + elementFromPoint: most reliable way to detect "finger over item"
// on mobile — works regardless of pointer capture or browser scroll decisions.
function onDocTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (!t) return
  lastPointerX = t.clientX
  lastPointerY = t.clientY
  if (!holdFired || !lockItemRef.value) return
  const hit = document.elementFromPoint(t.clientX, t.clientY)
  if (hit && (hit === lockItemRef.value || lockItemRef.value.contains(hit as Node))) {
    doToggleLock()
    cleanupWindowListeners()
  }
}

function onPointerDown(e: PointerEvent) {
  if (isLocked.value) return
  startY = e.clientY
  swiped = false
  holdFired = false
  cleanupWindowListeners()
  holdTimer = setTimeout(async () => {
    holdFired = true
    showDropdown.value = true
    // After Vue renders the dropdown, check if the finger is already over the
    // lock item — fixes the case where the pointer stopped moving before the
    // DOM update completed and no further pointermove events will fire.
    await nextTick()
    checkLockItem(lastPointerX, lastPointerY)
  }, 400)
  window.addEventListener('pointermove', onWindowMove)
  window.addEventListener('pointerup', onWindowUp, { once: true })
  window.addEventListener('pointercancel', onWindowUp, { once: true })
  document.addEventListener('touchmove', onDocTouchMove, { passive: true })
}

function doToggleLock() {
  toggleLock()
  showDropdown.value = false
  lockItemActive.value = false
}

// Document listener active while dropdown is open — handles mouse hover
// after the finger/button has been released (window listener already removed).
function onDocMove(e: PointerEvent) {
  checkLockItem(e.clientX, e.clientY)
}

watch(showDropdown, (open) => {
  if (open) {
    document.addEventListener('pointermove', onDocMove)
  } else {
    document.removeEventListener('pointermove', onDocMove)
    lockItemActive.value = false
  }
})

onBeforeUnmount(() => {
  cleanupWindowListeners()
  document.removeEventListener('pointermove', onDocMove)
})

const label = computed(() => (saveFlash.value ? 'Saved!' : 'Save View'))
</script>

<template>
  <div class="relative">
    <!-- Locked state: only the lock icon, tap to unlock -->
    <button
      v-if="isLocked"
      class="btn-touch !px-3 text-sm select-none text-orange-400 border border-orange-400/50"
      title="Camera locked — tap to unlock"
      @click="doToggleLock"
    >
      <Icon icon="mdi:lock" width="18" height="18" />
    </button>

    <!-- Normal state: camera icon + label with hold/swipe behaviour -->
    <button
      v-else
      class="btn-touch !px-3 gap-2 text-sm select-none touch-none"
      :class="saveFlash ? 'text-accent border border-accent/50' : 'text-fg-muted'"
      title="Tap to save view · Hold for options · Swipe down to lock"
      @pointerdown="onPointerDown"
    >
      <Icon icon="mdi:camera-iris" width="18" height="18" />
      <span class="hidden md:inline">{{ label }}</span>
    </button>

    <!-- Backdrop — closes dropdown when interacting outside -->
    <Transition
      enter-from-class="opacity-0"
      enter-active-class="transition-opacity duration-100"
      leave-to-class="opacity-0"
      leave-active-class="transition-opacity duration-100"
    >
      <div
        v-if="showDropdown"
        class="fixed inset-0 z-40"
        @pointerdown="showDropdown = false"
      />
    </Transition>

    <!-- Dropdown: item activates on hover/touch-slide, never on click -->
    <Transition
      enter-from-class="opacity-0"
      enter-active-class="transition-opacity duration-150 ease-out"
      leave-to-class="opacity-0"
      leave-active-class="transition-opacity duration-100 ease-in"
    >
      <div
        v-if="showDropdown"
        class="absolute top-full mt-2 right-0 z-50 bg-bg-panel border border-fg-muted/20 rounded-xl shadow-xl overflow-hidden min-w-[9rem]"
      >
        <div
          ref="lockItemRef"
          class="flex items-center gap-3 px-4 py-3 text-sm text-fg cursor-default select-none transition-colors"
          :class="lockItemActive ? 'bg-bg-elevated text-accent' : ''"
          @pointerup.stop="doToggleLock"
        >
          <Icon icon="mdi:lock" width="18" height="18" />
          Lock Camera
        </div>
      </div>
    </Transition>
  </div>
</template>
