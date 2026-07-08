import { ensureMasterEvents } from '~~/server/utils/masterEvents'
import { subscribe } from '~~/server/utils/eventBus'

/**
 * On startup, and whenever the local device config changes, (re)establish the
 * upstream SSE bridge from Master → this Slave's local bus. Master devices
 * short-circuit inside `ensureMasterEvents`.
 */
export default defineNitroPlugin(() => {
  void ensureMasterEvents()
  subscribe((e) => {
    if (e.type === 'device') void ensureMasterEvents()
  })
})
