import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig } from '~~/server/utils/deviceConfig'
import { proxyToMaster } from '~~/server/utils/masterProxy'

/**
 * Returns WiFi credentials to LAN clients only, formatted for QR encoding.
 *
 * - Master: serves its own persisted WiFi info.
 * - Slave: proxies to the Master so every screen shows the same network.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const proxied = await proxyToMaster(event, '/api/wifi')
  if (proxied !== null) return proxied

  const { wifi } = await readDeviceConfig()

  if (!wifi.ssid) {
    return { configured: false as const }
  }

  return {
    configured: true as const,
    ssid: wifi.ssid,
    password: wifi.password,
    security: wifi.security,
    hidden: wifi.hidden,
  }
})
