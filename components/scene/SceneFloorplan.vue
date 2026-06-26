<script setup lang="ts">
import { Shape, BoxGeometry, ExtrudeGeometry, BufferGeometry, MeshBasicMaterial, MeshDepthMaterial, Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { FloorplanRoom, FloorplanFurniture } from '~/stores/floorplan'
import {
  makeRoundedRectShape, makeEllipseShape, buildEllipseGeoRounded,
  buildFootprintShape, makeHoleShape, buildFurnitureGeo, buildFurnitureGeoAsymBevel,
  buildFurnitureGeoSegmented, buildSphereGeo,
  type HoleInfo,
} from '~/utils/furnitureGeometry'
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
// Walls taller than this opt out of receive-shadow so lights don't paint
// shadow patches onto their top surface (visible in the dollhouse view).
const WALL_SHADOW_RECEIVE_MAX_H = 1.8

interface WallPiece {
  key: string
  geo: BufferGeometry
  /** Total wall height this piece belongs to (room wallH, or junction-cap height). */
  wallH: number
}

// Canonical key for a wall segment — order-independent so reversed duplicates match.
function wallSegKey(x1: number, z1: number, x2: number, z2: number): string {
  const ax = Math.round(x1 * 100), az = Math.round(z1 * 100)
  const bx = Math.round(x2 * 100), bz = Math.round(z2 * 100)
  if (ax < bx || (ax === bx && az <= bz)) return `${ax},${az}|${bx},${bz}`
  return `${bx},${bz}|${ax},${az}`
}

// Walls explicitly hidden in 3D, keyed by the owning room + edge index. Only the
// room's own wall leaf is hidden — a wall on the same shared boundary belonging
// to an adjacent room stays visible.
const hiddenWallKeys = computed(() => {
  const set = new Set<string>()
  for (const room of fp.rooms) {
    for (const e of room.hiddenWalls ?? []) {
      set.add(`${room.id}|${e}`)
    }
  }
  return set
})
function isWallHidden(w: { roomId: string; edgeIdx: number }): boolean {
  return hiddenWallKeys.value.has(`${w.roomId}|${w.edgeIdx}`)
}

// ─── Mitred wall corner offsets ──────────────────────────────────────────────
// For each room we offset the polygon inward (left side) by the full wall
// thickness and keep the outer (right) side on the polygon edge (distRight=0).
// The polygon boundary is therefore the OUTER face of every wall.
interface RoomOffsets { left: [number, number][]; right: [number, number][]; nrm: [number, number][] }

function computeRoomOffsets(verts: [number, number][], distLeft: number | number[], distRight: number = 0): RoomOffsets {
  const n = verts.length
  // Per-edge inner-offset distance. A scalar applies the same thickness to every edge.
  const dL = (i: number) => Array.isArray(distLeft) ? (distLeft[i] ?? WALL_THICK) : distLeft
  // Detect polygon winding: positive signed area = CCW in standard XY/XZ,
  // where the left-hand normal points inward. Negate normals for CW polygons
  // so "left" always means toward the room interior.
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n]
    area += a[0] * b[1] - b[0] * a[1]
  }
  const windSign = area >= 0 ? 1 : -1
  const nrm: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n]
    let dx = b[0] - a[0], dz = b[1] - a[1]
    const L = Math.hypot(dx, dz) || 1
    nrm.push([-dz / L * windSign, dx / L * windSign])   // inward normal of edge i
  }
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const ip = (i + n - 1) % n
    const n1 = nrm[ip], n2 = nrm[i]   // normals of the two edges at vertex i
    const d1 = dL(ip), d2 = dL(i)     // inner-offset distance of each adjacent edge
    const cosE = n1[0] * n2[0] + n1[1] * n2[1]   // cosine between the two edge normals
    const denom = 1 - cosE * cosE
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]
    const ml = Math.hypot(mx, mz)
    if (ml < 1e-6 || denom < 1e-6) {
      // 180° degenerate (collinear edges) — just step out along the edge normal.
      left.push([verts[i][0] + n2[0] * d2, verts[i][1] + n2[1] * d2])
      right.push([verts[i][0] - n2[0] * distRight, verts[i][1] - n2[1] * distRight])
      continue
    }
    // LEFT corner = intersection of the two inner offset lines, each offset along
    // its edge normal by that edge's own thickness. Solving u·n1=d1, u·n2=d2 for
    // u = α·n1 + β·n2 gives the mitre that stays flush even when the two adjacent
    // walls have different thicknesses.
    const alpha = (d1 - d2 * cosE) / denom
    const beta = (d2 - d1 * cosE) / denom
    let ux = alpha * n1[0] + beta * n2[0]
    let uz = alpha * n1[1] + beta * n2[1]
    // Clamp runaway mitre length on very sharp corners (caps at 4× the larger thickness).
    const ulen = Math.hypot(ux, uz) || 1
    const maxLen = Math.max(d1, d2) * 4
    if (ulen > maxLen) { const f = maxLen / ulen; ux *= f; uz *= f }
    left.push([verts[i][0] + ux, verts[i][1] + uz])
    // RIGHT (outer face) keeps the uniform distRight mitre — it sits on the
    // polygon edge (distRight = 0) in all current usages.
    mx /= ml; mz /= ml
    const cos = Math.max(0.25, mx * n1[0] + mz * n1[1])
    right.push([verts[i][0] - mx * (distRight / cos), verts[i][1] - mz * (distRight / cos)])
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
  const usedKeys = new Set<string>()
  // Full wall thickness per room edge; outer face sits on the polygon edge (distRight=0).
  const roomT = (roomId: string, edgeIdx: number) => {
    const room = fp.rooms.find(r => r.id === roomId)
    if (!room) return WALL_THICK
    return room.wallThicknesses?.[edgeIdx] ?? room.wallThickness ?? WALL_THICK
  }
  // Per-edge thickness array for a whole room, used to build mitred offsets.
  const roomTArray = (room: FloorplanRoom) => {
    const base = room.wallThickness ?? WALL_THICK
    return room.vertices.map((_, i) => room.wallThicknesses?.[i] ?? base)
  }
  // Winding sign: +1 if CCW-in-math / CW-on-screen (positive shoelace area = inward is left-normal),
  // -1 if opposite. Used to ensure all perpendicular offsets point toward the room interior.
  const roomWindSign = (roomId: string): number => {
    const room = fp.rooms.find(r => r.id === roomId)
    if (!room) return 1
    let a = 0
    const verts = room.vertices, n = verts.length
    for (let i = 0; i < n; i++) {
      const vi = verts[i], vn = verts[(i + 1) % n]
      a += vi[0] * vn[1] - vn[0] * vi[1]
    }
    return a >= 0 ? 1 : -1
  }

  const offsetsByRoom = new Map<string, RoomOffsets>()
  for (const room of fp.rooms)
    offsetsByRoom.set(room.id, computeRoomOffsets(room.vertices, roomTArray(room), 0))

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
  // L (inner) sits on the offset polygon; R (outer) sits on the polygon edge. The mapping between
  // a junction-side ('CCW' or 'CW' around the junction) and L/R depends on BOTH which end of the
  // wall is at the junction AND the room's polygon winding. The hallway is the only CW room here;
  // ignoring `ws` swaps L↔R for hallway corners and bleeds the flush outer face into the inner.
  const slotFor = (end: 'A' | 'B', awaySide: 'CCW' | 'CW', ws: number): 'L' | 'R' =>
    ((awaySide === 'CCW') === (end === 'A') === (ws > 0) ? 'L' : 'R')
  const roomH = (id: string) => fp.rooms.find(r => r.id === id)?.wallH ?? WALL_HEIGHT

  interface JHalf { roomId: string; edgeIdx: number; end: 'A' | 'B'; dirx: number; dirz: number; ang: number; fx: number; fz: number }
  const junctionMap = new Map<string, JHalf[]>()
  const dedup = new Set<string>()
  for (const w of fp.derivedWalls) {
    const k = wallSegKey(w.x1, w.z1, w.x2, w.z2)
    if (dedup.has(k)) continue
    dedup.add(k)
    if (isWallHidden(w)) continue
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
      // Effective distance: inner-face (L-slot) corners use full thickness;
      // outer-face (R-slot) corners sit on the polygon edge (dist = 0).
      const tA = roomT(A.roomId, A.edgeIdx), tB = roomT(B.roomId, B.edgeIdx)
      const wsA = roomWindSign(A.roomId), wsB = roomWindSign(B.roomId)
      const htA = slotFor(A.end, 'CCW', wsA) === 'L' ? tA : 0
      const htB = slotFor(B.end, 'CW',  wsB) === 'L' ? tB : 0
      // Inward normal = windSign × left-hand normal of each wall's FORWARD direction. Using
      // forward (not the away direction) keeps the formula correct at both endpoints — at
      // end=B the away direction is -forward, and the left-hand-of-away is OUTWARD.
      const nAx = -A.fz * wsA, nAz = A.fx * wsA
      const nBx = -B.fz * wsB, nBz = B.fx * wsB
      const qA: [number, number] = [px + nAx * htA, pz + nAz * htA]  // A's CCW foot (inner or on edge)
      const qB: [number, number] = [px + nBx * htB, pz + nBz * htB]  // B's CW  foot (inner or on edge)
      if (i !== gi && gaps[i] > 0.05 && gaps[i] < Math.PI - 0.05) {
        const p1x = px + nAx * htA, p1z = pz + nAz * htA
        const p2x = px + nBx * htB, p2z = pz + nBz * htB
        const wx = p2x - p1x, wz = p2z - p1z
        const det = B.dirx * A.dirz - A.dirx * B.dirz
        if (Math.abs(det) > 1e-6) {
          const s = (-wx * B.dirz + B.dirx * wz) / det
          let cx = p1x + s * A.dirx, cz = p1z + s * A.dirz
          const d = Math.hypot(cx - px, cz - pz)
          const htCap = Math.max(htA, htB); if (d > htCap * 8) { const f = (htCap * 8) / d; cx = px + (cx - px) * f; cz = pz + (cz - pz) * f }
          gapPts.push({ miter: [cx, cz] })
        } else { gapPts.push({ a: qA, b: qB }) }
      } else {
        gapPts.push({ a: qA, b: qB })            // flush outer face / degenerate
      }
    }

    // Drive each wall's two junction corners from the shared gap points.
    for (let i = 0; i < m; i++) {
      const A = hes[i], B = hes[(i + 1) % m]
      const wsA = roomWindSign(A.roomId), wsB = roomWindSign(B.roomId)
      const g = gapPts[i]
      const ptA: [number, number] = 'miter' in g ? g.miter : g.a   // A's CCW-side corner
      const ptB: [number, number] = 'miter' in g ? g.miter : g.b   // B's CW-side corner
      cornerOv.set(ovKey(A.roomId, A.edgeIdx, A.end, slotFor(A.end, 'CCW', wsA)), ptA)
      cornerOv.set(ovKey(B.roomId, B.edgeIdx, B.end, slotFor(B.end, 'CW',  wsB)), ptB)
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

  // ── T-junction perpendicular-cut detection ───────────────────────────────
  // When a room's polygon vertex lies on the INTERIOR of another room's wall
  // segment (not at a shared endpoint), the standard intra-room mitre produces a
  // diagonal notch rather than a flush cut.  Flag those vertices so cutAt() uses
  // a straight perpendicular cut instead.
  const tJunctionKeys = new Set<string>()
  {
    const TJ_EPS = 0.015
    for (const room of fp.rooms) {
      for (const V of room.vertices) {
        const vk = pkey(V[0], V[1])
        // Already handled by the 3+-way junction algorithm above — skip.
        if ((junctionMap.get(vk)?.length ?? 0) >= 3) continue
        for (const w of fp.derivedWalls) {
          if (w.roomId === room.id) continue
          if (isWallHidden(w)) continue
          const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
          const wLen = Math.hypot(wdx, wdz)
          if (wLen < 0.01) continue
          const tP = ((V[0] - w.x1) * wdx + (V[1] - w.z1) * wdz) / (wLen * wLen)
          // Must be strictly interior — not at the segment's own endpoints.
          if (tP <= TJ_EPS / wLen || tP >= 1 - TJ_EPS / wLen) continue
          const projX = w.x1 + tP * wdx, projZ = w.z1 + tP * wdz
          if (Math.hypot(V[0] - projX, V[1] - projZ) < TJ_EPS) {
            tJunctionKeys.add(vk)
            break
          }
        }
      }
    }
  }

  for (const wall of fp.derivedWalls) {
    // Each room renders its own wall leaf (offset inward into its own interior),
    // so a shared edge between two rooms produces two back-to-back leaves — a
    // full double-thickness interior wall — rather than a single deduped wall.
    // Walls explicitly hidden in 3D are skipped (still drawn as a 2D ghost).
    if (isWallHidden(wall)) continue

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
        const ovL = cornerOv.get(ovKey(wall.roomId, vi, 'A', 'L'))
        const ovR = cornerOv.get(ovKey(wall.roomId, vi, 'A', 'R'))
        if (ovL !== undefined || ovR !== undefined)
          return { L: ovL ?? off.left[vi], R: ovR ?? off.right[vi] }
        if (tJunctionKeys.has(pkey(wall.x1, wall.z1))) {
          // Perpendicular (square) cut — no mitre — so the stem terminates flush
          // against the crossing wall rather than leaving a diagonal notch.
          const wallFullT = roomT(wall.roomId, vi)
          const nnx = off.nrm[vi][0], nnz = off.nrm[vi][1]
          return { L: [wall.x1 + nnx * wallFullT, wall.z1 + nnz * wallFullT], R: [wall.x1, wall.z1] }
        }
        return { L: off.left[vi], R: off.right[vi] }
      }
      if (off && t >= 1 - 1e-4) {
        const ovL = cornerOv.get(ovKey(wall.roomId, vi, 'B', 'L'))
        const ovR = cornerOv.get(ovKey(wall.roomId, vi, 'B', 'R'))
        if (ovL !== undefined || ovR !== undefined)
          return { L: ovL ?? off.left[viNext], R: ovR ?? off.right[viNext] }
        if (tJunctionKeys.has(pkey(wall.x2, wall.z2))) {
          const wallFullT = roomT(wall.roomId, vi)
          const nnx = off.nrm[vi][0], nnz = off.nrm[vi][1]
          return { L: [wall.x2 + nnx * wallFullT, wall.z2 + nnz * wallFullT], R: [wall.x2, wall.z2] }
        }
        return { L: off.left[viNext], R: off.right[viNext] }
      }
      const cx = wall.x1 + t * dx
      const cz = wall.z1 + t * dz
      // Outer face is on the polygon edge; inner face is full thickness inward.
      const wallFullT = roomT(wall.roomId, vi)
      const nnx = off ? off.nrm[vi][0] : -wallNormZ
      const nnz = off ? off.nrm[vi][1] : wallNormX
      return { L: [cx + nnx * wallFullT, cz + nnz * wallFullT], R: [cx, cz] }
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
        pieces.push({ key, geo: getWallGeo(key, quad, yBottom, h), wallH })
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
    pieces.push({ key: c.key, geo: getWallGeo(c.key, c.poly, 0, c.h), wallH: c.h })
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

// ─── Merge all wall pieces into a single geometry ────────────────────────────
// Avoids Z-fighting, lighting seams and shadow artifacts between adjacent pieces.
// Split by total wall height: walls > WALL_SHADOW_RECEIVE_MAX_H render in a
// separate mesh with receive-shadow disabled, so lights can't paint shadow
// patches onto their tops (which are visible from the dollhouse view).
const mergedWallGeoShort = shallowRef<BufferGeometry | null>(null)
const mergedWallGeoTall  = shallowRef<BufferGeometry | null>(null)
watch(wallPieces, (pieces) => {
  const prevShort = mergedWallGeoShort.value
  const prevTall  = mergedWallGeoTall.value
  const shortGeos: BufferGeometry[] = []
  const tallGeos: BufferGeometry[] = []
  for (const p of pieces) {
    (p.wallH > WALL_SHADOW_RECEIVE_MAX_H ? tallGeos : shortGeos).push(p.geo)
  }
  if (shortGeos.length === 0) {
    mergedWallGeoShort.value = null
  } else {
    const merged = mergeGeometries(shortGeos, false)
    merged.computeVertexNormals()
    mergedWallGeoShort.value = merged
  }
  if (tallGeos.length === 0) {
    mergedWallGeoTall.value = null
  } else {
    const merged = mergeGeometries(tallGeos, false)
    merged.computeVertexNormals()
    mergedWallGeoTall.value = merged
  }
  prevShort?.dispose()
  prevTall?.dispose()
}, { immediate: true })

onBeforeUnmount(() => {
  mergedWallGeoShort.value?.dispose()
  mergedWallGeoTall.value?.dispose()
})

// ─── Invisible upward wall extensions (point-light spill blockers) ───────────
// The dollhouse walls are intentionally short, so omnidirectional lamp light
// spills over their tops into neighbouring rooms. We extrude an invisible
// "blocker" upward from each wall top to contain that spill. It casts shadows
// only for point lights: a custom depth material (used by the directional sun
// and spot lights in the shadow pass) writes nothing, so the sun is unaffected
// and we avoid huge fake shadows from these tall invisible walls.
const WALL_BLOCK_HEIGHT = 6   // metres of invisible wall added above each wall top
const WALL_BLOCK_CORNER = 0.5  // extend each slice past wall ENDS to seal corner pinholes

// Renders nothing to colour or depth in the main pass — fully invisible & non-occluding.
const blockerMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
// Used for the directional sun / spot shadow maps only — writes no depth, so those
// lights ignore the tall invisible walls (no giant fake shadows). Point lights use
// the default distance material instead, so they DO get blocked.
const blockerDepthMaterial = new MeshDepthMaterial()
blockerDepthMaterial.depthWrite = false
blockerDepthMaterial.colorWrite = false

// A single real THREE.Mesh dropped into the scene via <primitive>. Building it in
// script (rather than binding raw material instances as TresJS props) guarantees
// castShadow and customDepthMaterial actually take effect.
const blockerMesh = new Mesh(new BoxGeometry(0.001, 0.001, 0.001), blockerMaterial)
blockerMesh.castShadow = true
blockerMesh.receiveShadow = false
blockerMesh.frustumCulled = false
blockerMesh.customDepthMaterial = blockerDepthMaterial
blockerMesh.visible = false

const _blockerGeoCache = new Map<string, { sig: string; geo: BufferGeometry }>()
function getBlockerGeo(key: string, quad: [number, number][], yBottom: number, h: number): BufferGeometry {
  const sig = quad.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('|') + `|${yBottom.toFixed(3)}|${h.toFixed(3)}`
  const cached = _blockerGeoCache.get(key)
  if (cached && cached.sig === sig) return cached.geo
  cached?.geo.dispose()
  const geo = buildWallGeo(quad, yBottom, h)
  _blockerGeoCache.set(key, { sig, geo })
  return geo
}

const blockerPieces = computed<WallPiece[]>(() => {
  const pieces: WallPiece[] = []
  const seen = new Set<string>()
  const used = new Set<string>()
  for (const wall of fp.derivedWalls) {
    const segKey = wallSegKey(wall.x1, wall.z1, wall.x2, wall.z2)
    if (seen.has(segKey)) continue
    seen.add(segKey)
    if (isWallHidden(wall)) continue
    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 0.01) continue
    const room = fp.rooms.find(r => r.id === wall.roomId)
    const wallH = room?.wallH ?? WALL_HEIGHT
    const thick = room?.wallThicknesses?.[wall.edgeIdx] ?? room?.wallThickness ?? WALL_THICK
    const ux = dx / len, uz = dz / len   // along the wall
    const nx = -uz, nz = ux              // perpendicular to the wall
    const ht = thick + 0.04, ext = thick + WALL_BLOCK_CORNER

    // Skip the opening span entirely (no blocker over doors/windows). Emitting an
    // invisible blocker slab above an opening creates a tall "extended lintel" that
    // casts point-light shadows far beyond what the visible lintel geometry implies,
    // showing up as a hard shadow line across the doorway on the adjacent room's
    // floor. Letting only the real lintel cast its own shadow keeps the doorway
    // visually clean; solid wall sections still get the blocker for spill containment.
    const sorted = activeOpeningsForWall(wall, ux, uz, len).sort((a, b) => a.t - b.t)
    // Blocker starts at the wall TOP, not the floor.  The visible wall mesh already
    // covers y = 0 → wallH; the blocker only needs to seal the zone ABOVE the wall
    // where a point light could otherwise shoot sideways into adjacent rooms.
    // Starting at y = 0 caused the blocker's slightly-wider bottom face to cast a
    // dark shadow line on the floor right at every wall base.
    const solidYBot = wallH
    const top = wallH + WALL_BLOCK_HEIGHT

    type Slice = { t0: number; t1: number; yBot: number }
    const slices: Slice[] = []
    let cursor = 0
    for (const op of sorted) {
      const halfT = (op.width / 2) / len
      const t0 = Math.max(0, op.t - halfT)
      const t1 = Math.min(1, op.t + halfT)
      if (t0 > cursor + 1e-4) slices.push({ t0: cursor, t1: t0, yBot: solidYBot })
      cursor = t1
    }
    if (cursor < 1 - 1e-4) slices.push({ t0: cursor, t1: 1, yBot: solidYBot })
    if (slices.length === 0) slices.push({ t0: 0, t1: 1, yBot: solidYBot })

    let pi = 0
    for (const sl of slices) {
      const segLen = (sl.t1 - sl.t0) * len
      if (segLen < 0.01) { pi++; continue }
      if (top - sl.yBot < 0.01) { pi++; continue }
      // Only extend the footprint past the wall ends — not at opening boundaries —
      // so adjacent blocker slices still meet flush at the lintel/jamb corners.
      const extA = sl.t0 <= 1e-4 ? ext : 0
      const extB = sl.t1 >= 1 - 1e-4 ? ext : 0
      const x1 = wall.x1 + sl.t0 * dx - ux * extA
      const z1 = wall.z1 + sl.t0 * dz - uz * extA
      const x2 = wall.x1 + sl.t1 * dx + ux * extB
      const z2 = wall.z1 + sl.t1 * dz + uz * extB
      const quad: [number, number][] = [
        [x1 + nx * ht, z1 + nz * ht],
        [x2 + nx * ht, z2 + nz * ht],
        [x2 - nx * ht, z2 - nz * ht],
        [x1 - nx * ht, z1 - nz * ht],
      ]
      const key = `blk-${wall.roomId}-${wall.edgeIdx}-${pi++}`
      used.add(key)
      pieces.push({ key, geo: getBlockerGeo(key, quad, sl.yBot, top - sl.yBot), wallH })
    }
  }
  for (const [key, entry] of _blockerGeoCache) {
    if (!used.has(key)) { entry.geo.dispose(); _blockerGeoCache.delete(key) }
  }
  return pieces
})

watch(blockerPieces, (pieces) => {
  const prev = blockerMesh.geometry
  const geos = pieces.map(p => p.geo)
  if (geos.length) {
    blockerMesh.geometry = mergeGeometries(geos, false)
    blockerMesh.visible = true
  } else {
    blockerMesh.geometry = new BoxGeometry(0.001, 0.001, 0.001)
    blockerMesh.visible = false
  }
  prev?.dispose()
}, { immediate: true })

onBeforeUnmount(() => {
  blockerMesh.geometry?.dispose()
  for (const { geo } of _blockerGeoCache.values()) geo.dispose()
  _blockerGeoCache.clear()
  blockerMaterial.dispose()
  blockerDepthMaterial.dispose()
})

// ─── Window glass + sill ledge geometry ──────────────────────────────────────

const SILL_LEDGE_H       = 0.028        // height of the ledge shelf
const SILL_LEDGE_OVERHANG = 0.035       // how far the ledge protrudes past each wall face

interface WindowPiece {
  key: string
  cx: number; cz: number
  width: number
  rotY: number
  sillY: number
  glassH: number
  /** Depth of the sill ledge along the wall normal — matches the built wall thickness. */
  sillDepth: number
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

  // Per-room winding sign (positive shoelace area = inward is the left normal).
  const roomWindSign = (room: FloorplanRoom): number => {
    let area = 0
    const verts = room.vertices, nv = verts.length
    for (let i = 0; i < nv; i++) {
      const a = verts[i], b = verts[(i + 1) % nv]
      area += a[0] * b[1] - b[0] * a[1]
    }
    return area >= 0 ? 1 : -1
  }

  // Group wall leaves by physical segment so we can tell whether one or both
  // sides of a shared boundary are actually shown. A shared wall renders two
  // back-to-back leaves; hiding one room's wall must leave the other intact and
  // collapse the sill to a single thickness rather than dropping it entirely.
  const bySeg = new Map<string, typeof fp.derivedWalls>()
  for (const w of fp.derivedWalls) {
    const k = wallSegKey(w.x1, w.z1, w.x2, w.z2)
    const arr = bySeg.get(k)
    if (arr) arr.push(w); else bySeg.set(k, [w])
  }

  for (const leaves of bySeg.values()) {
    const visible = leaves.filter(w => !isWallHidden(w))
    if (visible.length === 0) continue   // wall fully hidden → no frame for glass

    const wall = leaves[0]               // shared geometry reference for the segment
    const dx = wall.x2 - wall.x1
    const dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 0.01) continue
    const rotY = -Math.atan2(dz, dx)
    const wallNormX = dx / len
    const wallNormZ = dz / len
    // Reference inward normal of the segment; visible leaves are classified onto
    // its + / − sides so we can sum the real built thickness on each face.
    const refNx = -wallNormZ
    const refNz = wallNormX

    let extPos = 0   // built wall thickness on the +refN side
    let extNeg = 0   // built wall thickness on the −refN side
    let wallH = WALL_HEIGHT
    for (const w of visible) {
      const room = fp.rooms.find(r => r.id === w.roomId)
      if (!room) continue
      wallH = Math.max(wallH, room.wallH ?? WALL_HEIGHT)
      const thick = room.wallThicknesses?.[w.edgeIdx] ?? room.wallThickness ?? WALL_THICK
      const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
      const wlen = Math.hypot(wdx, wdz) || 1
      const sign = roomWindSign(room)
      const inwx = (-wdz / wlen) * sign    // inward normal of this leaf (into its room)
      const inwz = (wdx / wlen) * sign
      if (inwx * refNx + inwz * refNz >= 0) extPos = Math.max(extPos, thick)
      else extNeg = Math.max(extNeg, thick)
    }

    // Centre of the actually-built wall span, measured from the polygon edge.
    const centerOff = (extPos - extNeg) / 2
    const sillDepth = extPos + extNeg + SILL_LEDGE_OVERHANG * 2

    for (const op of activeOpeningsForWall(wall, wallNormX, wallNormZ, len)) {
      if (op.type !== 'window') continue
      const cx = wall.x1 + op.t * dx + refNx * centerOff
      const cz = wall.z1 + op.t * dz + refNz * centerOff
      const sillY = op.sill ?? wallH * 0.28
      const glassH = op.height ?? wallH * 0.52
      pieces.push({ key: `${wall.roomId}-${wall.edgeIdx}-${Math.round(op.t * 1000)}-wp`, cx, cz, width: op.width, rotY, sillY, glassH, sillDepth })
    }
  }
  return pieces
})

function furnitureColor(f: FloorplanFurniture): string {
  if (fp.editMode && fp.selection?.id === f.id) return HIGHLIGHT
  if (f.groupId) {
    const grp = fp.furnitureGroups.find(g => g.id === f.groupId)
    if (grp?.followTheme) return sceneColors.value.furniture
  }
  return f.color ?? tintHex(sceneColors.value.furniture, f.tintH, f.tintV)
}

// ─── Furniture geometry cache ─────────────────────────────────────────────────
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
      :receive-shadow="true"
      @click="fp.editMode ? fp.select('room', room.id) : undefined"
    >
      <TresShapeGeometry :args="[roomShapes.get(room.id), 1]" />
      <TresMeshStandardMaterial :color="roomColor(room)" :roughness="0.95" />
    </TresMesh>

    <!-- Auto-derived walls — both meshes cast AND receive shadows so that
         point lights are correctly occluded by walls between rooms. -->
    <TresMesh
      v-if="mergedWallGeoShort"
      :geometry="mergedWallGeoShort"
      :position="[0, 0, 0]"
      :cast-shadow="true"
      :receive-shadow="true"
    >
      <TresMeshStandardMaterial
        :key="`wm-short-${theme.wallOpacityMode}`"
        :color="sceneColors.wall"
        :roughness="0.85"
        :transparent="theme.wallOpacityMode !== 'solid'"
        :opacity="theme.wallOpacity"
        :depth-write="theme.wallOpacityMode === 'solid'"
      />
    </TresMesh>
    <TresMesh
      v-if="mergedWallGeoTall"
      :geometry="mergedWallGeoTall"
      :position="[0, 0, 0]"
      :cast-shadow="true"
      :receive-shadow="true"
    >
      <TresMeshStandardMaterial
        :key="`wm-tall-${theme.wallOpacityMode}`"
        :color="sceneColors.wall"
        :roughness="0.85"
        :transparent="theme.wallOpacityMode !== 'solid'"
        :opacity="theme.wallOpacity"
        :depth-write="theme.wallOpacityMode === 'solid'"
      />
    </TresMesh>

    <!-- Invisible wall extension: contains lamp light spill above the short walls.
         Built as a real Mesh (script) so castShadow + customDepthMaterial reliably
         apply. Casts shadows for point lights only → no sun shadow from the tall
         invisible geometry. -->
    <primitive :object="blockerMesh" />

    <!-- Window glass panes -->
    <TresMesh
      v-for="wp in windowPieces"
      :key="wp.key + '-glass'"
      :position="[wp.cx, wp.sillY + wp.glassH / 2, wp.cz]"
      :rotation="[0, wp.rotY, 0]"
    >
      <TresBoxGeometry :args="[wp.width, wp.glassH, 0.022]" />
      <TresMeshStandardMaterial
        :key="`gm-${theme.wallOpacityMode}`"
        color="#ffffff"
        :roughness="0.0"
        :metalness="0.0"
        :transparent="true"
        :opacity="0.5"
        :depth-write="false"
      />
    </TresMesh>

    <!-- Window sill ledges -->
    <TresMesh
      v-for="wp in windowPieces"
      :key="wp.key + '-sill'"
      :position="[wp.cx, wp.sillY + SILL_LEDGE_H / 2, wp.cz]"
      :rotation="[0, wp.rotY, 0]"
      :cast-shadow="true"
      :receive-shadow="true"
    >
      <TresBoxGeometry :args="[wp.width + 0.02, SILL_LEDGE_H, wp.sillDepth]" />
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
