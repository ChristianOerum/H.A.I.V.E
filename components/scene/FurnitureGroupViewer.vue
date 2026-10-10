<script setup lang="ts">
import { TresCanvas } from '@tresjs/core'
import { Icon } from '@iconify/vue'
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

// Close on Escape key
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
// The viewer covers the main scene with its own canvas; pause the main one
// meanwhile so two WebGL scenes never render at once.
const { sceneSuspended } = useGraphicsQuality()
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  sceneSuspended.value = true
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  sceneSuspended.value = false
})
</script>

<template>
  <!-- Fullscreen overlay -->
  <div class="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 pl-4 pr-2 h-14 bg-bg-panel border-b border-fg/10 shrink-0">
      <Icon icon="mdi:cube-scan" width="22" height="22" class="text-accent shrink-0" />
      <div class="min-w-0">
        <div class="text-sm font-semibold truncate">{{ group?.label ?? 'Group' }}</div>
        <div class="text-[11px] text-fg-muted">3D editor · tap a part to select · drag to orbit · pinch or scroll to zoom</div>
      </div>
      <div class="flex-1" />
      <button class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg" @click="emit('close')">
        <Icon icon="mdi:check" width="18" height="18" />
        <span>Done</span>
      </button>
    </div>

    <!-- Body: canvas + sidebar -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 3D Canvas -->
      <div class="flex-1 relative">
      <TresCanvas
        :clear-color="sceneColors.clear"
        :shadow-map-type="THREE.PCFShadowMap"
        render-mode="on-demand"
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
      <div class="w-96 max-w-[50%] shrink-0 bg-bg-panel border-l border-fg/10 flex flex-col overflow-y-auto overscroll-contain p-3 gap-5">
        <SettingsSection title="Group">
          <SettingsField label="Name">
            <input
              class="field-input"
              :value="group?.label ?? ''"
              @change="fp.updateFurnitureGroup(groupId, { label: ($event.target as HTMLInputElement).value })"
            />
          </SettingsField>
          <div class="grid grid-cols-3 gap-2">
            <SettingsField label="Rotate X">
              <SettingsNumber label="Group rotation X" :value="group?.rotX ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurnitureGroup(groupId, { rotX: v })" />
            </SettingsField>
            <SettingsField label="Rotate Y">
              <SettingsNumber label="Group rotation Y" :value="group?.rotY ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurnitureGroup(groupId, { rotY: v })" />
            </SettingsField>
            <SettingsField label="Rotate Z">
              <SettingsNumber label="Group rotation Z" :value="group?.rotZ ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurnitureGroup(groupId, { rotZ: v })" />
            </SettingsField>
          </div>
        </SettingsSection>

        <SettingsSection :title="`Parts (${items.length})`">
          <template #actions>
            <button class="field-action" @click="fp.addFurniture(groupId)">+ Add part</button>
          </template>
          <div class="flex flex-col gap-1.5">
            <SettingsItem
              v-for="item in items"
              :key="item.id"
              :title="item.label"
              :subtitle="item.subtract ? 'Cut-out' : undefined"
              :icon="item.subtract ? 'mdi:minus-box-outline' : 'mdi:cube-outline'"
              :open="fp.selection?.id === item.id"
              @toggle="selectItem(item.id)"
            >
              <template #actions>
                <SettingsDelete :label="item.label" @confirm="fp.deleteFurniture(item.id)" />
              </template>
              <FurnitureItemForm :item="item" />
            </SettingsItem>
            <p v-if="items.length === 0" class="field-hint text-center py-4">No parts yet — tap “Add part”.</p>
          </div>
        </SettingsSection>
      </div>
    </div>
  </div>
</template>
