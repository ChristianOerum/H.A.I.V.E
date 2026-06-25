import { getRequestIP, createError } from 'h3'

/**
 * Returns WiFi credentials to LAN clients only, formatted for QR encoding.
 * Mirrors the LAN-only gate used by /api/ha/token.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const rawIp = getRequestIP(event, { xForwardedFor: false }) || ''
  const ip = rawIp.replace(/^::ffff:/, '')

  const allowed = (config.allowedLocalPrefixes as string[]).map((p) => p.trim()).filter(Boolean)
  const ok =
    ip === '' ||
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === 'localhost' ||
    allowed.some((p) => ip.startsWith(p))

  if (!ok) {
    throw createError({
      statusCode: 403,
      statusMessage: `Forbidden (non-LAN, ip=${rawIp})`,
    })
  }

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
