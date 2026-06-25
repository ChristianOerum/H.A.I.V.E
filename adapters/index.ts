import LightControls from '~/components/controls/LightControls.vue'
import SwitchControls from '~/components/controls/SwitchControls.vue'
import ClimateControls from '~/components/controls/ClimateControls.vue'
import SensorControls from '~/components/controls/SensorControls.vue'
import MediaPlayerControls from '~/components/controls/MediaPlayerControls.vue'
import CoverControls from '~/components/controls/CoverControls.vue'
import CameraControls from '~/components/controls/CameraControls.vue'
import { registerAdapter, type DeviceAdapter } from '~/utils/deviceRegistry'

const light: DeviceAdapter = {
  domain: 'light',
  icon: 'mdi:lightbulb',
  controls: LightControls,
  getDisplayState: (e) => {
    const on = e.state === 'on'
    const rgb = (e.attributes.rgb_color as number[] | undefined) ?? [255, 220, 150]
    const color = `#${rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`
    const brightness = Number(e.attributes.brightness ?? (on ? 255 : 0))
    return {
      color,
      intensity: on ? brightness / 255 : 0,
      label: on ? `${Math.round((brightness / 255) * 100)}%` : 'Off',
      active: on,
    }
  },
}

const sw: DeviceAdapter = {
  domain: 'switch',
  icon: 'mdi:toggle-switch',
  controls: SwitchControls,
  getDisplayState: (e) => ({
    color: e.state === 'on' ? '#5eead4' : '#475569',
    intensity: e.state === 'on' ? 1 : 0.2,
    label: e.state.toUpperCase(),
    active: e.state === 'on',
  }),
}

const climate: DeviceAdapter = {
  domain: 'climate',
  icon: 'mdi:thermostat',
  controls: ClimateControls,
  getDisplayState: (e) => ({
    color: '#f59e0b',
    intensity: e.state !== 'off' ? 1 : 0.3,
    label: `${e.attributes.current_temperature ?? '–'}${e.attributes.temperature_unit ?? '°'}`,
    active: e.state !== 'off',
  }),
}

const sensor: DeviceAdapter = {
  domain: 'sensor',
  icon: 'mdi:eye',
  controls: SensorControls,
  getDisplayState: (e) => ({
    color: '#60a5fa',
    intensity: 0.6,
    label: `${e.state}${e.attributes.unit_of_measurement ?? ''}`,
    active: true,
  }),
}

const mediaPlayer: DeviceAdapter = {
  domain: 'media_player',
  icon: 'mdi:speaker',
  controls: MediaPlayerControls,
  getDisplayState: (e) => {
    const on = e.state !== 'off' && e.state !== 'standby' && e.state !== 'unavailable'
    return {
      color: '#ffffff',
      intensity: on ? 1 : 0,
      label: e.state,
      active: on,
    }
  },
}

const cover: DeviceAdapter = {
  domain: 'cover',
  icon: 'mdi:window-shutter',
  controls: CoverControls,
  getDisplayState: (e) => ({
    color: '#94a3b8',
    intensity: 0.7,
    label: e.state,
    active: e.state === 'open',
  }),
}

const camera: DeviceAdapter = {
  domain: 'camera',
  icon: 'mdi:cctv',
  controls: CameraControls,
  getDisplayState: (e) => ({
    color: '#ef4444',
    intensity: 0.8,
    label: 'CAM',
    active: e.state === 'recording' || e.state === 'streaming',
  }),
}

export function registerBuiltInAdapters() {
  ;[light, sw, climate, sensor, mediaPlayer, cover, camera].forEach(registerAdapter)
}
