import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Runtime, persisted device configuration.
 *
 * This is the single source of truth for whether the device has been
 * configured, its role, Home Assistant credentials, WiFi QR info, and toolbar
 * PIN. Everything is written at runtime by the first-launch setup screen and
 * stored in `config/device.json` — there are no environment variables to set.
 *
 * A Master hosts the server, holds the HA token and owns the layout/floorplan
 * data. A Slave holds no HA credentials of its own — it points at a Master and
 * its API requests are proxied there, so every screen shows the same data.
 */

export type DeviceRole = 'master' | 'slave'

export type WifiSecurity = 'WPA' | 'WEP' | 'NONE'

export interface WifiConfig {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}

export interface DeviceConfig {
  /** True once the first-launch setup has been completed. */
  configured: boolean
  role: DeviceRole
  /** Master-only: Home Assistant base URL. */
  haUrl: string
  /** Master-only: Home Assistant long-lived access token. */
  haToken: string
  /** Master-only: IP prefixes allowed to hit the API. */
  allowedLocalPrefixes: string[]
  /** Slave-only: base URL of the Master server (e.g. http://192.168.1.50:3000). */
  masterUrl: string
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
    role: 'master',
    haUrl: 'http://homeassistant.local:8123',
    haToken: '',
    allowedLocalPrefixes: [...DEFAULT_PREFIXES],
    masterUrl: '',
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
  const role: DeviceRole = raw.role === 'slave' ? 'slave' : 'master'
  const prefixes =
    Array.isArray(raw.allowedLocalPrefixes) && raw.allowedLocalPrefixes.length
      ? raw.allowedLocalPrefixes.map((p) => String(p).trim()).filter(Boolean)
      : base.allowedLocalPrefixes
  return {
    configured: raw.configured ?? base.configured,
    role,
    haUrl: (raw.haUrl ?? base.haUrl) || '',
    haToken: (raw.haToken ?? '') || '',
    allowedLocalPrefixes: prefixes,
    masterUrl: (raw.masterUrl ?? '').replace(/\/+$/, ''),
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
