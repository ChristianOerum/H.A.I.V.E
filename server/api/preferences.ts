import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { assertLanClient } from '~~/server/utils/lanGuard'
import { proxyToMaster } from '~~/server/utils/masterProxy'
import { publish } from '~~/server/utils/eventBus'

/**
 * Cross-device preferences (theme, accent colour, dark/light variants, custom
 * palettes). Stored server-side so every screen — master + slaves — stays in
 * visual sync. Slaves proxy the request to the master.
 */

const PREFS_PATH = resolve(process.cwd(), 'config/preferences.json')

async function readPrefs(): Promise<Record<string, unknown>> {
  if (!existsSync(PREFS_PATH)) return {}
  try {
    return JSON.parse(await readFile(PREFS_PATH, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const proxied = await proxyToMaster(event, '/api/preferences')
  if (proxied !== null) return proxied

  if (event.method === 'GET') {
    return await readPrefs()
  }

  if (event.method === 'PUT') {
    const body = await readBody<Record<string, unknown>>(event)
    if (!body || typeof body !== 'object') {
      throw createError({ statusCode: 400, statusMessage: 'Invalid body' })
    }
    await mkdir(dirname(PREFS_PATH), { recursive: true })
    await writeFile(PREFS_PATH, JSON.stringify(body, null, 2), 'utf8')
    publish({ type: 'preferences' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
