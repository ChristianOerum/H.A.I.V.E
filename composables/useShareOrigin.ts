/**
 * The address other devices should open to reach this HAIVE server.
 *
 * The browser's own origin isn't always usable elsewhere: a kiosk browses via
 * localhost, and `.local` names (e.g. homeassistant.local) don't resolve on
 * many phones. In those cases swap the host for the server's LAN IP.
 */
export function useShareOrigin() {
  const origin = ref('')

  async function resolve() {
    const { protocol, hostname, port } = location
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    origin.value = location.origin
    if (!isLoopback && !hostname.endsWith('.local')) return origin.value
    try {
      const { ip } = await $fetch<{ ip: string | null }>('/api/ip')
      if (ip) origin.value = `${protocol}//${ip}${port ? `:${port}` : ''}`
    } catch { /* keep the browser's origin */ }
    return origin.value
  }

  return { origin, resolve }
}
