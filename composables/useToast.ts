export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  icon?: string
}

// Module-level singleton so any component (or composable) can raise a toast
// without prop-drilling; ToastHost renders the queue.
const toasts = ref<Toast[]>([])
let nextId = 1

const DURATION_MS: Record<ToastKind, number> = {
  info: 2500,
  success: 2000,
  error: 5000,
}
const MAX_VISIBLE = 3

export function useToast() {
  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function show(message: string, kind: ToastKind = 'info', icon?: string) {
    if (!import.meta.client) return
    // Collapse identical messages (e.g. repeated failures while offline)
    // instead of stacking duplicates.
    if (toasts.value.some((t) => t.message === message && t.kind === kind)) return
    const id = nextId++
    toasts.value = [...toasts.value, { id, kind, message, icon }].slice(-MAX_VISIBLE)
    setTimeout(() => dismiss(id), DURATION_MS[kind])
  }

  return {
    toasts: readonly(toasts),
    show,
    dismiss,
    success: (message: string, icon?: string) => show(message, 'success', icon),
    error: (message: string, icon?: string) => show(message, 'error', icon),
  }
}
