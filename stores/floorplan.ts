import { defineStore } from 'pinia'

export interface FloorplanRoom {
  id: string
  name: string
  /** World-space [x, z] polygon vertices — any shape, any number of points (≥3). */
  vertices: [number, number][]
  tintH: number
  tintV: number
  /** Wall height in metres. Defaults to 2.4. */
  wallH?: number
  /** Default wall thickness in metres for every edge. Defaults to 0.15. */
  wallThickness?: number
  /** Per-edge wall thickness overrides, keyed by edge index. Falls back to `wallThickness`, then 0.15. */
  wallThicknesses?: Record<number, number>
  /** Edge indices whose wall is hidden in the 3D view (shown only as a 2D ghost in the planner). */
  hiddenWalls?: number[]
  /** Optional explicit hex floor color override, e.g. '#c8b89a'. Overrides tint when set. */
  color?: string
}

export interface FloorplanOpening {
  id: string
  type: 'door' | 'window'
  /** Which room's perimeter this opening lives on. */
  roomId: string
  /** Index into room.vertices[]; edge goes from vertices[edgeIdx] → vertices[(edgeIdx+1)%n]. */
  edgeIdx: number
  /** Normalised position along the edge (0 = start, 1 = end). */
  t: number
  /** Opening width in world units. */
  width: number
  /** Opening height in world units. Doors default to full wall height; windows default to 0.52. */
  height?: number
  /** Windows only: distance from floor to bottom of window in world units. Default 0.34. */
  sill?: number
}

export interface FloorplanDerivedWall {
  roomId: string
  edgeIdx: number
  x1: number; z1: number
  x2: number; z2: number
}

export interface FloorplanFurniture {
  id: string
  label: string
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  tintH: number
  tintV: number
  /** X-axis rotation in degrees. Default 0. */
  rotX?: number
  /** Y-axis rotation in degrees. Default 0. */
  rotY?: number
  /** Z-axis rotation in degrees. Default 0. */
  rotZ?: number
  /** Optional explicit hex color override, e.g. '#a07850'. Overrides tint when set. */
  color?: string
  /** Shape type: 'box' = sharp box, 'rounded' = corner-radius rect, 'ellipse' = oval footprint, 'sphere' = spheroid. */
  shape?: 'box' | 'rounded' | 'ellipse' | 'sphere'
  /** Sphere mode: 'full' = complete spheroid, 'half' = cut by a horizontal plane. Only used when shape is 'sphere'. Default 'full'. */
  sphereMode?: 'full' | 'half'
  /** Sphere style: 'pill' = equal XZ radii (circular footprint), 'elliptical' = independent W/D axes. Only used when shape is 'sphere'. Default 'pill'. */
  sphereStyle?: 'pill' | 'elliptical'
  /** Normalised Y cut position for half-sphere: -1 = bottom of sphere (shows full sphere), 0 = equator (true half), +1 = top (nothing visible). Only used when sphereMode is 'half'. Default 0. */
  sphereCutY?: number
  /** XZ corner radius (plan view): 0 = sharp corners, up to min(w,d)/2 = circle footprint. Only used when shape is 'rounded'. */
  radius?: number
  /** Y edge radius (vertical profile): 0 = flat top/bottom, up to h/2 = fully rounded edges. */
  radiusY?: number
  /** Per-edge Y bevel radii [top, bottom]: overrides uniform radiusY when set. 0 = flat, h/2 = dome. */
  edgeRadii?: [number, number]
  /** Per-corner XZ radii [TL, TR, BR, BL] (clockwise from top-left in plan view). Overrides uniform `radius` per-corner. */
  cornerRadii?: [number, number, number, number]
  /** Per-corner arc aspect ratio ρ = ry/rx for each corner [TL, TR, BR, BL]. 1 = circular, D/W = oval match. Only meaningful in ellipse per-corner mode. */
  cornerRho?: [number, number, number, number]
  /** When true this item acts as a boolean subtractor within its group: it cuts a hole in all solid siblings. */
  subtract?: boolean
  /** Optional group this item belongs to. */
  groupId?: string
  /** Curve/arc segment count override for rounded or ellipse shapes. Higher = smoother. Undefined = auto-calculated from size. */
  segments?: number
}

export interface FloorplanFurnitureGroup {
  id: string
  label: string
  /** Whether the group is collapsed in the editor panel. */
  collapsed: boolean
  /** World-space origin of the group. Children positions are relative to this. */
  x: number
  y: number
  z: number
  /** X-axis rotation of the whole group in degrees. */
  rotX?: number
  /** Y-axis rotation of the whole group in degrees. */
  rotY: number
  /** Z-axis rotation of the whole group in degrees. */
  rotZ?: number
  /** When true, all items in this group ignore their individual tint/color and render with the plain theme furniture color. */
  followTheme?: boolean
}

export type FloorplanItemType = 'room' | 'furniture'
export interface FloorplanSelection { type: FloorplanItemType; id: string }
export type FloorplanEditorTab = 'rooms' | 'furniture' | 'devices' | 'preferences'

function uid() {
  return crypto.randomUUID()
}

type Snapshot = { rooms: FloorplanRoom[]; openings: FloorplanOpening[]; furniture: FloorplanFurniture[]; furnitureGroups: FloorplanFurnitureGroup[] }

export const useFloorplanStore = defineStore('floorplan', {
  state: () => ({
    rooms: [] as FloorplanRoom[],
    openings: [] as FloorplanOpening[],
    furniture: [] as FloorplanFurniture[],
    furnitureGroups: [] as FloorplanFurnitureGroup[],
    editMode: false,
    editorTab: 'rooms' as FloorplanEditorTab,
    selection: null as FloorplanSelection | null,
    selectedOpeningId: null as string | null,
    /** Wall (room edge) currently highlighted from the editor panel, e.g. while editing its thickness. */
    highlightedWall: null as { roomId: string; edgeIdx: number } | null,
    dirty: false,
    _history: [] as Snapshot[],
    _future: [] as Snapshot[],
  }),
  getters: {
    selectedRoom: (state) => state.rooms.find((r) => r.id === state.selection?.id),
    selectedFurniture: (state) => state.furniture.find((f) => f.id === state.selection?.id),
    /** Walls auto-derived from room polygon edges. One entry per room edge. */
    derivedWalls: (state): FloorplanDerivedWall[] => {
      const walls: FloorplanDerivedWall[] = []
      for (const room of state.rooms) {
        const n = room.vertices.length
        for (let i = 0; i < n; i++) {
          const v0 = room.vertices[i]
          const v1 = room.vertices[(i + 1) % n]
          walls.push({ roomId: room.id, edgeIdx: i, x1: v0[0], z1: v0[1], x2: v1[0], z2: v1[1] })
        }
      }
      return walls
    },
    /** Axis-aligned bounding-box center [x, z] of all room vertices. Falls back to [0,0]. */
    center: (state): [number, number] => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const room of state.rooms) {
        for (const [x, z] of room.vertices) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
        }
      }
      if (!isFinite(minX)) return [0, 0]
      return [(minX + maxX) / 2, (minZ + maxZ) / 2]
    },
    canUndo: (state) => state._history.length > 0,
    canRedo: (state) => state._future.length > 0,
  },
  actions: {
    _snapshot(): Snapshot {
      return JSON.parse(JSON.stringify({ rooms: this.rooms, openings: this.openings, furniture: this.furniture, furnitureGroups: this.furnitureGroups }))
    },
    _push() {
      this._history.push(this._snapshot())
      if (this._history.length > 50) this._history.shift()
      this._future = []
    },
    undo() {
      if (!this._history.length) return
      this._future.push(this._snapshot())
      const prev = this._history.pop()!
      this.rooms = prev.rooms
      this.openings = prev.openings
      this.furniture = prev.furniture
      this.furnitureGroups = prev.furnitureGroups
      this.dirty = true
    },
    redo() {
      if (!this._future.length) return
      this._history.push(this._snapshot())
      const next = this._future.pop()!
      this.rooms = next.rooms
      this.openings = next.openings
      this.furniture = next.furniture
      this.furnitureGroups = next.furnitureGroups
      this.dirty = true
    },
    async load() {
      try {
        const data = await $fetch<{
          rooms: FloorplanRoom[]
          openings?: FloorplanOpening[]
          furniture: FloorplanFurniture[]
          furnitureGroups?: FloorplanFurnitureGroup[]
        }>('/api/floorplan')
        this.rooms = data.rooms ?? []
        this.openings = data.openings ?? []
        this.furniture = data.furniture ?? []
        this.furnitureGroups = data.furnitureGroups ?? []
      } catch {
        this._loadDefaults()
      }
      this.dirty = false
    },

    _loadDefaults() {
      this.rooms = [
        { id: 'r1', name: 'Living Room', vertices: [[ 0,-5],[8,-5],[8, 3],[ 0, 3]], tintH:   0, tintV: 1.00 },
        { id: 'r2', name: 'Bedroom',     vertices: [[-8,-5],[0,-5],[0, 0],[-8, 0]], tintH: -25, tintV: 0.95 },
        { id: 'r3', name: 'Bathroom',    vertices: [[-8, 0],[-4, 0],[-4, 3],[-8, 3]], tintH:  20, tintV: 1.05 },
        { id: 'r4', name: 'Hallway',     vertices: [[-4, 0],[ 0, 0],[ 0, 3],[-4, 3]], tintH:   0, tintV: 0.90 },
        { id: 'r5', name: 'Kitchen',     vertices: [[-8, 3],[ 0, 3],[ 0, 5],[-8, 5]], tintH:  35, tintV: 1.10 },
      ]
      this.openings = [
        { id: 'op1', type: 'door',   roomId: 'r2', edgeIdx: 1, t: 0.65, width: 0.9 },
        { id: 'op2', type: 'door',   roomId: 'r4', edgeIdx: 1, t: 0.50, width: 0.9 },
        { id: 'op3', type: 'door',   roomId: 'r3', edgeIdx: 1, t: 0.50, width: 0.9 },
        { id: 'op4', type: 'window', roomId: 'r1', edgeIdx: 0, t: 0.50, width: 1.4 },
        { id: 'op5', type: 'window', roomId: 'r2', edgeIdx: 0, t: 0.50, width: 1.2 },
      ]
      this.furniture = [
        { id: 'f1', label: 'Sofa',            x:  6,    y: 0.25, z:  1.5, w: 3.0, h: 0.5, d: 1.0, tintH: -10, tintV: 0.90 },
        { id: 'f2', label: 'Bookshelf',       x:  1,    y: 0.20, z:  1.5, w: 0.4, h: 0.4, d: 3.0, tintH:   0, tintV: 0.55 },
        { id: 'f3', label: 'Coffee Table',    x:  4,    y: 0.15, z:  1.5, w: 1.6, h: 0.3, d: 0.9, tintH:   0, tintV: 0.80 },
        { id: 'f4', label: 'Bed',             x: -5.5,  y: 0.30, z: -3,   w: 3.5, h: 0.6, d: 2.0, tintH: -30, tintV: 0.95 },
        { id: 'f5', label: 'Nightstand',      x: -7.5,  y: 0.30, z: -1.6, w: 0.7, h: 0.6, d: 0.7, tintH: -30, tintV: 0.80 },
        { id: 'f6', label: 'Kitchen Counter', x: -4,    y: 0.45, z:  4.5, w: 7.0, h: 0.9, d: 0.7, tintH:  35, tintV: 0.70 },
        { id: 'f7', label: 'Kitchen Island',  x: -4,    y: 0.45, z:  3.5, w: 3.0, h: 0.9, d: 0.6, tintH:  35, tintV: 0.80 },
        { id: 'f8', label: 'Bath',            x: -6.8,  y: 0.25, z:  1.5, w: 2.2, h: 0.5, d: 1.2, tintH:  20, tintV: 1.00 },
      ]
    },

    async save() {
      await $fetch('/api/floorplan', {
        method: 'PUT',
        body: { rooms: this.rooms, openings: this.openings, furniture: this.furniture, furnitureGroups: this.furnitureGroups },
      })
      this.dirty = false
    },

    toggleEditMode() {
      this.editMode = !this.editMode
      if (!this.editMode) { this.selection = null; this.highlightedWall = null }
    },

    select(type: FloorplanItemType, id: string) {
      this.selection = { type, id }
    },

    deselect() {
      this.selection = null
    },

    // ---- Rooms ----
    updateRoom(id: string, patch: Partial<FloorplanRoom>) {
      const r = this.rooms.find((r) => r.id === id)
      if (r) { this._push(); Object.assign(r, patch); this.dirty = true }
    },
    addRoom(vertices?: [number, number][]) {
      this._push()
      const verts: [number, number][] = vertices ?? [[-2, -2], [2, -2], [2, 2], [-2, 2]]
      const r: FloorplanRoom = { id: uid(), name: 'New Room', vertices: verts, tintH: 0, tintV: 1.0 }
      this.rooms.push(r)
      this.dirty = true
      this.selection = { type: 'room', id: r.id }
    },
    deleteRoom(id: string) {
      this._push()
      this.rooms = this.rooms.filter((r) => r.id !== id)
      this.openings = this.openings.filter((o) => o.roomId !== id)
      if (this.selection?.id === id) this.selection = null
      this.dirty = true
    },
    removeVertex(roomId: string, index: number) {
      const r = this.rooms.find((r) => r.id === roomId)
      if (!r || r.vertices.length <= 3) return
      this._push()
      // Remap or discard openings on shifted edges
      this.openings = this.openings.filter((o) => {
        if (o.roomId !== roomId) return true
        if (o.edgeIdx === index) return false
        if (o.edgeIdx > index) o.edgeIdx -= 1
        return true
      })
      // Remap per-edge wall thickness overrides: drop the removed edge, shift the rest down.
      if (r.wallThicknesses) {
        const next: Record<number, number> = {}
        for (const [k, v] of Object.entries(r.wallThicknesses)) {
          const ki = Number(k)
          if (ki === index) continue
          next[ki > index ? ki - 1 : ki] = v
        }
        r.wallThicknesses = next
      }
      // Remap hidden-wall edge indices the same way.
      if (r.hiddenWalls) {
        const next = r.hiddenWalls
          .filter((e) => e !== index)
          .map((e) => (e > index ? e - 1 : e))
        r.hiddenWalls = next.length ? next : undefined
      }
      r.vertices.splice(index, 1)
      this.dirty = true
    },
    updateVertex(roomId: string, index: number, value: [number, number]) {
      const r = this.rooms.find((r) => r.id === roomId)
      if (!r || index >= r.vertices.length) return
      r.vertices[index] = value
      this.dirty = true
    },

    /** Set the thickness of a single wall edge. Pass `undefined` to clear the override (revert to room default). */
    setWallThickness(roomId: string, edgeIdx: number, value: number | undefined) {
      const r = this.rooms.find((r) => r.id === roomId)
      if (!r) return
      this._push()
      const map = { ...(r.wallThicknesses ?? {}) }
      if (value === undefined || Number.isNaN(value)) delete map[edgeIdx]
      else map[edgeIdx] = value
      r.wallThicknesses = Object.keys(map).length ? map : undefined
      this.dirty = true
    },

    /** Toggle whether a single wall edge is hidden in the 3D view (still drawn as a 2D ghost). */
    toggleWallHidden(roomId: string, edgeIdx: number) {
      const r = this.rooms.find((r) => r.id === roomId)
      if (!r) return
      this._push()
      const set = new Set(r.hiddenWalls ?? [])
      if (set.has(edgeIdx)) set.delete(edgeIdx)
      else set.add(edgeIdx)
      r.hiddenWalls = set.size ? [...set].sort((a, b) => a - b) : undefined
      this.dirty = true
    },

    /** Explicitly set a wall edge's hidden state. */
    setWallHidden(roomId: string, edgeIdx: number, hidden: boolean) {
      const r = this.rooms.find((r) => r.id === roomId)
      if (!r) return
      this._push()
      const set = new Set(r.hiddenWalls ?? [])
      if (hidden) set.add(edgeIdx)
      else set.delete(edgeIdx)
      r.hiddenWalls = set.size ? [...set].sort((a, b) => a - b) : undefined
      this.dirty = true
    },

    // ---- Openings (doors & windows) ----
    addOpening(op: Omit<FloorplanOpening, 'id'>) {
      this._push()
      this.openings.push({ id: uid(), ...op })
      this.dirty = true
    },
    deleteOpening(id: string) {
      this._push()
      this.openings = this.openings.filter((o) => o.id !== id)
      this.dirty = true
    },
    updateOpening(id: string, patch: Partial<FloorplanOpening>) {
      const o = this.openings.find((o) => o.id === id)
      if (o) { this._push(); Object.assign(o, patch); this.dirty = true }
    },

    // ---- Furniture ----
    updateFurniture(id: string, patch: Partial<FloorplanFurniture>) {
      const f = this.furniture.find((f) => f.id === id)
      if (f) { this._push(); Object.assign(f, patch); this.dirty = true }
    },
    addFurniture(groupId?: string) {
      this._push()
      const f: FloorplanFurniture = { id: uid(), label: 'New Item', x: 0, y: 0.25, z: 0, w: 1, h: 0.5, d: 1, tintH: 0, tintV: 0.9, rotY: 0, groupId }
      this.furniture.push(f)
      this.dirty = true
      this.selection = { type: 'furniture', id: f.id }
    },
    deleteFurniture(id: string) {
      this._push()
      this.furniture = this.furniture.filter((f) => f.id !== id)
      if (this.selection?.id === id) this.selection = null
      this.dirty = true
    },

    // ---- Furniture Groups ----
    addFurnitureGroup() {
      this._push()
      const g: FloorplanFurnitureGroup = { id: uid(), label: 'New Group', collapsed: false, x: 0, y: 0, z: 0, rotY: 0 }
      this.furnitureGroups.push(g)
      this.dirty = true
      return g.id
    },
    deleteFurnitureGroup(id: string) {
      this._push()
      // Ungroup all children
      for (const f of this.furniture) {
        if (f.groupId === id) f.groupId = undefined
      }
      this.furnitureGroups = this.furnitureGroups.filter((g) => g.id !== id)
      this.dirty = true
    },
    updateFurnitureGroup(id: string, patch: Partial<FloorplanFurnitureGroup>) {
      const g = this.furnitureGroups.find((g) => g.id === id)
      if (g) { this._push(); Object.assign(g, patch); this.dirty = true }
    },
    toggleGroupCollapsed(id: string) {
      const g = this.furnitureGroups.find((g) => g.id === id)
      if (g) { g.collapsed = !g.collapsed }
    },
    setFurnitureGroup(itemId: string, groupId: string | undefined) {
      const f = this.furniture.find((f) => f.id === itemId)
      if (f) { this._push(); f.groupId = groupId; this.dirty = true }
    },
    importFurnitureGroup(preset: {
      label: string
      x: number; y: number; z: number; rotY: number
      items: Omit<FloorplanFurniture, 'id' | 'groupId'>[]
    }) {
      this._push()
      const groupId = uid()
      const g: FloorplanFurnitureGroup = { id: groupId, label: preset.label, collapsed: false, x: preset.x ?? 0, y: preset.y ?? 0, z: preset.z ?? 0, rotY: preset.rotY ?? 0 }
      this.furnitureGroups.push(g)
      for (const item of (preset.items ?? [])) {
        this.furniture.push({ ...item, id: uid(), groupId })
      }
      this.dirty = true
      return groupId
    },
  },
})
