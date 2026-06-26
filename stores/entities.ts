import { defineStore } from 'pinia'
import type { HassEntities, HassEntity } from 'home-assistant-js-websocket'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export const useEntitiesStore = defineStore('entities', {
  state: () => ({
    entities: {} as HassEntities,
    status: 'idle' as ConnectionStatus,
    error: '' as string,
    lastUpdate: 0 as number,
  }),
  getters: {
    list: (state): HassEntity[] => Object.values(state.entities),
    byDomain: (state) => (domain: string) =>
      Object.values(state.entities).filter((e) =>
        e.entity_id.startsWith(`${domain}.`),
      ),
    get: (state) => (entityId: string): HassEntity | undefined =>
      state.entities[entityId],
  },
  actions: {
    replace(entities: HassEntities) {
      this.entities = entities
      this.lastUpdate = Date.now()
    },
    setStatus(s: ConnectionStatus) {
      this.status = s
      if (s === 'connected') {
        this.error = ''
      } else {
        this.entities = {}
      }
    },
    setError(e: string) {
      this.error = e
    },
    patch(entityId: string, partial: Partial<HassEntity>) {
      const existing = this.entities[entityId]
      if (!existing) return
      this.entities[entityId] = {
        ...existing,
        ...partial,
        attributes: { ...existing.attributes, ...partial.attributes },
      }
    },
  },
})
