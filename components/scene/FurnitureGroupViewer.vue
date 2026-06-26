<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import * as THREE from 'three'
import { resolveFurnitureGeometry } from '~/utils/furnitureGeometry'
import type { BufferGeometry } from 'three'

const props = defineProps<{ groupId: string }>()
const emit = defineEmits<{ close: [] }>()

const fp = useFloorplanStore()
const sceneColors = useSceneColors()

const group = computed(() => fp.furnitureGroups.find(g => g.id === props.groupId))
const items = computed(() => fp.furniture.filter(f => f.groupId === props.groupId))

// ─── Geometry cache ──────────────────────────────────────────────────────────

const _geoCache = new Map<string, { key: string; geo: BufferGeometry }>()

function getGeometry(item: ReturnType<typeof items.value[number]['valueOf']>) {
  return resolveFurnitureGeometry(item, items.value, _geoCache)
}

onUnmounted(() => {
  for (const { geo } of _geoCache.values()) geo.dispose()
  _geoCache.clear()
})

// ─── Camera position + grid — set once on mount, never updated reactively ────
// Using computed() here caused the camera to jump back to its initial position
// every time an item property was edited (reactivity re-ran the computation).

const cameraPosition = shallowRef<[number, number, number]>([0, 3, 5])
const gridHelper = shallowRef<THREE.Group | null>(null)

onMounted(() => {
  // Camera: fit the group's bounding box
  const its = items.value
  if (its.length > 0) {
    let maxExtent = 0
    for (const it of its) {
      const ext = Math.max(Math.abs(it.x) + it.w / 2, Math.abs(it.z) + it.d / 2, it.y + it.h)
      if (ext > maxExtent) maxExtent = ext
    }
    const dist = Math.max(2, maxExtent * 2.2)
    cameraPosition.value = [dist * 0.6, dist * 0.55, dist]
  }
  // Grid: two-layer (1 m main + 0.25 m sub) sized to fit
  let size = 2
  for (const it of its) {
    const ext = Math.max(Math.abs(it.x) + it.w / 2, Math.abs(it.z) + it.d / 2) * 2
    if (ext > size) size = ext
  }
  const gridSize = Math.ceil(size) + 2
  const main = new THREE.GridHelper(gridSize, gridSize, '#475569', '#334155')
  const sub  = new THREE.GridHelper(gridSize, gridSize * 4, '#1e293b', '#1e293b')
  sub.position.y = 0.0001
  const g = new THREE.Group()
  g.add(main, sub)
  gridHelper.value = g
})

// ─── Item color ───────────────────────────────────────────────────────────────

function itemColor(item: ReturnType<typeof items.value[number]['valueOf']>): string {
  if (fp.selection?.id === item.id) return '#5eead4'
  return item.color ?? sceneColors.value.furniture
}

function selectItem(id: string) {
  if (fp.selection?.id === id) fp.deselect()
  else fp.select('furniture', id)
}

const selectedItem = computed(() =>
  fp.selection?.type === 'furniture'
    ? items.value.find(i => i.id === fp.selection!.id) ?? null
    : null
)

function numVal(e: Event) {
  return +(e.target as HTMLInputElement).value
}

// Close on Escape key
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <!-- Fullscreen overlay -->
  <div class="fixed inset-0 z-50 flex flex-col bg-[#0f172a]">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-4 py-2.5 bg-bg-elevated border-b border-bg shrink-0">
      <span class="text-xs text-fg-muted uppercase tracking-wide">3D Group Editor</span>
      <span class="text-sm text-fg font-medium">{{ group?.label ?? '—' }}</span>
      <div class="flex-1" />
      <span class="text-xs text-fg-muted hidden sm:block">Click items to select · Scroll to zoom · Drag to orbit</span>
      <button
        class="ml-2 px-3 py-1.5 text-xs rounded-lg bg-bg border border-bg-elevated text-fg-muted hover:text-fg hover:border-accent/50 transition-colors"
        @click="emit('close')"
      >✕ Close</button>
    </div>

    <!-- Body: canvas + sidebar -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 3D Canvas -->
      <div class="flex-1 relative">
      <TresCanvas
        :clear-color="sceneColors.clear"
        :shadow-map-type="2"
        class="!absolute inset-0"
      >
        <!-- Camera -->
        <TresPerspectiveCamera
          :position="cameraPosition"
          :look-at="[0, 0, 0]"
          :fov="50"
          :near="0.05"
          :far="200"
        />
        <OrbitControls
          :enable-damping="true"
          :damping-factor="0.08"
          :min-polar-angle="0"
          :max-polar-angle="Math.PI / 2 + 0.1"
        />

        <!-- Lighting -->
        <TresAmbientLight :intensity="sceneColors.ambient * 2.2" />
        <TresDirectionalLight
          :position="[5, 10, 7]"
          :intensity="sceneColors.sun * 0.9"
          :cast-shadow="true"
        />
        <TresDirectionalLight
          :position="[-4, 6, -5]"
          :intensity="sceneColors.sun * 0.3"
        />

        <!-- Grid floor -->
        <primitive v-if="gridHelper" :object="gridHelper" />

        <!-- Furniture items in group-local space (group centered at origin) -->
        <TresGroup
          v-if="group"
          :rotation="[(group.rotX ?? 0) * Math.PI / 180, (group.rotY ?? 0) * Math.PI / 180, (group.rotZ ?? 0) * Math.PI / 180]"
        >
          <TresMesh
            v-for="item in items"
            :key="item.id"
            :geometry="getGeometry(item)"
            :position="[item.x, item.y, item.z]"
            :rotation="[(item.rotX ?? 0) * Math.PI / 180, (item.rotY ?? 0) * Math.PI / 180, (item.rotZ ?? 0) * Math.PI / 180]"
            :visible="!item.subtract || true"
            :cast-shadow="true"
            :receive-shadow="!item.subtract"
            @click="selectItem(item.id)"
          >
            <TresMeshStandardMaterial
              v-if="!item.subtract"
              :color="itemColor(item)"
              :roughness="0.7"
            />
            <TresMeshStandardMaterial
              v-else
              color="#ff5533"
              :transparent="true"
              :opacity="0.38"
              :depth-write="false"
              :roughness="0.5"
            />
          </TresMesh>
        </TresGroup>
      </TresCanvas>

      <!-- Empty state -->
      <div
        v-if="items.length === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <p class="text-fg-muted text-sm">No items in this group</p>
      </div>
    </div>

      <!-- Properties sidebar -->
      <div class="w-72 shrink-0 bg-bg-elevated border-l border-bg flex flex-col overflow-y-auto">
        <!-- Group properties -->
        <div class="px-3 pt-3 pb-2 border-b border-bg">
          <p class="text-[10px] text-fg-muted uppercase tracking-wide mb-2">Group</p>
          <label class="flex flex-col gap-1 mb-2">
            <span class="text-[10px] text-fg-muted uppercase tracking-wide">Label</span>
            <input
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg w-full"
              :value="group?.label ?? ''"
              @change="fp.updateFurnitureGroup(groupId, { label: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <p class="text-[9px] text-fg-muted uppercase tracking-wide mb-1">Rotation</p>
          <div class="grid grid-cols-3 gap-1.5">
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-fg-muted uppercase">Rot X°</span>
              <input type="number" step="5" class="bg-bg text-fg text-xs rounded px-1.5 py-1 border border-bg-elevated w-full"
                :value="group?.rotX ?? 0" @change="fp.updateFurnitureGroup(groupId, { rotX: numVal($event) })" />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-fg-muted uppercase">Rot Y°</span>
              <input type="number" step="5" class="bg-bg text-fg text-xs rounded px-1.5 py-1 border border-bg-elevated w-full"
                :value="group?.rotY ?? 0" @change="fp.updateFurnitureGroup(groupId, { rotY: numVal($event) })" />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-fg-muted uppercase">Rot Z°</span>
              <input type="number" step="5" class="bg-bg text-fg text-xs rounded px-1.5 py-1 border border-bg-elevated w-full"
                :value="group?.rotZ ?? 0" @change="fp.updateFurnitureGroup(groupId, { rotZ: numVal($event) })" />
            </label>
          </div>
        </div>

        <!-- Items list + selected item properties -->
        <div class="flex-1 px-3 pt-2 pb-3 flex flex-col">
          <div class="flex items-center justify-between mb-1.5">
            <p class="text-[10px] text-fg-muted uppercase tracking-wide">Items</p>
            <button
              class="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
              title="Add new item to group"
              @click="fp.addFurniture(groupId)"
            >+ Add</button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div
              v-for="item in items"
              :key="item.id"
              class="mb-0.5 rounded-lg border cursor-pointer px-2.5 py-1.5 transition-colors"
              :class="fp.selection?.id === item.id
                ? 'border-accent bg-accent/10'
                : 'border-transparent bg-bg hover:border-accent/30'"
              @click="selectItem(item.id)"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs text-fg truncate mr-1">{{ item.label }}</span>
                <div class="flex items-center gap-1 shrink-0">
                  <span v-if="item.subtract" class="text-[9px] text-red-400">subtract</span>
                  <button
                    class="text-[10px] text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/20 transition-colors"
                    title="Delete item"
                    @click.stop="fp.deleteFurniture(item.id)"
                  >Del</button>
                </div>
              </div>
              <!-- Inline properties for selected item -->
              <FurnitureItemForm
                v-if="fp.selection?.id === item.id"
                :item="item"
              />
            </div>
            <p v-if="items.length === 0" class="text-xs text-fg-muted italic mt-1">No items — click + Add</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
