import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig } from '~~/server/utils/deviceConfig'

/**
 * Returns WiFi credentials to LAN clients only, formatted for QR encoding.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

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
