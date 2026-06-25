<script setup lang="ts">
// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = 'select' | 'draw' | 'door' | 'window' | 'erase'

const fp = useFloorplanStore()

// ─── Tool mode ────────────────────────────────────────────────────────────────
const mode = ref<Mode>('select')

// ─── View-box (in world units) ────────────────────────────────────────────────
const vbX = ref(-16)
const vbY = ref(-12)
const vbW = ref(34)
const vbH = ref(22)
const vbString = computed(() => `${vbX.value} ${vbY.value} ${vbW.value} ${vbH.value}`)

// ─── Draw-room state ──────────────────────────────────────────────────────────
const drawPoints = ref<[number, number][]>([])
const cursorWorld = ref<[number, number]>([0, 0])

// ─── Hover / drag state ───────────────────────────────────────────────────────
const hoveredEdge = ref<{ roomId: string; edgeIdx: number; t: number; cx: number; cz: number } | null>(null)
const dragVertex = ref<{ roomId: string; vtxIdx: number } | null>(null)
const panStart = ref<{ clientX: number; clientY: number; ox: number; oy: number } | null>(null)
const drawSnapVertex = ref<[number, number] | null>(null) // snapped to existing vertex in draw mode

// ─── Multi-room selection + room-move drag ────────────────────────────────────
const multiSelectedRoomIds = ref(new Set<string>())
const dragRoomsState = ref<{
  startWorld: [number, number]
  roomSnapshots: { id: string; verts: [number, number][] }[]
} | null>(null)

// ─── SVG element ref ──────────────────────────────────────────────────────────
const svgEl = ref<SVGSVGElement | null>(null)

// ─── Coordinate helpers ───────────────────────────────────────────────────────
function getSvgCoords(e: PointerEvent): [number, number] {
  const el = svgEl.value!
  const pt = el.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const svgPt = pt.matrixTransform(el.getScreenCTM()!.inverse())
  return [svgPt.x, svgPt.y]
}

function snap(v: number) { return Math.round(v * 4) / 4 }
function snapPt(x: number, z: number): [number, number] { return [snap(x), snap(z)] }

// ─── Nearest edge detection ───────────────────────────────────────────────────
const EDGE_HIT = 0.35 // world units
const DRAW_SNAP = 0.5  // snap radius when drawing near existing vertices

function findSnapVertex(wx: number, wz: number): [number, number] | null {
  let best: [number, number] | null = null
  let bestDist = DRAW_SNAP
  for (const room of fp.rooms) {
    for (const [vx, vz] of room.vertices) {
      const d = Math.hypot(wx - vx, wz - vz)
      if (d < bestDist) { bestDist = d; best = [vx, vz] }
    }
  }
  return best
}

function closestOnSeg(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): [number, number, number] {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) return [ax, ay, 0]
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return [ax + t * dx, ay + t * dy, t]
}

function findNearestEdge(wx: number, wz: number) {
  let best: typeof hoveredEdge.value & { dist: number } | null = null
  for (const room of fp.rooms) {
    const n = room.vertices.length
    for (let i = 0; i < n; i++) {
      const [ax, az] = room.vertices[i]
      const [bx, bz] = room.vertices[(i + 1) % n]
      const [cx, cz, t] = closestOnSeg(wx, wz, ax, az, bx, bz)
      const d = Math.hypot(wx - cx, wz - cz)
      if (d < EDGE_HIT && (!best || d < best.dist)) {
        best = { roomId: room.id, edgeIdx: i, t, cx, cz, dist: d }
      }
    }
  }
  return best
}

// ─── Pointer handlers ─────────────────────────────────────────────────────────
function onSvgMove(e: PointerEvent) {
  const [wx, wz] = getSvgCoords(e)

  if (mode.value === 'draw') {
    const sv = findSnapVertex(wx, wz)
    drawSnapVertex.value = sv
    cursorWorld.value = sv ?? snapPt(wx, wz)
  } else {
    drawSnapVertex.value = null
    cursorWorld.value = snapPt(wx, wz)
  }

  if (dragVertex.value) {
    const [sx, sz] = snapPt(wx, wz)
    fp.updateVertex(dragVertex.value.roomId, dragVertex.value.vtxIdx, [sx, sz])
    return
  }
  if (dragRoomsState.value) {
    const dx = wx - dragRoomsState.value.startWorld[0]
    const dz = wz - dragRoomsState.value.startWorld[1]
    for (const roomSnap of dragRoomsState.value.roomSnapshots) {
      const room = fp.rooms.find(r => r.id === roomSnap.id)
      if (!room) continue
      room.vertices = roomSnap.verts.map(([vx, vz]) => [vx + dx, vz + dz] as [number, number])
      fp.dirty = true
    }
    return
  }
  if (panStart.value) {
    const el = svgEl.value!
    const rect = el.getBoundingClientRect()
    vbX.value = panStart.value.ox - (e.clientX - panStart.value.clientX) / rect.width * vbW.value
    vbY.value = panStart.value.oy - (e.clientY - panStart.value.clientY) / rect.height * vbH.value
    return
  }
  if (mode.value === 'door' || mode.value === 'window') {
    const edge = findNearestEdge(wx, wz)
    hoveredEdge.value = edge ? { roomId: edge.roomId, edgeIdx: edge.edgeIdx, t: edge.t, cx: edge.cx, cz: edge.cz } : null
  } else {
    hoveredEdge.value = null
  }
}

function onSvgUp(_e: PointerEvent) {
  dragVertex.value = null
  panStart.value = null
  dragRoomsState.value = null
}

function onBgPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const [wx, wz] = getSvgCoords(e)

  if (mode.value === 'draw') {
    const sv = findSnapVertex(wx, wz)
    const [sx, sz] = sv ?? snapPt(wx, wz)
    // Close polygon if near first point
    if (drawPoints.value.length >= 3) {
      const [fx, fz] = drawPoints.value[0]
      if (Math.hypot(sx - fx, sz - fz) < 0.6) {
        closePolygon(); return
      }
    }
    drawPoints.value.push([sx, sz])
    return
  }

  const [sx, sz] = snapPt(wx, wz)

  if (mode.value === 'door' || mode.value === 'window') {
    const edge = findNearestEdge(wx, wz)
    if (edge) {
      fp.addOpening({ type: mode.value, roomId: edge.roomId, edgeIdx: edge.edgeIdx, t: edge.t, width: mode.value === 'door' ? 0.9 : 1.2 })
    }
    return
  }

  // select / erase: start pan on empty space
  panStart.value = { clientX: e.clientX, clientY: e.clientY, ox: vbX.value, oy: vbY.value }
  multiSelectedRoomIds.value.clear()
  fp.deselect()
}

function onVertexPointerDown(roomId: string, vtxIdx: number, e: PointerEvent) {
  e.stopPropagation()
  if (mode.value === 'draw') {
    const [vx, vz] = fp.rooms.find(r => r.id === roomId)!.vertices[vtxIdx]
    if (drawPoints.value.length >= 3) {
      const [fx, fz] = drawPoints.value[0]
      if (Math.hypot(vx - fx, vz - fz) < 0.6) { closePolygon(); return }
    }
    drawPoints.value.push([vx, vz])
    return
  }
  if (mode.value === 'erase') {
    fp.removeVertex(roomId, vtxIdx); return
  }
  if (mode.value === 'select') {
    fp._push()
    dragVertex.value = { roomId, vtxIdx }
    fp.select('room', roomId)
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  }
}

function onRoomPointerDown(roomId: string, e: PointerEvent) {
  if (mode.value === 'draw') return // let click fall through to onBgPointerDown
  e.stopPropagation()
  if (mode.value === 'erase') { fp.deleteRoom(roomId); return }
  if (mode.value === 'select') {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle room in multi-selection
      if (multiSelectedRoomIds.value.has(roomId)) {
        multiSelectedRoomIds.value.delete(roomId)
        if (fp.selection?.id === roomId) {
          const remaining = [...multiSelectedRoomIds.value]
          if (remaining.length > 0) fp.select('room', remaining[remaining.length - 1])
          else fp.deselect()
        }
      } else {
        // Pull current single-selection into the multi-set first
        if (fp.selection?.type === 'room') multiSelectedRoomIds.value.add(fp.selection.id)
        multiSelectedRoomIds.value.add(roomId)
        fp.select('room', roomId)
      }
      return // no drag on ctrl-click
    }

    // Plain click: if the room isn't already part of multi-selection, clear it
    if (!multiSelectedRoomIds.value.has(roomId)) {
      multiSelectedRoomIds.value.clear()
      fp.select('room', roomId)
    }

    // Start a drag covering all currently selected rooms
    const [wx, wz] = getSvgCoords(e)
    const roomIds = multiSelectedRoomIds.value.size > 0
      ? [...multiSelectedRoomIds.value]
      : [roomId]
    dragRoomsState.value = {
      startWorld: [wx, wz],
      roomSnapshots: roomIds.map(id => ({
        id,
        verts: fp.rooms.find(r => r.id === id)!.vertices.map(v => [v[0], v[1]] as [number, number]),
      })),
    }
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  }
}

function onOpeningPointerDown(openingId: string, e: PointerEvent) {
  e.stopPropagation()
  if (mode.value === 'select' || mode.value === 'erase') fp.deleteOpening(openingId)
}

function closePolygon() {
  if (drawPoints.value.length < 3) return
  fp.addRoom(drawPoints.value)
  drawPoints.value = []
  mode.value = 'select'
}

// ─── Zoom (scroll wheel) ──────────────────────────────────────────────────────
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const el = svgEl.value!
  const rect = el.getBoundingClientRect()
  const wx = vbX.value + (e.clientX - rect.left) / rect.width * vbW.value
  const wz = vbY.value + (e.clientY - rect.top) / rect.height * vbH.value
  const f = e.deltaY > 0 ? 1.12 : 0.89
  const nW = Math.max(6, Math.min(60, vbW.value * f))
  const nH = Math.max(4, Math.min(42, vbH.value * f))
  vbX.value = wx - (wx - vbX.value) * (nW / vbW.value)
  vbY.value = wz - (wz - vbY.value) * (nH / vbH.value)
  vbW.value = nW
  vbH.value = nH
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (!fp.editMode) return
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === 'Escape') {
    if (drawPoints.value.length > 0) { drawPoints.value = []; return }
    multiSelectedRoomIds.value.clear()
    mode.value = 'select'
  }
  if (e.key === 'Enter' && mode.value === 'draw' && drawPoints.value.length >= 3) closePolygon()
  const map: Record<string, Mode> = { s: 'select', d: 'draw', o: 'door', w: 'window', e: 'erase' }
  if (map[e.key]) mode.value = map[e.key]
  if (e.key === 'Delete') {
    if (multiSelectedRoomIds.value.size > 0) {
      for (const id of [...multiSelectedRoomIds.value]) fp.deleteRoom(id)
      multiSelectedRoomIds.value.clear()
    } else if (fp.selection) {
      if (fp.selection.type === 'room') fp.deleteRoom(fp.selection.id)
      if (fp.selection.type === 'furniture') fp.deleteFurniture(fp.selection.id)
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

import type { FloorplanOpening } from '~/stores/floorplan'

// ─── Derived helpers for display ──────────────────────────────────────────────
interface EdgeInfo {
  roomId: string; edgeIdx: number
  x1: number; z1: number; x2: number; z2: number
  openings: FloorplanOpening[]
}

const allEdges = computed<EdgeInfo[]>(() => {
  const result: EdgeInfo[] = []
  for (const room of fp.rooms) {
    const n = room.vertices.length
    for (let i = 0; i < n; i++) {
      const [x1, z1] = room.vertices[i]
      const [x2, z2] = room.vertices[(i + 1) % n]
      result.push({
        roomId: room.id, edgeIdx: i, x1, z1, x2, z2,
        openings: fp.openings.filter(o => o.roomId === room.id && o.edgeIdx === i),
      })
    }
  }
  return result
})

const allVertices = computed(() => {
  const result: { roomId: string; vtxIdx: number; x: number; z: number }[] = []
  for (const room of fp.rooms) {
    for (let i = 0; i < room.vertices.length; i++) {
      result.push({ roomId: room.id, vtxIdx: i, x: room.vertices[i][0], z: room.vertices[i][1] })
    }
  }
  return result
})

// Compute wall line segments for an edge, skipping opening gaps
function edgeSegments(e: EdgeInfo): Array<[number, number, number, number]> {
  if (e.openings.length === 0) return [[e.x1, e.z1, e.x2, e.z2]]
  const dx = e.x2 - e.x1, dz = e.z2 - e.z1
  const len = Math.hypot(dx, dz)
  const sorted = [...e.openings].sort((a, b) => a.t - b.t)
  const segs: Array<[number, number, number, number]> = []
  let cursor = 0
  for (const op of sorted) {
    const halfT = (op.width / 2) / len
    const t0 = Math.max(0, op.t - halfT)
    const t1 = Math.min(1, op.t + halfT)
    if (t0 > cursor + 0.001) {
      segs.push([e.x1 + cursor * dx, e.z1 + cursor * dz, e.x1 + t0 * dx, e.z1 + t0 * dz])
    }
    cursor = t1
  }
  if (cursor < 0.999) segs.push([e.x1 + cursor * dx, e.z1 + cursor * dz, e.x2, e.z2])
  return segs
}

function roomPolygonPoints(room: typeof fp.rooms[0]) {
  return room.vertices.map(v => `${v[0]},${v[1]}`).join(' ')
}

// Opening marker geometry (SVG)
function openingMarker(e: EdgeInfo, op: typeof fp.openings[0]) {
  const dx = e.x2 - e.x1, dz = e.z2 - e.z1
  const len = Math.hypot(dx, dz)
  const ux = dx / len, uz = dz / len      // unit along wall
  const px = -uz, pz = ux                 // perpendicular (into room)
  const cx = e.x1 + op.t * dx
  const cz = e.z1 + op.t * dz
  const hw = op.width / 2
  const lx = cx - ux * hw, lz = cz - uz * hw
  const rx = cx + ux * hw, rz = cz + uz * hw
  if (op.type === 'door') {
    // Arc: swing from one jamb, sweeping into the room
    const ex = rx + px * op.width, ez = rz + pz * op.width
    return {
      type: 'door' as const,
      lx, lz, rx, rz,
      arcPath: `M ${rx},${rz} A ${op.width},${op.width} 0 0,1 ${ex},${ez}`,
    }
  } else {
    // Window: two short crossing ticks
    const ts = 0.18
    return {
      type: 'window' as const,
      lx, lz, rx, rz,
      t1ax: lx + px * ts, t1az: lz + pz * ts, t1bx: lx - px * ts, t1bz: lz - pz * ts,
      t2ax: rx + px * ts, t2az: rz + pz * ts, t2bx: rx - px * ts, t2bz: rz - pz * ts,
    }
  }
}

// Close indicator for draw mode
const showCloseIndicator = computed(() => {
  if (mode.value !== 'draw' || drawPoints.value.length < 3) return false
  const [fx, fz] = drawPoints.value[0]
  const [cx, cz] = cursorWorld.value
  return Math.hypot(cx - fx, cz - fz) < 0.7
})

const drawPolylinePoints = computed(() => {
  const pts = drawPoints.value.map(p => `${p[0]},${p[1]}`)
  if (drawPoints.value.length > 0) pts.push(`${cursorWorld.value[0]},${cursorWorld.value[1]}`)
  return pts.join(' ')
})

// ─── Edge length labels (selected room) ─────────────────────────────────────────────
const labelFontSize = computed(() => vbW.value * 0.022)
const labelOffset  = computed(() => vbW.value * 0.028)

interface EdgeLabel {
  x: number; z: number
  text: string
  angle: number
  ox: number; oz: number
}

const selectedEdgeLabels = computed((): EdgeLabel[] => {
  if (fp.selection?.type !== 'room') return []
  const room = fp.rooms.find(r => r.id === fp.selection!.id)
  if (!room) return []
  const n = room.vertices.length
  const cx = room.vertices.reduce((s, v) => s + v[0], 0) / n
  const cz = room.vertices.reduce((s, v) => s + v[1], 0) / n
  return room.vertices.map((_, i) => {
    const [x1, z1] = room.vertices[i]
    const [x2, z2] = room.vertices[(i + 1) % n]
    const dx = x2 - x1, dz = z2 - z1
    const len = Math.hypot(dx, dz)
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
    const icx = cx - mx, icz = cz - mz
    const ilen = Math.hypot(icx, icz) || 1
    const ox = -(icx / ilen), oz = -(icz / ilen)
    let angle = Math.atan2(dz, dx) * 180 / Math.PI
    if (angle > 90 || angle < -90) angle += 180
    return { x: mx, z: mz, text: len.toFixed(2) + 'm', angle, ox, oz }
  })
})

// ─── Colour helpers ───────────────────────────────────────────────────────────
const ACCENT = '#5eead4'
const WALL_STROKE = '#94a3b8'
const WALL_STROKE_HOVERED = '#f59e0b'

function roomFill(id: string) {
  const isSelected = fp.selection?.id === id || multiSelectedRoomIds.value.has(id)
  return isSelected ? 'rgba(94,234,212,0.18)' : 'rgba(99,102,241,0.10)'
}
function roomStroke(id: string) {
  const isSelected = fp.selection?.id === id || multiSelectedRoomIds.value.has(id)
  return isSelected ? ACCENT : '#6366f1'
}
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-100 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="fp.editMode && fp.editorTab !== 'furniture' && fp.editorTab !== 'devices'"
      class="absolute inset-0 right-80 z-10 bg-bg flex flex-col select-none"
      :class="mode === 'draw' ? 'cursor-crosshair' : mode === 'erase' ? 'cursor-not-allowed' : 'cursor-default'"
    >
      <!-- ── Toolbar ── -->
      <div class="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-bg-elevated bg-bg-panel text-xs">
        <span class="text-fg-muted mr-1 hidden sm:inline">Tool:</span>

        <button
          v-for="[id, label, key] in [['select','↖ Select','S'],['draw','✏ Draw Room','D'],['door','🚪 Door','O'],['window','🪟 Window','W'],['erase','✕ Erase','E']]"
          :key="id"
          class="px-2.5 py-1.5 rounded-md transition-colors font-medium"
          :class="mode === id
            ? 'bg-accent/20 text-accent border border-accent/50'
            : 'text-fg-muted hover:bg-bg-elevated'"
          @click="mode = id as Mode"
        >{{ label }} <span class="text-[9px] opacity-50 ml-0.5">{{ key }}</span></button>

        <div class="flex-1" />

        <span v-if="mode === 'draw'" class="text-fg-muted italic hidden sm:inline">
          {{ drawPoints.length === 0 ? 'Click to place first point' : drawPoints.length < 3 ? `${drawPoints.length} pts — keep clicking` : 'Click first point or Enter to close' }}
        </span>
        <span v-if="mode === 'door' || mode === 'window'" class="text-fg-muted italic hidden sm:inline">
          Hover a wall edge, then click to place
        </span>
        <span v-if="mode === 'erase'" class="text-fg-muted italic hidden sm:inline">
          Click room / vertex / opening to delete
        </span>

        <div class="w-px h-4 bg-bg-elevated mx-1" />

        <button
          class="px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-bg-elevated transition-colors"
          title="Save floorplan"
          :class="fp.dirty ? 'text-yellow-300' : ''"
          @click="fp.save()"
        >{{ fp.dirty ? '● Save' : '✓ Saved' }}</button>
      </div>

      <!-- ── SVG Canvas ── -->
      <div class="flex-1 overflow-hidden relative">
        <svg
          ref="svgEl"
          class="w-full h-full"
          :viewBox="vbString"
          @pointermove="onSvgMove"
          @pointerup="onSvgUp"
          @pointerdown="onBgPointerDown"
          @wheel.prevent="onWheel"
        >
          <defs>
            <!-- 0.25m fine grid lines (shown when zoomed in) -->
            <pattern id="grid-fine" x="0" y="0" width="0.25" height="0.25" patternUnits="userSpaceOnUse">
              <path d="M 0.25 0 L 0 0 0 0.25" fill="none" stroke="#1e2d3d" stroke-width="0.008"/>
            </pattern>
            <!-- 1m major grid lines -->
            <pattern id="grid-main" x="0" y="0" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#2d3f52" stroke-width="0.022"/>
            </pattern>
          </defs>

          <!-- Background grid -->
          <rect v-if="vbW < 12" x="-200" y="-200" width="400" height="400" fill="url(#grid-fine)" />
          <rect x="-200" y="-200" width="400" height="400" fill="url(#grid-main)" />

          <!-- ── Room fills (clickable) ── -->
          <polygon
            v-for="room in fp.rooms"
            :key="'fill-' + room.id"
            :points="roomPolygonPoints(room)"
            :fill="roomFill(room.id)"
            stroke="none"
            :style="mode === 'select' ? { cursor: 'grab' } : {}"
            @pointerdown="onRoomPointerDown(room.id, $event)"
          />

          <!-- ── Wall edges (with opening gaps) ── -->
          <g v-for="edge in allEdges" :key="edge.roomId + '-' + edge.edgeIdx">
            <line
              v-for="([x1, z1, x2, z2], si) in edgeSegments(edge)"
              :key="si"
              :x1="x1" :y1="z1" :x2="x2" :y2="z2"
              :stroke="hoveredEdge?.roomId === edge.roomId && hoveredEdge?.edgeIdx === edge.edgeIdx
                ? WALL_STROKE_HOVERED : WALL_STROKE"
              stroke-width="0.1"
              stroke-linecap="round"
            />
          </g>

          <!-- ── Opening markers ── -->
          <g v-for="edge in allEdges" :key="'op-' + edge.roomId + '-' + edge.edgeIdx">
            <g
              v-for="op in edge.openings"
              :key="op.id"
              :opacity="mode === 'erase' || mode === 'select' ? 1 : 0.9"
              style="cursor: pointer"
              @pointerdown="onOpeningPointerDown(op.id, $event)"
            >
              <template v-if="openingMarker(edge, op).type === 'door'">
                <!-- Door: arc + jamb lines -->
                <path
                  :d="openingMarker(edge, op).arcPath"
                  fill="none"
                  stroke="#f97316"
                  stroke-width="0.07"
                  stroke-dasharray="0.12 0.06"
                />
                <line
                  :x1="openingMarker(edge, op).rx" :y1="openingMarker(edge, op).rz"
                  :x2="openingMarker(edge, op).rx + (-((edge.z2 - edge.z1) / Math.hypot(edge.x2 - edge.x1, edge.z2 - edge.z1))) * op.width"
                  :y2="openingMarker(edge, op).rz + (((edge.x2 - edge.x1) / Math.hypot(edge.x2 - edge.x1, edge.z2 - edge.z1))) * op.width"
                  stroke="#f97316" stroke-width="0.06" opacity="0.5"
                />
              </template>
              <template v-else>
                <!-- Window: short perpendicular ticks -->
                <line
                  :x1="openingMarker(edge, op).t1ax" :y1="openingMarker(edge, op).t1az"
                  :x2="openingMarker(edge, op).t1bx" :y2="openingMarker(edge, op).t1bz"
                  stroke="#38bdf8" stroke-width="0.07"
                />
                <line
                  :x1="openingMarker(edge, op).t2ax" :y1="openingMarker(edge, op).t2az"
                  :x2="openingMarker(edge, op).t2bx" :y2="openingMarker(edge, op).t2bz"
                  stroke="#38bdf8" stroke-width="0.07"
                />
                <line
                  :x1="openingMarker(edge, op).lx" :y1="openingMarker(edge, op).lz"
                  :x2="openingMarker(edge, op).rx" :y2="openingMarker(edge, op).rz"
                  stroke="#38bdf8" stroke-width="0.05" stroke-dasharray="0.1 0.05"
                />
              </template>
            </g>
          </g>

          <!-- ── Hover preview for door/window placement ── -->
          <circle
            v-if="hoveredEdge"
            :cx="hoveredEdge.cx" :cy="hoveredEdge.cz"
            r="0.25"
            :fill="mode === 'door' ? 'rgba(249,115,22,0.4)' : 'rgba(56,189,248,0.4)'"
            :stroke="mode === 'door' ? '#f97316' : '#38bdf8'"
            stroke-width="0.05"
            pointer-events="none"
          />

          <!-- ── Room name labels ── -->
          <text
            v-for="room in fp.rooms"
            :key="'lbl-' + room.id"
            :x="room.vertices.reduce((s, v) => s + v[0], 0) / room.vertices.length"
            :y="room.vertices.reduce((s, v) => s + v[1], 0) / room.vertices.length"
            text-anchor="middle"
            dominant-baseline="middle"
            font-size="0.45"
            fill="#94a3b8"
            pointer-events="none"
          >{{ room.name }}</text>

          <!-- ── Vertex dots ── -->
          <circle
            v-for="v in allVertices"
            :key="v.roomId + '-' + v.vtxIdx"
            :cx="v.x" :cy="v.z"
            :r="(fp.selection?.id === v.roomId || multiSelectedRoomIds.has(v.roomId)) ? 0.22 : 0.17"
            :fill="(fp.selection?.id === v.roomId || multiSelectedRoomIds.has(v.roomId)) ? ACCENT : '#cbd5e1'"
            :stroke="mode === 'erase' ? '#f87171' : '#1e293b'"
            stroke-width="0.05"
            style="cursor: grab"
            @pointerdown="onVertexPointerDown(v.roomId, v.vtxIdx, $event)"
          />

          <!-- ── Draw-mode: in-progress polygon ── -->
          <polyline
            v-if="drawPoints.length > 0"
            :points="drawPolylinePoints"
            fill="none"
            stroke="#5eead4"
            stroke-width="0.09"
            stroke-dasharray="0.25 0.12"
            pointer-events="none"
          />
          <circle
            v-for="(pt, i) in drawPoints"
            :key="'dp-' + i"
            :cx="pt[0]" :cy="pt[1]"
            r="0.18"
            fill="#5eead4"
            stroke="#1e293b"
            stroke-width="0.05"
            pointer-events="none"
          />
          <!-- Close-polygon indicator -->
          <circle
            v-if="showCloseIndicator"
            :cx="drawPoints[0][0]" :cy="drawPoints[0][1]"
            r="0.38"
            fill="none"
            stroke="#5eead4"
            stroke-width="0.09"
            stroke-dasharray="0.15 0.08"
            pointer-events="none"
          />
          <!-- Snap cursor crosshair -->
          <g v-if="mode === 'draw'" pointer-events="none">
            <line :x1="cursorWorld[0] - 0.3" :y1="cursorWorld[1]" :x2="cursorWorld[0] + 0.3" :y2="cursorWorld[1]" stroke="#5eead4" stroke-width="0.04" opacity="0.7"/>
            <line :x1="cursorWorld[0]" :y1="cursorWorld[1] - 0.3" :x2="cursorWorld[0]" :y2="cursorWorld[1] + 0.3" stroke="#5eead4" stroke-width="0.04" opacity="0.7"/>
            <!-- Snap-to-vertex ring -->
            <circle
              v-if="drawSnapVertex"
              :cx="drawSnapVertex[0]" :cy="drawSnapVertex[1]"
              r="0.38"
              fill="rgba(94,234,212,0.15)"
              stroke="#5eead4"
              stroke-width="0.07"
            />
          </g>

          <!-- ── Edge length labels (selected room) ── -->
          <g v-if="fp.selection?.type === 'room'" pointer-events="none" font-family="ui-monospace,monospace">
            <text
              v-for="(lbl, i) in selectedEdgeLabels"
              :key="'el' + i"
              :x="lbl.x + lbl.ox * labelOffset"
              :y="lbl.z + lbl.oz * labelOffset"
              :transform="`rotate(${lbl.angle}, ${lbl.x + lbl.ox * labelOffset}, ${lbl.z + lbl.oz * labelOffset})`"
              text-anchor="middle"
              dominant-baseline="middle"
              :font-size="labelFontSize"
              fill="#5eead4"
              paint-order="stroke"
              stroke="#0f172a"
              :stroke-width="labelFontSize * 0.35"
            >{{ lbl.text }}</text>
          </g>
        </svg>
      </div>

      <!-- ── Bottom legend ── -->
      <div class="shrink-0 flex items-center gap-4 px-4 py-1.5 border-t border-bg-elevated text-[10px] text-fg-muted bg-bg-panel">
        <span>Scroll to zoom · Drag background to pan</span>
        <span v-if="mode === 'select'">Drag ● to move vertex · Click room to select · <kbd class="opacity-60">Ctrl</kbd>+click to multi-select · Drag room to move · Del to delete selected</span>
        <span v-if="mode === 'draw'">Click dots to trace polygon · Enter or click first point to close</span>
        <span class="flex items-center gap-1">
          <span class="inline-block w-3 h-0.5 bg-orange-400 rounded" /> Door
          <span class="inline-block w-3 h-0.5 bg-sky-400 rounded ml-2" /> Window
        </span>
      </div>
    </div>
  </Transition>
</template>
