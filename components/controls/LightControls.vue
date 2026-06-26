<script setup lang="ts">
import type { HassEntity } from 'home-assistant-js-websocket'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const entities = useEntitiesStore()

const isOn = computed(() => props.entity.state === 'on')
const brightness = computed({
  get: () => Number(props.entity.attributes.brightness ?? 0),
  set: (v: number) => {
    entities.patch(props.entity.entity_id, { attributes: { brightness: v } })
    callService('light', 'turn_on', { brightness: v }, { entity_id: props.entity.entity_id })
  },
})

const COLOR_MODES = ['hs', 'rgb', 'xy', 'rgbw', 'rgbww']
const supportsColor = computed(() =>
  (props.entity.attributes.supported_color_modes as string[] | undefined)
    ?.some((m) => COLOR_MODES.includes(m)) ?? false
)
const supportsColorTemp = computed(() =>
  (props.entity.attributes.supported_color_modes as string[] | undefined)
    ?.includes('color_temp') ?? false
)

const pickerMode = ref<'color' | 'white'>('color')

// Draft refs: track value visually while dragging; null = use committed value
const brightnessDraft = ref<number | null>(null)
const hueDraft = ref<number | null>(null)
const saturationDraft = ref<number | null>(null)
const colorTempDraft = ref<number | null>(null)

const brightnessDisplay = computed(() => brightnessDraft.value ?? brightness.value)
const hueDisplay = computed(() => hueDraft.value ?? hue.value)
const saturationDisplay = computed(() => saturationDraft.value ?? saturation.value)
const colorTempDisplay = computed(() => colorTempDraft.value ?? colorTemp.value)

const hue = computed({
  get: () => Number((props.entity.attributes.hs_color as [number, number] | undefined)?.[0] ?? 0),
  set: (v: number) => {
    const sat = (props.entity.attributes.hs_color as [number, number] | undefined)?.[1] ?? 100
    entities.patch(props.entity.entity_id, { attributes: { hs_color: [v, sat] } })
    callService('light', 'turn_on', { hs_color: [v, sat] }, { entity_id: props.entity.entity_id })
  },
})

const saturation = computed({
  get: () => Number((props.entity.attributes.hs_color as [number, number] | undefined)?.[1] ?? 100),
  set: (v: number) => {
    const h = (props.entity.attributes.hs_color as [number, number] | undefined)?.[0] ?? 0
    entities.patch(props.entity.entity_id, { attributes: { hs_color: [h, v] } })
    callService('light', 'turn_on', { hs_color: [h, v] }, { entity_id: props.entity.entity_id })
  },
})

const minMireds = computed(() => Number(props.entity.attributes.min_mireds ?? 153))
const maxMireds = computed(() => Number(props.entity.attributes.max_mireds ?? 500))
const colorTemp = computed({
  get: () => Number(props.entity.attributes.color_temp ?? minMireds.value),
  set: (v: number) => {
    entities.patch(props.entity.entity_id, { attributes: { color_temp: v } })
    callService('light', 'turn_on', { color_temp: v }, { entity_id: props.entity.entity_id })
  },
})

function toggle() {
  const turningOn = !isOn.value
  entities.patch(props.entity.entity_id, {
    state: turningOn ? 'on' : 'off',
    ...(turningOn ? { attributes: { brightness: props.entity.attributes.brightness ?? 255 } } : {}),
  })
  callService('light', turningOn ? 'turn_on' : 'turn_off', undefined, {
    entity_id: props.entity.entity_id,
  })
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-medium">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
      <button class="btn-touch" :class="isOn ? 'bg-accent text-bg' : ''" @click="toggle">
        {{ isOn ? 'On' : 'Off' }}
      </button>
    </div>

    <!-- Brightness -->
    <div v-if="entity.attributes.supported_color_modes" class="space-y-2">
      <label class="text-sm text-fg-muted">Brightness</label>
      <div class="relative h-14 rounded-xl overflow-hidden"
           :style="`background: linear-gradient(to right, rgb(var(--accent)) ${brightnessDisplay / 255 * 100}%, white ${brightnessDisplay / 255 * 100}%)`">
        <!-- Gesture bar pill: vertical, tracks the slider thumb -->
        <div class="absolute top-1/2 -translate-y-1/2 -translate-x-3 w-1.5 h-8 rounded-full bg-white/70 pointer-events-none"
             :style="`left: calc(${brightnessDisplay / 255 * 100}%)`" />
        <input type="range" min="0" max="255" :value="brightnessDisplay"
          @input="(e) => brightnessDraft = Number((e.target as HTMLInputElement).value)"
          @change="(e) => { brightness = Number((e.target as HTMLInputElement).value); brightnessDraft = null }"
          class="brightness-slider absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
    </div>

    <!-- Hue & Saturation section -->
    <div v-if="supportsColor || supportsColorTemp" class="space-y-2">
      <label class="text-sm text-fg-muted">Hue &amp; Saturation</label>

      <!-- Mode buttons -->
      <div class="flex gap-2">
        <button v-if="supportsColor" class="btn-touch flex-1 text-sm"
          :class="pickerMode === 'color' ? 'bg-accent text-bg' : ''"
          @click="pickerMode = 'color'">Color</button>
        <button v-if="supportsColorTemp" class="btn-touch flex-1 text-sm"
          :class="pickerMode === 'white' ? 'bg-accent text-bg' : ''"
          @click="pickerMode = 'white'">White</button>
      </div>

      <!-- Color mode: hue + saturation bars -->
      <template v-if="supportsColor && pickerMode === 'color'">
        <div class="relative h-14 rounded-xl overflow-hidden"
             style="background: linear-gradient(to right,
               hsl(0,100%,50%), hsl(15,100%,50%), hsl(30,100%,50%), hsl(45,100%,50%),
               hsl(60,100%,50%), hsl(75,100%,50%), hsl(90,100%,50%), hsl(105,100%,50%),
               hsl(120,100%,50%), hsl(135,100%,50%), hsl(150,100%,50%), hsl(165,100%,50%),
               hsl(180,100%,50%), hsl(195,100%,50%), hsl(210,100%,50%), hsl(225,100%,50%),
               hsl(240,100%,50%), hsl(255,100%,50%), hsl(270,100%,50%), hsl(285,100%,50%),
               hsl(300,100%,50%), hsl(315,100%,50%), hsl(330,100%,50%), hsl(345,100%,50%),
               hsl(360,100%,50%))">
          <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-8 rounded-full bg-white/70 pointer-events-none"
               :style="`left: calc(${hueDisplay / 360 * 100}%)`" />
          <input type="range" min="0" max="360" :value="hueDisplay"
            @input="(e) => hueDraft = Number((e.target as HTMLInputElement).value)"
            @change="(e) => { hue = Number((e.target as HTMLInputElement).value); hueDraft = null }"
            class="brightness-slider absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </div>
        <div class="relative h-14 rounded-xl overflow-hidden"
             :style="`background: linear-gradient(to right, #fff, hsl(${hueDisplay}, 100%, 50%))`">
          <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-8 rounded-full bg-white/70 pointer-events-none"
               :style="`left: calc(${saturationDisplay}%)`" />
          <input type="range" min="0" max="100" :value="saturationDisplay"
            @input="(e) => saturationDraft = Number((e.target as HTMLInputElement).value)"
            @change="(e) => { saturation = Number((e.target as HTMLInputElement).value); saturationDraft = null }"
            class="brightness-slider absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </div>
      </template>

      <!-- White mode: color temperature bar (cool → warm) -->
      <div v-if="supportsColorTemp && pickerMode === 'white'" class="relative h-14 rounded-xl overflow-hidden"
           style="background: linear-gradient(to right, #b3ccff, #ccdcff, #e8eeff, #fff5e0, #ffe0a0, #ffcc70, #ffb347)">
        <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-8 rounded-full bg-white/70 pointer-events-none"
             :style="`left: calc(${(colorTempDisplay - minMireds) / (maxMireds - minMireds) * 100}%)`" />
        <input type="range" :min="minMireds" :max="maxMireds" :value="colorTempDisplay"
          @input="(e) => colorTempDraft = Number((e.target as HTMLInputElement).value)"
          @change="(e) => { colorTemp = Number((e.target as HTMLInputElement).value); colorTempDraft = null }"
          class="brightness-slider absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
    </div>
  </div>
</template>
