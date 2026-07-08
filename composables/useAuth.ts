/**
 * Manages toolbar authentication state.
 * Unlocked state is persisted in sessionStorage so it survives page navigation
 * but resets when the tab/kiosk session is closed or after AUTH_TTL_MS.
 * When no PIN is configured in the setup screen, auth is disabled and unlocked
 * is always true.
 */
const AUTH_TTL_MS = 60 * 60 * 1000 // 1 hour

export const useAuth = () => {
  const { authEnabled } = useDeviceConfig()
  const unlocked = useState<boolean>('auth:unlocked', () => !authEnabled.value)

  const SESSION_KEY = 'haive:unlocked'
  let expiryTimer: ReturnType<typeof setTimeout> | null = null

  const _scheduleExpiry = (expiresAt: number) => {
    if (!import.meta.client) return
    if (expiryTimer) clearTimeout(expiryTimer)
    const delay = expiresAt - Date.now()
    if (delay <= 0) { _expire(); return }
    expiryTimer = setTimeout(_expire, delay)
  }

  const _expire = () => {
    unlocked.value = false
    if (import.meta.client) sessionStorage.removeItem(SESSION_KEY)
  }

  if (import.meta.client && !unlocked.value) {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) {
      const expiresAt = parseInt(raw, 10)
      if (!isNaN(expiresAt) && Date.now() < expiresAt) {
        unlocked.value = true
        _scheduleExpiry(expiresAt)
      } else {
        sessionStorage.removeItem(SESSION_KEY)
      }
    }
  }

  const verify = async (pin: string): Promise<boolean> => {
    try {
      await $fetch('/api/auth/verify', { method: 'POST', body: { pin } })
      const expiresAt = Date.now() + AUTH_TTL_MS
      unlocked.value = true
      if (import.meta.client) {
        sessionStorage.setItem(SESSION_KEY, String(expiresAt))
        _scheduleExpiry(expiresAt)
      }
      return true
    } catch {
      return false
    }
  }

  const lock = () => {
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null }
    unlocked.value = false
    if (import.meta.client) sessionStorage.removeItem(SESSION_KEY)
  }

  return { unlocked: readonly(unlocked), verify, lock }
}
