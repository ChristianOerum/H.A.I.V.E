export type WifiSecurity = 'WPA' | 'WEP' | 'NONE'

/** Where the server gets its Home Assistant connection from. */
export type HaSource = 'supervisor' | 'manual' | 'none'

export interface PublicWifiInfo {
  configured: boolean
  ssid: string
  security: WifiSecurity
  hidden: boolean
}

export interface PublicDeviceConfig {
  configured: boolean
  haUrl: string
  haSource: HaSource
  allowedLocalPrefixes: string[]
  haConfigured: boolean
  authEnabled: boolean
  wifi: PublicWifiInfo
}

export interface DeviceSetupPayload {
  haUrl?: string
  haToken?: string
  allowedLocalPrefixes?: string
  authPin?: string
  wifi?: {
    ssid: string
    password: string
    security: WifiSecurity
    hidden: boolean
  }
}

const DEFAULT: PublicDeviceConfig = {
  configured: false,
  haUrl: '',
  haSource: 'none',
  allowedLocalPrefixes: ['127.', '192.168.', '10.', '172.'],
  haConfigured: false,
  authEnabled: false,
  wifi: { configured: false, ssid: '', security: 'WPA', hidden: false },
}

/**
 * Client-side view of the persisted server configuration. Every screen talks to
 * the same HAIVE server, so this is identical everywhere. Drives the setup gate
 * and the settings / factory-reset controls.
 */
export function useDeviceConfig() {
  const config = useState<PublicDeviceConfig>('device:config', () => ({ ...DEFAULT }))
  const loaded = useState<boolean>('device:config:loaded', () => false)

  async function refresh(): Promise<PublicDeviceConfig> {
    const data = await $fetch<PublicDeviceConfig>('/api/config')
    config.value = data
    loaded.value = true
    return data
  }

  async function save(payload: DeviceSetupPayload): Promise<void> {
    await $fetch('/api/config', { method: 'POST', body: payload })
    await refresh()
  }

  async function factoryReset(): Promise<void> {
    await $fetch('/api/config/reset', { method: 'POST' })
    config.value = { ...DEFAULT }
  }

  const configured = computed(() => config.value.configured)
  const authEnabled = computed(() => config.value.authEnabled)
  /** True when HAIVE is running as a Home Assistant OS add-on. */
  const supervised = computed(() => config.value.haSource === 'supervisor')

  return { config, loaded, configured, authEnabled, supervised, refresh, save, factoryReset }
}
