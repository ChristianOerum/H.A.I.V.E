import type { Component } from 'vue'
import type { HassEntity } from 'home-assistant-js-websocket'

/**
 * Visual state derived from an entity, used by the 3D marker layer.
 *  - color: hex color for the marker glow
 *  - intensity: 0..1 — used for emissive strength / opacity
 *  - label: short display string (e.g. "72°F", "ON")
 *  - active: whether the device is in a non-idle state
 */
export interface DeviceVisualState {
  color: string
  intensity: number
  label: string
  active: boolean
}

export interface DeviceAdapter {
  /** Home Assistant domain (e.g. 'light', 'switch') */
  domain: string
  /** Optional finer filter — defaults to entity_id prefix match */
  matches?: (entity: HassEntity) => boolean
  /** Icon glyph (emoji or string), used until SVG/3D icons are added */
  icon: string
  /** Derive visual state from the entity */
  getDisplayState: (entity: HassEntity) => DeviceVisualState
  /** Vue component rendered in the bottom-sheet control panel */
  controls: Component
}

const registry = new Map<string, DeviceAdapter>()

export function registerAdapter(adapter: DeviceAdapter) {
  registry.set(adapter.domain, adapter)
}

export function getAdapter(entity: HassEntity): DeviceAdapter | undefined {
  const domain = entity.entity_id.split('.')[0]
  const a = registry.get(domain)
  if (!a) return undefined
  if (a.matches && !a.matches(entity)) return undefined
  return a
}

export function allAdapters(): DeviceAdapter[] {
  return Array.from(registry.values())
}
