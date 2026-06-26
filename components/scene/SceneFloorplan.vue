<script setup lang="ts">
import { Shape, BoxGeometry, ExtrudeGeometry, SphereGeometry, CircleGeometry, Vector2, BufferGeometry, Float32BufferAttribute } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { FloorplanRoom, FloorplanFurniture } from '~/stores/floorplan'
import { getAdapter } from '~/utils/deviceRegistry'

const sceneColors = useSceneColors()
const fp = useFloorplanStore()
const theme = useThemeStore()
const layout = useLayoutStore()
const entities = useEntitiesStore()

/** Map from furnitureId → active light visual state, for items used as light sources. */
const lightSourceVisuals = computed(() => {
  const map = new Map<string, { color: string; intensity: number; active: boolean; domain: string }>()
  for (const p of layout.placements) {
    if (!p.lightSourceFurnitureId) continue
    const entity = entities.get(p.entity_id)
    if (!entity) continue
    const adapter = getAdapter(entity)
    if (!adapter) continue
    const v = adapter.getDisplayState(entity)
    const domain = p.entity_id.split('.')[0]
    map.set(p.lightSourceFurnitureId, { ...v, domain })
  }
  return map
})

function isActiveEmitter(itemId: string): boolean {
  return lightSourceVisuals.value.get(itemId)?.active === true
}

function emissiveIntensity(itemId: string): number {
  const v = lightSourceVisuals.value.get(itemId)
  if (!v || !v.active) return 0
  return v.intensity * 3
}

const HIGHLIGHT = '#5eead4'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tintHex(hex: string, hueShift: number, valueMul: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let H = 0, S = 0
  const L = (max + min) / 2
  if (max !== min) {
    const d = max - min
    S = L > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: H = ((g - b) / d + (g < b ? 6 : 0)) * 60; break
      case g: H = ((b - r) / d + 2) * 60; break
      default: H = ((r - g) / d + 4) * 60; break
    }
  }
  H = (H + hueShift + 360) % 360
  const Lp = Math.max(0, Math.min(1, L * valueMul))
  function hue2rgb(p: number, q: number, t: number) {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = Lp < 0.5 ? Lp * (1 + S) : Lp + S - Lp * S
  const p2 = 2 * Lp - q
  const Hn = H / 360
  const R = Math.round(hue2rgb(p2, q, Hn + 1 / 3) * 255)
  const G = Math.round(hue2rgb(p2, q, Hn) * 255)
  const B = Math.round(hue2rgb(p2, q, Hn - 1 / 3) * 255)
  return `#${[R, G, B].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function roomColor(r: FloorplanRoom): string {
  if (fp.editMode && fp.selection?.id === r.id) return HIGHLIGHT
  return r.color ?? tintHex(sceneColors.value.floor, r.tintH, r.tintV)
}

const roomShapes = computed(() => {
  const map = new Map<string, Shape>()
  for (const room of fp.rooms) {
    const shape = new Shape()
    if (room.vertices.length >= 3) {
      shape.moveTo(room.vertices[0][0], -room.vertices[0][1])
      for (let i = 1; i < room.vertices.length; i++)
        shape.lineTo(room.vertices[i][0], -room.vertices[i][1])
      shape.closePath()
    }
    map.set(room.id, shape)
  }
  return map
})

// ─── Wall geometry with opening gaps ─────────────────────────────────────────

const WALL_HEIGHT = 1.2
const WALL_THICK = 0.12
const WIN_SILL  = WALL_HEIGHT * 0.28   // ~0.34
const WIN_TOP   = WALL_HEIGHT * 0.80   // ~0.96

interface WallPiece {
  key: string
  geo: BufferGeometry
}

// Canonical key for a wall segment — order-independent so reversed duplicates match.
function wallSegKey(x1: number, z1: number, x2: number, z2: number): string {
  const ax = Math.round(x1 * 100), az = Math.round(z1 * 100)
  const bx = Math.round(x2 * 100), bz = Math.round(z2 * 100)
  if (ax < bx || (ax === bx && az <= bz)) return `${ax},${az}|${bx},${bz}`
  return `${bx},${bz}|${ax},${az}`
}

// ─── Mitred wall corner offsets ──────────────────────────────────────────────
// For each room we offset the centreline polygon by ±T/2 with proper mitre joins
// at every vertex. Adjacent wall quads then share the exact same mitred corner
// points, so they meet cleanly at both convex and concave corners instead of
// overshooting/notching the way square box ends do.
interface RoomOffsets { left: [number, number][]; right: [number, number][]; nrm: [number, number][] }

function computeRoomOffsets(verts: [number, number][], dist: number): RoomOffsets {
  const n = verts.length
  const nrm: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n]
    let dx = b[0] - a[0], dz = b[1] - a[1]
    const L = Math.hypot(dx, dz) || 1
    nrm.push([-dz / L, dx / L])   // unit left-hand normal of edge i
  }
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const n1 = nrm[(i + n - 1) % n], n2 = nrm[i]   // normals of the two edges at vertex i
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]
    const ml = Math.hypot(mx, mz)
    if (ml < 1e-6) {
      // 180° degenerate (collinear edges) — just step out along the edge normal.
      left.push([verts[i][0] + n1[0] * dist, verts[i][1] + n1[1] * dist])
      right.push([verts[i][0] - n1[0] * dist, verts[i][1] - n1[1] * dist])
      continue
    }
    mx /= ml; mz /= ml
    // cos(half-angle) between the mitre direction and an edge normal; clamp to
    // avoid runaway spikes on very sharp corners (caps mitre length at 4·dist).
    const cos = Math.max(0.25, mx * n1[0] + mz * n1[1])
    const len = dist / cos
    left.push([verts[i][0] + mx * len, verts[i][1] + mz * len])
    right.push([verts[i][0] - mx * len, verts[i][1] - mz * len])
  }
  return { left, right, nrm }
}

/** Build a world-space extruded wall geometry from a 4-point plan footprint. */
function buildWallGeo(quad: [number, number][], yBottom: number, h: number): BufferGeometry {
  // Shape space: X = world-X, Y = -world-Z (matches the floor's rotateX(-90°) convention).
  let pts = quad.map(([x, z]) => [x, -z] as [number, number])
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  if (area < 0) pts = pts.slice().reverse()   // ensure CCW winding for outward normals
  const shape = new Shape()
  shape.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
  shape.closePath()
  const geo = new ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)        // extrude depth → world Y (wall height)
  geo.translate(0, yBottom, 0)
  geo.computeVertexNormals()
  return geo
}

const _wallGeoCache = new Map<string, { sig: string; geo: BufferGeometry }>()

function getWallGeo(key: string, quad: [number, number][], yBottom: number, h: number): BufferGeometry {
  const sig = quad.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('|') + `|${yBottom.toFixed(3)}|${h.toFixed(3)}`
  const cached = _wallGeoCache.get(key)
  if (cached && cached.sig === sig) return cached.geo
  cached?.geo.dispose()
  const geo = buildWallGeo(quad, yBottom, h)
  _wallGeoCache.set(key, { sig, geo })
  return geo
}

const wallPieces = computed<WallPiece[]>(() => {
  const pieces: WallPiece[] = []
  const seen = new Set<string>()
  const usedKeys = new Set<string>()
  const HALF_T = WALL_THICK / 2

  const offsetsByRoom = new Map<string, RoomOffsets>()
  for (const room of fp.rooms)
    offsetsByRoom.set(room.id, computeRoomOffsets(room.vertices, WALL_THICK / 2))

  // ── Junction-aware corners ───────────────────────────────────────────────
  // Where 3+ walls meet, the per-room mitres overshoot. Each gap is resolved to
  // a shared corner: convex inner gaps mitre to one point both walls share (so a
  // short third wall joins seamlessly), while the WIDEST gap (outer face) is cut
  // straight across between the two walls' perpendicular feet — flush. A core
  // cap polygon, built as a boundary walk of those corners, fills the centre and
  // tiles exactly with the wall ends (no sliver), extruded to the tallest wall's
  // full height. Plain 2-way corners are left untouched.
  const pkey = (x: number, z: number) => `${Math.round(x * 100)},${Math.round(z * 100)}`
  const ovKey = (roomId: string, edgeIdx: number, end: 'A' | 'B', slot: 'L' | 'R') => `${roomId}|${edgeIdx}|${end}|${slot}`
  const slotFor = (end: 'A' | 'B', awaySide: 'CCW' | 'CW'): 'L' | 'R' => ((awaySide === 'CCW') === (end === 'A') ? 'L' : 'R')
  const roomH = (id: string) => fp.rooms.find(r => r.id === id)?.wallH ?? WALL_HEIGHT

  interface JHalf { roomId: string; edgeIdx: number; end: 'A' | 'B'; dirx: number; dirz: number; ang: number; fx: number; fz: number }
  const junctionMap = new Map<string, JHalf[]>()
  const dedup = new Set<string>()
  for (const w of fp.derivedWalls) {
    const k = wallSegKey(w.x1, w.z1, w.x2, w.z2)
    if (dedup.has(k)) continue
    dedup.add(k)
    const ddx = w.x2 - w.x1, ddz = w.z2 - w.z1
    const L = Math.hypot(ddx, ddz)
    if (L < 0.01) continue
    const fx = ddx / L, fz = ddz / L           // wall forward direction (A→B)
    const push = (px: number, pz: number, end: 'A' | 'B', ax: number, az: number) => {
      const he: JHalf = { roomId: w.roomId, edgeIdx: w.edgeIdx, end, dirx: ax, dirz: az, ang: Math.atan2(az, ax), fx, fz }
      const pk = pkey(px, pz)
      const arr = junctionMap.get(pk)
      if (arr) arr.push(he); else junctionMap.set(pk, [he])
    }
    push(w.x1, w.z1, 'A', fx, fz)              // away from start = +forward
    push(w.x2, w.z2, 'B', -fx, -fz)            // away from end   = -forward
  }

  const cornerOv = new Map<string, [number, number]>()
  const caps: { key: string; poly: [number, number][]; h: number }[] = []
  for (const [pk, hes] of junctionMap) {
    if (hes.length < 3) continue               // only 3+-wall junctions
    const parts = pk.split(',')
    const px = Number(parts[0]) / 100, pz = Number(parts[1]) / 100
    hes.sort((a, b) => a.ang - b.ang)
    const m = hes.length

    // Angular gap to the next wall (CCW) for each wall; widest = outer face.
    const gaps: number[] = []
    for (let i = 0; i < m; i++) {
      let g = hes[(i + 1) % m].ang - hes[i].ang
      g = ((g % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      gaps.push(g)
    }
    // Purely right-angled junctions (every gap a multiple of 90°) already meet
    // cleanly with the plain per-room square offsets — skip the heavy mitre/cut.
    const rectilinear = gaps.every(g => {
      const r = g % (Math.PI / 2)
      return Math.min(r, Math.PI / 2 - r) < 0.05
    })
    if (rectilinear) continue

    let gi = 0
    for (let i = 1; i < m; i++) if (gaps[i] > gaps[gi]) gi = i

    // Resolve each gap to a shared corner. A convex inner gap mitres to a single
    // point both walls share (seamless fill). The widest gap (outer face) and any
    // degenerate/reflex gap is "split": each wall keeps its own perpendicular foot
    // so the face is cut straight across (flush) between them.
    type GapPt = { miter: [number, number] } | { a: [number, number]; b: [number, number] }
    const gapPts: GapPt[] = []
    for (let i = 0; i < m; i++) {
      const A = hes[i], B = hes[(i + 1) % m]
      const qA: [number, number] = [px - A.dirz * HALF_T, pz + A.dirx * HALF_T]  // A's CCW foot
      const qB: [number, number] = [px + B.dirz * HALF_T, pz - B.dirx * HALF_T]  // B's CW  foot
      if (i !== gi && gaps[i] > 0.05 && gaps[i] < Math.PI - 0.05) {
        const nAx = -A.dirz, nAz = A.dirx
        const nBx = B.dirz, nBz = -B.dirx
        const p1x = px + nAx * HALF_T, p1z = pz + nAz * HALF_T
        const p2x = px + nBx * HALF_T, p2z = pz + nBz * HALF_T
        const wx = p2x - p1x, wz = p2z - p1z
        const det = B.dirx * A.dirz - A.dirx * B.dirz
        if (Math.abs(det) > 1e-6) {
          const s = (-wx * B.dirz + B.dirx * wz) / det
          let cx = p1x + s * A.dirx, cz = p1z + s * A.dirz
          const d = Math.hypot(cx - px, cz - pz)
          if (d > HALF_T * 8) { const f = (HALF_T * 8) / d; cx = px + (cx - px) * f; cz = pz + (cz - pz) * f }
          gapPts.push({ miter: [cx, cz] })
        } else { gapPts.push({ a: qA, b: qB }) }
      } else {
        gapPts.push({ a: qA, b: qB })            // flush outer face / degenerate
      }
    }

    // Drive each wall's two junction corners from the shared gap points.
    for (let i = 0; i < m; i++) {
      const A = hes[i], B = hes[(i + 1) % m]
      const g = gapPts[i]
      const ptA: [number, number] = 'miter' in g ? g.miter : g.a   // A's CCW-side corner
      const ptB: [number, number] = 'miter' in g ? g.miter : g.b   // B's CW-side corner
      cornerOv.set(ovKey(A.roomId, A.edgeIdx, A.end, slotFor(A.end, 'CCW')), ptA)
      cornerOv.set(ovKey(B.roomId, B.edgeIdx, B.end, slotFor(B.end, 'CW')), ptB)
    }

    // Core cap = boundary walk of the corner points, so it tiles exactly with
    // the (now mitred) wall ends and leaves no sliver. Extrude to the tallest
    // participating wall so the flush cut spans its full height.
    let capH = WALL_HEIGHT
    for (const he of hes) capH = Math.max(capH, roomH(he.roomId))
    const raw: [number, number][] = []
    for (let i = 0; i < m; i++) {
      const prev = gapPts[(i + m - 1) % m]       // wall i's CW-side corner (gap i-1)
      raw.push('miter' in prev ? prev.miter : prev.b)
      const cur = gapPts[i]                       // wall i's CCW-side corner (gap i)
      raw.push('miter' in cur ? cur.miter : cur.a)
    }
    const poly: [number, number][] = []
    for (const p of raw) {
      const last = poly[poly.length - 1]
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) poly.push(p)
    }
    while (poly.length >= 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-4) poly.pop()
    if (poly.length >= 3) caps.push({ key: `cap-${pk}`, poly, h: capH })
  }

  for (const wall of fp.derivedWalls) {
    // Skip the duplicate side of a shared interior wall
    const segKey = wallSegKey(wall.x1, wall.z1, wall.x2, wall.z2)
    if (seen.has(segKey)) continue
    seen.add(segKey)

    const dx = wall.x2 - wall.x1
    const dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 0.01) continue
    const wallNormX = dx / len
    const wallNormZ = dz / len

    const off = offsetsByRoom.get(wall.roomId)
    const vi = wall.edgeIdx
    const viNext = off ? (vi + 1) % off.left.length : 0

    // Resolve the wall's two side points at a parameter t∈[0,1] along the edge.
    // At the very ends (t≈0/1) we snap to the mitred corner points (or junction
    // overrides) so neighbouring walls join cleanly; in between (e.g. door/window
    // jambs) we cut perpendicular to the wall so openings stay square.
    const cutAt = (t: number): { L: [number, number]; R: [number, number] } => {
      if (off && t <= 1e-4) {
        const l = cornerOv.get(ovKey(wall.roomId, vi, 'A', 'L')) ?? off.left[vi]
        const r = cornerOv.get(ovKey(wall.roomId, vi, 'A', 'R')) ?? off.right[vi]
        return { L: l, R: r }
      }
      if (off && t >= 1 - 1e-4) {
        const l = cornerOv.get(ovKey(wall.roomId, vi, 'B', 'L')) ?? off.left[viNext]
        const r = cornerOv.get(ovKey(wall.roomId, vi, 'B', 'R')) ?? off.right[viNext]
        return { L: l, R: r }
      }
      const cx = wall.x1 + t * dx
      const cz = wall.z1 + t * dz
      const nx = (off ? off.nrm[vi][0] : -wallNormZ) * HALF_T
      const nz = (off ? off.nrm[vi][1] : wallNormX) * HALF_T
      return { L: [cx + nx, cz + nz], R: [cx - nx, cz - nz] }
    }

    // This handles exact shared walls (opposite direction), partial overlaps
    // (sub-segments from adjacent rooms), and T-junctions — all cases where
    // a simple roomId+edgeIdx match would miss the opening and render solid
    // wall over a door/window gap.
    const sorted = activeOpeningsForWall(wall, wallNormX, wallNormZ, len).sort((a, b) => a.t - b.t)

    const wallH = fp.rooms.find(r => r.id === wall.roomId)?.wallH ?? WALL_HEIGHT

    type SegType = 'solid' | 'door' | 'window'
    const segs: { t0: number; t1: number; type: SegType; openingH?: number; openingSill?: number }[] = []
    let cursor = 0

    for (const op of sorted) {
      const halfT = (op.width / 2) / len
      const t0 = Math.max(0, op.t - halfT)
      const t1 = Math.min(1, op.t + halfT)
      if (t0 > cursor + 0.001) segs.push({ t0: cursor, t1: t0, type: 'solid' })
      segs.push({ t0, t1, type: op.type as SegType, openingH: op.height, openingSill: op.sill })
      cursor = t1
    }
    if (cursor < 1 - 0.001) segs.push({ t0: cursor, t1: 1, type: 'solid' })

    let pi = 0
    for (const seg of segs) {
      const segLen = (seg.t1 - seg.t0) * len
      if (segLen < 0.01) { pi++; continue }
      const a = cutAt(seg.t0)
      const b = cutAt(seg.t1)
      const quad: [number, number][] = [a.L, b.L, b.R, a.R]
      const base = `${wall.roomId}-${wall.edgeIdx}-${pi++}`

      const emit = (key: string, yBottom: number, h: number) => {
        if (h <= 0.01) return
        usedKeys.add(key)
        pieces.push({ key, geo: getWallGeo(key, quad, yBottom, h) })
      }

      if (seg.type === 'solid') {
        emit(base, 0, wallH)
      } else if (seg.type === 'door') {
        const doorH = Math.min(seg.openingH ?? wallH, wallH)
        emit(base + 'l', doorH, wallH - doorH)   // lintel above the door
      } else {
        // Window: sill piece below + lintel piece above
        const winSill = seg.openingSill ?? wallH * 0.28
        const winH = seg.openingH ?? wallH * 0.52
        const winTop = winSill + winH
        emit(base + 'a', 0, winSill)
        emit(base + 'b', winTop, wallH - winTop)
      }
    }
  }

  // Emit the junction core caps (flush outer face + filled inner corners).
  for (const c of caps) {
    usedKeys.add(c.key)
    pieces.push({ key: c.key, geo: getWallGeo(c.key, c.poly, 0, c.h) })
  }

  // Dispose cached geometries for pieces that no longer exist.
  for (const [key, entry] of _wallGeoCache) {
    if (!usedKeys.has(key)) {
      entry.geo.dispose()
      _wallGeoCache.delete(key)
    }
  }
  return pieces
})

// ─── Window glass + sill ledge geometry ──────────────────────────────────────

const SILL_LEDGE_H     = 0.028          // height of the ledge shelf
const SILL_LEDGE_DEPTH = WALL_THICK + 0.07  // ledge protrudes slightly beyond wall thickness

interface WindowPiece {
  key: string
  cx: number; cz: number
  width: number
  rotY: number
  sillY: number
  glassH: number
}

/** Resolve active openings that lie on the given wall segment (same logic as wallPieces). */
function activeOpeningsForWall(
  wall: { x1: number; z1: number; x2: number; z2: number },
  wallNormX: number, wallNormZ: number, len: number
) {
  const GEO_EPS = 0.025
  return fp.openings.flatMap(o => {
    const oRoom = fp.rooms.find(r => r.id === o.roomId)
    if (!oRoom) return []
    const n = oRoom.vertices.length
    const vA = oRoom.vertices[o.edgeIdx]
    const vB = oRoom.vertices[(o.edgeIdx + 1) % n]
    const eDx = vB[0] - vA[0]
    const eDz = vB[1] - vA[1]
    const eLen = Math.hypot(eDx, eDz)
    if (eLen < 0.01) return []
    const dot = Math.abs((eDx / eLen) * wallNormX + (eDz / eLen) * wallNormZ)
    if (dot < 0.99) return []
    const wx = vA[0] + o.t * eDx
    const wz = vA[1] + o.t * eDz
    const relX = wx - wall.x1
    const relZ = wz - wall.z1
    const perp = Math.abs(relX * (-wallNormZ) + relZ * wallNormX)
    if (perp > GEO_EPS) return []
    const t = (relX * wallNormX + relZ * wallNormZ) / len
    if (t < -0.01 || t > 1.01) return []
    return [{ ...o, t: Math.max(0, Math.min(1, t)) }]
  })
}

const windowPieces = computed<WindowPiece[]>(() => {
  const pieces: WindowPiece[] = []
  const seen = new Set<string>()

  for (const wall of fp.derivedWalls) {
    const segKey = wallSegKey(wall.x1, wall.z1, wall.x2, wall.z2)
    if (seen.has(segKey)) continue
    seen.add(segKey)

    const dx = wall.x2 - wall.x1
    const dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 0.01) continue
    const rotY = -Math.atan2(dz, dx)
    const wallNormX = dx / len
    const wallNormZ = dz / len
    const wallH = fp.rooms.find(r => r.id === wall.roomId)?.wallH ?? WALL_HEIGHT

    for (const op of activeOpeningsForWall(wall, wallNormX, wallNormZ, len)) {
      if (op.type !== 'window') continue
      const cx = wall.x1 + op.t * dx
      const cz = wall.z1 + op.t * dz
      const sillY = op.sill ?? wallH * 0.28
      const glassH = op.height ?? wallH * 0.52
      pieces.push({ key: `${wall.roomId}-${wall.edgeIdx}-${Math.round(op.t * 1000)}-wp`, cx, cz, width: op.width, rotY, sillY, glassH })
    }
  }
  return pieces
})

function furnitureColor(f: FloorplanFurniture): string {
  if (fp.editMode && fp.selection?.id === f.id) return HIGHLIGHT
  return f.color ?? tintHex(sceneColors.value.furniture, f.tintH, f.tintV)
}

// ─── Furniture geometry cache (separate XZ corner + Y edge rounding) ─────────

/**
 * Build a THREE.Shape for a (possibly elliptic) rounded rectangle in the XY plane.
 * corners = [TL, TR, BR, BL] x-radii; rho = per-corner ry/rx aspect ratio (default 1 = circular).
 * When rho[i] = d/w for all i, the shape approximates a true ellipse.
 */
function makeRoundedRectShape(
  w: number, d: number,
  corners: [number, number, number, number],
  rho?: [number, number, number, number],
): Shape {
  const hw = w / 2, hd = d / 2
  const p = rho ?? ([1, 1, 1, 1] as [number, number, number, number])
  type C = { rx: number; ry: number }
  // Clamp rx to half-width, ry = rx*rho clamped to half-depth
  const c = corners.map((rx, i): C => {
    const rxC = Math.min(Math.max(0, rx), hw * 0.999)
    const ry  = Math.min(rxC * Math.max(0, p[i]), hd * 0.999)
    return { rx: rxC, ry }
  }) as [C, C, C, C]
  const [tl, tr, br, bl] = c
  const shape = new Shape()
  shape.moveTo(-hw + bl.rx, -hd)
  shape.lineTo(hw - br.rx, -hd)
  if (br.rx > 0.001) shape.absellipse(hw - br.rx, -hd + br.ry, br.rx, br.ry, -Math.PI / 2, 0, false, 0)
  shape.lineTo(hw, hd - tr.ry)
  if (tr.rx > 0.001) shape.absellipse(hw - tr.rx, hd - tr.ry, tr.rx, tr.ry, 0, Math.PI / 2, false, 0)
  shape.lineTo(-hw + tl.rx, hd)
  if (tl.rx > 0.001) shape.absellipse(-hw + tl.rx, hd - tl.ry, tl.rx, tl.ry, Math.PI / 2, Math.PI, false, 0)
  shape.lineTo(-hw, -hd + bl.ry)
  if (bl.rx > 0.001) shape.absellipse(-hw + bl.rx, -hd + bl.ry, bl.rx, bl.ry, Math.PI, 3 * Math.PI / 2, false, 0)
  shape.closePath()
  return shape
}

/** Build a THREE.Shape for an ellipse in the XY plane (w/2 and d/2 as radii). */
function makeEllipseShape(w: number, d: number): Shape {
  const shape = new Shape()
  shape.absellipse(0, 0, w / 2, d / 2, 0, Math.PI * 2, false, 0)
  return shape
}

/** Signed volume of an indexed triangle mesh (>0 ⇒ outward-facing winding). */
function meshSignedVolume(pos: number[], idx: number[]): number {
  let v = 0
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])
  }
  return v / 6
}

/**
 * Build an ellipse (or per-corner elliptic) prism with rounded top/bottom Y edges.
 *
 * Unlike the ExtrudeGeometry bevel path (which offsets each profile vertex along its normal
 * and so drifts away from the W/D footprint for curved outlines), this keeps the waist
 * cross-section EXACTLY on the requested footprint and sweeps it vertically, insetting it
 * along its own inward normals to form a true rounded fillet at each end. topRY/botRY are
 * independent so per-edge (top/bottom) rounding aligns with the radius footprint too.
 */
function buildEllipseGeoRounded(
  w: number, d: number, h: number,
  topRYin: number, botRYin: number,
  cornerRadii?: [number, number, number, number],
  cornerRho?: [number, number, number, number],
  segments?: number,
): BufferGeometry {
  const seg = Math.max(8, segments ?? Math.min(96, Math.max(24, Math.round(Math.max(w, d) * 8))))
  const maxXZ = Math.min(w, d) * 0.49
  let topRY = Math.min(Math.max(0, topRYin), maxXZ, h * 0.5)
  let botRY = Math.min(Math.max(0, botRYin), maxXZ, h * 0.5)
  if (topRY + botRY > h && topRY + botRY > 0) {
    const k = h / (topRY + botRY)
    topRY *= k; botRY *= k
  }

  // Full-size footprint outline = the waist cross-section, centred at origin in XY.
  const footprint = cornerRadii
    ? makeRoundedRectShape(w, d, cornerRadii, cornerRho)
    : makeEllipseShape(w, d)
  const sampled = footprint.getSpacedPoints(seg)        // seg+1 pts, last ≈ first
  const ring = sampled.slice(0, sampled.length - 1)     // unique closed loop
  const N = ring.length
  // Inward normals (footprint is convex & centred ⇒ point toward origin).
  const inN: Vector2[] = ring.map((p, i) => {
    const a = ring[(i - 1 + N) % N], b = ring[(i + 1) % N]
    let nx = -(b.y - a.y), ny = (b.x - a.x)             // perpendicular to tangent
    const len = Math.hypot(nx, ny) || 1
    nx /= len; ny /= len
    if (nx * p.x + ny * p.y > 0) { nx = -nx; ny = -ny }  // orient inward
    return new Vector2(nx, ny)
  })

  // Vertical layers: { y, delta } where delta = inward offset from the footprint.
  const layers: { y: number; delta: number }[] = []
  const nBot = botRY > 0.001 ? Math.max(2, Math.round(botRY * 16)) : 0
  const nTop = topRY > 0.001 ? Math.max(2, Math.round(topRY * 16)) : 0
  if (nBot === 0) {
    layers.push({ y: -h / 2, delta: 0 })
  } else {
    for (let i = 0; i <= nBot; i++) {
      const phi = (i / nBot) * (Math.PI / 2)
      layers.push({ y: -h / 2 + botRY * (1 - Math.cos(phi)), delta: botRY * (1 - Math.sin(phi)) })
    }
  }
  if (nTop === 0) {
    layers.push({ y: h / 2, delta: 0 })
  } else {
    for (let i = nTop; i >= 0; i--) {
      const phi = (i / nTop) * (Math.PI / 2)
      layers.push({ y: h / 2 - topRY * (1 - Math.cos(phi)), delta: topRY * (1 - Math.sin(phi)) })
    }
  }

  const positions: number[] = []
  const layerStart: number[] = []
  const maxDelta = maxXZ * 0.98
  for (const L of layers) {
    layerStart.push(positions.length / 3)
    const dlt = Math.min(L.delta, maxDelta)
    for (let j = 0; j < N; j++) {
      // world: x = X, z = -Y (matches the rotateX(-π/2) convention used elsewhere)
      positions.push(ring[j].x + inN[j].x * dlt, L.y, -(ring[j].y + inN[j].y * dlt))
    }
  }
  const botCenter = positions.length / 3
  positions.push(0, layers[0].y, 0)
  const topCenter = positions.length / 3
  positions.push(0, layers[layers.length - 1].y, 0)

  const indices: number[] = []
  for (let l = 0; l < layers.length - 1; l++) {
    const a = layerStart[l], b = layerStart[l + 1]
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N
      indices.push(a + j, a + j2, b + j2, a + j, b + j2, b + j)
    }
  }
  const first = layerStart[0]
  for (let j = 0; j < N; j++) indices.push(botCenter, first + (j + 1) % N, first + j)
  const last = layerStart[layers.length - 1]
  for (let j = 0; j < N; j++) indices.push(topCenter, last + j, last + (j + 1) % N)

  // Ensure outward-facing winding regardless of footprint orientation.
  if (meshSignedVolume(positions, indices) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0)
  geo.computeVertexNormals()
  return geo
}

/** Return the outer XY footprint shape for a furniture item (full size, no bevel inset). */
function buildFootprintShape(
  w: number, d: number,
  shape: 'box' | 'rounded' | 'ellipse',
  rXZ: number,
  cornerRadii?: [number, number, number, number],
  cornerRho?: [number, number, number, number],
): Shape {
  if (shape === 'ellipse' && !cornerRadii) return makeEllipseShape(w, d)
  const rxz = shape === 'rounded' ? Math.min(Math.max(0, rXZ), Math.min(w, d) * 0.499) : 0
  return makeRoundedRectShape(w, d, cornerRadii ?? [rxz, rxz, rxz, rxz], cornerRho)
}

/**
 * Build a hole Shape in the base item's XY profile space from a subtract item.
 * Accounts for XZ position offset and relative Y-axis rotation between the two items.
 * Profile convention: shape-X = world-X, shape-Y = world-(-Z) (from rotateX(-PI/2)).
 */
function makeHoleShape(holeItem: FloorplanFurniture, baseItem: FloorplanFurniture): Shape {
  const hSh = holeItem.shape ?? 'box'
  const footprint = buildFootprintShape(holeItem.w, holeItem.d, hSh, holeItem.radius ?? 0, holeItem.cornerRadii, holeItem.cornerRho)
  // Offset in world XZ, rotated into base item's local space
  const dxW = holeItem.x - baseItem.x
  const dzW = holeItem.z - baseItem.z
  const baseRad = (baseItem.rotY ?? 0) * Math.PI / 180
  const cosB = Math.cos(-baseRad), sinB = Math.sin(-baseRad)
  const dxL = dxW * cosB - dzW * sinB
  const dzL = dxW * sinB + dzW * cosB
  // Map to profile space: X=localX, Y=-localZ
  const dx = dxL, dy = -dzL
  // Relative rotation of hole vs base (negated for profile/CCW winding)
  const relRad = -((holeItem.rotY ?? 0) - (baseItem.rotY ?? 0)) * Math.PI / 180
  const cosR = Math.cos(relRad), sinR = Math.sin(relRad)
  const pts = footprint.getPoints(64).map(p => new Vector2(
    p.x * cosR - p.y * sinR + dx,
    p.x * sinR + p.y * cosR + dy,
  ))
  return new Shape(pts)
}

/**
 * Build furniture geometry.
 * - shape 'box': plain BoxGeometry (unless holes/bevel require extrusion).
 * - shape 'rounded': extruded rounded-rect; supports per-corner radii + rho.
 * - shape 'ellipse': extruded ellipse or per-corner elliptic arcs.
 * holes = optional hole Shapes in the same XY profile space (for subtract boolean).
 */
function buildFurnitureGeo(
  w: number, h: number, d: number,
  rXZ: number, rY: number,
  shape: 'box' | 'rounded' | 'ellipse',
  cornerRadii?: [number, number, number, number],
  cornerRho?: [number, number, number, number],
  holes?: Shape[],
  segments?: number,
  edgeRadii?: [number, number],
): BufferGeometry {
  const hasHoles = !!holes?.length

  // Ellipse with rounded Y edges → dedicated builder that keeps the waist cross-section
  // aligned with the W/D (and per-corner) footprint. ExtrudeGeometry's bevel offsets each
  // vertex along its normal, which is exact for straight box edges but drifts on a curved
  // outline, so the rounded edge no longer lines up with the radius values for ellipses.
  if (shape === 'ellipse' && !hasHoles) {
    const topRY = Math.max(0, edgeRadii ? edgeRadii[0] : rY)
    const botRY = Math.max(0, edgeRadii ? edgeRadii[1] : rY)
    if (topRY > 0.001 || botRY > 0.001)
      return buildEllipseGeoRounded(w, d, h, topRY, botRY, cornerRadii, cornerRho, segments)
  }

  // Per-edge asymmetric bevel: delegate when top ≠ bottom
  if (edgeRadii && Math.abs(edgeRadii[0] - edgeRadii[1]) > 0.001)
    return buildFurnitureGeoAsymBevel(w, h, d, rXZ, edgeRadii[0], edgeRadii[1], shape, cornerRadii, cornerRho, holes, segments)
  const ry = Math.min(Math.max(0, edgeRadii ? (edgeRadii[0] + edgeRadii[1]) / 2 : rY), h * 0.499)

  // Fast path: plain box with no special features
  if (shape === 'box' && ry < 0.001 && !hasHoles) return new BoxGeometry(w, h, d)

  const inset = ry
  const innerW = Math.max(0.001, w - 2 * inset)
  const innerD = Math.max(0.001, d - 2 * inset)
  const innerH = Math.max(0.001, h - 2 * inset)

  let profileShape: Shape
  let seg: number

  if (shape === 'ellipse') {
    seg = segments ?? Math.min(64, Math.max(16, Math.round(Math.max(w, d) * 8)))
    profileShape = cornerRadii
      ? makeRoundedRectShape(
          innerW, innerD,
          cornerRadii.map(r => Math.max(0, r - inset)) as [number, number, number, number],
          cornerRho,
        )
      : makeEllipseShape(innerW, innerD)
  } else {
    // 'box' (with bevel or holes) or 'rounded'
    const rxz = shape === 'rounded' ? Math.min(Math.max(0, rXZ), Math.min(w, d) * 0.499) : 0
    if (rxz < 0.001 && ry < 0.001 && !cornerRadii && !hasHoles) return new BoxGeometry(w, h, d)
    seg = segments ?? Math.max(3, Math.round(Math.max(rxz, ry, 0.01) * 20))
    const innerR = Math.max(0, rxz - inset)
    const corners: [number, number, number, number] = cornerRadii
      ? cornerRadii.map(r => Math.max(0, r - inset)) as [number, number, number, number]
      : [innerR, innerR, innerR, innerR]
    profileShape = makeRoundedRectShape(innerW, innerD, corners, cornerRho)
  }

  if (hasHoles) profileShape.holes.push(...holes!)

  const geo = new ExtrudeGeometry(profileShape, {
    depth: innerH,
    curveSegments: shape === 'ellipse' ? seg : seg * 4,
    bevelEnabled: ry > 0.001,
    bevelSize: inset,
    bevelThickness: inset,
    bevelSegments: shape === 'ellipse' ? Math.max(3, Math.round(ry * 20)) : seg,
  })
  geo.rotateX(-Math.PI / 2)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0)
  geo.computeVertexNormals()
  return geo
}

/**
 * Build furniture geometry with asymmetric Y-edge bevel (different top vs bottom radius).
 * Uses a 2-piece merge: a "main" piece with the smaller bevel at its outer face, and a
 * symmetric "cap" lens at the big-bevel end. The cap's inner bevel faces are depth-occluded
 * by the main piece and are never visible from any external viewpoint.
 */
function buildFurnitureGeoAsymBevel(
  w: number, h: number, d: number,
  rXZ: number, topRY: number, bottomRY: number,
  shape: 'box' | 'rounded' | 'ellipse',
  cornerRadii?: [number, number, number, number],
  cornerRho?: [number, number, number, number],
  holes?: Shape[],
  segments?: number,
): BufferGeometry {
  const bigRY    = Math.max(topRY, bottomRY)
  const smallRY  = Math.min(topRY, bottomRY)
  const isTopBig = topRY >= bottomRY
  const mainH    = Math.max(0.002, h - bigRY)
  const capH     = bigRY * 2
  const mainGeo  = buildFurnitureGeo(w, mainH, d, rXZ, smallRY, shape, cornerRadii, cornerRho, holes, segments)
  const capGeo   = buildFurnitureGeo(w, capH,  d, rXZ, bigRY,   shape, cornerRadii, cornerRho, holes, segments)
  // Shift main piece so its small-bevel face sits at the correct outer end
  mainGeo.translate(0, isTopBig ? -bigRY / 2 : bigRY / 2, 0)
  // Shift cap so its outer peak aligns with the big-bevel end of the item
  capGeo.translate(0,  isTopBig ? h / 2 - bigRY : -(h / 2 - bigRY), 0)
  const merged = mergeGeometries([mainGeo, capGeo])
  mainGeo.dispose()
  capGeo.dispose()
  if (!merged) return new BoxGeometry(w, h, d)
  merged.computeVertexNormals()
  return merged
}

/**
 * Per-hole info: the XY profile hole shape and the Y range (in base item's local space)
 * over which the hole should be cut. yBottom/yTop are measured from the base item's
 * geometry centre (0 = centre, ±h/2 = bottom/top faces).
 */
interface HoleInfo { shape: Shape; yBottom: number; yTop: number }

/**
 * Build furniture geometry where each subtract hole is only cut within the Y range
 * where the subtract item physically overlaps the base item.
 *
 * If all holes span the full height, the single-piece (bevel-preserving) path is used.
 * For partial-height holes the extrusion is split into segments at each overlap boundary,
 * the middle segment(s) get the hole(s), and the pieces are merged back together.
 * Bevel is omitted on segmented builds (minor trade-off for correct boolean behaviour).
 */
function buildFurnitureGeoSegmented(
  w: number, h: number, d: number,
  rXZ: number, rY: number,
  shape: 'box' | 'rounded' | 'ellipse',
  cornerRadii: [number, number, number, number] | undefined,
  cornerRho: [number, number, number, number] | undefined,
  holeInfos: HoleInfo[],
  segments?: number,
  edgeRadii?: [number, number],
): BufferGeometry {
  const baseBottom = -h / 2
  const baseTop    =  h / 2

  // Filter holes that actually intersect the base item's Y extent
  const active = holeInfos.filter(hi => hi.yBottom < baseTop && hi.yTop > baseBottom)
  if (active.length === 0) return buildFurnitureGeo(w, h, d, rXZ, rY, shape, cornerRadii, cornerRho, undefined, segments, edgeRadii)

  // If every hole spans the full height: use single-piece path (keeps bevel)
  const allFull = active.every(
    hi => hi.yBottom <= baseBottom + 0.0005 && hi.yTop >= baseTop - 0.0005
  )
  if (allFull)
    return buildFurnitureGeo(w, h, d, rXZ, rY, shape, cornerRadii, cornerRho, active.map(hi => hi.shape), segments, edgeRadii)

  // Collect all Y split boundaries, clamped to the base item's extent
  const yBounds = new Set<number>([baseBottom, baseTop])
  for (const hi of active) {
    if (hi.yBottom > baseBottom) yBounds.add(hi.yBottom)
    if (hi.yTop   < baseTop)    yBounds.add(hi.yTop)
  }
  const sorted = [...yBounds].sort((a, b) => a - b)

  const segGeos: BufferGeometry[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const segBot = sorted[i]
    const segTop = sorted[i + 1]
    const segH   = segTop - segBot
    if (segH < 0.0001) continue
    const segMid = (segBot + segTop) / 2

    const segHoles = active
      .filter(hi => hi.yBottom <= segMid && hi.yTop >= segMid)
      .map(hi => hi.shape)

    // Build segment without bevel (rY=0) — bevel at internal seams looks wrong
    const seg = buildFurnitureGeo(
      w, segH, d, rXZ, 0, shape, cornerRadii, cornerRho,
      segHoles.length ? segHoles : undefined,
      segments,
    )
    // Geometry is centred at Y=0 after buildFurnitureGeo; shift to its correct position
    seg.translate(0, (segBot + segTop) / 2, 0)
    segGeos.push(seg)
  }

  if (segGeos.length === 0) return new BoxGeometry(w, h, d)
  if (segGeos.length === 1) return segGeos[0]

  const merged = mergeGeometries(segGeos)
  for (const g of segGeos) g.dispose()
  return merged ?? new BoxGeometry(w, h, d)
}

/**
 * Build a sphere (or half-sphere) geometry.
 *
 * - style 'pill'       : equal XZ radii = min(w, d) / 2, Y radius = h / 2.
 * - style 'elliptical' : independent radii rx = w/2, ry = h/2, rz = d/2.
 *
 * For half-sphere, `cutY` is the normalised cut plane position on the unit sphere
 * (-1 = bottom, 0 = equator, +1 = top).  The dome is the part above the cut.
 * A flat circular/elliptical cap is added to close the open bottom face.
 *
 * The returned geometry is centred at origin (bounding-box centre = 0).
 */
function buildSphereGeo(
  w: number, h: number, d: number,
  mode: 'full' | 'half',
  style: 'pill' | 'elliptical',
  cutY: number,
  segments?: number,
): BufferGeometry {
  const segs = segments ?? Math.max(16, Math.round(Math.max(w, h, d) * 10))
  const rx = style === 'pill' ? Math.min(w, d) / 2 : w / 2
  const ry = h / 2
  const rz = style === 'pill' ? Math.min(w, d) / 2 : d / 2

  const clampedCut = Math.max(-0.9999, Math.min(0.9999, cutY))
  const thetaLength = mode === 'full' ? Math.PI : Math.acos(clampedCut)

  const sphereGeo = new SphereGeometry(1, segs * 2, segs, 0, Math.PI * 2, 0, thetaLength)
  sphereGeo.scale(rx, ry, rz)

  if (mode === 'half') {
    // Cap: circle of unit-radius sqrt(1 - cutY²) in XY plane, rotated to XZ, scaled to ellipse
    const capR  = Math.sqrt(1 - clampedCut * clampedCut)
    const capGeo = new CircleGeometry(capR, segs * 2)
    capGeo.rotateX(Math.PI / 2)   // XY→XZ; normals now point −Y (outward from dome bottom)
    capGeo.scale(rx, 1, rz)
    capGeo.translate(0, ry * clampedCut, 0)
    const merged = mergeGeometries([sphereGeo, capGeo])
    sphereGeo.dispose()
    capGeo.dispose()
    const geo = merged ?? new BoxGeometry(w, h, d)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0)
    geo.computeVertexNormals()
    return geo
  }

  sphereGeo.computeBoundingBox()
  const bb = sphereGeo.boundingBox!
  sphereGeo.translate(0, -(bb.min.y + bb.max.y) / 2, 0)
  sphereGeo.computeVertexNormals()
  return sphereGeo
}

const _geoCache = new Map<string, { key: string; geo: BufferGeometry }>()

function getFurnitureGeometry(item: FloorplanFurniture): BufferGeometry {
  const rxz   = Math.max(0, item.radius  ?? 0)
  const ry    = Math.max(0, item.radiusY ?? 0)
  const edgeR = item.edgeRadii
  const cr    = item.cornerRadii
  const crho  = item.cornerRho
  // Determine effective shape: explicit field takes priority; otherwise infer from radius values
  const sh: 'box' | 'rounded' | 'ellipse' | 'sphere' = item.shape
    ?? ((rxz > 0.001 || ry > 0.001 || cr) ? 'rounded' : 'box')

  // ── Sphere fast path ────────────────────────────────────────────────────────
  if (sh === 'sphere') {
    const sMode  = item.sphereMode  ?? 'full'
    const sStyle = item.sphereStyle ?? 'pill'
    const sCutY  = item.sphereCutY  ?? 0
    const cacheKey = `sphere|${item.w}|${item.h}|${item.d}|${sMode}|${sStyle}|${sCutY}|${item.segments ?? ''}`
    const cached = _geoCache.get(item.id)
    if (cached?.key === cacheKey) return cached.geo
    cached?.geo.dispose()
    const geo = buildSphereGeo(item.w, item.h, item.d, sMode, sStyle, sCutY, item.segments)
    _geoCache.set(item.id, { key: cacheKey, geo })
    return geo
  }

  // Collect subtract siblings; compute per-hole Y overlap with the base item
  let holeInfos: HoleInfo[] | undefined
  let holeKey = ''
  if (item.groupId && !item.subtract) {
    const subs = fp.furniture.filter(f => f.groupId === item.groupId && !!f.subtract)
    if (subs.length) {
      const baseWorldBottom = item.y - item.h / 2
      const baseWorldTop   = item.y + item.h / 2
      const infos: HoleInfo[] = []
      for (const s of subs) {
        const sBottom = s.y - s.h / 2
        const sTop    = s.y + s.h / 2
        const overlapBottom = Math.max(sBottom, baseWorldBottom)
        const overlapTop    = Math.min(sTop,    baseWorldTop)
        if (overlapBottom >= overlapTop) continue  // no vertical overlap at all
        infos.push({
          shape:   makeHoleShape(s, item),
          yBottom: overlapBottom - item.y,  // convert to base-item local Y
          yTop:    overlapTop   - item.y,
        })
      }
      if (infos.length) {
        holeInfos = infos
        // Cache key includes s.y and s.h so moving a subtract item invalidates the cache
        holeKey = subs.map(s =>
          `${s.id}:${s.x},${s.y},${s.z},${s.w},${s.h},${s.d},${s.rotY ?? 0},${s.shape ?? ''},${s.radius ?? 0},${s.cornerRadii?.join(',') ?? ''},${s.cornerRho?.join(',') ?? ''}`
        ).join('|')
      }
    }
  }

  // item.y is part of the key because Y position affects which subtract items overlap
  const cacheKey = `${item.w}|${item.h}|${item.d}|${item.y}|${rxz}|${ry}|${edgeR ? edgeR.join(',') : ''}|${sh}|${cr ? cr.join(',') : ''}|${crho ? crho.join(',') : ''}|${item.segments ?? ''}|${holeKey}`
  const cached = _geoCache.get(item.id)
  if (cached?.key === cacheKey) return cached.geo
  cached?.geo.dispose()
  const geo = holeInfos
    ? buildFurnitureGeoSegmented(item.w, item.h, item.d, rxz, ry, sh as 'box' | 'rounded' | 'ellipse', cr, crho, holeInfos, item.segments, edgeR)
    : buildFurnitureGeo(item.w, item.h, item.d, rxz, ry, sh as 'box' | 'rounded' | 'ellipse', cr, crho, undefined, item.segments, edgeR)
  _geoCache.set(item.id, { key: cacheKey, geo })
  return geo
}

onUnmounted(() => {
  for (const { geo } of _geoCache.values()) geo.dispose()
  _geoCache.clear()
  for (const { geo } of _wallGeoCache.values()) geo.dispose()
  _wallGeoCache.clear()
})
</script>

<template>
  <TresGroup>
    <!-- Per-room floor tiles -->
    <TresMesh
      v-for="room in fp.rooms"
      :key="room.id"
      :position="[0, 0, 0]"
      :rotation="[-Math.PI / 2, 0, 0]"
      receive-shadow
      @click="fp.editMode ? fp.select('room', room.id) : undefined"
    >
      <TresShapeGeometry :args="[roomShapes.get(room.id), 1]" />
      <TresMeshStandardMaterial :color="roomColor(room)" :roughness="0.95" />
    </TresMesh>

    <!-- Auto-derived walls (with door/window opening gaps) -->
    <TresMesh
      v-for="piece in wallPieces"
      :key="piece.key"
      :geometry="piece.geo"
      :position="[0, 0, 0]"
      cast-shadow
      receive-shadow
    >
      <TresMeshStandardMaterial
        :key="`wm-${theme.wallOpacityMode}`"
        :color="sceneColors.wall"
        :roughness="0.85"
        :transparent="theme.wallOpacityMode !== 'solid'"
        :opacity="theme.wallOpacity"
        :depth-write="theme.wallOpacityMode === 'solid'"
      />
    </TresMesh>

    <!-- Window glass panes -->
    <TresMesh
      v-for="wp in windowPieces"
      :key="wp.key + '-glass'"
      :position="[wp.cx, wp.sillY + wp.glassH / 2, wp.cz]"
      :rotation="[0, wp.rotY, 0]"
    >
      <TresBoxGeometry :args="[wp.width, wp.glassH, 0.008]" />
      <TresMeshStandardMaterial
        :key="`gm-${theme.wallOpacityMode}`"
        color="#a8d8f0"
        :roughness="0.05"
        :metalness="0.1"
        :transparent="true"
        :opacity="0.32 * theme.wallOpacity"
        :depth-write="false"
      />
    </TresMesh>

    <!-- Window sill ledges -->
    <TresMesh
      v-for="wp in windowPieces"
      :key="wp.key + '-sill'"
      :position="[wp.cx, wp.sillY + SILL_LEDGE_H / 2, wp.cz]"
      :rotation="[0, wp.rotY, 0]"
      cast-shadow
      receive-shadow
    >
      <TresBoxGeometry :args="[wp.width + 0.02, SILL_LEDGE_H, SILL_LEDGE_DEPTH]" />
      <TresMeshStandardMaterial
        :key="`sm-${theme.wallOpacityMode}`"
        :color="sceneColors.wall"
        :roughness="0.6"
        :transparent="theme.wallOpacityMode !== 'solid'"
        :opacity="theme.wallOpacity"
        :depth-write="theme.wallOpacityMode === 'solid'"
      />
    </TresMesh>

    <!-- Furniture: grouped items wrapped in TresGroup with group-level transform -->
    <TresGroup
      v-for="group in fp.furnitureGroups"
      :key="group.id"
      :position="[group.x ?? 0, group.y ?? 0, group.z ?? 0]"
      :rotation="[(group.rotX ?? 0) * Math.PI / 180, (group.rotY ?? 0) * Math.PI / 180, (group.rotZ ?? 0) * Math.PI / 180]"
    >
      <TresMesh
        v-for="item in fp.furniture.filter(f => f.groupId === group.id)"
        :key="item.id"
        :geometry="getFurnitureGeometry(item)"
        :position="[item.x, item.y, item.z]"
        :rotation="[(item.rotX ?? 0) * Math.PI / 180, (item.rotY ?? 0) * Math.PI / 180, (item.rotZ ?? 0) * Math.PI / 180]"
        :receive-shadow="!isActiveEmitter(item.id) && !item.subtract"
        :visible="!item.subtract || fp.editMode"
        @click="fp.editMode ? fp.select('furniture', item.id) : undefined"
      >
        <TresMeshStandardMaterial
          v-if="!item.subtract"
          :color="furnitureColor(item)"
          :roughness="0.7"
          :emissive="lightSourceVisuals.get(item.id)?.color ?? '#000000'"
          :emissive-intensity="emissiveIntensity(item.id)"
        />
        <!-- Subtract items: visible only in edit mode as a transparent red indicator -->
        <TresMeshStandardMaterial
          v-else
          color="#ff5533"
          :transparent="true"
          :opacity="0.38"
          :depth-write="false"
          :roughness="0.5"
        />
      </TresMesh>
    </TresGroup>

    <!-- Ungrouped furniture -->
    <TresMesh
      v-for="item in fp.furniture.filter(f => !f.groupId)"
      :key="item.id"
      :geometry="getFurnitureGeometry(item)"
      :position="[item.x, item.y, item.z]"
      :rotation="[(item.rotX ?? 0) * Math.PI / 180, (item.rotY ?? 0) * Math.PI / 180, (item.rotZ ?? 0) * Math.PI / 180]"
      :receive-shadow="!isActiveEmitter(item.id)"
      @click="fp.editMode ? fp.select('furniture', item.id) : undefined"
    >
      <TresMeshStandardMaterial
        :color="furnitureColor(item)"
        :roughness="0.7"
        :emissive="lightSourceVisuals.get(item.id)?.color ?? '#000000'"
        :emissive-intensity="emissiveIntensity(item.id)"
      />
    </TresMesh>
  </TresGroup>
</template>