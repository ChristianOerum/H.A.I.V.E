/**
 * Pure Three.js geometry builders for furniture items.
 * Extracted from SceneFloorplan.vue so they can be reused in other scenes.
 */
import {
  Shape, BoxGeometry, ExtrudeGeometry, SphereGeometry, CircleGeometry,
  Vector2, BufferGeometry, Float32BufferAttribute,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { FloorplanFurniture } from '~/stores/floorplan'

// ─── Shape helpers ────────────────────────────────────────────────────────────

/**
 * Build a THREE.Shape for a (possibly elliptic) rounded rectangle in the XY plane.
 * corners = [TL, TR, BR, BL] x-radii; rho = per-corner ry/rx aspect ratio (default 1 = circular).
 */
export function makeRoundedRectShape(
  w: number, d: number,
  corners: [number, number, number, number],
  rho?: [number, number, number, number],
): Shape {
  const hw = w / 2, hd = d / 2
  const p = rho ?? ([1, 1, 1, 1] as [number, number, number, number])
  type C = { rx: number; ry: number }
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
export function makeEllipseShape(w: number, d: number): Shape {
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

// ─── Ellipse with rounded Y edges ─────────────────────────────────────────────

/**
 * Build an ellipse (or per-corner elliptic) prism with rounded top/bottom Y edges.
 * Keeps the waist cross-section EXACTLY on the requested footprint, sweeping it
 * vertically and insetting along inward normals for the fillet.
 */
export function buildEllipseGeoRounded(
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

  const footprint = cornerRadii
    ? makeRoundedRectShape(w, d, cornerRadii, cornerRho)
    : makeEllipseShape(w, d)
  const sampled = footprint.getSpacedPoints(seg)
  const ring = sampled.slice(0, sampled.length - 1)
  const N = ring.length
  const inN: Vector2[] = ring.map((p, i) => {
    const a = ring[(i - 1 + N) % N], b = ring[(i + 1) % N]
    let nx = -(b.y - a.y), ny = (b.x - a.x)
    const len = Math.hypot(nx, ny) || 1
    nx /= len; ny /= len
    if (nx * p.x + ny * p.y > 0) { nx = -nx; ny = -ny }
    return new Vector2(nx, ny)
  })

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
    for (let j = 0; j < N; j++)
      positions.push(ring[j].x + inN[j].x * dlt, L.y, -(ring[j].y + inN[j].y * dlt))
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

// ─── Footprint shape + hole helper ───────────────────────────────────────────

/** Return the outer XY footprint shape for a furniture item (full size, no bevel inset). */
export function buildFootprintShape(
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
 */
export function makeHoleShape(holeItem: FloorplanFurniture, baseItem: FloorplanFurniture): Shape {
  const hSh = holeItem.shape ?? 'box'
  const footprint = buildFootprintShape(holeItem.w, holeItem.d, hSh, holeItem.radius ?? 0, holeItem.cornerRadii, holeItem.cornerRho)
  const dxW = holeItem.x - baseItem.x
  const dzW = holeItem.z - baseItem.z
  const baseRad = (baseItem.rotY ?? 0) * Math.PI / 180
  const cosB = Math.cos(-baseRad), sinB = Math.sin(-baseRad)
  const dxL = dxW * cosB - dzW * sinB
  const dzL = dxW * sinB + dzW * cosB
  const dx = dxL, dy = -dzL
  const relRad = -((holeItem.rotY ?? 0) - (baseItem.rotY ?? 0)) * Math.PI / 180
  const cosR = Math.cos(relRad), sinR = Math.sin(relRad)
  const pts = footprint.getPoints(64).map(p => new Vector2(
    p.x * cosR - p.y * sinR + dx,
    p.x * sinR + p.y * cosR + dy,
  ))
  return new Shape(pts)
}

// ─── Furniture geometry builders ─────────────────────────────────────────────

/** Per-hole info for segmented geometry building. */
export interface HoleInfo { shape: Shape; yBottom: number; yTop: number }

/**
 * Build furniture geometry.
 * - shape 'box': plain BoxGeometry (unless holes/bevel require extrusion).
 * - shape 'rounded': extruded rounded-rect; supports per-corner radii + rho.
 * - shape 'ellipse': extruded ellipse or per-corner elliptic arcs.
 */
export function buildFurnitureGeo(
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

  if (shape === 'ellipse' && !hasHoles) {
    const topRY = Math.max(0, edgeRadii ? edgeRadii[0] : rY)
    const botRY = Math.max(0, edgeRadii ? edgeRadii[1] : rY)
    if (topRY > 0.001 || botRY > 0.001)
      return buildEllipseGeoRounded(w, d, h, topRY, botRY, cornerRadii, cornerRho, segments)
  }

  if (edgeRadii && Math.abs(edgeRadii[0] - edgeRadii[1]) > 0.001)
    return buildFurnitureGeoAsymBevel(w, h, d, rXZ, edgeRadii[0], edgeRadii[1], shape, cornerRadii, cornerRho, holes, segments)
  const ry = Math.min(Math.max(0, edgeRadii ? (edgeRadii[0] + edgeRadii[1]) / 2 : rY), h * 0.499)

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
 */
export function buildFurnitureGeoAsymBevel(
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
  mainGeo.translate(0, isTopBig ? -bigRY / 2 : bigRY / 2, 0)
  capGeo.translate(0,  isTopBig ? h / 2 - bigRY : -(h / 2 - bigRY), 0)
  const merged = mergeGeometries([mainGeo, capGeo])
  mainGeo.dispose()
  capGeo.dispose()
  if (!merged) return new BoxGeometry(w, h, d)
  merged.computeVertexNormals()
  return merged
}

/**
 * Build furniture geometry where each subtract hole is only cut within the Y range
 * where the subtract item physically overlaps the base item.
 */
export function buildFurnitureGeoSegmented(
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

  const active = holeInfos.filter(hi => hi.yBottom < baseTop && hi.yTop > baseBottom)
  if (active.length === 0) return buildFurnitureGeo(w, h, d, rXZ, rY, shape, cornerRadii, cornerRho, undefined, segments, edgeRadii)

  const allFull = active.every(
    hi => hi.yBottom <= baseBottom + 0.0005 && hi.yTop >= baseTop - 0.0005
  )
  if (allFull)
    return buildFurnitureGeo(w, h, d, rXZ, rY, shape, cornerRadii, cornerRho, active.map(hi => hi.shape), segments, edgeRadii)

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

    const seg = buildFurnitureGeo(
      w, segH, d, rXZ, 0, shape, cornerRadii, cornerRho,
      segHoles.length ? segHoles : undefined,
      segments,
    )
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
 */
export function buildSphereGeo(
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
    const capR  = Math.sqrt(1 - clampedCut * clampedCut)
    const capGeo = new CircleGeometry(capR, segs * 2)
    capGeo.rotateX(Math.PI / 2)
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

// ─── Per-item geometry resolver (with caching) ────────────────────────────────

/**
 * Build or retrieve a cached geometry for a furniture item.
 * Pass the group's furniture array so subtract holes can be resolved.
 */
export function resolveFurnitureGeometry(
  item: FloorplanFurniture,
  siblings: FloorplanFurniture[],
  cache: Map<string, { key: string; geo: BufferGeometry }>,
): BufferGeometry {
  const rxz  = Math.max(0, item.radius  ?? 0)
  const ry   = Math.max(0, item.radiusY ?? 0)
  const edgeR = item.edgeRadii
  const cr   = item.cornerRadii
  const crho = item.cornerRho
  const sh: 'box' | 'rounded' | 'ellipse' | 'sphere' = item.shape
    ?? ((rxz > 0.001 || ry > 0.001 || cr) ? 'rounded' : 'box')

  if (sh === 'sphere') {
    const sMode  = item.sphereMode  ?? 'full'
    const sStyle = item.sphereStyle ?? 'pill'
    const sCutY  = item.sphereCutY  ?? 0
    const cacheKey = `sphere|${item.w}|${item.h}|${item.d}|${sMode}|${sStyle}|${sCutY}|${item.segments ?? ''}`
    const cached = cache.get(item.id)
    if (cached?.key === cacheKey) return cached.geo
    cached?.geo.dispose()
    const geo = buildSphereGeo(item.w, item.h, item.d, sMode, sStyle, sCutY, item.segments)
    cache.set(item.id, { key: cacheKey, geo })
    return geo
  }

  let holeInfos: HoleInfo[] | undefined
  let holeKey = ''
  if (item.groupId && !item.subtract) {
    const subs = siblings.filter(f => f.groupId === item.groupId && !!f.subtract)
    if (subs.length) {
      const baseWorldBottom = item.y - item.h / 2
      const baseWorldTop   = item.y + item.h / 2
      const infos: HoleInfo[] = []
      for (const s of subs) {
        const sBottom = s.y - s.h / 2
        const sTop    = s.y + s.h / 2
        const overlapBottom = Math.max(sBottom, baseWorldBottom)
        const overlapTop    = Math.min(sTop,    baseWorldTop)
        if (overlapBottom >= overlapTop) continue
        infos.push({
          shape:   makeHoleShape(s, item),
          yBottom: overlapBottom - item.y,
          yTop:    overlapTop   - item.y,
        })
      }
      if (infos.length) {
        holeInfos = infos
        holeKey = subs.map(s =>
          `${s.id}:${s.x},${s.y},${s.z},${s.w},${s.h},${s.d},${s.rotY ?? 0},${s.shape ?? ''},${s.radius ?? 0},${s.cornerRadii?.join(',') ?? ''},${s.cornerRho?.join(',') ?? ''}`
        ).join('|')
      }
    }
  }

  const cacheKey = `${item.w}|${item.h}|${item.d}|${item.y}|${rxz}|${ry}|${edgeR ? edgeR.join(',') : ''}|${sh}|${cr ? cr.join(',') : ''}|${crho ? crho.join(',') : ''}|${item.segments ?? ''}|${holeKey}`
  const cached = cache.get(item.id)
  if (cached?.key === cacheKey) return cached.geo
  cached?.geo.dispose()
  const geo = holeInfos
    ? buildFurnitureGeoSegmented(item.w, item.h, item.d, rxz, ry, sh as 'box' | 'rounded' | 'ellipse', cr, crho, holeInfos, item.segments, edgeR)
    : buildFurnitureGeo(item.w, item.h, item.d, rxz, ry, sh as 'box' | 'rounded' | 'ellipse', cr, crho, undefined, item.segments, edgeR)
  cache.set(item.id, { key: cacheKey, geo })
  return geo
}
