import type { HassEntity } from 'home-assistant-js-websocket'

/**
 * Laundry appliances (washing machines / tumble dryers). Home Assistant has no
 * dedicated domain for them — integrations expose them as sensors, binary
 * sensors, switches (smart plugs) or selects — so we recognise them by the
 * marker icon override or by the entity id / friendly name, and parse the many
 * vendor-specific state strings into a small set of phases.
 */
export type ApplianceKind = 'washer' | 'dryer'

export type AppliancePhase =
  | 'off'
  | 'idle'
  | 'paused'
  | 'done'
  | 'wash'
  | 'rinse'
  | 'spin'
  | 'dry'
  | 'cool'
  /** Running, but the integration doesn't tell us which part of the cycle. */
  | 'running'

export const APPLIANCE_DOMAINS = ['sensor', 'binary_sensor', 'switch', 'select', 'input_select']

export const APPLIANCE_ICONS: Record<ApplianceKind, string> = {
  washer: 'mdi:washing-machine',
  dryer: 'mdi:tumble-dryer',
}

export const APPLIANCE_COLORS: Record<ApplianceKind, string> = {
  washer: '#38bdf8',
  dryer: '#fb923c',
}

// Dishwashers also contain "wash"/"vask" (Danish: opvaskemaskine) — exclude them.
const DISH_RE = /dish|opvask|geschirr|lave_?vaisselle/
const DRYER_RE = /dryer|tumble|t(ø|oe?)rre|trockner|s(e|é)che_?linge/
const WASHER_RE = /wash|vask|wasch|lave_?linge/
const LAUNDRY_RE = /laundry/

/**
 * Returns the appliance kind for an entity, or null when it isn't one.
 * `iconOverride` is the placement's custom marker icon — picking the washing
 * machine / tumble dryer icon in the editor forces detection for entities
 * with unhelpful names.
 */
export function detectAppliance(entity: HassEntity, iconOverride?: string): ApplianceKind | null {
  const domain = entity.entity_id.split('.')[0]
  if (!APPLIANCE_DOMAINS.includes(domain)) return null

  if (iconOverride) {
    if (/tumble-dryer/.test(iconOverride)) return 'dryer'
    if (/washing-machine/.test(iconOverride)) return 'washer'
  }

  const name = `${entity.entity_id} ${entity.attributes?.friendly_name ?? ''}`
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (DISH_RE.test(name)) return null
  // A combined washer-dryer counts as a washer; its phase switches the 3D
  // effect to the dryer look while it is drying.
  if (WASHER_RE.test(name)) return 'washer'
  if (DRYER_RE.test(name)) return 'dryer'
  if (LAUNDRY_RE.test(name)) return 'washer'
  return null
}

/** Splits "BSH.Common.EnumType.OperationState.Run" / "delayWash" / "Main wash" into lowercase words. */
function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
}

interface PhaseRule {
  phase: AppliancePhase
  /** Whole-word matches */
  exact?: string[]
  /** Word-prefix matches (stems like "rins" for rinse/rinsing) */
  prefix?: string[]
}

// Order matters: e.g. "delay_wash" must read as idle before "wash" matches,
// and "program_ended" as done before anything else.
const RULES: PhaseRule[] = [
  { phase: 'paused', prefix: ['pause'] },
  { phase: 'off', exact: ['off', 'unavailable', 'unknown', 'none', 'poweroff'] },
  { phase: 'done', exact: ['end', 'ended', 'done'], prefix: ['finish', 'complet'] },
  { phase: 'idle', prefix: ['delay', 'waiting', 'reserv', 'timer'] },
  { phase: 'spin', prefix: ['spin', 'centrifug', 'schleuder'] },
  { phase: 'rinse', prefix: ['rins', 'skyl', 'spül', 'spul'] },
  { phase: 'cool', prefix: ['cool', 'anti', 'crease', 'afkøl'] },
  { phase: 'dry', prefix: ['dry', 'drying', 'tørr', 'trockn'] },
  { phase: 'wash', prefix: ['wash', 'prewash', 'soak', 'vask', 'wasch', 'main'] },
  { phase: 'idle', exact: ['ready', 'stop', 'stopped'], prefix: ['idle', 'standby', 'inactive', 'sleep', 'programmed', 'select'] },
  {
    phase: 'running',
    exact: ['on', 'run', 'use', 'busy', 'heat', 'heating', 'steam'],
    prefix: ['running', 'active', 'start', 'detect', 'sens', 'weigh', 'program', 'cycl', 'kører'],
  },
]

function phaseFromText(text: string): AppliancePhase | null {
  const words = tokens(text)
  if (!words.length) return 'off'
  for (const rule of RULES) {
    if (words.some((w) => rule.exact?.includes(w) || rule.prefix?.some((p) => w.startsWith(p)))) {
      return rule.phase
    }
  }
  return null
}

// Attributes some integrations use to report the current part of the cycle
// while the main state just says "run" / "on".
const PHASE_ATTRS = ['program_phase', 'phase', 'job_state', 'washer_job_state', 'dryer_job_state', 'run_state', 'current_course']

/** Power draw above this (W) counts as running for smart-plug power sensors. */
const POWER_RUNNING_W = 5

export function getAppliancePhase(entity: HassEntity): AppliancePhase {
  const raw = String(entity.state ?? '').trim()

  const num = Number(raw)
  if (raw !== '' && Number.isFinite(num)) {
    const unit = String(entity.attributes?.unit_of_measurement ?? '')
    const watts = unit === 'kW' ? num * 1000 : num
    if (unit === 'W' || unit === 'kW') return watts > POWER_RUNNING_W ? 'running' : 'idle'
    // Remaining-time / progress style numeric sensors: anything > 0 is running.
    return num > 0 ? 'running' : 'idle'
  }

  const phase = phaseFromText(raw) ?? 'idle'
  if (phase !== 'running') return phase

  // Generic "running" — refine with a phase attribute if the integration has one.
  for (const key of PHASE_ATTRS) {
    const v = entity.attributes?.[key]
    if (typeof v !== 'string') continue
    const p = phaseFromText(v)
    if (p && p !== 'off' && p !== 'idle' && p !== 'running') return p
  }
  return 'running'
}

export function isApplianceRunning(phase: AppliancePhase): boolean {
  return phase === 'wash' || phase === 'rinse' || phase === 'spin' ||
    phase === 'dry' || phase === 'cool' || phase === 'running'
}

/** Whether the 3D effect should show heat (dryer) rather than water (washer). */
export function isDryingPhase(kind: ApplianceKind, phase: AppliancePhase): boolean {
  if (phase === 'dry' || phase === 'cool') return true
  if (phase === 'wash' || phase === 'rinse' || phase === 'spin') return false
  return kind === 'dryer'
}

export function phaseLabel(kind: ApplianceKind, phase: AppliancePhase): string {
  switch (phase) {
    case 'off': return 'Off'
    case 'idle': return 'Idle'
    case 'paused': return 'Paused'
    case 'done': return 'Finished'
    case 'wash': return 'Washing'
    case 'rinse': return 'Rinsing'
    case 'spin': return 'Spinning'
    case 'dry': return 'Drying'
    case 'cool': return 'Cooling down'
    case 'running': return kind === 'dryer' ? 'Drying' : 'Washing'
  }
}

/**
 * Remaining time in minutes, read from the common attribute names, or from
 * an ISO `completion_time` / `end_time`. Null when unknown.
 */
export function getRemainingMinutes(entity: HassEntity): number | null {
  const a = entity.attributes ?? {}
  for (const key of ['remaining_time', 'remain_time', 'time_remaining', 'remaining_minutes']) {
    const v = a[key]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v))
    if (typeof v === 'string') {
      // "1:25" / "01:25:00" (h:mm[:ss]) or a plain number string
      const hm = v.match(/^(\d+):(\d{2})(?::\d{2})?$/)
      if (hm) return Number(hm[1]) * 60 + Number(hm[2])
      const n = Number(v)
      if (v.trim() !== '' && Number.isFinite(n)) return Math.max(0, Math.round(n))
    }
  }
  for (const key of ['completion_time', 'end_time', 'finish_time']) {
    const v = a[key]
    if (typeof v !== 'string') continue
    const t = Date.parse(v)
    if (Number.isFinite(t)) return Math.max(0, Math.round((t - Date.now()) / 60000))
  }
  return null
}

/** Cycle progress 0–100, or null when the integration doesn't report it. */
export function getProgress(entity: HassEntity): number | null {
  const a = entity.attributes ?? {}
  for (const key of ['progress', 'program_progress', 'progress_percent']) {
    const v = Number(a[key])
    if (a[key] !== undefined && a[key] !== null && Number.isFinite(v)) return Math.min(100, Math.max(0, v))
  }
  return null
}
