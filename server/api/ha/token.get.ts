import { assertLanClient } from '~~/server/utils/lanGuard'
import { resolveHaTarget } from '~~/server/utils/haTarget'

/**
 * Tells a browser how to reach Home Assistant. No credentials are returned —
 * clients talk to HA through the same-origin `/api/ha/proxy` bridge, so the
 * token stays on the server and every screen on the network behaves the same.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const target = await resolveHaTarget()

  return {
    configured: target.source !== 'none',
    source: target.source,
    /** Same-origin base URL; the HA client appends `/api/websocket` to it. */
    proxyBase: '/api/ha/proxy',
  }
})
