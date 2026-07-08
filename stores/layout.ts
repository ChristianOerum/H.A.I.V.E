import { defineStore } from 'pinia'

const MOCK_LAYOUT_KEY = 'haive.mock.layout'

export interface DevicePlacement {
  entity_id: string
  position: [number, number, number]
  rotation?: [number, number, number]
  label?: string
  /** Optional Iconify icon override, e.g. 'mdi:lightbulb'. Falls back to auto-detect. */
  icon?: string
  /** Optional furniture item ID whose world position drives the 3D light source. */
  lightSourceFurnitureId?: string
  /** Optional custom marker color (hex). Does not apply to lights (their color is auto-set). */
  color?: string
}

export const useLayoutStore = defineStore('layout', {
  state: () => ({
    placements: [] as DevicePlacement[],
    selectedEntityId: null as string | null,
    editMode: false,
    dirty: false,
  }),
  getters: {
    placementFor: (state) => (entityId: string) =>
      state.placements.find((p) => p.entity_id === entityId),
  },
  actions: {
    async load() {
      // Mock mode: use the localStorage sandbox if it exists, otherwise seed
      // from the server config (below) as a starting point.
      if (isMockMode() && import.meta.client) {
        const raw = localStorage.getItem(MOCK_LAYOUT_KEY)
        if (raw) {
          try { this.placements = JSON.parse(raw).placements ?? [] } catch { this.placements = [] }
          this.dirty = false
          return
        }
      }
      try {
        const res = await $fetch<{ placements: DevicePlacement[] }>(
          '/api/layout',
        )
        this.placements = res.placements ?? []
      } catch {
        this.placements = []
      }
      this.dirty = false
    },
    async save() {
      // Mock mode never writes to the server — it stays a private sandbox.
      if (isMockMode()) {
        if (import.meta.client) {
          localStorage.setItem(MOCK_LAYOUT_KEY, JSON.stringify({ placements: this.placements }))
        }
        this.dirty = false
        return
      }
      await $fetch('/api/layout', {
        method: 'PUT',
        body: { placements: this.placements },
      })
      this.dirty = false
    },
    select(entityId: string | null) {
      this.selectedEntityId = entityId
    },
    move(entityId: string, position: [number, number, number]) {
      const p = this.placements.find((x) => x.entity_id === entityId)
      if (p) { p.position = position; this.dirty = true }
    },
    toggleEditMode() {
      this.editMode = !this.editMode
    },
    addPlacement(entityId: string) {
      if (this.placements.find((p) => p.entity_id === entityId)) return
      this.placements.push({ entity_id: entityId, position: [0, 1.2, 0] })
      this.dirty = true
    },
    deletePlacement(entityId: string) {
      this.placements = this.placements.filter((p) => p.entity_id !== entityId)
      if (this.selectedEntityId === entityId) this.selectedEntityId = null
      this.dirty = true
    },
    updatePlacement(entityId: string, patch: Partial<DevicePlacement>) {
      const p = this.placements.find((p) => p.entity_id === entityId)
      if (p) { Object.assign(p, patch); this.dirty = true }
    },
  },
})
