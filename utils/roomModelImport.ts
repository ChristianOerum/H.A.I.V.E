import type * as THREE_NS from 'three'
import type { ScanOpening, ScanResult, ScanRoom } from '~/utils/scanGeometry'

/**
 * Turns a 3D room scan (a Polycam GLTF/GLB export) into a ScanResult, which
 * utils/scanGeometry.ts then straightens into floorplan rooms like a phone scan.
 *
 * Two ways in, depending on what the file holds:
 * - Objects: LiDAR room scans name their parts (walls, floors, doors,
 *   windows). Walls and floors are drawn straight onto a top-down grid, and
 *   doors/windows become openings.
 * - Mesh: a plain triangle mesh. The floor is found as the lowest large
 *   horizontal surface, and walls are where the mesh crosses two horizontal
 *   cuts: one at waist height and one just above door height, so doorways
 *   still separate rooms.
 *
 * Either way, rooms are the separate patches of floor left between walls,
 * traced back into polygons. Coordinates: glTF is metres, y up, which matches
 * the scan frame (x/z on the floor).
 */

export interface RoomModelImport {
  scan: ScanResult
  method: 'objects' | 'mesh'
  triangles: number
}

type P = [number, number]

/** Grid resolution in metres; coarser for very large scans. */
const CELL = 0.05
const MAX_CELLS = 4_000_000
/** Floor patches smaller than this aren't rooms (closets under stairs, gaps). */
const MIN_ROOM_AREA = 1.0
/** Cuts through the mesh for walls, above the floor. */
const WALL_CUT = 1.0
const LINTEL_CUT = 2.05
/** Polygon simplification tolerance (removes the grid's staircase). */
const SIMPLIFY_TOL = 0.08

type Kind = 'wall' | 'floor' | 'door' | 'window' | 'other'

/** Classifies a mesh by its own name, then its parents'. */
function kindOf(obj: THREE_NS.Object3D): Kind {
  for (let o: THREE_NS.Object3D | null = obj; o; o = o.parent) {
    const n = o.name.toLowerCase()
    if (/door|opening/.test(n)) return 'door'
    if (/window/.test(n)) return 'window'
    if (/wall/.test(n)) return 'wall'
    if (/floor|ground/.test(n)) return 'floor'
  }
  return 'other'
}

/** World-space triangles of a mesh, 9 numbers each. */
function worldTriangles(THREE: typeof THREE_NS, mesh: THREE_NS.Mesh): number[] {
  const geo = mesh.geometry as THREE_NS.BufferGeometry
  const pos = geo.getAttribute('position')
  if (!pos) return []
  const v = new THREE.Vector3()
  const world = new Float64Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z
  }
  const out: number[] = []
  const idx = geo.getIndex()
  const n = idx ? idx.count : pos.count
  for (let i = 0; i + 2 < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const j = idx ? idx.getX(i + k) : i + k
      out.push(world[j * 3]!, world[j * 3 + 1]!, world[j * 3 + 2]!)
    }
  }
  return out
}

// ── Top-down grid ──

class Grid {
  readonly cells: Uint8Array
  constructor(readonly w: number, readonly h: number, readonly x0: number, readonly z0: number, readonly cell: number) {
    this.cells = new Uint8Array(w * h)
  }
  ci(x: number) { return Math.floor((x - this.x0) / this.cell) }
  cj(z: number) { return Math.floor((z - this.z0) / this.cell) }
  set(i: number, j: number) {
    if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.cells[j * this.w + i] = 1
  }
  line(x1: number, z1: number, x2: number, z2: number) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (this.cell / 2)))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      this.set(this.ci(x1 + (x2 - x1) * t), this.cj(z1 + (z2 - z1) * t))
    }
  }
  /** Fills a triangle's top-down footprint; edges too, so upright faces still leave a line. */
  tri(x1: number, z1: number, x2: number, z2: number, x3: number, z3: number) {
    this.line(x1, z1, x2, z2); this.line(x2, z2, x3, z3); this.line(x3, z3, x1, z1)
    const d = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
    if (Math.abs(d) < 1e-9) return
    const i0 = Math.max(0, this.ci(Math.min(x1, x2, x3))), i1 = Math.min(this.w - 1, this.ci(Math.max(x1, x2, x3)))
    const j0 = Math.max(0, this.cj(Math.min(z1, z2, z3))), j1 = Math.min(this.h - 1, this.cj(Math.max(z1, z2, z3)))
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cell
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.cell
        const a = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / d
        const b = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / d
        if (a >= 0 && b >= 0 && a + b <= 1) this.cells[j * this.w + i] = 1
      }
    }
  }
}

function dilate(g: Grid, r: number): Uint8Array {
  let src = g.cells
  for (let k = 0; k < r; k++) {
    const out = src.slice()
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      if (src[j * g.w + i]) continue
      if ((i > 0 && src[j * g.w + i - 1]) || (i < g.w - 1 && src[j * g.w + i + 1])
        || (j > 0 && src[(j - 1) * g.w + i]) || (j < g.h - 1 && src[(j + 1) * g.w + i])) out[j * g.w + i] = 1
    }
    src = out
  }
  return src
}

function erode(g: Grid, cells: Uint8Array, r: number): Uint8Array {
  let src = cells
  for (let k = 0; k < r; k++) {
    const out = src.slice()
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      if (!src[j * g.w + i]) continue
      if (i === 0 || j === 0 || i === g.w - 1 || j === g.h - 1
        || !src[j * g.w + i - 1] || !src[j * g.w + i + 1] || !src[(j - 1) * g.w + i] || !src[(j + 1) * g.w + i]) out[j * g.w + i] = 0
    }
    src = out
  }
  return src
}

/** Cells reachable from the grid border without entering a blocked cell. */
function outside(g: Grid, blocked: Uint8Array): Uint8Array {
  const seen = new Uint8Array(g.w * g.h)
  const stack: number[] = []
  const push = (k: number) => { if (!seen[k] && !blocked[k]) { seen[k] = 1; stack.push(k) } }
  for (let i = 0; i < g.w; i++) { push(i); push((g.h - 1) * g.w + i) }
  for (let j = 0; j < g.h; j++) { push(j * g.w); push(j * g.w + g.w - 1) }
  while (stack.length) {
    const k = stack.pop()!
    const i = k % g.w, j = (k - i) / g.w
    if (i > 0) push(k - 1)
    if (i < g.w - 1) push(k + 1)
    if (j > 0) push(k - g.w)
    if (j < g.h - 1) push(k + g.w)
  }
  return seen
}

/** Labels 4-connected patches of `free`; returns labels (0 = none) and each label's cell count. */
function label(g: Grid, free: Uint8Array): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(g.w * g.h)
  const sizes = [0]
  for (let start = 0; start < free.length; start++) {
    if (!free[start] || labels[start]) continue
    const id = sizes.length
    let count = 0
    const stack = [start]
    labels[start] = id
    while (stack.length) {
      const k = stack.pop()!
      count++
      const i = k % g.w
      for (const n of [i > 0 ? k - 1 : -1, i < g.w - 1 ? k + 1 : -1, k - g.w, k + g.w]) {
        if (n >= 0 && n < free.length && free[n] && !labels[n]) { labels[n] = id; stack.push(n) }
      }
    }
    sizes.push(count)
  }
  return { labels, sizes }
}

/** Outer boundary of one labelled patch, as a polygon in metres (largest loop of cell edges). */
function trace(g: Grid, labels: Int32Array, id: number): P[] {
  // Directed boundary edges, patch on the left, keyed by start corner.
  const next = new Map<number, number[]>()
  const W = g.w + 1
  const add = (a: number, b: number) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]) }
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < g.w && j < g.h && labels[j * g.w + i] === id
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    if (labels[j * g.w + i] !== id) continue
    const c00 = j * W + i, c10 = c00 + 1, c01 = c00 + W, c11 = c01 + 1
    if (!at(i, j - 1)) add(c00, c10)
    if (!at(i + 1, j)) add(c10, c11)
    if (!at(i, j + 1)) add(c11, c01)
    if (!at(i - 1, j)) add(c01, c00)
  }
  let best: number[] = []
  let bestArea = 0
  while (next.size) {
    const [start] = next.keys()
    const loop: number[] = []
    let cur = start!
    for (;;) {
      const outs = next.get(cur)
      if (!outs?.length) break
      const to = outs.pop()!
      if (!outs.length) next.delete(cur)
      loop.push(cur)
      cur = to
      if (cur === start) break
    }
    let area = 0
    for (let k = 0; k < loop.length; k++) {
      const a = loop[k]!, b = loop[(k + 1) % loop.length]!
      area += (a % W) * Math.floor(b / W) - (b % W) * Math.floor(a / W)
    }
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = loop }
  }
  return best.map((c) => [g.x0 + (c % W) * g.cell, g.z0 + Math.floor(c / W) * g.cell])
}

/** Douglas–Peucker on a closed polygon. */
function simplify(poly: P[], tol: number): P[] {
  if (poly.length < 4) return poly
  // Split at the two most distant points so the closed loop becomes two open runs.
  let far = 0, farD = 0
  for (let i = 1; i < poly.length; i++) {
    const d = Math.hypot(poly[i]![0] - poly[0]![0], poly[i]![1] - poly[0]![1])
    if (d > farD) { farD = d; far = i }
  }
  const run = (pts: P[]): P[] => {
    if (pts.length < 3) return pts
    const a = pts[0]!, b = pts[pts.length - 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9
    let idx = 0, dmax = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len
      if (d > dmax) { dmax = d; idx = i }
    }
    if (dmax <= tol) return [a, b]
    return [...run(pts.slice(0, idx + 1)).slice(0, -1), ...run(pts.slice(idx))]
  }
  const first = run(poly.slice(0, far + 1))
  const second = run([...poly.slice(far), poly[0]!])
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

/** The two farthest-apart points of an object's top-down footprint: a door or window's two sides. */
function span(tris: number[]): [P, P] | null {
  const pts: P[] = []
  const step = Math.max(1, Math.floor(tris.length / 3 / 400))
  for (let i = 0; i < tris.length; i += 3 * step) pts.push([tris[i]!, tris[i + 2]!])
  let best: [P, P] | null = null, bestD = 0
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
    const d = Math.hypot(pts[b]![0] - pts[a]![0], pts[b]![1] - pts[a]![1])
    if (d > bestD) { bestD = d; best = [pts[a]!, pts[b]!] }
  }
  return best && bestD > 0.3 ? best : null
}

/** Height of the floor: the lowest horizontal surface with a good share of all horizontal area. */
function findFloor(tris: number[]): number | null {
  const bins = new Map<number, number>()
  let total = 0
  for (let t = 0; t < tris.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(t, t + 9) as number[]
    const ux = bx! - ax!, uy = by! - ay!, uz = bz! - az!, vx = cx! - ax!, vy = cy! - ay!, vz = cz! - az!
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const area2 = Math.hypot(nx, ny, nz)
    if (!area2 || Math.abs(ny) / area2 < 0.9) continue
    const bin = Math.round((ay! + by! + cy!) / 3 / 0.02)
    bins.set(bin, (bins.get(bin) ?? 0) + area2)
    total += area2
  }
  if (!total) return null
  const sorted = [...bins.entries()].sort((a, b) => a[0] - b[0])
  for (const [bin, area] of sorted) {
    // Sum neighbouring bins too: a slightly uneven floor spreads over a few.
    const near = (bins.get(bin - 1) ?? 0) + area + (bins.get(bin + 1) ?? 0)
    if (near > total * 0.15) return bin * 0.02
  }
  return sorted[0]![0] * 0.02
}

/** Where a triangle crosses the plane y = h, as a top-down segment. */
function cut(tris: number[], t: number, h: number): [number, number, number, number] | null {
  const pts: number[] = []
  for (let e = 0; e < 3; e++) {
    const a = t + e * 3, b = t + ((e + 1) % 3) * 3
    const ya = tris[a + 1]! - h, yb = tris[b + 1]! - h
    if ((ya < 0) === (yb < 0)) continue
    const s = ya / (ya - yb)
    pts.push(tris[a]! + (tris[b]! - tris[a]!) * s, tris[a + 2]! + (tris[b + 2]! - tris[a + 2]!) * s)
  }
  return pts.length >= 4 ? [pts[0]!, pts[1]!, pts[2]!, pts[3]!] : null
}

/** Converts a loaded scene (e.g. GLTFLoader's gltf.scene) into rooms and openings. */
export function scanFromModel(THREE: typeof THREE_NS, root: THREE_NS.Object3D): RoomModelImport {
  root.updateMatrixWorld(true)
  const byKind: Record<Kind, number[]> = { wall: [], floor: [], door: [], window: [], other: [] }
  const openingObjects: { type: 'door' | 'window'; tris: number[] }[] = []
  let wallObjects = 0
  root.traverse((o) => {
    if (!(o as THREE_NS.Mesh).isMesh || !o.visible) return
    const kind = kindOf(o)
    const tris = worldTriangles(THREE, o as THREE_NS.Mesh)
    for (const n of tris) byKind[kind].push(n)
    if (kind === 'wall') wallObjects++
    if (kind === 'door' || kind === 'window') openingObjects.push({ type: kind, tris })
  })
  const all = [...byKind.wall, ...byKind.floor, ...byKind.door, ...byKind.window, ...byKind.other]
  const triangles = all.length / 9
  if (!triangles) throw new Error('The file has no 3D geometry.')

  const useObjects = wallObjects >= 3
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity
  for (let i = 0; i < all.length; i += 3) {
    minX = Math.min(minX, all[i]!); maxX = Math.max(maxX, all[i]!)
    maxY = Math.max(maxY, all[i + 1]!)
    minZ = Math.min(minZ, all[i + 2]!); maxZ = Math.max(maxZ, all[i + 2]!)
  }
  const pad = 0.5
  let cell = CELL
  while (((maxX - minX + 2 * pad) / cell) * ((maxZ - minZ + 2 * pad) / cell) > MAX_CELLS) cell *= 2
  const w = Math.ceil((maxX - minX + 2 * pad) / cell), h = Math.ceil((maxZ - minZ + 2 * pad) / cell)
  const grid = () => new Grid(w, h, minX - pad, minZ - pad, cell)

  const walls = grid()
  const floor = grid()
  let hasFloor = false

  if (useObjects) {
    // Doors and windows are drawn as wall too: the wall object may have a hole there.
    for (const list of [byKind.wall, byKind.door, byKind.window]) {
      for (let t = 0; t < list.length; t += 9) walls.tri(list[t]!, list[t + 2]!, list[t + 3]!, list[t + 5]!, list[t + 6]!, list[t + 8]!)
    }
    const f = byKind.floor
    for (let t = 0; t < f.length; t += 9) floor.tri(f[t]!, f[t + 2]!, f[t + 3]!, f[t + 5]!, f[t + 6]!, f[t + 8]!)
    hasFloor = f.length > 0
  } else {
    const floorY = findFloor(all)
    if (floorY === null) throw new Error('Couldn\'t find a floor in the scan.')
    const cuts = [floorY + WALL_CUT]
    if (maxY > floorY + LINTEL_CUT + 0.1) cuts.push(floorY + LINTEL_CUT)
    for (let t = 0; t < all.length; t += 9) {
      for (const y of cuts) {
        const s = cut(all, t, y)
        if (s) walls.line(s[0], s[1], s[2], s[3])
      }
      // Floor: near-horizontal triangles at floor height.
      const ay = all[t + 1]!, by = all[t + 4]!, cy = all[t + 7]!
      if (Math.max(ay, by, cy) - floorY > 0.1 || floorY - Math.min(ay, by, cy) > 0.1) continue
      floor.tri(all[t]!, all[t + 2]!, all[t + 3]!, all[t + 5]!, all[t + 6]!, all[t + 8]!)
      hasFloor = true
    }
  }

  const wallCells = dilate(walls, 1)
  let floorCells: Uint8Array
  if (hasFloor) {
    // Close small gaps in the scanned floor, then fill holes left by furniture.
    floor.cells.set(erode(floor, dilate(floor, 2), 2))
    const out = outside(floor, floor.cells)
    floorCells = new Uint8Array(w * h)
    for (let k = 0; k < floorCells.length; k++) floorCells[k] = out[k] ? 0 : 1
  } else {
    // No floor: everything enclosed by walls.
    const out = outside(walls, wallCells)
    floorCells = new Uint8Array(w * h)
    for (let k = 0; k < floorCells.length; k++) floorCells[k] = out[k] || wallCells[k] ? 0 : 1
  }

  const free = new Uint8Array(w * h)
  for (let k = 0; k < free.length; k++) free[k] = floorCells[k] && !wallCells[k] ? 1 : 0
  const { labels, sizes } = label(walls, free)

  // Grow each room back over the cell the wall dilation took, so sizes aren't short.
  const grown = labels.slice()
  for (let k = 0; k < labels.length; k++) {
    if (labels[k] || !wallCells[k] || walls.cells[k]) continue
    const i = k % w
    const near = [i > 0 ? labels[k - 1] : 0, i < w - 1 ? labels[k + 1] : 0, labels[k - w] ?? 0, labels[k + w] ?? 0].filter(Boolean)
    if (near.length && near.every((n) => n === near[0])) grown[k] = near[0]!
  }

  const minCells = MIN_ROOM_AREA / (cell * cell)
  const rooms: ScanRoom[] = []
  sizes.forEach((size, id) => {
    if (!id || size < minCells) return
    const corners = simplify(trace(walls, grown, id), Math.max(SIMPLIFY_TOL, cell * 1.5))
    if (corners.length >= 3) rooms.push({ name: `Room ${rooms.length + 1}`, corners })
  })
  if (!rooms.length) throw new Error('Couldn\'t find any rooms in the scan.')

  const openings: ScanOpening[] = []
  for (const o of openingObjects) {
    const s = span(o.tris)
    if (s) openings.push({ type: o.type, a: s[0], b: s[1] })
  }

  return {
    scan: { rooms, openings, createdAt: Date.now() },
    method: useObjects ? 'objects' : 'mesh',
    triangles,
  }
}

/** Loads a GLB, a self-contained GLTF, or a zip holding a GLTF and its files. */
export async function loadRoomModel(file: File): Promise<THREE_NS.Object3D> {
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')

  const name = file.name.toLowerCase()
  const buf = await file.arrayBuffer()
  const manager = new THREE.LoadingManager()
  const blobUrls: string[] = []
  let data: ArrayBuffer | string = buf

  if (name.endsWith('.zip')) {
    const { unzipSync } = await import('three/examples/jsm/libs/fflate.module.js')
    const files = unzipSync(new Uint8Array(buf))
    const paths = Object.keys(files).filter((p) => !p.startsWith('__MACOSX/'))
    const main = paths.find((p) => p.toLowerCase().endsWith('.glb')) ?? paths.find((p) => p.toLowerCase().endsWith('.gltf'))
    if (!main) throw new Error('The zip has no .glb or .gltf file in it.')
    // Point the GLTF's external files (buffers, textures) at the zip's contents.
    const byName = new Map<string, string>()
    for (const p of paths) {
      if (p === main) continue
      const url = URL.createObjectURL(new Blob([files[p]!]))
      blobUrls.push(url)
      byName.set(p.split('/').pop()!.toLowerCase(), url)
    }
    manager.setURLModifier((url) => byName.get(decodeURIComponent(url.split(/[\\/]/).pop() ?? '').toLowerCase()) ?? url)
    const bytes = files[main]!
    data = main.toLowerCase().endsWith('.glb')
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      : new TextDecoder().decode(bytes)
  } else if (!name.endsWith('.glb') && !name.endsWith('.gltf')) {
    throw new Error('Choose a .glb, .gltf or .zip file exported from Polycam.')
  }

  try {
    const loader = new GLTFLoader(manager)
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.parseAsync(data, '')
    return gltf.scene
  } finally {
    for (const url of blobUrls) URL.revokeObjectURL(url)
  }
}
