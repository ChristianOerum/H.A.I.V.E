import { networkInterfaces } from 'node:os'
import { assertLanClient } from '~~/server/utils/lanGuard'

/**
 * Returns this device's primary LAN IPv4 address (and any others). Handy when
 * the app is deployed on a headless Raspberry Pi and you need to reach it from
 * another machine without checking the router.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const addresses: string[] = []
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address)
      }
    }
  }

  return {
    ip: addresses[0] ?? null,
    addresses,
  }
})
