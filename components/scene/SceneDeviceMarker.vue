<script setup lang="ts">
import { watch, shallowRef, onMounted, onUnmounted } from 'vue'
import { Object3D, type SpotLight } from 'three'
import { requestShadowUpdate } from '~/composables/useShadowUpdates'
import { useTresContext } from '@tresjs/core'
import { getAdapter } from '~/utils/deviceRegistry'
import { APPLIANCE_COLORS, detectAppliance, getAppliancePhase, isApplianceRunning, isDryingPhase } from '~/utils/appliance'
import type { HassEntity } from 'home-assistant-js-websocket'
import type { DevicePlacement } from '~/stores/layout'

const props = defineProps<{
  entity: HassEntity
  placement: DevicePlacement
  /** If provided, the point light is placed here instead of placement.position */
  lightPosition?: [number, number, number]
  /** Y-rotation (degrees) of the emitter furniture — used to aim the TV spot light */
  lightFacing?: number
}>()

const adapter = computed(() => getAdapter(props.entity))
const visual = computed(() =>
  adapter.value
    ? adapter.value.getDisplayState(props.entity)
    : { color: '#888', intensity: 0.3, label: '?', active: false },
)

const effectiveLightPos = computed(() => props.lightPosition ?? props.placement.position)

// ── Speaker vs. screen ───────────────────────────────────────────────────────
// A media player emits a directional light beam (screen) or colour ripples plus
// music notes (speaker). HA reports `device_class` on modern integrations; when
// it is missing we fall back to the media content type and otherwise assume a
// speaker, since only screens carry video content.
const AUDIO_CLASSES = ['speaker', 'receiver']
const VIDEO_CONTENT = ['tvshow', 'movie', 'video', 'episode', 'channel']

const mediaClass = computed(() => String(props.entity.attributes?.device_class ?? ''))
const mediaContent = computed(() => String(props.entity.attributes?.media_content_type ?? ''))

const isSpeaker = computed(() =>
  props.entity.entity_id.startsWith('media_player.') &&
  (AUDIO_CLASSES.includes(mediaClass.value) ||
    (mediaClass.value !== 'tv' && !VIDEO_CONTENT.includes(mediaContent.value))),
)
const speakerPlaying = computed(() => isSpeaker.value && props.entity.state === 'playing')
const isScreen = computed(() =>
  props.entity.entity_id.startsWith('media_player.') && !AUDIO_CLASSES.includes(mediaClass.value),
)
const speakerVolume = computed(() => {
  if (props.entity.attributes?.is_volume_muted === true) return 0
  const level = props.entity.attributes?.volume_level
  return typeof level === 'number' ? level : 0.5
})

// ── Washing machine / tumble dryer ───────────────────────────────────────────
// Detected from the marker icon override or the entity name; the phase drives
// the drum / bubbles / heat effect. A washer-dryer switches to the heat look
// (and the dryer colour, unless a custom one is set) while drying.
const appliance = computed(() => detectAppliance(props.entity, props.placement.icon))
const appliancePhase = computed(() => (appliance.value ? getAppliancePhase(props.entity) : 'off'))
const applianceDrying = computed(() => !!appliance.value && isDryingPhase(appliance.value, appliancePhase.value))
const applianceColor = computed(() =>
  props.placement.color || APPLIANCE_COLORS[applianceDrying.value ? 'dryer' : (appliance.value ?? 'washer')],
)

// Lamp point lights live in SceneLampLights (a shared pool), so toggling a lamp
// never changes the scene's light count and never recompiles shaders.

// ── TV spot light — directional emission in furniture facing direction ────────
// Mounted for as long as the screen is placed and dimmed to 0 while it's off,
// for the same reason: a stable light count means no shader recompiles.
const { scene } = useTresContext()
const quality = useGraphicsQuality()
const tvTarget = new Object3D()
const tvSpotRef = shallowRef<SpotLight | null>(null)

onMounted(() => scene.value.add(tvTarget))
onUnmounted(() => {
  scene.value.remove(tvTarget)
  requestShadowUpdate()
})

watch([tvSpotRef, () => quality.settings.value.lampShadowSize], ([spot, size]) => {
  if (!spot) return
  // Shadow config matches the lamp point lights: very low normalBias keeps the
  // beam anchored at the wall base so TV light can't bleed into neighbouring
  // rooms along the floor edge.
  if (spot.shadow.mapSize.x !== size) {
    spot.shadow.mapSize.set(size, size)
    spot.shadow.map?.dispose()
    spot.shadow.map = null
  }
  spot.shadow.camera.near    = 0.1
  spot.shadow.camera.far     = 8
  spot.shadow.bias           = -0.0005
  spot.shadow.normalBias     = 0.02
  requestShadowUpdate()
})

watch([tvSpotRef, effectiveLightPos, () => props.lightFacing], () => {
  const spot = tvSpotRef.value
  if (!spot) return
  const pos = effectiveLightPos.value
  const rad = ((props.lightFacing ?? 0) * Math.PI) / 180
  // Aim 4 m forward (local -Z rotated by facing angle) and 0.5 m downward
  tvTarget.position.set(
    pos[0] - Math.sin(rad) * 4,
    pos[1] - 0.5,
    pos[2] - Math.cos(rad) * 4,
  )
  tvTarget.updateMatrixWorld()
  spot.target = tvTarget
  requestShadowUpdate()
}, { immediate: true })
</script>

<template>
  <TresGroup :position="effectiveLightPos">
    <!-- Directional spot light for TV / media player — emits in furniture facing direction -->
    <TresSpotLight
      v-if="isScreen && placement.lightSourceFurnitureId"
      ref="tvSpotRef"
      color="#ffffff"
      :intensity="visual.active ? visual.intensity * 20 : 0"
      :angle="Math.PI / 2.5"
      :penumbra="0.5"
      :distance="8"
      :decay="1.5"
      :cast-shadow="quality.settings.value.shadows"
    />

    <!-- Speaker — colour ripples + floating music notes while playing -->
    <SceneSpeakerWaves
      v-if="isSpeaker"
      :active="speakerPlaying"
      :origin="effectiveLightPos"
      :color="placement.color || visual.color"
      :volume="speakerVolume"
    />

    <!-- Washer / dryer — spinning drum with soap bubbles or heat wisps while running -->
    <SceneApplianceEffect
      v-if="appliance"
      :active="isApplianceRunning(appliancePhase)"
      :phase="appliancePhase"
      :drying="applianceDrying"
      :color="applianceColor"
    />
  </TresGroup>
</template>