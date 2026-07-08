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
    stream.push({ data: JSON.stringify(e) })
  })

  stream.onClosed(async () => {
    unsub()
    await stream.close()
  })

  // Nudge — helps some proxies flush headers.
  await stream.push({ event: 'hello', data: '{}' })

  return stream.send()
})
