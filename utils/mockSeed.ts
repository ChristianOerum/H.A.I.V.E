import washingMachine from '~/config/furnitureLibrary/washing_machine.json'
import type { FloorplanFurniture } from '~/stores/floorplan'

/**
 * Demo content mock mode adds on top of the seeded sandbox: a washing machine
 * model with the simulated `sensor.washing_machine` marker on top of it, so the
 * appliance animation (wash → rinse → spin) shows up offline. Each piece is
 * added once per sandbox — deleting it in the editor keeps it deleted.
 */
const SEED_FLAG_PREFIX = 'haive.mock.seeded.'

/** Floor position of the demo washer: against the back wall of the seeded room, door facing into it. */
const WASHER_POS = { x: -3.6, z: -8.3 }

export const MOCK_WASHER_FURNITURE = {
  label: washingMachine.label,
  x: WASHER_POS.x,
  y: 0,
  z: WASHER_POS.z,
  rotY: 0,
  items: washingMachine.items as Omit<FloorplanFurniture, 'id' | 'groupId'>[],
}

export const MOCK_WASHER_PLACEMENT = {
  entity_id: 'sensor.washing_machine',
  // Just above the 0.85 m lid so the drum ring lies on top of the machine.
  position: [WASHER_POS.x, 0.95, WASHER_POS.z] as [number, number, number],
  label: 'Washing Machine',
  icon: 'mdi:washing-machine',
}

/** Returns true the first time it is called for `key` in this sandbox, then false. */
export function claimMockSeed(key: string): boolean {
  try {
    if (localStorage.getItem(SEED_FLAG_PREFIX + key)) return false
    localStorage.setItem(SEED_FLAG_PREFIX + key, '1')
    return true
  } catch {
    return false
  }
}
