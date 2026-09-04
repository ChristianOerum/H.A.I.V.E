import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig } from '~~/server/utils/deviceConfig'
import { resolveHaTarget } from '~~/server/utils/haTarget'

/**
 * Returns the current (non-secret) server configuration for the setup screen and
 * settings panel. Secrets (HA token, WiFi password, PIN) are never returned —
 * only whether they are present.
 *
 * There is exactly one HAIVE server, so every screen that asks gets the same
 * answer and therefore the same lock, WiFi button and camera behaviour.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const cfg = await readDeviceConfig()
  const ha = await resolveHaTarget()

  return {
    configured: cfg.configured,
    haUrl: ha.source === 'supervisor' ? '' : cfg.haUrl,
    haSource: ha.source,
    haConfigured: ha.source !== 'none',
    allowedLocalPrefixes: cfg.allowedLocalPrefixes,
    authEnabled: !!cfg.authPin,
    wifi: {
      configured: !!cfg.wifi.ssid,
      ssid: cfg.wifi.ssid,
      security: cfg.wifi.security,
      hidden: cfg.wifi.hidden,
    },
  }
})
