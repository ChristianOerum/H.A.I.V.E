import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig, writeDeviceConfig, type DeviceRole } from '~~/server/utils/deviceConfig'

interface SetupBody {
  role?: DeviceRole
  haUrl?: string
  haToken?: string
  allowedLocalPrefixes?: string | string[]
  masterUrl?: string
}

/**
 * Persists the first-launch configuration. Master requires an HA URL + token;
 * Slave requires a Master URL and stores no HA credentials of its own.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const body = await readBody<SetupBody>(event)

  const role: DeviceRole = body?.role === 'slave' ? 'slave' : 'master'
  const prefixes = Array.isArray(body?.allowedLocalPrefixes)
    ? body!.allowedLocalPrefixes
    : String(body?.allowedLocalPrefixes ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)

  if (role === 'master') {
    const haUrl = (body?.haUrl ?? '').trim()
    const haToken = (body?.haToken ?? '').trim()
    if (!haUrl) throw createError({ statusCode: 400, statusMessage: 'HA_URL is required for a Master device' })
    if (!haToken) throw createError({ statusCode: 400, statusMessage: 'HA_TOKEN is required for a Master device' })

    const cfg = await writeDeviceConfig({
      role,
      haUrl,
      haToken,
      allowedLocalPrefixes: prefixes.length ? prefixes : undefined,
      masterUrl: '',
    })
    return { ok: true, role: cfg.role }
  }

  // Slave
  const masterUrl = (body?.masterUrl ?? '').trim()
  if (!masterUrl) throw createError({ statusCode: 400, statusMessage: 'Master URL is required for a Slave device' })
  if (!/^https?:\/\//i.test(masterUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'Master URL must start with http:// or https://' })
  }

  // Keep the current allowed prefixes so the slave can still serve its own client.
  const current = await readDeviceConfig()
  const cfg = await writeDeviceConfig({
    role,
    haUrl: '',
    haToken: '',
    allowedLocalPrefixes: prefixes.length ? prefixes : current.allowedLocalPrefixes,
    masterUrl,
  })
  return { ok: true, role: cfg.role }
})
