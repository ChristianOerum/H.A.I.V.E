<script setup lang="ts">
import * as THREE from 'three'
import { resolveFurnitureGeometry } from '~/utils/furnitureGeometry'
import type { FloorplanFurniture } from '~/stores/floorplan'
import type { BufferGeometry } from 'three'
import { acquireThumbnailRenderer, releaseThumbnailRenderer, renderThumbnail } from '~/utils/furnitureThumbnail'

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

// ─── Still thumbnail ──────────────────────────────────────────────────────────
// Rendered once to an <img> by a shared offscreen renderer (see
// utils/furnitureThumbnail) instead of a live canvas per card.

const box = ref<HTMLDivElement | null>(null)
const src = ref<string | null>(null)

function render() {
  const el = box.value
  if (!el || !el.clientWidth || !el.clientHeight) return
  const c = sceneColors.value
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(c.clear)

  scene.add(new THREE.AmbientLight(0xffffff, c.ambient * 2.5))
  const key = new THREE.DirectionalLight(0xffffff, c.sun * 0.9)
  key.position.set(4, 8, 6)
  key.castShadow = true
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, c.sun * 0.25)
  fill.position.set(-3, 5, -4)
  scene.add(fill)

  const materials: THREE.Material[] = []
  for (const item of items.value) {
    const mat = item.subtract
      ? new THREE.MeshStandardMaterial({ color: '#ff5533', transparent: true, opacity: 0.35, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: item.color ?? c.furniture, roughness: 0.65, metalness: 0.05 })
    materials.push(mat)
    const mesh = new THREE.Mesh(getGeometry(item), mat)
    mesh.position.set(item.x, item.y, item.z)
    mesh.rotation.set((item.rotX ?? 0) * Math.PI / 180, (item.rotY ?? 0) * Math.PI / 180, (item.rotZ ?? 0) * Math.PI / 180)
    mesh.castShadow = true
    mesh.receiveShadow = !item.subtract
    scene.add(mesh)
  }

  const { position, target } = cameraSetup.value
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100)
  camera.position.set(...position)
  camera.lookAt(...target)

  src.value = renderThumbnail(scene, camera, el.clientWidth, el.clientHeight)

  key.shadow.map?.dispose()
  for (const m of materials) m.dispose()
}

onMounted(() => {
  acquireThumbnailRenderer()
  render()
})
onUnmounted(releaseThumbnailRenderer)
watch([items, sceneColors], render)
// The card can still be zero-sized on mount (modal opening); draw once it has a size.
useResizeObserver(box, () => { if (!src.value) render() })
</script>

<template>
  <div ref="box" class="w-full aspect-video rounded-lg overflow-hidden bg-[#1e293b]">
    <img v-if="src" :src="src" :alt="preset.label" class="w-full h-full object-cover" draggable="false" />
  </div>
</template>
