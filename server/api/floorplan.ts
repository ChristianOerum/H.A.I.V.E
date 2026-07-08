import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { proxyToMaster } from '~~/server/utils/masterProxy'
import { publish } from '~~/server/utils/eventBus'

const FLOORPLAN_PATH = resolve(process.cwd(), 'config/floorplan.json')

async function read() {
  if (!existsSync(FLOORPLAN_PATH)) return null
  try {
    const raw = await readFile(FLOORPLAN_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  // Slaves defer to the Master so every screen shares one floorplan.
  const proxied = await proxyToMaster(event, '/api/floorplan')
  if (proxied !== null) return proxied

  if (event.method === 'GET') {
    const data = await read()
    if (!data) throw createError({ statusCode: 404, statusMessage: 'No floorplan saved yet' })
    return data
  }

  if (event.method === 'PUT') {
    const body = await readBody<{ rooms: unknown[]; openings: unknown[]; furniture: unknown[]; furnitureGroups?: unknown[] }>(event)
    if (!body || !Array.isArray(body.rooms) || !Array.isArray(body.openings) || !Array.isArray(body.furniture)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid body' })
    }
    await mkdir(dirname(FLOORPLAN_PATH), { recursive: true })
    await writeFile(FLOORPLAN_PATH, JSON.stringify(body, null, 2), 'utf8')
    publish({ type: 'floorplan' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
