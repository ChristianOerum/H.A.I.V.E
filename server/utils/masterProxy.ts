import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { readDeviceConfig } from './deviceConfig'

/**
 * When this device is a Slave, forwards the current request to the Master server
 * and returns its response, so all screens share one source of truth. Returns
 * `null` when the device is a Master (caller should handle the request locally).
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
  return await $fetch(url, opts)
}
