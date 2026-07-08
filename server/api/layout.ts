import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { proxyToMaster } from '~~/server/utils/masterProxy'

const LAYOUT_PATH = resolve(process.cwd(), 'config/entities.json')

async function readLayout() {
  if (!existsSync(LAYOUT_PATH)) return { placements: [] }
  try {
    const raw = await readFile(LAYOUT_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { placements: [] }
  }
}

export default defineEventHandler(async (event) => {
  // Slaves defer to the Master so every screen shares one layout.
  const proxied = await proxyToMaster(event, '/api/layout')
  if (proxied !== null) return proxied

  if (event.method === 'GET') {
    return await readLayout()
  }

  if (event.method === 'PUT') {
    const body = await readBody<{ placements: unknown[] }>(event)
    if (!body || !Array.isArray(body.placements)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid body' })
    }
    await mkdir(dirname(LAYOUT_PATH), { recursive: true })
    await writeFile(LAYOUT_PATH, JSON.stringify(body, null, 2), 'utf8')
    return { ok: true }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
