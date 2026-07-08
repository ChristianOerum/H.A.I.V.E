/**
 * Subscribes to the server's SSE `/api/events` stream and refreshes local
 * stores when other clients save changes. Auto-reconnects on drop.
 *
 * Skips its own store refresh when the store is dirty (editor mid-edit),
 * so a remote save can't clobber unsaved local changes.
 */
export function useLiveSync() {
  if (!import.meta.client) return

  const layout = useLayoutStore()
  const fp = useFloorplanStore()
  const device = useDeviceConfig()

  let es: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (es) return
    try {
      es = new EventSource('/api/events')
    } catch {
      scheduleRetry()
      return
    }

    es.onmessage = async (msg) => {
      let data: { type?: string } = {}
      try { data = JSON.parse(msg.data) } catch { return }

      if (data.type === 'layout' && !layout.dirty && !layout.editMode) {
        await layout.load().catch(() => {})
      } else if (data.type === 'floorplan' && !fp.dirty && !fp.editMode) {
        await fp.load().catch(() => {})
      } else if (data.type === 'device') {
        const prev = device.configured.value
        await device.refresh().catch(() => {})
        // If configured status flipped (setup finished or factory reset),
        // reload the page so the setup gate re-evaluates cleanly.
        if (prev !== device.configured.value) location.reload()
      }
    }

    es.onerror = () => {
      teardown()
      scheduleRetry()
    }
  }

  function teardown() {
    if (es) { es.close(); es = null }
  }

  function scheduleRetry() {
    if (retryTimer) return
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, 3000)
  }

  onMounted(connect)
  onBeforeUnmount(() => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    teardown()
  })
}
