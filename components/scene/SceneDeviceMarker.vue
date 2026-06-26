<script setup lang="ts">
import { watch, shallowRef, onMounted, onUnmounted } from 'vue'
import { Object3D, type PointLight, type SpotLight } from 'three'
import { useTresContext } from '@tresjs/core'
import { getAdapter } from '~/utils/deviceRegistry'
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

// ── Lamp point light shadow config ───────────────────────────────────────────
const lightRef = shallowRef<PointLight | null>(null)
watch(lightRef, (light) => {
  if (!light) return
  light.shadow.mapSize.width  = 1024
  light.shadow.mapSize.height = 1024
  light.shadow.camera.near    = 0.1
  light.shadow.camera.far     = 8
  light.shadow.bias           = -0.0005
  light.shadow.normalBias     = 0.02
})

// ── TV spot light — directional emission in furniture facing direction ────────
const { scene } = useTresContext()
const tvTarget = new Object3D()
const tvSpotRef = shallowRef<SpotLight | null>(null)

onMounted(() => scene.value.add(tvTarget))
onUnmounted(() => scene.value.remove(tvTarget))

watch(tvSpotRef, (spot) => {
  if (!spot) return
  // Shadow config matches the lamp point light: walls block the beam so light
  // can't bleed into neighbouring rooms.
  spot.shadow.mapSize.width  = 512
  spot.shadow.mapSize.height = 512
  spot.shadow.camera.near    = 0.1
  spot.shadow.camera.far     = 8
  spot.shadow.bias           = -0.0005
  spot.shadow.normalBias     = 0.02
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
}, { immediate: true })
</script>

<template>
  <TresGroup :position="effectiveLightPos">
    <!-- Point light — high decay keeps light contained inside the room walls -->
    <TresPointLight
      v-if="visual.active && entity.entity_id.startsWith('light.')"
      ref="lightRef"
      :color="visual.color"
      :intensity="visual.intensity * 80"
      :distance="8"
      :decay="2"
      :cast-shadow="true"
    />
    <!-- Directional spot light for TV / media player — emits in furniture facing direction -->
    <TresSpotLight
      v-if="visual.active && entity.entity_id.startsWith('media_player.') && placement.lightSourceFurnitureId"
      ref="tvSpotRef"
      color="#ffffff"
      :intensity="visual.intensity * 20"
      :angle="Math.PI / 2.5"
      :penumbra="0.5"
      :distance="8"
      :decay="1.5"
      :cast-shadow="true"
    />

  </TresGroup>
</template>