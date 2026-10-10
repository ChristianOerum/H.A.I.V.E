import type { ScanResult } from '~/utils/scanGeometry'
import { convertScan } from '~/utils/scanGeometry'

// Module-level singleton: live sync refreshes it, the Rooms tab reads it.
const pending = ref<ScanResult | null>(null)

/** The phone scan waiting on the server (see server/api/scan.ts), and importing it into the floorplan. */
export function usePendingScan() {
  const fp = useFloorplanStore()

  async function refresh() {
    try {
      const res = await $fetch<{ scan: ScanResult | null }>('/api/scan')
      pending.value = res.scan
    } catch {
      pending.value = null
    }
  }

  async function discard() {
    pending.value = null
    await $fetch('/api/scan', { method: 'DELETE' }).catch(() => {})
  }

  /** Adds the scan to the floorplan as unsaved, undoable changes. Returns what was added. */
  async function importIntoFloorplan() {
    if (!pending.value) return null
    const result = convertScan(pending.value, fp.rooms)
    fp.importScannedRooms(result.rooms, result.openings)
    await discard()
    return result
  }

  return { pending: readonly(pending), refresh, discard, importIntoFloorplan }
}
