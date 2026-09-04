import { assertLanClient } from '~~/server/utils/lanGuard'
import { readDeviceConfig, writeDeviceConfig, type WifiSecurity } from '~~/server/utils/deviceConfig'
import { isSupervised } from '~~/server/utils/haTarget'
import { publish } from '~~/server/utils/eventBus'

interface SetupWifi {
  ssid?: string
  password?: string
  security?: string
  hidden?: boolean
}

interface SetupBody {
  haUrl?: string
  haToken?: string
  allowedLocalPrefixes?: string | string[]
  authPin?: string
  wifi?: SetupWifi
}

function normalizeSecurity(v: string | undefined): WifiSecurity {
  const s = String(v ?? 'WPA').toUpperCase()
  return s === 'WEP' ? 'WEP' : s === 'NONE' ? 'NONE' : 'WPA'
}

/**
 * Persists the server configuration written by the setup screen.
 *
 * An HA URL + long-lived token are only required when HAIVE runs outside Home
 * Assistant OS; as an add-on the Supervisor provides the connection and those
 * fields are ignored. PIN and WiFi are always optional.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const body = await readBody<SetupBody>(event)
  const supervised = isSupervised()

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

  const current = await readDeviceConfig()
  const haUrl = (body?.haUrl ?? '').trim()
  // A blank token on a re-save means "keep the one already stored".
  const haToken = (body?.haToken ?? '').trim() || current.haToken

  if (!supervised) {
    if (!haUrl) {
      throw createError({ statusCode: 400, statusMessage: 'Home Assistant URL is required' })
    }
    if (!/^https?:\/\//i.test(haUrl)) {
      throw createError({ statusCode: 400, statusMessage: 'Home Assistant URL must start with http:// or https://' })
    }
    if (!haToken) {
      throw createError({ statusCode: 400, statusMessage: 'Home Assistant token is required' })
    }
  }

  await writeDeviceConfig({
    haUrl: supervised ? '' : haUrl,
    haToken: supervised ? '' : haToken,
    allowedLocalPrefixes: prefixes.length ? prefixes : current.allowedLocalPrefixes,
    authPin,
    wifi,
  })
  publish({ type: 'device' })
  return { ok: true }
})
