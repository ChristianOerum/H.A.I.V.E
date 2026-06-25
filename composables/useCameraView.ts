const LS_KEY = 'haive-camera-view'
const LS_LOCK_KEY = 'haive-camera-locked'

export interface SavedCameraView {
  position: [number, number, number]
}

// Module-level singleton state — shared across all useCameraView() calls.
const savedView = ref<SavedCameraView | null>(null)
const isLocked = ref(false)
const _saveCallback = ref<(() => void) | null>(null)

// Load persisted state from localStorage on first module evaluation (client only).
if (import.meta.client) {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) {
    try {
      savedView.value = JSON.parse(raw)
    } catch {
      // ignore malformed data
    }
  }
  isLocked.value = localStorage.getItem(LS_LOCK_KEY) === 'true'
}

export function useCameraView() {
  const hasSaved = computed(() => !!savedView.value)

  /** Called by SceneRoot/SceneCameraController to register the capture function. */
  function registerSaveCallback(cb: () => void) {
    _saveCallback.value = cb
  }

  /** Triggered by the UI button — delegates to the registered callback. */
  function saveView() {
    _saveCallback.value?.()
  }

  /** Called internally by SceneCameraController once it has captured the camera state. */
  function persistView(position: [number, number, number]) {
    savedView.value = { position }
    if (import.meta.client) {
      localStorage.setItem(LS_KEY, JSON.stringify(savedView.value))
    }
  }

  function toggleLock() {
    isLocked.value = !isLocked.value
    if (import.meta.client) {
      localStorage.setItem(LS_LOCK_KEY, String(isLocked.value))
    }
  }

  return { savedView, hasSaved, isLocked, toggleLock, saveView, registerSaveCallback, persistView }
}
