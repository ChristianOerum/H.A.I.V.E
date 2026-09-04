import { readDeviceConfig } from './deviceConfig'

/**
 * Resolves which Home Assistant instance this server talks to, and with what
 * credentials. The token never leaves the server — browsers reach HA through
 * the `/api/ha/proxy` routes instead.
 *
 * When HAIVE runs as a Home Assistant OS add-on the Supervisor injects
 * `SUPERVISOR_TOKEN` and exposes Core at `http://supervisor/core`, so there is
 * nothing for the user to configure. Outside the add-on we fall back to the URL
 * and long-lived token entered on the setup screen.
 */

export type HaSource = 'supervisor' | 'manual' | 'none'

export interface HaTarget {
  source: HaSource
  /** Base URL with no trailing slash. `/api/...` is appended to it. */
  baseUrl: string
  token: string
}

const SUPERVISOR_BASE = 'http://supervisor/core'

/** True when running inside a Home Assistant OS / Supervised add-on. */
export function isSupervised(): boolean {
  return !!process.env.SUPERVISOR_TOKEN
}

export async function resolveHaTarget(): Promise<HaTarget> {
  const supervisorToken = process.env.SUPERVISOR_TOKEN
  if (supervisorToken) {
    return { source: 'supervisor', baseUrl: SUPERVISOR_BASE, token: supervisorToken }
  }

  const cfg = await readDeviceConfig()
  if (cfg.haUrl && cfg.haToken) {
    return { source: 'manual', baseUrl: cfg.haUrl.replace(/\/+$/, ''), token: cfg.haToken }
  }

  return { source: 'none', baseUrl: '', token: '' }
}
