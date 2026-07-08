import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { readDeviceConfig } from './deviceConfig'

/**
 * When this device is a Slave, forwards the current request to the Master server
 * and returns its response, so all screens share one source of truth. Returns
 * `null` when the device is a Master, or when the Master is running an older
 * build that doesn't implement the requested endpoint (caller should then
 * handle the request locally).
 */
export async function proxyToMaster(event: H3Event, path: string): Promise<unknown | null> {
  const cfg = await readDeviceConfig()
  if (cfg.role !== 'slave' || !cfg.masterUrl) return null

  const method = event.method
  const url = `${cfg.masterUrl}${path}`
  const opts: Record<string, unknown> = { method }
  if (method !== 'GET' && method !== 'HEAD') {
    opts.body = await readBody(event).catch(() => undefined)
  }
  try {
    return await $fetch(url, opts)
  } catch (err: unknown) {
    // Master is on an older build without this endpoint → fall back to local.
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { statusCode?: number })?.statusCode
    if (status === 404) return null
    throw err
  }
}
