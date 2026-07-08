import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig } from '~~/server/utils/deviceConfig'
import { proxyToMaster } from '~~/server/utils/masterProxy'

/**
 * Returns the HA URL + long-lived token to LAN clients only.
 *
 * - Master: serves its own persisted (or env-provided) HA credentials.
 * - Slave: proxies to the Master so every screen uses the same connection.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const proxied = await proxyToMaster(event, '/api/ha/token')
  if (proxied !== null) return proxied

  const cfg = await readDeviceConfig()
  if (!cfg.haToken) {
    return { url: '', token: '', mock: true as const }
  }

  return {
    url: cfg.haUrl,
    token: cfg.haToken,
  }
})
