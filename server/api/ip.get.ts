import { networkInterfaces } from 'node:os'
import { assertLanClient } from '~~/server/utils/lanGuard'

interface SupervisorInterface {
  primary?: boolean
  connected?: boolean
  ipv4?: { address?: string[] }
}

/**
 * Host LAN addresses from the Supervisor. Inside the add-on container the OS
 * only sees Docker's internal network, so ask the Supervisor for the real ones
 * (primary interface first).
 */
async function supervisorAddresses(): Promise<string[]> {
  const token = process.env.SUPERVISOR_TOKEN
  if (!token) return []
  try {
    const res = await $fetch<{ data?: { interfaces?: SupervisorInterface[] } }>('http://supervisor/network/info', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 3000,
    })
    const ifaces = (res.data?.interfaces ?? [])
      .filter((i) => i.connected !== false)
      .sort((a, b) => Number(!!b.primary) - Number(!!a.primary))
    return ifaces.flatMap((i) => (i.ipv4?.address ?? []).map((a) => a.split('/')[0]!))
  } catch {
    return []
  }
}

/**
 * Returns this device's primary LAN IPv4 address (and any others). Handy when
 * the app is deployed on a headless Raspberry Pi and you need to reach it from
 * another machine without checking the router.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  const addresses = await supervisorAddresses()
  if (!addresses.length) {
    const ifaces = networkInterfaces()
    for (const list of Object.values(ifaces)) {
      if (!list) continue
      for (const net of list) {
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push(net.address)
        }
      }
    }
  }

  return {
    ip: addresses[0] ?? null,
    addresses,
  }
})
