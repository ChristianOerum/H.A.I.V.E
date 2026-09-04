import { resolveHaTarget } from '~~/server/utils/haTarget'

/**
 * Transparent WebSocket bridge to the Home Assistant WebSocket API.
 *
 * Browsers connect here instead of straight to Home Assistant, which means:
 *  - the HA token (or the Supervisor token, when running as an add-on) stays on
 *    the server and is never handed to a client,
 *  - every screen on the network works as long as it can reach HAIVE, even if
 *    it cannot reach Home Assistant directly.
 *
 * The bridge is byte-for-byte transparent except for the client's `auth` frame,
 * where the placeholder access token is swapped for the real one.
 */

interface Upstream {
  socket: WebSocket | null
  /** Frames received from the browser before the upstream socket was ready. */
  pending: string[]
  token: string
  closed: boolean
}

const upstreams = new Map<string, Upstream>()

/** Swaps the placeholder token in the client's auth frame for the real one. */
function withRealToken(frame: string, token: string): string {
  if (!frame.includes('"auth"')) return frame
  try {
    const msg = JSON.parse(frame) as Record<string, unknown>
    if (msg?.type !== 'auth') return frame
    return JSON.stringify({ ...msg, access_token: token })
  } catch {
    return frame
  }
}

/**
 * Either side can vanish mid-frame (screen unplugged, HA restarting), and both
 * `peer` and the upstream socket throw on a dead connection. Nothing useful can
 * be done about it, so swallow it rather than crashing the server.
 */
function safe(fn: () => void) {
  try {
    fn()
  } catch {
    /* connection already gone */
  }
}

function flush(up: Upstream) {
  const socket = up.socket
  if (!socket || socket.readyState !== 1) return
  for (const frame of up.pending.splice(0)) safe(() => socket.send(withRealToken(frame, up.token)))
}

export default defineWebSocketHandler({
  open(peer) {
    const up: Upstream = { socket: null, pending: [], token: '', closed: false }
    upstreams.set(peer.id, up)

    void (async () => {
      const target = await resolveHaTarget()
      if (up.closed) return

      if (target.source === 'none') {
        safe(() => peer.send(JSON.stringify({ type: 'auth_invalid', message: 'Home Assistant is not configured' })))
        safe(() => peer.close(1011, 'Home Assistant is not configured'))
        upstreams.delete(peer.id)
        return
      }

      up.token = target.token
      const wsUrl = `${target.baseUrl.replace(/^http/, 'ws')}/api/websocket`

      let socket: WebSocket
      try {
        socket = new WebSocket(wsUrl)
      } catch {
        safe(() => peer.close(1011, 'Cannot reach Home Assistant'))
        upstreams.delete(peer.id)
        return
      }
      up.socket = socket

      socket.addEventListener('open', () => flush(up))
      socket.addEventListener('message', (ev: MessageEvent) => {
        safe(() => peer.send(typeof ev.data === 'string' ? ev.data : String(ev.data)))
      })
      socket.addEventListener('close', () => {
        upstreams.delete(peer.id)
        if (!up.closed) safe(() => peer.close())
      })
      socket.addEventListener('error', () => {
        upstreams.delete(peer.id)
        if (!up.closed) safe(() => peer.close(1011, 'Home Assistant connection failed'))
      })
    })()
  },

  message(peer, message) {
    const up = upstreams.get(peer.id)
    if (!up) return
    const frame = message.text()
    const socket = up.socket
    if (socket && socket.readyState === 1) {
      flush(up)
      safe(() => socket.send(withRealToken(frame, up.token)))
    } else {
      up.pending.push(frame)
    }
  },

  close(peer) {
    const up = upstreams.get(peer.id)
    if (!up) return
    up.closed = true
    upstreams.delete(peer.id)
    safe(() => up.socket?.close())
  },

  error(peer) {
    const up = upstreams.get(peer.id)
    if (!up) return
    up.closed = true
    upstreams.delete(peer.id)
    safe(() => up.socket?.close())
  },
})
