import { assertLanClient } from '~~/server/utils/lanGuard'
import { resetDeviceConfig } from '~~/server/utils/deviceConfig'
import { publish } from '~~/server/utils/eventBus'

/**
 * Factory reset: clears the persisted device config so the app returns to the
 * first-launch setup screen. Layout/floorplan data files are left untouched.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  await resetDeviceConfig()
  publish({ type: 'device' })
  return { ok: true }
})
