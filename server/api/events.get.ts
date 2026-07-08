import { createEventStream } from 'h3'
import { assertLanClient } from '~~/server/utils/lanGuard'
import { subscribe } from '~~/server/utils/eventBus'

/**
 * Server-Sent Events stream. Each connected browser receives a JSON payload
 * whenever another client saves layout / floorplan / device config, so all
 * screens stay in sync without a page reload.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const stream = createEventStream(event)

  const unsub = subscribe((e) => {
    // Fire-and-forget: h3's push is async but we don't need to await inside
    // the subscriber (would block other subscribers).
    stream.push({ data: JSON.stringify(e) }).catch(() => {})
  })

  // Heartbeat every 25s so proxies / kiosk browsers don't idle-drop the socket.
  const heartbeat = setInterval(() => {
    stream.push({ event: 'ping', data: '{}' }).catch(() => {})
  }, 25_000)

  stream.onClosed(async () => {
    clearInterval(heartbeat)
    unsub()
    await stream.close()
  })

  return stream.send()
})
