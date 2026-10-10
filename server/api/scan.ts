import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { publish } from '~~/server/utils/eventBus'
import { assertLanClient } from '~~/server/utils/lanGuard'

/**
 * Holds the most recent phone AR scan (pages/scan.vue) until someone imports
 * or discards it from the floorplan editor. The scan is never written into the
 * floorplan directly, so it can't clobber an edit in progress on another screen.
 */
const SCAN_PATH = resolve(process.cwd(), 'config/scan-pending.json')

const isPoint = (p: unknown) =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000)

function isValidScan(body: any): boolean {
  if (!body || !Array.isArray(body.rooms) || !Array.isArray(body.openings)) return false
  if (body.rooms.length === 0 || body.rooms.length > 50 || body.openings.length > 200) return false
  const roomsOk = body.rooms.every((r: any) =>
    r && typeof r.name === 'string' && r.name.length <= 80
    && Array.isArray(r.corners) && r.corners.length >= 3 && r.corners.length <= 100
    && r.corners.every(isPoint))
  const openingsOk = body.openings.every((o: any) =>
    o && (o.type === 'door' || o.type === 'window') && isPoint(o.a) && isPoint(o.b))
  return roomsOk && openingsOk
}

export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  if (event.method === 'GET') {
    if (!existsSync(SCAN_PATH)) return { scan: null }
    try {
      return { scan: JSON.parse(await readFile(SCAN_PATH, 'utf8')) }
    } catch {
      return { scan: null }
    }
  }

  if (event.method === 'POST') {
    const body = await readBody(event)
    if (!isValidScan(body)) throw createError({ statusCode: 400, statusMessage: 'Invalid scan' })
    const scan = {
      rooms: body.rooms.map((r: any) => ({ name: r.name, corners: r.corners })),
      openings: body.openings.map((o: any) => ({ type: o.type, a: o.a, b: o.b })),
      createdAt: Date.now(),
    }
    await mkdir(dirname(SCAN_PATH), { recursive: true })
    await writeFile(SCAN_PATH, JSON.stringify(scan, null, 2), 'utf8')
    publish({ type: 'scan' })
    return { ok: true }
  }

  if (event.method === 'DELETE') {
    await rm(SCAN_PATH, { force: true })
    publish({ type: 'scan' })
    return { ok: true }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
