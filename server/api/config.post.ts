import { assertLanClient } from '~~/server/utils/lanGuard'
import {
  readDeviceConfig,
  writeDeviceConfig,
  type DeviceRole,
  type WifiSecurity,
} from '~~/server/utils/deviceConfig'

interface SetupWifi {
  ssid?: string
  password?: string
  security?: string
  hidden?: boolean
}

interface SetupBody {
  role?: DeviceRole
  haUrl?: string
  haToken?: string
  allowedLocalPrefixes?: string | string[]
  masterUrl?: string
  authPin?: string
  wifi?: SetupWifi
}

function normalizeSecurity(v: string | undefined): WifiSecurity {
  const s = String(v ?? 'WPA').toUpperCase()
  return s === 'WEP' ? 'WEP' : s === 'NONE' ? 'NONE' : 'WPA'
}

/**
 * Persists the first-launch configuration. Master requires an HA URL + token;
 * Slave requires a Master URL and stores no HA credentials of its own.
 * PIN + WiFi are optional shared fields available to both roles.
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

  const authPin = String(body?.authPin ?? '').trim()
  const wifiSsid = String(body?.wifi?.ssid ?? '').trim()
  const wifi = {
    ssid: wifiSsid,
    password: wifiSsid ? String(body?.wifi?.password ?? '') : '',
    security: normalizeSecurity(body?.wifi?.security),
    hidden: !!body?.wifi?.hidden,
  }

  if (role === 'master') {
    const haUrl = (body?.haUrl ?? '').trim()
    const haToken = (body?.haToken ?? '').trim()
    if (!haUrl) throw createError({ statusCode: 400, statusMessage: 'HA URL is required for a Master device' })
    if (!haToken) throw createError({ statusCode: 400, statusMessage: 'HA token is required for a Master device' })

    const cfg = await writeDeviceConfig({
      role,
      haUrl,
      haToken,
      allowedLocalPrefixes: prefixes.length ? prefixes : undefined,
      masterUrl: '',
      authPin,
      wifi,
    })
    return { ok: true, role: cfg.role }
  }

  // Slave
  const masterUrl = (body?.masterUrl ?? '').trim()
  if (!masterUrl) throw createError({ statusCode: 400, statusMessage: 'Master URL is required for a Slave device' })
  if (!/^https?:\/\//i.test(masterUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'Master URL must start with http:// or https://' })
  }

  // Slaves inherit PIN + WiFi from the Master — never store their own.
  // Keep the current allowed prefixes so the slave can still serve its own client.
  const current = await readDeviceConfig()
  const cfg = await writeDeviceConfig({
    role,
    haUrl: '',
    haToken: '',
    allowedLocalPrefixes: prefixes.length ? prefixes : current.allowedLocalPrefixes,
    masterUrl,
    authPin: '',
    wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  })
  return { ok: true, role: cfg.role }
})
