import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Runtime, persisted device configuration.
 *
 * Unlike Nuxt's `runtimeConfig` (which is baked from env at process start), this
 * config is written at runtime by the first-launch setup screen and stored in
 * `config/device.json`. It is the single source of truth for whether the device
 * has been configured, its role, and the Home Assistant connection details.
 *
 * A Master hosts the server, holds the HA token and owns the layout/floorplan
 * data. A Slave holds no HA credentials of its own — it points at a Master and
 * its API requests are proxied there, so every screen shows the same data.
 */

export type DeviceRole = 'master' | 'slave'

export interface DeviceConfig {
  /** True once the first-launch setup has been completed. */
  configured: boolean
  role: DeviceRole
  /** Master-only: Home Assistant base URL. */
  haUrl: string
  /** Master-only: Home Assistant long-lived access token. */
  haToken: string
  /** Master-only: comma-separated IP prefixes allowed to hit the API. */
  allowedLocalPrefixes: string[]
  /** Slave-only: base URL of the Master server (e.g. http://192.168.1.50:3000). */
  masterUrl: string
}

const CONFIG_PATH = resolve(process.cwd(), 'config/device.json')

function envPrefixes(): string[] {
  return (process.env.ALLOWED_LOCAL_PREFIXES || '127.,192.168.,10.,172.')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Config derived purely from environment variables (backward-compatible path). */
function envConfig(): DeviceConfig {
  return {
    // If a token is provided via env, treat the device as an already-configured
    // Master so existing .env-based deployments keep working with no setup step.
    configured: !!process.env.HA_TOKEN,
    role: 'master',
    haUrl: process.env.HA_URL || 'http://homeassistant.local:8123',
    haToken: process.env.HA_TOKEN || '',
    allowedLocalPrefixes: envPrefixes(),
    masterUrl: '',
  }
}

function normalize(raw: Partial<DeviceConfig>): DeviceConfig {
  const base = envConfig()
  const role: DeviceRole = raw.role === 'slave' ? 'slave' : 'master'
  return {
    configured: raw.configured ?? base.configured,
    role,
    haUrl: (raw.haUrl ?? base.haUrl) || '',
    haToken: (raw.haToken ?? base.haToken) || '',
    allowedLocalPrefixes:
      Array.isArray(raw.allowedLocalPrefixes) && raw.allowedLocalPrefixes.length
        ? raw.allowedLocalPrefixes.map((p) => String(p).trim()).filter(Boolean)
        : base.allowedLocalPrefixes,
    masterUrl: (raw.masterUrl ?? '').replace(/\/+$/, ''),
  }
}

/** Reads the persisted device config, falling back to env-derived defaults. */
export async function readDeviceConfig(): Promise<DeviceConfig> {
  if (!existsSync(CONFIG_PATH)) return envConfig()
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Partial<DeviceConfig>
    return normalize(raw)
  } catch {
    return envConfig()
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
