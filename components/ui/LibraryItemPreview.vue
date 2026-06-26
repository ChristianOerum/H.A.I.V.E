<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import * as THREE from 'three'
import { resolveFurnitureGeometry } from '~/utils/furnitureGeometry'
import type { FloorplanFurniture } from '~/stores/floorplan'
import type { BufferGeometry } from 'three'

const props = defineProps<{
  preset: {
    label: string
    x?: number; y?: number; z?: number; rotY?: number
    items: Omit<FloorplanFurniture, 'id' | 'groupId'>[]
  }
}>()

const sceneColors = useSceneColors()

// Synthesise full FloorplanFurniture items with stable IDs scoped to this preset
const items = computed<FloorplanFurniture[]>(() =>
  props.preset.items.map((it, i) => ({
    ...it,
    id: `lib-preview-${props.preset.label}-${i}`,
    groupId: '__preview__',
  })),
)

// ─── Geometry cache ───────────────────────────────────────────────────────────

const _geoCache = new Map<string, { key: string; geo: BufferGeometry }>()

function getGeometry(item: FloorplanFurniture) {
  return resolveFurnitureGeometry(item, items.value, _geoCache)
}

onUnmounted(() => {
  for (const { geo } of _geoCache.values()) geo.dispose()
  _geoCache.clear()
})

// ─── Camera ───────────────────────────────────────────────────────────────────

const cameraSetup = computed(() => {
  if (items.value.length === 0) {
    return { position: [2, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
  }
  // Compute world AABB of all items
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (const it of items.value) {
    minX = Math.min(minX, it.x - it.w / 2); maxX = Math.max(maxX, it.x + it.w / 2)
    minY = Math.min(minY, it.y - it.h / 2); maxY = Math.max(maxY, it.y + it.h / 2)
    minZ = Math.min(minZ, it.z - it.d / 2); maxZ = Math.max(maxZ, it.z + it.d / 2)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  // Half-diagonal of the bounding box → camera distance to frame it
  const halfDiag = Math.sqrt(
    ((maxX - minX) / 2) ** 2 +
    ((maxY - minY) / 2) ** 2 +
    ((maxZ - minZ) / 2) ** 2,
  )
  const fovRad = 45 * Math.PI / 180
  const dist = Math.max(0.5, (halfDiag / Math.tan(fovRad / 2)) * 1.25)
  return {
    position: [cx + dist * 0.5, cy + dist * 0.5, cz + dist] as [number, number, number],
    target:   [cx, cy, cz] as [number, number, number],
  }
})
</script>

<template>
  <div class="w-full aspect-video rounded-lg overflow-hidden bg-[#1e293b]">
    <TresCanvas
      :clear-color="sceneColors.clear"
      class="!w-full !h-full"
    >
      <TresPerspectiveCamera
        :position="cameraSetup.position"
        :look-at="cameraSetup.target"
        :fov="45"
        :near="0.05"
        :far="100"
      />

      <!-- Lighting -->
      <TresAmbientLight :intensity="sceneColors.ambient * 2.5" />
      <TresDirectionalLight
        :position="[4, 8, 6]"
        :intensity="sceneColors.sun * 0.9"
        :cast-shadow="true"
      />
      <TresDirectionalLight
        :position="[-3, 5, -4]"
        :intensity="sceneColors.sun * 0.25"
      />

      <!-- Items -->
      <TresMesh
        v-for="item in items"
        :key="item.id"
        :geometry="getGeometry(item)"
        :position="[item.x, item.y, item.z]"
        :rotation="[
          (item.rotX ?? 0) * Math.PI / 180,
          (item.rotY ?? 0) * Math.PI / 180,
          (item.rotZ ?? 0) * Math.PI / 180,
        ]"
        :cast-shadow="true"
        :receive-shadow="!item.subtract"
      >
        <TresMeshStandardMaterial
          v-if="!item.subtract"
          :color="item.color ?? sceneColors.furniture"
          :roughness="0.65"
          :metalness="0.05"
        />
        <TresMeshStandardMaterial
          v-else
          color="#ff5533"
          :transparent="true"
          :opacity="0.35"
          :depth-write="false"
        />
      </TresMesh>
    </TresCanvas>
  </div>
</template>
