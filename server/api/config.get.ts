import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig, type WifiSecurity } from '~~/server/utils/deviceConfig'

interface MasterPublicConfig {
  haUrl: string
  haConfigured: boolean
  authEnabled: boolean
  wifi: { configured: boolean; ssid: string; security: WifiSecurity; hidden: boolean }
}

/**
 * Returns the current (non-secret) device configuration for the setup screen and
 * settings panel. Secrets (HA token, WiFi password, PIN) are never returned —
 * only whether they are present.
 *
 * On a Slave, the HA URL / PIN-enabled flag / WiFi info are mirrored from the
 * Master so all screens present the same lock, WiFi button and camera URLs.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const cfg = await readDeviceConfig()

  let haUrl = cfg.haUrl
  let haConfigured = !!cfg.haToken
  let authEnabled = !!cfg.authPin
  let wifi = {
    configured: !!cfg.wifi.ssid,
    ssid: cfg.wifi.ssid,
    security: cfg.wifi.security,
    hidden: cfg.wifi.hidden,
  }

  if (cfg.role === 'slave' && cfg.masterUrl) {
    try {
      const master = await $fetch<MasterPublicConfig>(`${cfg.masterUrl}/api/config`)
      haUrl = master.haUrl
      haConfigured = master.haConfigured
      authEnabled = master.authEnabled
      wifi = master.wifi
    } catch {
      // Master unreachable — fall back to whatever we have locally.
    }
  }

  return {
    configured: cfg.configured,
    role: cfg.role,
    haUrl,
    allowedLocalPrefixes: cfg.allowedLocalPrefixes,
    masterUrl: cfg.masterUrl,
    haConfigured,
    authEnabled,
    wifi,
  }
})
