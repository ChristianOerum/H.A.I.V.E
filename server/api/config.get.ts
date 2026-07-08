import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig } from '~~/server/utils/deviceConfig'

/**
 * Returns the current (non-secret) device configuration for the setup screen and
 * settings panel. The HA token is never returned — only whether one is present.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const cfg = await readDeviceConfig()
  return {
    configured: cfg.configured,
    role: cfg.role,
    haUrl: cfg.haUrl,
    allowedLocalPrefixes: cfg.allowedLocalPrefixes,
    masterUrl: cfg.masterUrl,
    haConfigured: !!cfg.haToken,
  }
})
