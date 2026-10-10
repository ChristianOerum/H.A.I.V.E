<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { HassEntity } from 'home-assistant-js-websocket'
import {
  APPLIANCE_COLORS,
  APPLIANCE_ICONS,
  detectAppliance,
  getAppliancePhase,
  getProgress,
  getRemainingMinutes,
  isApplianceRunning,
  isDryingPhase,
  phaseLabel,
} from '~/utils/appliance'

const props = defineProps<{ entity: HassEntity }>()
const { callService } = useHomeAssistant()
const layout = useLayoutStore()

const placement = computed(() => layout.placementFor(props.entity.entity_id))
const kind = computed(() => detectAppliance(props.entity, placement.value?.icon) ?? 'washer')
const phase = computed(() => getAppliancePhase(props.entity))
const running = computed(() => isApplianceRunning(phase.value))
const drying = computed(() => isDryingPhase(kind.value, phase.value))
const color = computed(() => placement.value?.color || APPLIANCE_COLORS[kind.value])

const remaining = computed(() => getRemainingMinutes(props.entity))
const remainingLabel = computed(() => {
  const m = remaining.value
  if (m === null) return null
  const h = Math.floor(m / 60)
  return h > 0 ? `${h} h ${m % 60} min left` : `${m} min left`
})
const progress = computed(() => getProgress(props.entity))

const program = computed(() => {
  const a = props.entity.attributes
  const p = a.program ?? a.selected_program ?? a.course ?? a.current_course
  return typeof p === 'string' && p ? p : null
})

// Smart-plug style appliances (switch domain) can be powered on/off here.
// Taps on the scene marker open this panel instead of toggling, so a running
// machine can't be cut off by an accidental tap.
const canPower = computed(() => props.entity.entity_id.startsWith('switch.'))
const isOn = computed(() => props.entity.state === 'on')
function togglePower() {
  callService('switch', isOn.value ? 'turn_off' : 'turn_on', undefined, {
    entity_id: props.entity.entity_id,
  })
}

const drumClass = computed(() => {
  if (!running.value) return ''
  if (phase.value === 'spin') return 'drum-spin'
  if (drying.value) return 'drum-tumble'
  return 'drum-wash'
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-lg font-medium truncate">{{ entity.attributes.friendly_name ?? entity.entity_id }}</h3>
      <button
        v-if="canPower"
        class="btn-touch shrink-0"
        :class="isOn ? 'bg-accent text-bg' : ''"
        @click="togglePower"
      >{{ isOn ? 'On' : 'Off' }}</button>
    </div>

    <div class="flex items-center gap-5">
      <!-- Porthole: water sloshes while washing, clothes tumble while drying -->
      <div
        class="porthole shrink-0"
        :class="[drumClass, { 'is-drying': drying }]"
        :style="{ '--appliance': color }"
      >
        <div class="porthole-water" />
        <div class="porthole-drum">
          <span v-for="i in 5" :key="i" class="porthole-item" :style="{ '--i': i }" />
        </div>
        <div class="porthole-glass" />
      </div>

      <div class="min-w-0 space-y-1">
        <div class="flex items-center gap-2 text-2xl font-light">
          <Icon :icon="APPLIANCE_ICONS[kind]" class="shrink-0" :style="{ color }" />
          <span>{{ phaseLabel(kind, phase) }}</span>
        </div>
        <div v-if="remainingLabel && running" class="text-sm">{{ remainingLabel }}</div>
        <div v-if="program" class="text-sm text-fg-muted truncate">{{ program }}</div>
        <div class="text-xs text-fg-muted/70 truncate">{{ entity.state }}{{ entity.attributes.unit_of_measurement ?? '' }}</div>
      </div>
    </div>

    <div v-if="progress !== null && running" class="h-2 rounded-full bg-bg-elevated overflow-hidden">
      <div class="h-full rounded-full transition-[width] duration-700" :style="{ width: `${progress}%`, background: color }" />
    </div>
  </div>
</template>

<style scoped>
.porthole {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 9999px;
  padding: 7px;
  background: rgb(var(--bg-elevated));
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--appliance) 45%, transparent);
}
.porthole-water,
.porthole-drum,
.porthole-glass {
  position: absolute;
  inset: 7px;
  border-radius: 9999px;
}
/* Water level stays put while the drum turns; drying swaps it for a warm glow */
.porthole-water {
  background:
    linear-gradient(to top, color-mix(in srgb, var(--appliance) 55%, transparent) 0 38%, transparent 38%),
    color-mix(in srgb, var(--appliance) 12%, #0b1220);
}
.is-drying .porthole-water {
  background: radial-gradient(circle, color-mix(in srgb, var(--appliance) 35%, #1a0f08), #120a06);
}
.porthole-drum {
  overflow: hidden;
}
.porthole-glass {
  pointer-events: none;
  background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.35), transparent 38%);
}
/* Clothes / bubbles, laid out around the drum and rotated with it */
.porthole-item {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 14px;
  height: 9px;
  margin: -4.5px 0 0 -7px;
  border-radius: 40%;
  background: color-mix(in srgb, var(--appliance) 70%, white);
  opacity: 0.85;
  transform: rotate(calc(var(--i) * 72deg)) translateY(-20px);
}
.drum-wash .porthole-drum { animation: drum-agitate 5s ease-in-out infinite; }
.drum-tumble .porthole-drum { animation: drum-rotate 3s linear infinite; }
.drum-spin .porthole-drum { animation: drum-rotate 0.35s linear infinite; }
.drum-spin { animation: machine-shake 0.12s linear infinite; }

@keyframes drum-agitate {
  0%, 100% { transform: rotate(0deg); }
  40% { transform: rotate(320deg); }
  50% { transform: rotate(320deg); }
  90% { transform: rotate(0deg); }
}
@keyframes drum-rotate {
  to { transform: rotate(360deg); }
}
@keyframes machine-shake {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(0.6px, -0.4px); }
  75% { transform: translate(-0.6px, 0.4px); }
}
@media (prefers-reduced-motion: reduce) {
  .porthole, .porthole-drum { animation: none !important; }
}
</style>
