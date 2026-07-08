import type { H3Event } from 'h3'
import { getRequestIP, createError } from 'h3'
import { readDeviceConfig } from './deviceConfig'

/**
 * Throws a 403 unless the request originates from an allowed LAN client.
 * The allowed prefixes come from the persisted device config (Master), falling
 * back to the env-derived defaults. Loopback is always permitted.
 */
export async function assertLanClient(event: H3Event): Promise<void> {
  const cfg = await readDeviceConfig()
  const rawIp = getRequestIP(event, { xForwardedFor: false }) || ''
  // Normalize IPv6-mapped IPv4 (::ffff:192.168.1.5 -> 192.168.1.5)
  const ip = rawIp.replace(/^::ffff:/, '')

  const allowed = cfg.allowedLocalPrefixes.map((p) => p.trim()).filter(Boolean)
  const ok =
    ip === '' || // local socket on some platforms
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
}
