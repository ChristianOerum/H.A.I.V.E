import type { HassEntity } from 'home-assistant-js-websocket'

export type Precipitation = 'rain' | 'snow' | 'none'

// Home Assistant standard weather conditions.
const RAIN_CONDITIONS = new Set(['rainy', 'pouring', 'lightning-rainy', 'hail'])
const SNOW_CONDITIONS = new Set(['snowy', 'snowy-rainy'])
const HEAVY_CONDITIONS = new Set(['pouring', 'lightning-rainy'])
const OVERCAST_CONDITIONS = new Set([
  'cloudy', 'fog', 'rainy', 'pouring', 'snowy', 'snowy-rainy',
  'lightning', 'lightning-rainy', 'hail', 'exceptional',
])

// Module-scoped singleton so the toggle button and the scene share one flag.
// When false, every effect derivation collapses to a neutral "clear" scene.
const weatherEnabled = ref(true)

/** Conditions the mock-mode test button cycles through. */
export const DEMO_CONDITIONS = [
  'sunny', 'partlycloudy', 'cloudy', 'fog', 'rainy', 'pouring', 'snowy', 'clear-night',
] as const

// Manual condition override for testing (driven by the mock-mode cycle button).
// null = follow the live/mock entity; a string forces that condition everywhere.
const overrideCondition = ref<string | null>(null)

/**
 * Reads the live Home Assistant weather entity (first `weather.*` found) and
 * exposes reactive, presentation-ready derivations used to drive the 3D scene:
 * precipitation type/intensity for particle effects plus sun/ambient dimming
 * factors so overcast conditions darken the dollhouse.
 */
export function useWeather() {
  const store = useEntitiesStore()

  const entity = computed<HassEntity | undefined>(() => store.byDomain('weather')[0])
  const available = computed(() => !!entity.value)
  /** The condition in effect: manual override wins, else the live/mock entity. */
  const condition = computed(() => overrideCondition.value ?? entity.value?.state ?? 'unknown')
  /** Condition the visual effects derive from — 'off' neutralises everything. */
  const effectiveCondition = computed(() => (weatherEnabled.value ? condition.value : 'off'))

  const temperature = computed<number | null>(() => {
    const t = entity.value?.attributes?.temperature
    const n = Number(t)
    return t != null && Number.isFinite(n) ? n : null
  })
  const temperatureUnit = computed(() =>
    String(entity.value?.attributes?.temperature_unit ?? '°C'),
  )
  const humidity = computed<number | null>(() => {
    const h = Number(entity.value?.attributes?.humidity)
    return Number.isFinite(h) ? h : null
  })
  const windSpeed = computed<number>(() => Number(entity.value?.attributes?.wind_speed) || 0)

  const precipitation = computed<Precipitation>(() => {
    const c = effectiveCondition.value
    if (RAIN_CONDITIONS.has(c)) return 'rain'
    if (SNOW_CONDITIONS.has(c)) return 'snow'
    return 'none'
  })

  /** 0 = none, ~0.55 = normal, 1 = heavy. Drives particle density. */
  const intensity = computed<number>(() => {
    if (HEAVY_CONDITIONS.has(effectiveCondition.value)) return 1
    return precipitation.value === 'none' ? 0 : 0.55
  })

  const isNight = computed(() => effectiveCondition.value === 'clear-night')
  const isFoggy = computed(() => effectiveCondition.value === 'fog')

  // Per-condition scene styling: light colors + how strongly to tint the sky
  // (background) toward `sky`. This is what makes the "quiet" conditions
  // (sunny / cloudy / fog / night) read at a glance, not just brightness.
  interface SkyStyle { sun: string; ambient: string; sky: string; skyAmt: number }
  const SKY: Record<string, SkyStyle> = {
    sunny:            { sun: '#fff0c8', ambient: '#fff2d6', sky: '#5aa0e6', skyAmt: 0.32 },
    partlycloudy:     { sun: '#fff6e2', ambient: '#fdf4e2', sky: '#31517a', skyAmt: 0.28 },
    cloudy:           { sun: '#cfd6e0', ambient: '#b6bec9', sky: '#4a525e', skyAmt: 0.55 },
    fog:              { sun: '#d2d6dc', ambient: '#cbd0d8', sky: '#909aa4', skyAmt: 0.62 },
    rainy:            { sun: '#c4ccd6', ambient: '#a6afba', sky: '#3a4450', skyAmt: 0.5 },
    pouring:          { sun: '#b8c0cc', ambient: '#9aa3b0', sky: '#2f3742', skyAmt: 0.6 },
    'lightning-rainy':{ sun: '#b8c0cc', ambient: '#9aa3b0', sky: '#2b323d', skyAmt: 0.62 },
    lightning:        { sun: '#c0c8d4', ambient: '#9aa3b0', sky: '#333b47', skyAmt: 0.55 },
    hail:             { sun: '#c4ccd6', ambient: '#a6afba', sky: '#38414d', skyAmt: 0.55 },
    snowy:            { sun: '#dfe6f0', ambient: '#cdd6e2', sky: '#6b7482', skyAmt: 0.5 },
    'snowy-rainy':    { sun: '#d6dde8', ambient: '#c2ccd8', sky: '#5c6572', skyAmt: 0.52 },
    'clear-night':    { sun: '#93a8e0', ambient: '#556699', sky: '#0a1230', skyAmt: 0.62 },
    exceptional:      { sun: '#d2d6dc', ambient: '#c2c8d2', sky: '#5a4a52', skyAmt: 0.5 },
  }
  const DEFAULT_SKY: SkyStyle = { sun: '#ffffff', ambient: '#ffffff', sky: '#000000', skyAmt: 0 }
  const skyStyle = computed<SkyStyle>(() => SKY[effectiveCondition.value] ?? DEFAULT_SKY)
  const sunColor = computed(() => skyStyle.value.sun)
  const ambientColor = computed(() => skyStyle.value.ambient)
  const skyColor = computed(() => skyStyle.value.sky)
  const skyTintAmount = computed(() => skyStyle.value.skyAmt)

  /** Cloud cover 0..1, drives the drifting cloud puffs above the floorplan. */
  const cloudCoverage = computed<number>(() => {
    switch (effectiveCondition.value) {
      case 'partlycloudy': return 0.45
      case 'cloudy': return 1
      default: return 0
    }
  })

  /** Whether to render the night star field. */
  const showStars = computed(() => isNight.value)

  /** Multiplier applied to the sun (directional) light intensity. */
  const sunFactor = computed<number>(() => {
    const c = effectiveCondition.value
    if (isNight.value) return 0.15
    if (HEAVY_CONDITIONS.has(c)) return 0.28
    if (OVERCAST_CONDITIONS.has(c)) return 0.45
    if (c === 'partlycloudy') return 0.78
    return 1
  })

  /** Multiplier applied to the ambient light intensity. */
  const ambientFactor = computed<number>(() => {
    if (isNight.value) return 0.55
    if (OVERCAST_CONDITIONS.has(effectiveCondition.value)) return 0.85
    return 1
  })

  const enabled = computed(() => weatherEnabled.value)

  /** Turn all weather visuals on or off. */
  function toggle() {
    weatherEnabled.value = !weatherEnabled.value
  }
  function setEnabled(on: boolean) {
    weatherEnabled.value = on
  }

  /** Advance the manual override to the next test condition (enables effects). */
  function cycleCondition() {
    weatherEnabled.value = true
    const cur = overrideCondition.value
    const i = cur == null ? -1 : DEMO_CONDITIONS.indexOf(cur as (typeof DEMO_CONDITIONS)[number])
    overrideCondition.value = DEMO_CONDITIONS[(i + 1) % DEMO_CONDITIONS.length]
  }
  /** Drop the manual override and follow the live/mock entity again. */
  function clearOverride() {
    overrideCondition.value = null
  }

  return {
    entity,
    available,
    condition,
    temperature,
    temperatureUnit,
    humidity,
    windSpeed,
    precipitation,
    intensity,
    isNight,
    isFoggy,
    sunFactor,
    ambientFactor,
    sunColor,
    ambientColor,
    skyColor,
    skyTintAmount,
    cloudCoverage,
    showStars,
    enabled,
    toggle,
    setEnabled,
    cycleCondition,
    clearOverride,
  }
}
