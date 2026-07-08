/**
 * Mock mode is a fully self-contained sandbox: it seeds from the server config
 * once, but all edits are persisted to localStorage instead of the server, so
 * previewing/experimenting with `?mock=1` never mutates the real deployment data.
 */
export function isMockMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('mock')
}
