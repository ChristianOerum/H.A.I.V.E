import { getRequestIP, createError } from 'h3'

/**
 * Returns the HA URL + long-lived token to LAN clients only.
 * Token stays on the server side until requested by a trusted local client.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const rawIp = getRequestIP(event, { xForwardedFor: false }) || ''
  // Normalize IPv6-mapped IPv4 (::ffff:192.168.1.5 -> 192.168.1.5)
  const ip = rawIp.replace(/^::ffff:/, '')

  const allowed = (config.allowedLocalPrefixes as string[]).map((p) => p.trim()).filter(Boolean)
  const ok =
    ip === '' ||             // local socket on some platforms
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

  if (!config.haToken) {
    return { url: '', token: '', mock: true as const }
  }

  return {
    url: config.haUrl as string,
    token: config.haToken as string,
  }
})
