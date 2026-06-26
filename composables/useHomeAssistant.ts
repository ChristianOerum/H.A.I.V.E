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
  url: string
  token: string
  mock?: boolean
}

function isMockRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('mock')
}

async function fetchBootstrap(): Promise<HaBootstrap> {
  try {
    return await $fetch<HaBootstrap>('/api/ha/token')
  } catch {
    return { url: '', token: '', mock: true }
  }
}

/**
 * Composable: provides the live HA connection + reactive entity state.
 * Falls back to a built-in mock when no token is configured or ?mock=1 is set.
 */
export function useHomeAssistant() {
  const store = useEntitiesStore()

  function startMock(reason?: string) {
    if (mockActive) return
    mockActive = true
    if (reason) store.setError(reason)
    store.setStatus('connected')
    unsubEntities?.()
    unsubEntities = mockSubscribe((entities) => store.replace(entities))
    startMockSimulation()
  }

  async function start() {
    if (mockActive || connectionPromise) return connectionPromise ?? undefined

    if (isMockRequested()) {
      startMock('Mock mode (?mock=1)')
      return
    }

    store.setStatus('connecting')

    connectionPromise = (async () => {
      const boot = await fetchBootstrap()
      if (boot.mock || !boot.url || !boot.token) {
        throw new Error('__USE_MOCK__')
      }
      const auth = createLongLivedTokenAuth(boot.url, boot.token)
      return await createConnection({ auth })
    })().catch((err) => {
      connectionPromise = null
      if ((err as Error)?.message === '__USE_MOCK__') {
        startMock('No HA token configured — using mock data')
        return null as unknown as Connection
      }
      if (err === ERR_HASS_HOST_REQUIRED) store.setError('HA host required')
      else if (err === ERR_INVALID_AUTH) store.setError('Invalid HA token')
      else store.setError(String((err as Error)?.message ?? err))
      store.setStatus('error')
      setTimeout(() => void start(), 3000)
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
