import { assertLanClient } from '~~/server/utils/lanGuard'

/**
 * Returns WiFi credentials to LAN clients only, formatted for QR encoding.
 * Mirrors the LAN-only gate used by /api/ha/token.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const config = useRuntimeConfig()

  const ssid = (process.env.WIFI_SSID ?? config.wifiSsid ?? '') as string
  if (!ssid) {
    return { configured: false as const }
  }

  return {
    configured: true as const,
    ssid,
    password: (process.env.WIFI_PASSWORD ?? config.wifiPassword ?? '') as string,
    security: (process.env.WIFI_SECURITY ?? config.wifiSecurity ?? 'WPA') as string,
    hidden: (process.env.WIFI_HIDDEN ?? String(config.wifiHidden)) === 'true',
  }
})
