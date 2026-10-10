<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

const id = computed(() => props.entity.entity_id)
const attrs = computed(() => props.entity.attributes)
const isOn = computed(() => props.entity.state === 'on')

const colorModes = computed(() => (attrs.value.supported_color_modes as string[] | undefined) ?? [])
const COLOR_MODES = ['hs', 'rgb', 'xy', 'rgbw', 'rgbww']
const supportsColor = computed(() => colorModes.value.some((m) => COLOR_MODES.includes(m)))
const supportsColorTemp = computed(() => colorModes.value.includes('color_temp'))
// Anything beyond plain on/off supports brightness.
const supportsBrightness = computed(() =>
  colorModes.value.length
    ? colorModes.value.some((m) => m !== 'onoff')
    : attrs.value.brightness !== undefined,
)

function turnOn(data: Record<string, unknown>, optimistic: Record<string, unknown> = data) {
  entities.patch(id.value, { state: 'on', attributes: optimistic })
  callService('light', 'turn_on', data, { entity_id: id.value })
}

function toggle() {
  const turningOn = !isOn.value
  entities.patch(id.value, {
    state: turningOn ? 'on' : 'off',
    ...(turningOn ? { attributes: { brightness: attrs.value.brightness ?? 255 } } : {}),
  })
  callService('light', turningOn ? 'turn_on' : 'turn_off', undefined, { entity_id: id.value })
}

// ── Brightness ──
const brightness = computed(() => (isOn.value ? Number(attrs.value.brightness ?? 255) : 0))
const pctOf = (b: number) => Math.round((b / 255) * 100)
function commitBrightness(v: number) {
  if (v <= 0) {
    entities.patch(id.value, { state: 'off' })
    callService('light', 'turn_off', undefined, { entity_id: id.value })
  } else {
    turnOn({ brightness: v })
  }
}

// ── Colour ──
const hs = computed(() => (attrs.value.hs_color as [number, number] | undefined) ?? [0, 100])
const hueDraft = ref<number | null>(null)
const liveHue = computed(() => hueDraft.value ?? hs.value[0])

const minMireds = computed(() => Number(attrs.value.min_mireds ?? 153))
const maxMireds = computed(() => Number(attrs.value.max_mireds ?? 500))
const colorTemp = computed(() => Number(attrs.value.color_temp ?? minMireds.value))

const pickerMode = ref<'color' | 'white'>(
  attrs.value.color_mode === 'color_temp' || !supportsColor.value ? 'white' : 'color',
)

function setHs(h: number, s: number) {
  turnOn({ hs_color: [h, s] })
}

const HUE_TRACK = `linear-gradient(to right, ${
  Array.from({ length: 13 }, (_, i) => `hsl(${i * 30},100%,50%)`).join(',')
})`
const WHITE_TRACK = 'linear-gradient(to right, #b3ccff, #e8eeff, #fff5e0, #ffe0a0, #ffb347)'

const COLOR_PRESETS: [number, number][] = [
  [30, 40], [0, 100], [28, 100], [50, 95], [120, 80], [185, 85], [225, 90], [275, 80], [320, 75],
]
const WHITE_PRESETS = computed(() => {
  const span = maxMireds.value - minMireds.value
  return [
    { label: 'Cool', mireds: minMireds.value },
    { label: 'Neutral', mireds: Math.round(minMireds.value + span * 0.4) },
    { label: 'Warm', mireds: Math.round(minMireds.value + span * 0.75) },
    { label: 'Candle', mireds: maxMireds.value },
  ]
})
const kelvin = (mireds: number) => `${Math.round(1_000_000 / mireds / 100) * 100} K`

// Header chip tint follows the light's real colour.
const tint = computed(() => {
  const rgb = attrs.value.rgb_color as number[] | undefined
  return rgb ? `rgb(${rgb.join(',')})` : undefined
})
</script>

<template>
  <div class="space-y-5">
    <ControlHeader
      :entity="entity"
      :active="isOn"
      :tint="tint"
      :subtitle="isOn ? (supportsBrightness ? `On · ${pctOf(brightness)}%` : 'On') : 'Off'"
    >
      <ToggleSwitch :on="isOn" label="Power" @toggle="toggle" />
    </ControlHeader>

    <RangeSlider
      v-if="supportsBrightness"
      label="Brightness"
      :value="brightness"
      :min="0"
      :max="255"
      :format="(v) => (v <= 0 ? 'Off' : `${pctOf(v)}%`)"
      @commit="commitBrightness"
    />

    <div v-if="supportsColor || supportsColorTemp" class="space-y-4">
      <div v-if="supportsColor && supportsColorTemp" class="segmented">
        <button :aria-pressed="pickerMode === 'color'" @click="pickerMode = 'color'">Colour</button>
        <button :aria-pressed="pickerMode === 'white'" @click="pickerMode = 'white'">White</button>
      </div>

      <template v-if="supportsColor && pickerMode === 'color'">
        <div class="flex flex-wrap gap-2.5">
          <button
            v-for="[h, s] in COLOR_PRESETS"
            :key="`${h}-${s}`"
            class="w-11 h-11 rounded-full ring-1 ring-inset ring-black/10 transition-transform active:scale-90"
            :class="isOn && Math.round(hs[0]) === h && Math.round(hs[1]) === s ? 'outline outline-2 outline-offset-2 outline-fg' : ''"
            :style="{ background: `hsl(${h}, ${s}%, ${100 - s / 2}%)` }"
            :aria-label="`Set colour hue ${h}`"
            @click="setHs(h, s)"
          />
        </div>
        <RangeSlider
          label="Hue"
          :value="hs[0]"
          :min="0"
          :max="360"
          :background="HUE_TRACK"
          :format="(v) => `${Math.round(v)}°`"
          @input="(v) => (hueDraft = v)"
          @commit="(v) => { hueDraft = null; setHs(v, hs[1]) }"
        />
        <RangeSlider
          label="Saturation"
          :value="hs[1]"
          :min="0"
          :max="100"
          :background="`linear-gradient(to right, #fff, hsl(${liveHue}, 100%, 50%))`"
          :format="(v) => `${Math.round(v)}%`"
          @commit="(v) => setHs(hs[0], v)"
        />
      </template>

      <template v-if="supportsColorTemp && pickerMode === 'white'">
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="p in WHITE_PRESETS"
            :key="p.label"
            class="btn-touch flex-col !gap-1 !py-2 text-xs"
            @click="turnOn({ color_temp: p.mireds })"
          >
            <span class="font-medium">{{ p.label }}</span>
            <span class="text-[10px] text-fg-muted">{{ kelvin(p.mireds) }}</span>
          </button>
        </div>
        <RangeSlider
          label="Colour temperature"
          :value="colorTemp"
          :min="minMireds"
          :max="maxMireds"
          :background="WHITE_TRACK"
          :format="kelvin"
          @commit="(v) => turnOn({ color_temp: v })"
        />
      </template>
    </div>
  </div>
</template>
