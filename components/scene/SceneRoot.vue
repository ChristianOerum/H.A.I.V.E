<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import * as THREE from 'three'
import type { DirectionalLight } from 'three'

const layout = useLayoutStore()
const entities = useEntitiesStore()
const sceneColors = useSceneColors()
const fp = useFloorplanStore()

const center = computed<[number, number, number]>(() => [fp.center[0], 0, fp.center[1]])

/** Half-extents of the floorplan AABB, used to size the shadow camera frustum tightly. */
const shadowHalfExtent = computed(() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const room of fp.rooms) {
    for (const [x, z] of room.vertices) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
  }
  if (!isFinite(minX)) return 12
  const hw = (maxX - minX) / 2 + 2   // +2m margin on each side
  const hd = (maxZ - minZ) / 2 + 2
  return Math.ceil(Math.max(hw, hd))
})

const sunLight = ref<DirectionalLight | null>(null)
watchEffect(() => {
  const light = sunLight.value
  if (!light) return
  const h = shadowHalfExtent.value
  light.shadow.bias = 0.0
  light.shadow.normalBias = 0.04
  light.shadow.mapSize.set(2048, 2048)
  const cam = light.shadow.camera as THREE.OrthographicCamera
  cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h
  cam.near = 0.1; cam.far = 60
  cam.updateProjectionMatrix()
})
const { savedView, isLocked, isReturning } = useCameraView()
const cameraPosition = computed<[number, number, number]>(() =>
  savedView.value ? savedView.value.position : [fp.center[0], 14, fp.center[1] + 12],
)

const placedEntities = computed(() =>
  layout.placements
    .map((p) => ({ placement: p, entity: entities.get(p.entity_id) }))
    .filter((x): x is { placement: typeof x.placement; entity: NonNullable<typeof x.entity> } => !!x.entity),
)

/** Resolve a furniture item's world-space position (top surface) given its ID. */
function furnitureWorldTop(furnitureId: string): [number, number, number] | undefined {
  const item = fp.furniture.find((f) => f.id === furnitureId)
  if (!item) return undefined
  if (item.groupId) {
    const group = fp.furnitureGroups.find((g) => g.id === item.groupId)
    if (group) {
      const rad = (group.rotY * Math.PI) / 180
      const rx = item.x * Math.cos(rad) - item.z * Math.sin(rad)
      const rz = item.x * Math.sin(rad) + item.z * Math.cos(rad)
      return [group.x + rx, group.y + item.y + item.h / 2 + 0.15, group.z + rz]
    }
  }
  return [item.x, item.y + item.h / 2 + 0.15, item.z]
}
/** World-space Y-rotation (degrees) of a furniture item, accounting for group. */
function furnitureLightFacing(furnitureId: string): number {
  const item = fp.furniture.find((f) => f.id === furnitureId)
  if (!item) return 0
  const itemRot = item.rotY ?? 0
  if (item.groupId) {
    const group = fp.furnitureGroups.find((g) => g.id === item.groupId)
    if (group) return itemRot + (group.rotY ?? 0)
  }
  return itemRot
}
</script>

<template>
  <TresCanvas
    :clear-color="sceneColors.clear"
    window-size
    shadows
    :dpr="[1, 2]"
  >
    <TresPerspectiveCamera :position="cameraPosition" :look-at="center" :fov="45" />

    <OrbitControls
      :target="center"
      :enabled="!isLocked && !isReturning"
      :enable-pan="false"
      :enable-damping="true"
      :damping-factor="0.08"
      :min-distance="8"
      :max-distance="28"
      :min-polar-angle="0.2"
      :max-polar-angle="Math.PI / 2.2"
    />

    <SceneCameraController />

    <TresAmbientLight :intensity="sceneColors.ambient" />
    <TresDirectionalLight
      ref="sunLight"
      :position="[8, 14, 8]"
      :intensity="sceneColors.sun"
      cast-shadow
    />

    <SceneFloorplan />

    <SceneProjector />

    <SceneDeviceMarker
      v-for="item in placedEntities"
      :key="item.placement.entity_id"
      :entity="item.entity"
      :placement="item.placement"
      :light-position="item.placement.lightSourceFurnitureId ? furnitureWorldTop(item.placement.lightSourceFurnitureId) : undefined"
      :light-facing="item.placement.lightSourceFurnitureId ? furnitureLightFacing(item.placement.lightSourceFurnitureId) : undefined"
    />
  </TresCanvas>
</template>
