import type { HassEntity } from 'home-assistant-js-websocket'
import { getAdapter } from '~/utils/deviceRegistry'

const SENSOR_CLASS_ICONS: Record<string, string> = {
  temperature: 'mdi:thermometer',
  humidity: 'mdi:water-percent',
  power: 'mdi:flash',
  energy: 'mdi:lightning-bolt',
  battery: 'mdi:battery',
  illuminance: 'mdi:brightness-5',
  pressure: 'mdi:gauge',
  co2: 'mdi:molecule-co2',
  carbon_dioxide: 'mdi:molecule-co2',
}

/**
 * Icon for an entity: explicit placement override first, then name/device-class
 * heuristics, then the domain adapter's default.
 */
export function entityIcon(entityId: string, entity?: HassEntity, override?: string): string {
  if (override) return override
  if (entityId.includes('temperature')) return 'mdi:thermometer'
  if (entityId.includes('humidity'))    return 'mdi:water-percent'
  if (entityId.includes('outdoor'))     return 'mdi:weather-partly-cloudy'
  if (entityId.includes('blinds'))      return 'mdi:blinds'
  if (entityId.includes('garage'))      return 'mdi:garage'
  if (entityId.includes('tv') || entityId.includes('television')) return 'mdi:television'
  if (entityId.includes('coffee'))      return 'mdi:coffee'
  if (entityId.includes('front_door') || entityId.includes('door_cam')) return 'mdi:doorbell-video'
  if (entity) {
    const adapter = getAdapter(entity)
    // Specialised adapters (e.g. washer/dryer on a power sensor) know better
    // than the generic device-class mapping.
    if (adapter?.matches && adapter.icon) return adapter.icon
    const cls = entity.attributes.device_class as string | undefined
    if (cls && SENSOR_CLASS_ICONS[cls]) return SENSOR_CLASS_ICONS[cls]
    if (adapter?.icon) return adapter.icon
  }
  return 'mdi:help-circle'
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** "heat_cool" → "Heat cool", "partlycloudy" stays as-is apart from casing. */
export function humanizeState(state: string): string {
  const s = state.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
