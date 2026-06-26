import type { HassEntities, HassEntity } from 'home-assistant-js-websocket'

type Listener = (entities: HassEntities) => void

function entity(
  id: string,
  state: string,
  attrs: Record<string, unknown> = {},
): HassEntity {
  return {
    entity_id: id,
    state,
    attributes: {
      friendly_name: id.split('.')[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      ...attrs,
    },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'mock', parent_id: null, user_id: null },
  } as HassEntity
}

const initial: HassEntities = Object.fromEntries(
  [
    entity('light.living_room', 'on', {
      brightness: 200,
      rgb_color: [255, 220, 150],
      supported_color_modes: ['rgb'],
    }),
    entity('light.kitchen', 'off', {
      brightness: 0,
      rgb_color: [255, 255, 255],
      supported_color_modes: ['rgb'],
    }),
    entity('light.bedroom', 'on', {
      brightness: 120,
      rgb_color: [180, 120, 255],
      supported_color_modes: ['rgb'],
    }),
    entity('light.bathroom', 'off', { brightness: 0 }),
    entity('light.hallway', 'on', { brightness: 80 }),
    entity('switch.coffee_maker', 'off'),
    entity('switch.tv', 'on'),
    entity('switch.desk_lamp', 'off'),
    entity('climate.thermostat', 'heat', {
      current_temperature: 21,
      temperature: 22,
      temperature_unit: '°C',
      hvac_modes: ['off', 'heat', 'cool', 'auto'],
    }),
    entity('sensor.living_room_temperature', '21.4', {
      unit_of_measurement: '°C',
      device_class: 'temperature',
    }),
    entity('sensor.bedroom_humidity', '47', {
      unit_of_measurement: '%',
      device_class: 'humidity',
    }),
    entity('sensor.outdoor_temperature', '14', {
      unit_of_measurement: '°C',
      device_class: 'temperature',
    }),
    entity('media_player.living_room', 'playing', {
      media_title: 'Sample Track',
      media_artist: 'Test Artist',
      volume_level: 0.4,
    }),
    entity('cover.bedroom_blinds', 'open', { current_position: 100 }),
    entity('cover.garage_door', 'closed', { current_position: 0 }),
    entity('camera.front_door', 'idle', { entity_picture: '' }),
  ].map((e) => [e.entity_id, e]),
)

let state: HassEntities = { ...initial }
const listeners = new Set<Listener>()

function notify() {
  // Clone so reactivity sees a new ref
  state = { ...state }
  listeners.forEach((fn) => fn(state))
}

function update(id: string, patch: Partial<HassEntity> & { attributes?: Record<string, unknown> }) {
  const cur = state[id]
  if (!cur) return
  state[id] = {
    ...cur,
    ...patch,
    attributes: { ...cur.attributes, ...(patch.attributes ?? {}) },
    last_changed: patch.state && patch.state !== cur.state ? new Date().toISOString() : cur.last_changed,
    last_updated: new Date().toISOString(),
  } as HassEntity
  notify()
}

export function mockSubscribe(cb: Listener): () => void {
  listeners.add(cb)
  // Initial push (microtask, so subscribers wired first)
  queueMicrotask(() => cb(state))
  return () => listeners.delete(cb)
}

export async function mockCallService(
  domain: string,
  service: string,
  data?: Record<string, unknown>,
  target?: { entity_id?: string | string[] },
): Promise<void> {
  const ids = Array.isArray(target?.entity_id)
    ? target.entity_id
    : target?.entity_id
      ? [target.entity_id]
      : []

  for (const id of ids) {
    const e = state[id]
    if (!e) continue

    if (domain === 'light' || domain === 'switch') {
      if (service === 'turn_on') {
        update(id, {
          state: 'on',
          attributes: {
            ...(data?.brightness !== undefined ? { brightness: Number(data.brightness) } : {}),
            ...(data?.rgb_color ? { rgb_color: data.rgb_color } : {}),
          },
        })
      } else if (service === 'turn_off') {
        update(id, { state: 'off', attributes: { brightness: 0 } })
      } else if (service === 'toggle') {
        update(id, { state: e.state === 'on' ? 'off' : 'on' })
      }
    } else if (domain === 'climate') {
      if (service === 'set_temperature' && data?.temperature !== undefined) {
        update(id, { attributes: { temperature: Number(data.temperature) } })
      } else if (service === 'set_hvac_mode' && data?.hvac_mode) {
        update(id, { state: String(data.hvac_mode) })
      }
    } else if (domain === 'cover') {
      if (service === 'open_cover') update(id, { state: 'open', attributes: { current_position: 100 } })
      else if (service === 'close_cover') update(id, { state: 'closed', attributes: { current_position: 0 } })
      else if (service === 'stop_cover') update(id, { state: 'stopped' })
    } else if (domain === 'media_player') {
      if (service === 'turn_on') update(id, { state: 'idle' })
      else if (service === 'turn_off') update(id, { state: 'off' })
      else if (service === 'media_play') update(id, { state: 'playing' })
      else if (service === 'media_pause') update(id, { state: 'paused' })
      else if (service === 'media_stop') update(id, { state: 'idle' })
    }
  }
}

let simulationInterval: ReturnType<typeof setInterval> | null = null

/** Start the mock simulation. Safe to call multiple times — only one interval runs at a time. */
export function startMockSimulation() {
  if (simulationInterval !== null) return
  simulationInterval = setInterval(() => {
    for (const id of ['sensor.living_room_temperature', 'sensor.outdoor_temperature']) {
      const e = state[id]
      if (!e) continue
      const cur = Number(e.state)
      const next = (cur + (Math.random() - 0.5) * 0.3).toFixed(1)
      update(id, { state: next })
    }
  }, 5000)
}

/** Stop the mock simulation and clear all listeners. Called when real HA takes over. */
export function stopMockSimulation() {
  if (simulationInterval !== null) {
    clearInterval(simulationInterval)
    simulationInterval = null
  }
  listeners.clear()
}
