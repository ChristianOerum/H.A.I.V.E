import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Runtime, persisted server configuration.
 *
 * HAIVE runs as a single server — ideally the Home Assistant OS add-on, so it
 * lives on the same box as Home Assistant itself. Every screen in the house is
 * just a browser pointed at that server, so they all read and write the same
 * files and stay in sync over SSE. There are no roles and no per-screen setup.
 *
 * Everything here is written at runtime by the setup screen and stored in
 * `config/device.json` — there are no environment variables to set.
 */

export type WifiSecurity = 'WPA' | 'WEP' | 'NONE'

export interface WifiConfig {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}

export interface DeviceConfig {
  /** True once the setup screen has been completed. */
  configured: boolean
  /** Home Assistant base URL. Ignored when running as a Supervisor add-on. */
  haUrl: string
  /** Home Assistant long-lived token. Ignored when running as an add-on. */
  haToken: string
  /** IP prefixes allowed to hit the API. */
  allowedLocalPrefixes: string[]
  /** Optional PIN protecting the toolbar controls. Empty = auth disabled. */
  authPin: string
  /** Optional WiFi credentials shown via QR. Empty ssid = QR hidden. */
  wifi: WifiConfig
}

const CONFIG_PATH = resolve(process.cwd(), 'config/device.json')

const DEFAULT_PREFIXES = ['127.', '192.168.', '10.', '172.']

function defaultConfig(): DeviceConfig {
  return {
    configured: false,
    haUrl: 'http://homeassistant.local:8123',
    haToken: '',
    allowedLocalPrefixes: [...DEFAULT_PREFIXES],
    authPin: '',
    wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  }
}

function normalizeWifi(raw: Partial<WifiConfig> | undefined): WifiConfig {
  const sec = String(raw?.security ?? 'WPA').toUpperCase()
  const security: WifiSecurity = sec === 'WEP' ? 'WEP' : sec === 'NONE' ? 'NONE' : 'WPA'
  return {
    ssid: String(raw?.ssid ?? '').trim(),
    password: String(raw?.password ?? ''),
    security,
    hidden: !!raw?.hidden,
  }
}

function normalize(raw: Partial<DeviceConfig>): DeviceConfig {
  const base = defaultConfig()
  const prefixes =
    Array.isArray(raw.allowedLocalPrefixes) && raw.allowedLocalPrefixes.length
      ? raw.allowedLocalPrefixes.map((p) => String(p).trim()).filter(Boolean)
      : base.allowedLocalPrefixes
  return {
    configured: raw.configured ?? base.configured,
    haUrl: ((raw.haUrl ?? base.haUrl) || '').replace(/\/+$/, ''),
    haToken: (raw.haToken ?? '') || '',
    allowedLocalPrefixes: prefixes,
    authPin: String(raw.authPin ?? '').trim(),
    wifi: normalizeWifi(raw.wifi),
  }
}

/** Reads the persisted device config, or returns unconfigured defaults. */
export async function readDeviceConfig(): Promise<DeviceConfig> {
  if (!existsSync(CONFIG_PATH)) return defaultConfig()
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Partial<DeviceConfig>
    return normalize(raw)
  } catch {
    return defaultConfig()
  }
}

/** Persists a new device config, returning the normalized result. */
export async function writeDeviceConfig(raw: Partial<DeviceConfig>): Promise<DeviceConfig> {
  const cfg = normalize({ ...raw, configured: true })
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
  return cfg
}

/** Removes the persisted device config (factory reset). */
export async function resetDeviceConfig(): Promise<void> {
  if (existsSync(CONFIG_PATH)) await rm(CONFIG_PATH, { force: true })
}
