import { readDeviceConfig } from './deviceConfig'
import { publish, type LiveEvent } from './eventBus'

/**
 * On a Slave, keeps a background SSE connection to the Master's `/api/events`
 * stream and republishes each event into this device's local bus, so browsers
 * connected to the Slave server also see Master-originated changes in real
 * time. Auto-reconnects with a small backoff on drop.
 *
 * A no-op on Masters, or before the device has been configured.
 */

let started = false
let currentMasterUrl = ''
let abort: AbortController | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

async function connectOnce(masterUrl: string): Promise<void> {
  abort = new AbortController()
  const res = await fetch(`${masterUrl}/api/events`, {
    headers: { accept: 'text/event-stream' },
    signal: abort.signal,
  })
  if (!res.ok || !res.body) throw new Error(`master SSE responded ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const dispatch = () => {
    if (!dataLines.length) { eventName = 'message'; return }
    const raw = dataLines.join('\n')
    dataLines = []
    const name = eventName
    eventName = 'message'
    if (name !== 'message') return // ignore heartbeats etc.
    try {
      const parsed = JSON.parse(raw) as LiveEvent
      if (parsed && typeof parsed === 'object' && 'type' in parsed) publish(parsed)
    } catch { /* ignore malformed */ }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      if (line === '') { dispatch(); continue }
      if (line.startsWith(':')) continue // SSE comment
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const val = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'data') dataLines.push(val)
      else if (field === 'event') eventName = val
    }
  }
}

async function runLoop(masterUrl: string): Promise<void> {
  while (currentMasterUrl === masterUrl) {
    try {
      await connectOnce(masterUrl)
    } catch {
      // Fall through to retry.
    }
    if (currentMasterUrl !== masterUrl) return
    await new Promise<void>((resolve) => {
      retryTimer = setTimeout(() => { retryTimer = null; resolve() }, 3000)
    })
  }
}

/**
 * Re-reads the device config and (re)starts / stops the upstream SSE bridge
 * so it always reflects the current role and master URL. Safe to call any
 * time — including on every local `device` bus event.
 */
export async function ensureMasterEvents(): Promise<void> {
  const cfg = await readDeviceConfig().catch(() => null)
  const wantUrl = cfg && cfg.role === 'slave' && cfg.masterUrl ? cfg.masterUrl : ''
  if (wantUrl === currentMasterUrl && started) return

  // Tear down any existing connection before starting the new one.
  currentMasterUrl = wantUrl
  if (abort) { try { abort.abort() } catch { /* noop */ } abort = null }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }

  started = true
  if (!wantUrl) return
  // Fire and forget — runLoop handles its own reconnects.
  void runLoop(wantUrl)
}
