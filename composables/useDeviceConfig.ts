export type DeviceRole = 'master' | 'slave'

export interface PublicDeviceConfig {
  configured: boolean
  role: DeviceRole
  haUrl: string
  allowedLocalPrefixes: string[]
  masterUrl: string
  haConfigured: boolean
}

export interface DeviceSetupPayload {
  role: DeviceRole
  haUrl?: string
  haToken?: string
  allowedLocalPrefixes?: string
  masterUrl?: string
}

const DEFAULT: PublicDeviceConfig = {
  configured: false,
  role: 'master',
  haUrl: '',
  allowedLocalPrefixes: ['127.', '192.168.', '10.', '172.'],
  masterUrl: '',
  haConfigured: false,
}

/**
 * Client-side view of the persisted device configuration. Drives the
 * first-launch setup gate and the settings/factory-reset controls.
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
  const role = computed(() => config.value.role)

  return { config, loaded, configured, role, refresh, save, factoryReset }
}
