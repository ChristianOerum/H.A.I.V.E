import type { HassEntity } from 'home-assistant-js-websocket'

// Home Assistant standard weather conditions.
const HEAVY_CONDITIONS = new Set(['pouring', 'lightning-rainy'])
const OVERCAST_CONDITIONS = new Set([
  'cloudy', 'fog', 'rainy', 'pouring', 'snowy', 'snowy-rainy',
  'lightning', 'lightning-rainy', 'hail', 'exceptional',
])
const LIGHTNING_CONDITIONS = new Set(['lightning', 'lightning-rainy'])

// Per-condition particle density (0..1) for each precipitation layer. Layers
// are independent so mixed conditions (snowy-rainy) render both at once.
const RAIN_AMOUNT: Record<string, number> = {
  rainy: 0.55, pouring: 1, 'lightning-rainy': 0.9, 'snowy-rainy': 0.35,
}
const SNOW_AMOUNT: Record<string, number> = { snowy: 0.75, 'snowy-rainy': 0.45 }
const HAIL_AMOUNT: Record<string, number> = { hail: 0.8 }

/** Cloud cover 0..1 and how storm-dark the clouds are 0..1. */
const CLOUDS: Record<string, { cover: number; dark: number }> = {
  partlycloudy:      { cover: 0.4,  dark: 0 },
  'windy-variant':   { cover: 0.45, dark: 0.15 },
  cloudy:            { cover: 0.9,  dark: 0.4 },
  rainy:             { cover: 0.85, dark: 0.6 },
  pouring:           { cover: 1,    dark: 0.82 },
  lightning:         { cover: 0.9,  dark: 0.88 },
  'lightning-rainy': { cover: 1,    dark: 0.92 },
  hail:              { cover: 0.9,  dark: 0.72 },
  snowy:             { cover: 0.75, dark: 0.3 },
  'snowy-rainy':     { cover: 0.85, dark: 0.5 },
  exceptional:       { cover: 0.6,  dark: 0.6 },
}

/** Exponential scene-fog density — real depth haze, not just particles. */
const FOG_DENSITY: Record<string, number> = {
  fog: 0.042, pouring: 0.02, 'lightning-rainy': 0.018, rainy: 0.011,
  snowy: 0.02, 'snowy-rainy': 0.016, hail: 0.012, cloudy: 0.005,
}

/** Factors converting HA wind units to m/s. */
const WIND_TO_MS: Record<string, number> = {
  'km/h': 1 / 3.6, 'm/s': 1, mph: 0.44704, kn: 0.514444, kt: 0.514444, 'ft/s': 0.3048,
}

// Module-scoped singleton so the toggle button and the scene share one flag.
// When false, every effect derivation collapses to a neutral "clear" scene.
const weatherEnabled = ref(true)

/** Conditions the mock-mode test button cycles through. */
export const DEMO_CONDITIONS = [
  'sunny', 'partlycloudy', 'cloudy', 'fog', 'rainy', 'pouring', 'lightning-rainy',
  'hail', 'snowy', 'snowy-rainy', 'clear-night',
] as const

// Manual condition override for testing (driven by the mock-mode cycle button).
// null = follow the live/mock entity; a string forces that condition everywhere.
const overrideCondition = ref<string | null>(null)

// Sun-light multiplier written by the scene as cloud clusters drift over the
// house (1 = no cloud overhead). Shared so SceneRoot can dim its sun light.
const cloudShade = ref(1)

/**
 * Reads the live Home Assistant weather entity (first `weather.*` found) and
 * exposes reactive, presentation-ready derivations used to drive the 3D scene:
 * per-layer precipitation density, wind, fog and lightning plus sun/ambient dimming
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
  const windSpeedUnit = computed(() =>
    String(entity.value?.attributes?.wind_speed_unit ?? 'km/h'),
  )

  /** A single daily forecast entry, presentation-ready. */
  interface ForecastDay {
    datetime: string
    condition: string
    tempHigh: number | null
    tempLow: number | null
  }
  /** Upcoming daily forecast read from the weather entity's `forecast` attribute. */
  const forecast = computed<ForecastDay[]>(() => {
    const raw = entity.value?.attributes?.forecast
    if (!Array.isArray(raw)) return []
    return raw.map((f) => {
      const high = Number(f?.temperature)
      const low = Number(f?.templow)
      return {
        datetime: String(f?.datetime ?? ''),
        condition: String(f?.condition ?? 'unknown'),
        tempHigh: Number.isFinite(high) ? high : null,
        tempLow: Number.isFinite(low) ? low : null,
      }
    })
  })

  /** Rain / snow / hail particle density 0..1 (each layer independent). */
  const rainAmount = computed(() => RAIN_AMOUNT[effectiveCondition.value] ?? 0)
  const snowAmount = computed(() => SNOW_AMOUNT[effectiveCondition.value] ?? 0)
  const hailAmount = computed(() => HAIL_AMOUNT[effectiveCondition.value] ?? 0)
  const hasLightning = computed(() => LIGHTNING_CONDITIONS.has(effectiveCondition.value))
  const fogDensity = computed(() => FOG_DENSITY[effectiveCondition.value] ?? 0)

  /** Wind speed in m/s (0 when weather effects are off). */
  const windMs = computed(() => {
    if (!weatherEnabled.value) return 0
    const k = WIND_TO_MS[windSpeedUnit.value] ?? 1 / 3.6
    const ms = windSpeed.value * k
    // 'windy' conditions without a speed reading still deserve a stiff breeze.
    return effectiveCondition.value.startsWith('windy') ? Math.max(ms, 10) : ms
  })
  /**
   * Unit XZ vector the wind blows *toward*. HA's wind_bearing is the compass
   * direction it comes *from*; the scene treats -Z as north and +X as east.
   * Defaults to a westerly (blowing toward +X) when no bearing is reported.
   */
  const windDir = computed<[number, number]>(() => {
    const raw = Number(entity.value?.attributes?.wind_bearing)
    const from = Number.isFinite(raw) ? raw : 270
    const to = ((from + 180) * Math.PI) / 180
    return [Math.sin(to), -Math.cos(to)]
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

  /** Cloud cover 0..1, drives the drifting cloud clusters above the floorplan. */
  const cloudCoverage = computed<number>(() => CLOUDS[effectiveCondition.value]?.cover ?? 0)
  /** 0 = fluffy white, 1 = dark storm cloud. */
  const cloudDarkness = computed<number>(() => CLOUDS[effectiveCondition.value]?.dark ?? 0)

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
    windSpeedUnit,
    forecast,
    rainAmount,
    snowAmount,
    hailAmount,
    hasLightning,
    fogDensity,
    windMs,
    windDir,
    isNight,
    isFoggy,
    sunFactor,
    ambientFactor,
    sunColor,
    ambientColor,
    skyColor,
    skyTintAmount,
    cloudCoverage,
    cloudDarkness,
    cloudShade,
    showStars,
    enabled,
    toggle,
    setEnabled,
    cycleCondition,
    clearOverride,
  }
}
