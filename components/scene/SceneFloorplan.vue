<script setup lang="ts">
import { Shape, BoxGeometry, ExtrudeGeometry, type BufferGeometry } from 'three'
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
  cx: number; cz: number
  len: number; h: number; yCenter: number
  rotY: number
}

// Canonical key for a wall segment — order-independent so reversed duplicates match.
function wallSegKey(x1: number, z1: number, x2: number, z2: number): string {
  const ax = Math.round(x1 * 100), az = Math.round(z1 * 100)
  const bx = Math.round(x2 * 100), bz = Math.round(z2 * 100)
  if (ax < bx || (ax === bx && az <= bz)) return `${ax},${az}|${bx},${bz}`
  return `${bx},${bz}|${ax},${az}`
}

const wallPieces = computed<WallPiece[]>(() => {
  const pieces: WallPiece[] = []
  const seen = new Set<string>()

  for (const wall of fp.derivedWalls) {
    // Skip the duplicate side of a shared interior wall
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

    // ─── Miter extensions ─────────────────────────────────────────────────
    // Extend the first/last wall segment at each vertex by the exact amount
    // needed to fill the corner gap. Formula: (T/2) / tan(angle/2), where
    // angle is measured between the two wall directions pointing away from
    // the vertex. Always positive — convex corners fill their gap, concave
    // corners already overlap so the tiny addition is invisible (same material).
    const miterRoom = fp.rooms.find(r => r.id === wall.roomId)
    let tExtStart = 0, tExtEnd = 0
    if (miterRoom) {
      const rn    = miterRoom.vertices.length
      const vi    = wall.edgeIdx
      const startV = miterRoom.vertices[vi]
      const endV   = miterRoom.vertices[(vi + 1) % rn]
      const prevV  = miterRoom.vertices[(vi + rn - 1) % rn]
      const nextV  = miterRoom.vertices[(vi + 2) % rn]

      const cornerMiter = (aNX: number, aNZ: number, bDx: number, bDz: number): number => {
        const bL = Math.hypot(bDx, bDz)
        if (bL < 0.01) return 0
        const dot = aNX * (bDx / bL) + aNZ * (bDz / bL)
        const ang = Math.acos(Math.max(-1, Math.min(1, dot)))
        if (ang < 0.01 || ang > Math.PI - 0.01) return 0
        return Math.min((WALL_THICK / 2) / Math.tan(ang / 2), WALL_THICK * 4)
      }
      // Start vertex: away along current wall = +wallNorm; adjacent = prevV - startV
      tExtStart = cornerMiter(wallNormX, wallNormZ, prevV[0] - startV[0], prevV[1] - startV[1]) / len
      // End vertex: away along current wall = -wallNorm; adjacent = nextV - endV
      tExtEnd   = cornerMiter(-wallNormX, -wallNormZ, nextV[0] - endV[0], nextV[1] - endV[1]) / len
    }

    // This handles exact shared walls (opposite direction), partial overlaps
    // (sub-segments from adjacent rooms), and T-junctions — all cases where
    // a simple roomId+edgeIdx match would miss the opening and render solid
    // wall over a door/window gap.
    const sorted = activeOpeningsForWall(wall, wallNormX, wallNormZ, len).sort((a, b) => a.t - b.t)

    const wallH = fp.rooms.find(r => r.id === wall.roomId)?.wallH ?? WALL_HEIGHT

    type SegType = 'solid' | 'door' | 'window'
    const segs: { t0: number; t1: number; type: SegType; openingH?: number; openingSill?: number }[] = []
    let cursor = -tExtStart

    for (const op of sorted) {
      const halfT = (op.width / 2) / len
      const t0 = Math.max(0, op.t - halfT)
      const t1 = Math.min(1, op.t + halfT)
      if (t0 > cursor + 0.001) segs.push({ t0: cursor, t1: t0, type: 'solid' })
      segs.push({ t0, t1, type: op.type as SegType, openingH: op.height, openingSill: op.sill })
      cursor = t1
    }
    if (cursor < 1 + tExtEnd - 0.001) segs.push({ t0: cursor, t1: 1 + tExtEnd, type: 'solid' })

    let pi = 0
    for (const seg of segs) {
      const segLen = (seg.t1 - seg.t0) * len
      if (segLen < 0.01) { pi++; continue }
      const midT = (seg.t0 + seg.t1) / 2
      const cx = wall.x1 + midT * dx
      const cz = wall.z1 + midT * dz
      const base = `${wall.roomId}-${wall.edgeIdx}-${pi++}`

      if (seg.type === 'solid') {
        pieces.push({ key: base, cx, cz, len: segLen, h: wallH, yCenter: wallH / 2, rotY })
      } else if (seg.type === 'door') {
        const doorH = Math.min(seg.openingH ?? wallH, wallH)
        const lintelH = wallH - doorH
        if (lintelH > 0.01)
          pieces.push({ key: base + 'l', cx, cz, len: segLen, h: lintelH, yCenter: doorH + lintelH / 2, rotY })
      } else {
        // Window: sill piece + lintel piece
        const winSill = seg.openingSill ?? wallH * 0.28
        const winH = seg.openingH ?? wallH * 0.52
        const winTop = winSill + winH
        if (winSill > 0.01)
          pieces.push({ key: base + 'a', cx, cz, len: segLen, h: winSill, yCenter: winSill / 2, rotY })
        const lintelH = wallH - winTop
        if (lintelH > 0.01)
          pieces.push({ key: base + 'b', cx, cz, len: segLen, h: lintelH, yCenter: winTop + lintelH / 2, rotY })
      }
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

/** Build a THREE.Shape for a rounded rectangle in the XY plane. */
function makeRoundedRectShape(w: number, d: number, r: number, segs: number): Shape {
  const hw = w / 2, hd = d / 2
  r = Math.min(r, hw * 0.999, hd * 0.999)
  const shape = new Shape()
  if (r < 0.001) {
    shape.moveTo(-hw, -hd)
    shape.lineTo( hw, -hd)
    shape.lineTo( hw,  hd)
    shape.lineTo(-hw,  hd)
    shape.closePath()
    return shape
  }
  shape.moveTo(-hw + r, -hd)
  shape.lineTo( hw - r, -hd)
  shape.absarc( hw - r, -hd + r, r, -Math.PI / 2,          0, false)
  shape.lineTo( hw,  hd - r)
  shape.absarc( hw - r,  hd - r, r,           0,  Math.PI / 2, false)
  shape.lineTo(-hw + r,  hd)
  shape.absarc(-hw + r,  hd - r, r,  Math.PI / 2,      Math.PI, false)
  shape.lineTo(-hw, -hd + r)
  shape.absarc(-hw + r, -hd + r, r,      Math.PI, 3 * Math.PI / 2, false)
  return shape
}

/**
 * Build furniture geometry with independent XZ corner radius and Y-edge radius.
 *
 * Strategy: use ExtrudeGeometry of a rounded-rect Shape.
 *   - rXZ controls the shape's corner radius (plan-view roundness).
 *   - rY is implemented as bevelSize/bevelThickness on the extrude (top/bottom edge roundness).
 *
 * To keep the outer W×H×D dimensions correct the inner shape is inset by rY so the
 * outward bevel restores it: innerW = w−2rY, innerR = max(0, rXZ−rY).
 * After rotating the extrude from Z-up to Y-up, the bounding-box is used to re-centre.
 */
function buildFurnitureGeo(
  w: number, h: number, d: number,
  rXZ: number, rY: number,
): BufferGeometry {
  const rxz = Math.min(Math.max(0, rXZ), Math.min(w, d) * 0.499)
  const ry  = Math.min(Math.max(0, rY),  h * 0.499)

  if (rxz < 0.001 && ry < 0.001) return new BoxGeometry(w, h, d)

  const seg      = Math.max(3, Math.round(Math.max(rxz, ry) * 20))
  const insetRY  = ry   // how much to inset the shape before bevel expands it back
  const innerW   = Math.max(0.001, w - 2 * insetRY)
  const innerD   = Math.max(0.001, d - 2 * insetRY)
  const innerH   = Math.max(0.001, h - 2 * insetRY)
  const innerR   = Math.max(0, rxz - insetRY)

  const shape = makeRoundedRectShape(innerW, innerD, innerR, seg * 4)
  const geo = new ExtrudeGeometry(shape, {
    depth: innerH,
    curveSegments: seg * 4,
    bevelEnabled: ry > 0.001,
    bevelSize: insetRY,
    bevelThickness: insetRY,
    bevelSegments: seg,
  })

  // ExtrudeGeometry: shape in XY, extrude along +Z → rotate so extrude becomes +Y (world up)
  geo.rotateX(-Math.PI / 2)
  // Re-centre using actual bounding box (works regardless of bevel direction conventions)
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0)
  geo.computeVertexNormals()
  return geo
}

const _geoCache = new Map<string, { key: string; geo: BufferGeometry }>()

function getFurnitureGeometry(item: FloorplanFurniture): BufferGeometry {
  const rxz = Math.max(0, item.radius  ?? 0)
  const ry  = Math.max(0, item.radiusY ?? 0)
  const cacheKey = `${item.w}|${item.h}|${item.d}|${rxz}|${ry}`
  const cached = _geoCache.get(item.id)
  if (cached?.key === cacheKey) return cached.geo
  cached?.geo.dispose()
  const geo = buildFurnitureGeo(item.w, item.h, item.d, rxz, ry)
  _geoCache.set(item.id, { key: cacheKey, geo })
  return geo
}

onUnmounted(() => {
  for (const { geo } of _geoCache.values()) geo.dispose()
  _geoCache.clear()
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
      :position="[piece.cx, piece.yCenter, piece.cz]"
      :rotation="[0, piece.rotY, 0]"
      cast-shadow
      receive-shadow
    >
      <TresBoxGeometry :args="[piece.len, piece.h, WALL_THICK]" />
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
      :rotation="[0, (group.rotY ?? 0) * Math.PI / 180, 0]"
    >
      <TresMesh
        v-for="item in fp.furniture.filter(f => f.groupId === group.id)"
        :key="item.id"
        :geometry="getFurnitureGeometry(item)"
        :position="[item.x, item.y, item.z]"
        :rotation="[0, (item.rotY ?? 0) * Math.PI / 180, 0]"
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

    <!-- Ungrouped furniture -->
    <TresMesh
      v-for="item in fp.furniture.filter(f => !f.groupId)"
      :key="item.id"
      :geometry="getFurnitureGeometry(item)"
      :position="[item.x, item.y, item.z]"
      :rotation="[0, (item.rotY ?? 0) * Math.PI / 180, 0]"
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