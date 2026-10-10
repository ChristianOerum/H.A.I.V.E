import type { FloorplanOpening, FloorplanRoom } from '~/stores/floorplan'

/**
 * Raw output of the phone AR scan (pages/scan.vue), in the AR session's own
 * frame: metres, x/z on the floor, arbitrary origin and heading.
 */
export interface ScanRoom {
  name: string
  /** Corners in the order they were tapped. */
  corners: [number, number][]
}
export interface ScanOpening {
  type: 'door' | 'window'
  /** The two sides of the opening, tapped on the floor or the wall. */
  a: [number, number]
  b: [number, number]
}
export interface ScanResult {
  rooms: ScanRoom[]
  openings: ScanOpening[]
  createdAt: number
}

export interface ScanConversion {
  rooms: FloorplanRoom[]
  openings: FloorplanOpening[]
  /** Openings that were too far from any wall to place. */
  droppedOpenings: number
}

type P = [number, number]

/** Within this angle of an axis, an edge is squared up to it. */
const SQUARE_TOL = (12 * Math.PI) / 180
/** Consecutive edges this close in direction are merged into one wall. */
const COLLINEAR_TOL = (8 * Math.PI) / 180
/** Taps closer than this are treated as a double tap. */
const MIN_EDGE = 0.05
/** Parallel walls of different rooms within this distance become one shared wall (absorbs wall thickness). */
const SHARED_WALL_TOL = 0.35
/** An opening further than this from every wall is dropped. */
const OPENING_MAX_DIST = 0.6

const round = (v: number) => Math.round(v * 100) / 100

function rotate([x, z]: P, a: number): P {
  const c = Math.cos(a), s = Math.sin(a)
  return [x * c - z * s, x * s + z * c]
}

function signedArea(v: P[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) {
    const [x1, z1] = v[i]
    const [x2, z2] = v[(i + 1) % v.length]
    s += x1 * z2 - x2 * z1
  }
  return s / 2
}

/** Angle of the dominant wall direction, modulo 90°, weighted by wall length. */
function dominantAngle(rooms: P[][]): number {
  let c = 0, s = 0
  for (const v of rooms) {
    for (let i = 0; i < v.length; i++) {
      const [x1, z1] = v[i]
      const [x2, z2] = v[(i + 1) % v.length]
      const len = Math.hypot(x2 - x1, z2 - z1)
      const a = Math.atan2(z2 - z1, x2 - x1)
      // ×4 folds the four axis directions onto one, so a square room votes unanimously.
      c += len * Math.cos(4 * a)
      s += len * Math.sin(4 * a)
    }
  }
  return Math.atan2(s, c) / 4
}

/** Drops double taps and merges corners that lie on a straight wall. */
function cleanPolygon(input: P[]): P[] {
  let v = input.filter((p, i) => {
    const q = input[(i + 1) % input.length]
    return Math.hypot(q[0] - p[0], q[1] - p[1]) >= MIN_EDGE
  })
  let changed = true
  while (changed && v.length > 3) {
    changed = false
    for (let i = 0; i < v.length; i++) {
      const prev = v[(i - 1 + v.length) % v.length]
      const cur = v[i]
      const next = v[(i + 1) % v.length]
      const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0])
      const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0])
      let d = Math.abs(a2 - a1) % (2 * Math.PI)
      if (d > Math.PI) d = 2 * Math.PI - d
      if (d < COLLINEAR_TOL) {
        v = v.filter((_, j) => j !== i)
        changed = true
        break
      }
    }
  }
  return v
}

type Axis = 'x' | 'z' | null

/** Which axis an edge runs along once squared: 'x' = horizontal (constant z), 'z' = vertical (constant x). */
function edgeAxis(p: P, q: P): Axis {
  const a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]))
  if (a < SQUARE_TOL || a > Math.PI - SQUARE_TOL) return 'x'
  if (Math.abs(a - Math.PI / 2) < SQUARE_TOL) return 'z'
  return null
}

/** Makes near-axis-aligned walls exactly axis-aligned; diagonal walls are left as tapped. */
function squareUp(v: P[]): P[] {
  const out = v.map((p) => [...p] as P)
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) % out.length
    const axis = edgeAxis(out[i], out[j])
    if (axis === 'x') {
      const z = (out[i][1] + out[j][1]) / 2
      out[i][1] = z; out[j][1] = z
    } else if (axis === 'z') {
      const x = (out[i][0] + out[j][0]) / 2
      out[i][0] = x; out[j][0] = x
    }
  }
  return out
}

/**
 * Rooms are tapped at their inside corners, so neighbouring rooms end up a wall
 * thickness apart. HAIVE draws walls centred on shared edges, so parallel,
 * overlapping walls of different rooms that are close together are pulled onto
 * one shared line.
 */
function snapSharedWalls(rooms: P[][]): void {
  interface Edge { room: number; i: number; j: number; axis: 'x' | 'z'; value: number; lo: number; hi: number; len: number }
  const edges: Edge[] = []
  rooms.forEach((v, room) => {
    for (let i = 0; i < v.length; i++) {
      const j = (i + 1) % v.length
      const axis = edgeAxis(v[i], v[j])
      if (!axis) continue
      // A horizontal edge has constant z and spans x; vertical is the reverse.
      const k = axis === 'x' ? 1 : 0
      const o = 1 - k
      const value = v[i][k]
      if (Math.abs(v[j][k] - value) > 1e-6) continue // not exactly squared, leave it
      const lo = Math.min(v[i][o], v[j][o])
      const hi = Math.max(v[i][o], v[j][o])
      edges.push({ room, i, j, axis, value, lo, hi, len: hi - lo })
    }
  })

  const parent = edges.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let a = 0; a < edges.length; a++) {
    for (let b = a + 1; b < edges.length; b++) {
      const ea = edges[a], eb = edges[b]
      if (ea.room === eb.room || ea.axis !== eb.axis) continue
      if (Math.abs(ea.value - eb.value) > SHARED_WALL_TOL) continue
      const overlap = Math.min(ea.hi, eb.hi) - Math.max(ea.lo, eb.lo)
      // Facing walls must overlap; walls that continue each other (an outer
      // wall running through two rooms) only need to be nearly in line.
      const continues = overlap > -SHARED_WALL_TOL && Math.abs(ea.value - eb.value) < 0.1
      if (overlap < 0.1 && !continues) continue
      parent[find(a)] = find(b)
    }
  }

  const groups = new Map<number, Edge[]>()
  edges.forEach((e, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), e])
  })
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const total = group.reduce((s, e) => s + e.len, 0)
    const value = group.reduce((s, e) => s + e.value * e.len, 0) / total
    for (const e of group) {
      const k = e.axis === 'x' ? 1 : 0
      rooms[e.room][e.i][k] = value
      rooms[e.room][e.j][k] = value
    }
  }
}

/** Closest point on segment p→q to m, as a 0..1 fraction along it, plus the distance. */
function projectOnSegment(m: P, p: P, q: P): { t: number; dist: number } {
  const dx = q[0] - p[0], dz = q[1] - p[1]
  const len2 = dx * dx + dz * dz
  const t = len2 ? Math.max(0, Math.min(1, ((m[0] - p[0]) * dx + (m[1] - p[1]) * dz) / len2)) : 0
  return { t, dist: Math.hypot(p[0] + t * dx - m[0], p[1] + t * dz - m[1]) }
}

/**
 * Turns a raw phone scan into HAIVE rooms and openings: rotates it so the walls
 * line up with the grid, squares near-right angles, joins walls shared between
 * rooms, attaches doors/windows to their nearest wall, and places the result
 * next to (not on top of) any rooms that already exist.
 */
export function convertScan(
  scan: ScanResult,
  existingRooms: FloorplanRoom[],
  newId: () => string = () => crypto.randomUUID(),
): ScanConversion {
  const raw = scan.rooms.map((r) => cleanPolygon(r.corners)).filter((v) => v.length >= 3)
  const theta = dominantAngle(raw)

  const polys = raw.map((v) => {
    const sq = cleanPolygon(squareUp(v.map((p) => rotate(p, -theta))))
    return signedArea(sq) < 0 ? sq.reverse() : sq
  })
  snapSharedWalls(polys)

  // Placement: centre on the origin, or line up to the right of the existing plan.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const v of polys) for (const [x, z] of v) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  let dx = -(minX + maxX) / 2
  let dz = -(minZ + maxZ) / 2
  const existing = existingRooms.flatMap((r) => r.vertices)
  if (existing.length) {
    const exMaxX = Math.max(...existing.map((p) => p[0]))
    const exMinZ = Math.min(...existing.map((p) => p[1]))
    dx = exMaxX + 1 - minX
    dz = exMinZ - minZ
  }
  const place = ([x, z]: P): P => [round(x + dx), round(z + dz)]

  const rooms: FloorplanRoom[] = []
  polys.forEach((v, idx) => {
    const name = scan.rooms[idx]?.name?.trim() || `Scanned room ${idx + 1}`
    rooms.push({ id: newId(), name, vertices: v.map(place), tintH: 0, tintV: 1.0 })
  })

  const openings: FloorplanOpening[] = []
  let droppedOpenings = 0
  for (const op of scan.openings) {
    const a = place(rotate(op.a, -theta))
    const b = place(rotate(op.b, -theta))
    const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    let best: { room: FloorplanRoom; edgeIdx: number; dist: number } | null = null
    for (const room of rooms) {
      const n = room.vertices.length
      for (let i = 0; i < n; i++) {
        const { dist } = projectOnSegment(mid, room.vertices[i], room.vertices[(i + 1) % n])
        if (!best || dist < best.dist) best = { room, edgeIdx: i, dist }
      }
    }
    if (!best || best.dist > OPENING_MAX_DIST) { droppedOpenings++; continue }
    const n = best.room.vertices.length
    const p = best.room.vertices[best.edgeIdx]
    const q = best.room.vertices[(best.edgeIdx + 1) % n]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const ta = projectOnSegment(a, p, q).t
    const tb = projectOnSegment(b, p, q).t
    const width = Math.min(len, Math.max(0.4, Math.abs(tb - ta) * len))
    // Keep the whole opening on the wall.
    const half = width / 2 / len
    const t = Math.min(1 - half, Math.max(half, (ta + tb) / 2))
    openings.push({
      id: newId(),
      type: op.type,
      roomId: best.room.id,
      edgeIdx: best.edgeIdx,
      t: Math.round(t * 1000) / 1000,
      width: round(width),
    })
  }

  return { rooms, openings, droppedOpenings }
}
