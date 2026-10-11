import { assertLanClient } from '~~/server/utils/lanGuard'
import { lanAddresses } from '~~/server/utils/lanAddresses'

/**
 * Returns this device's primary LAN IPv4 address (and any others). Handy when
 * the app is deployed on a headless Raspberry Pi and you need to reach it from
 * another machine without checking the router.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const addresses = await lanAddresses()
  return {
    ip: addresses[0] ?? null,
    addresses,
  }
})
