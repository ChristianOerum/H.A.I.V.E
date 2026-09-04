import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as haCallService,
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH,
  type Connection,
  type HassEntities,
  type HassEntity,
} from 'home-assistant-js-websocket'
import { mockSubscribe, mockCallService, startMockSimulation, stopMockSimulation } from '~/utils/mockHomeAssistant'

let connectionPromise: Promise<Connection> | null = null
let unsubEntities: (() => void) | null = null
let mockActive = false

export interface HaBootstrap {
  configured: boolean
  source: 'supervisor' | 'manual' | 'none'
  /** Same-origin base the HA client appends `/api/websocket` to. */
  proxyBase: string
}

function isMockRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('mock')
}

async function fetchBootstrap(): Promise<HaBootstrap> {
  return await $fetch<HaBootstrap>('/api/ha/token')
}

/**
 * Composable: provides the live HA connection + reactive entity state.
 *
 * The connection is made to the HAIVE server's own origin, which bridges it to
 * Home Assistant — so every screen in the house connects the same way and no
 * client ever holds a Home Assistant token. Falls back to a built-in mock when
 * HA is not configured or ?mock=1 is set.
 */
export function useHomeAssistant() {
  const store = useEntitiesStore()

  function startMock(reason?: string) {
    if (mockActive) return
    mockActive = true
    if (reason) store.setError(reason)
    store.setStatus('connected')
    unsubEntities?.()
    // Guard on mockActive so a stale simulation can never write to the store
    // once a real (non-mock) session has taken over.
    unsubEntities = mockSubscribe((entities) => { if (mockActive) store.replace(entities) })
    startMockSimulation()
  }

  async function start() {
    // Mock explicitly requested (?mock=1) — start it once and stop here.
    if (isMockRequested()) {
      if (!mockActive) startMock('Mock mode (?mock=1)')
      return
    }

    // A real connection is already live or in-flight.
    if (connectionPromise) return connectionPromise

    // Real connection path: proactively tear down any leftover mock simulation
    // (e.g. from a prior ?mock=1 view in this tab) so its interval can't keep
    // pushing mock entities into the store while we connect to real HA.
    stopMockSimulation()
    unsubEntities?.()
    unsubEntities = null
    mockActive = false
    store.replace({})

    store.setStatus('connecting')

    // Missing credentials is a permanent state until setup runs, so we must not
    // schedule a retry for it.
    let retryable = true

    connectionPromise = (async () => {
      const boot = await fetchBootstrap()
      if (!boot.configured) {
        retryable = false
        throw new Error('Home Assistant is not connected')
      }
      // The real token is injected server-side by the proxy, so the placeholder
      // below is never seen by Home Assistant.
      const auth = createLongLivedTokenAuth(`${window.location.origin}${boot.proxyBase}`, 'haive-proxy')
      return await createConnection({ auth })
    })().catch((err) => {
      connectionPromise = null
      if (err === ERR_HASS_HOST_REQUIRED) store.setError('HA host required')
      else if (err === ERR_INVALID_AUTH) store.setError('Invalid HA token')
      else store.setError(String((err as Error)?.message ?? err))
      store.setStatus('error')
      if (retryable) setTimeout(() => { void start().catch(() => {}) }, 3000)
      throw err
    })

    const conn = await connectionPromise
    if (!conn || mockActive) return

    // Real HA is now live — tear down any lingering mock state
    stopMockSimulation()
    mockActive = false

    conn.addEventListener('ready', () => store.setStatus('connected'))
    conn.addEventListener('disconnected', () => store.setStatus('disconnected'))
    conn.addEventListener('reconnect-error', () => store.setStatus('error'))

    unsubEntities?.()
    unsubEntities = subscribeEntities(conn, (entities: HassEntities) => {
      store.replace(entities)
    })

    store.setStatus('connected')
    return conn
  }

  async function callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: { entity_id?: string | string[] },
  ): Promise<unknown> {
    if (mockActive) return mockCallService(domain, service, serviceData, target)
    const conn = await (connectionPromise ?? start())
    if (!conn) return mockCallService(domain, service, serviceData, target)
    return haCallService(conn, domain, service, serviceData, target)
  }

  function stop() {
    unsubEntities?.()
    unsubEntities = null
    connectionPromise = null
    mockActive = false
  }

  return { start, stop, callService, isMock: () => mockActive }
}

export type { HassEntity, HassEntities }
