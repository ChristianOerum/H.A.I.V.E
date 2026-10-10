<script setup lang="ts">
import type { FloorplanFurniture } from '~/stores/floorplan'

const props = defineProps<{ item: FloorplanFurniture }>()
const fp = useFloorplanStore()

function numVal(e: Event) {
  return +(e.target as HTMLInputElement).value
}

/** Effective shape — respects legacy items that never had an explicit shape field. */
const effectiveShape = computed<'box' | 'rounded' | 'ellipse' | 'sphere'>(() => {
  if (props.item.shape) return props.item.shape
  if ((props.item.radius ?? 0) > 0.001 || (props.item.radiusY ?? 0) > 0.001 || props.item.cornerRadii || !!props.item.edgeRadii)
    return 'rounded'
  return 'box'
})

const hasPerCorner = computed(() => !!props.item.cornerRadii && effectiveShape.value !== 'box')

function setBox() {
  fp.updateFurniture(props.item.id, { shape: 'box', radius: 0, radiusY: 0, cornerRadii: undefined, cornerRho: undefined, edgeRadii: undefined })
}
function setRounded() {
  const existing = props.item.radius ?? 0
  const defaultR = Math.min(props.item.w, props.item.d) / 4
  fp.updateFurniture(props.item.id, {
    shape: 'rounded',
    radius: existing > 0.001 ? existing : defaultR,
    cornerRadii: undefined,
    cornerRho: undefined,
  })
}
function setEllipse() {
  fp.updateFurniture(props.item.id, { shape: 'ellipse', radius: 0, cornerRadii: undefined, cornerRho: undefined })
}
function setSphere() {
  fp.updateFurniture(props.item.id, {
    shape: 'sphere',
    radius: 0, radiusY: 0, cornerRadii: undefined, cornerRho: undefined, edgeRadii: undefined,
    sphereMode: props.item.sphereMode ?? 'full',
    sphereStyle: props.item.sphereStyle ?? 'pill',
    sphereCutY: props.item.sphereCutY ?? 0,
  })
}

function enablePerCorner() {
  if (effectiveShape.value === 'ellipse') {
    // Default: each corner rx = w/2, rho = d/w → four quarter-ellipses = true oval
    const rx = props.item.w / 2
    const rho = props.item.d / props.item.w
    fp.updateFurniture(props.item.id, {
      cornerRadii: [rx, rx, rx, rx],
      cornerRho: [rho, rho, rho, rho],
    })
  } else {
    const r = props.item.radius ?? 0
    fp.updateFurniture(props.item.id, { cornerRadii: [r, r, r, r] })
  }
}
function disablePerCorner() {
  const cr = props.item.cornerRadii
  const avg = cr ? (cr[0] + cr[1] + cr[2] + cr[3]) / 4 : (props.item.radius ?? 0)
  fp.updateFurniture(props.item.id, { cornerRadii: undefined, cornerRho: undefined, radius: avg })
}
function setCorner(idx: 0 | 1 | 2 | 3, val: number) {
  const cr = [...(props.item.cornerRadii ?? [0, 0, 0, 0])] as [number, number, number, number]
  cr[idx] = val
  fp.updateFurniture(props.item.id, { cornerRadii: cr })
}
function setCornerRho(idx: 0 | 1 | 2 | 3, val: number) {
  const crho = [...(props.item.cornerRho ?? [1, 1, 1, 1])] as [number, number, number, number]
  crho[idx] = Math.max(0, val)
  fp.updateFurniture(props.item.id, { cornerRho: crho })
}

const hasPerEdge = computed(() => !!props.item.edgeRadii)
function enablePerEdge() {
  const ry = props.item.radiusY ?? 0
  fp.updateFurniture(props.item.id, { edgeRadii: [ry, ry] })
}
function disablePerEdge() {
  const er = props.item.edgeRadii
  const avg = er ? (er[0] + er[1]) / 2 : (props.item.radiusY ?? 0)
  fp.updateFurniture(props.item.id, { edgeRadii: undefined, radiusY: avg })
}
function setEdge(idx: 0 | 1, val: number) {
  const er = [...(props.item.edgeRadii ?? [0, 0])] as [number, number]
  er[idx] = val
  fp.updateFurniture(props.item.id, { edgeRadii: er })
}

/** Auto-calculated segment count that the geometry builder would use if no override is set. */
const autoSegments = computed(() => {
  const rxz = props.item.radius ?? 0
  const ry  = props.item.radiusY ?? 0
  if (effectiveShape.value === 'sphere')
    return Math.max(16, Math.round(Math.max(props.item.w, props.item.h, props.item.d) * 10)) * 2
  if (effectiveShape.value === 'ellipse')
    return Math.min(64, Math.max(16, Math.round(Math.max(props.item.w, props.item.d) * 8)))
  return Math.max(3, Math.round(Math.max(rxz, ry, 0.01) * 20))
})
</script>

<template>
  <div class="flex flex-col gap-4" @click.stop>
    <div class="grid grid-cols-2 gap-3">
      <SettingsField label="Name">
        <input
          class="field-input"
          :value="item.label"
          @change="fp.updateFurniture(item.id, { label: ($event.target as HTMLInputElement).value })"
        />
      </SettingsField>
      <SettingsField label="Group">
        <select
          class="field-input"
          :value="item.groupId ?? ''"
          @change="fp.setFurnitureGroup(item.id, ($event.target as HTMLSelectElement).value || undefined)"
        >
          <option value="">No group</option>
          <option v-for="g in fp.furnitureGroups" :key="g.id" :value="g.id">{{ g.label }}</option>
        </select>
      </SettingsField>
    </div>

    <SettingsSection title="Position">
      <div class="grid grid-cols-3 gap-2">
        <SettingsField label="X">
          <SettingsNumber label="X" :value="item.x" :step="0.25" @change="(v) => fp.updateFurniture(item.id, { x: v })" />
        </SettingsField>
        <SettingsField label="Z">
          <SettingsNumber label="Z" :value="item.z" :step="0.25" @change="(v) => fp.updateFurniture(item.id, { z: v })" />
        </SettingsField>
        <SettingsField label="Lift">
          <SettingsNumber label="Lift" :value="item.y" :step="0.05" :min="0" @change="(v) => fp.updateFurniture(item.id, { y: v })" />
        </SettingsField>
      </div>
    </SettingsSection>

    <SettingsSection title="Size">
      <div class="grid grid-cols-3 gap-2">
        <SettingsField label="Width">
          <SettingsNumber label="Width" :value="item.w" :step="0.25" :min="0.1" @change="(v) => fp.updateFurniture(item.id, { w: v })" />
        </SettingsField>
        <SettingsField label="Height">
          <SettingsNumber label="Height" :value="item.h" :step="0.1" :min="0.1" @change="(v) => fp.updateFurniture(item.id, { h: v })" />
        </SettingsField>
        <SettingsField label="Depth">
          <SettingsNumber label="Depth" :value="item.d" :step="0.25" :min="0.1" @change="(v) => fp.updateFurniture(item.id, { d: v })" />
        </SettingsField>
      </div>
    </SettingsSection>

    <SettingsSection title="Rotation">
      <div class="grid grid-cols-3 gap-2">
        <SettingsField label="X">
          <SettingsNumber label="Rotation X" :value="item.rotX ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurniture(item.id, { rotX: v })" />
        </SettingsField>
        <SettingsField label="Y">
          <SettingsNumber label="Rotation Y" :value="item.rotY ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurniture(item.id, { rotY: v })" />
        </SettingsField>
        <SettingsField label="Z">
          <SettingsNumber label="Rotation Z" :value="item.rotZ ?? 0" :step="5" unit="°" @change="(v) => fp.updateFurniture(item.id, { rotZ: v })" />
        </SettingsField>
      </div>
    </SettingsSection>

    <SettingsSection title="Shape">
      <div class="segmented compact">
        <button :aria-pressed="effectiveShape === 'box'" @click.stop="setBox()">Box</button>
        <button :aria-pressed="effectiveShape === 'rounded'" @click.stop="setRounded()">Rounded</button>
        <button :aria-pressed="effectiveShape === 'ellipse'" @click.stop="setEllipse()">Ellipse</button>
        <button :aria-pressed="effectiveShape === 'sphere'" @click.stop="setSphere()">Sphere</button>
      </div>

      <!-- ── Sphere ── -->
      <template v-if="effectiveShape === 'sphere'">
        <div class="grid grid-cols-2 gap-3">
          <SettingsField label="Coverage">
            <div class="segmented compact">
              <button :aria-pressed="(item.sphereMode ?? 'full') === 'full'" @click.stop="fp.updateFurniture(item.id, { sphereMode: 'full' })">Full</button>
              <button :aria-pressed="(item.sphereMode ?? 'full') === 'half'" @click.stop="fp.updateFurniture(item.id, { sphereMode: 'half' })">Half</button>
            </div>
          </SettingsField>
          <SettingsField label="Footprint">
            <div class="segmented compact">
              <button :aria-pressed="(item.sphereStyle ?? 'pill') === 'pill'" @click.stop="fp.updateFurniture(item.id, { sphereStyle: 'pill' })">Round</button>
              <button :aria-pressed="(item.sphereStyle ?? 'pill') === 'elliptical'" @click.stop="fp.updateFurniture(item.id, { sphereStyle: 'elliptical' })">Oval</button>
            </div>
          </SettingsField>
        </div>
        <p class="field-hint -mt-1">
          <template v-if="(item.sphereStyle ?? 'pill') === 'pill'">Circular footprint — radius is half the smaller of width and depth.</template>
          <template v-else>Oval footprint — follows width, depth and height.</template>
        </p>

        <SettingsField v-if="(item.sphereMode ?? 'full') === 'half'" label="Cut position" hint="−1 = bottom · 0 = equator (true half) · +1 = top">
          <div class="flex items-center gap-3">
            <input
              type="range" min="-1" max="1" step="0.01" class="flex-1 min-w-0 h-8 accent-accent"
              :value="item.sphereCutY ?? 0"
              @input="fp.updateFurniture(item.id, { sphereCutY: numVal($event) })"
            />
            <SettingsNumber
              class="!w-28 shrink-0" label="Cut position" :value="item.sphereCutY ?? 0" :step="0.05" :min="-1" :max="1"
              @change="(v) => fp.updateFurniture(item.id, { sphereCutY: v })"
            />
          </div>
        </SettingsField>
      </template>

      <!-- ── Rounded / ellipse ── -->
      <template v-if="effectiveShape === 'rounded' || effectiveShape === 'ellipse'">
        <SettingsField label="Corners">
          <div class="segmented compact">
            <button :aria-pressed="!hasPerCorner" @click.stop="disablePerCorner()">Same for all</button>
            <button :aria-pressed="hasPerCorner" @click.stop="enablePerCorner()">Per corner</button>
          </div>
        </SettingsField>

        <p v-if="effectiveShape === 'ellipse' && !hasPerCorner" class="field-hint -mt-1">
          True oval footprint — adjust width and depth to shape it. Per corner gives independent arc control.
        </p>

        <SettingsField v-if="effectiveShape === 'rounded' && !hasPerCorner" label="Corner radius" hint="0 = square corners · max = circular footprint">
          <div class="flex items-center gap-3">
            <input
              type="range" min="0" :max="Math.min(item.w, item.d) / 2" step="0.01" class="flex-1 min-w-0 h-8 accent-accent"
              :value="item.radius ?? 0"
              @input="fp.updateFurniture(item.id, { radius: numVal($event) })"
            />
            <SettingsNumber
              class="!w-28 shrink-0" label="Corner radius" :value="item.radius ?? 0" :step="0.05" :min="0"
              @change="(v) => fp.updateFurniture(item.id, { radius: v })"
            />
          </div>
        </SettingsField>

        <SettingsField v-if="hasPerCorner && effectiveShape === 'rounded'" label="Corner radii" :hint="`Max ${(Math.min(item.w, item.d) / 2).toFixed(2)} (half the smaller side)`">
          <div class="grid grid-cols-2 gap-2">
            <div v-for="corner in ([['Top left', 0], ['Top right', 1], ['Bottom left', 3], ['Bottom right', 2]] as [string, 0|1|2|3][])" :key="corner[0]" class="flex flex-col gap-1">
              <span class="text-[11px] text-fg-muted">{{ corner[0] }}</span>
              <SettingsNumber
                :label="corner[0]" :value="item.cornerRadii?.[corner[1]] ?? 0" :step="0.05" :min="0" :max="Math.min(item.w, item.d) / 2"
                @change="(v) => setCorner(corner[1], v ?? 0)"
              />
            </div>
          </div>
        </SettingsField>

        <SettingsField v-if="hasPerCorner && effectiveShape === 'ellipse'" label="Corner arcs" hint="Reach = how far the arc extends · ratio = arc height ÷ width (1 = circle)">
          <div class="grid gap-x-2 gap-y-1.5 items-center" style="grid-template-columns: auto 1fr 1fr">
            <span />
            <span class="text-[11px] text-fg-muted text-center">Reach</span>
            <span class="text-[11px] text-fg-muted text-center">Ratio</span>
            <template v-for="corner in ([['Top left', 0], ['Top right', 1], ['Bottom right', 2], ['Bottom left', 3]] as [string, 0|1|2|3][])" :key="corner[0]">
              <span class="text-[11px] text-fg-muted w-12 leading-tight">{{ corner[0] }}</span>
              <SettingsNumber
                :label="`${corner[0]} reach`" :value="item.cornerRadii?.[corner[1]] ?? 0" :step="0.05" :min="0" :max="item.w / 2"
                @change="(v) => setCorner(corner[1], v ?? 0)"
              />
              <SettingsNumber
                :label="`${corner[0]} ratio`" :value="+(item.cornerRho?.[corner[1]] ?? (item.d / item.w)).toFixed(3)" :step="0.05" :min="0"
                @change="(v) => setCornerRho(corner[1], v ?? 0)"
              />
            </template>
          </div>
        </SettingsField>

        <SettingsField label="Edge roundness" hint="0 = flat · max = dome / pillow">
          <div class="segmented compact">
            <button :aria-pressed="!hasPerEdge" @click.stop="disablePerEdge()">Same top &amp; bottom</button>
            <button :aria-pressed="hasPerEdge" @click.stop="enablePerEdge()">Separate</button>
          </div>
          <div v-if="!hasPerEdge" class="flex items-center gap-3">
            <input
              type="range" min="0" :max="item.h / 2" step="0.01" class="flex-1 min-w-0 h-8 accent-accent"
              :value="item.radiusY ?? 0"
              @input="fp.updateFurniture(item.id, { radiusY: numVal($event) })"
            />
            <SettingsNumber
              class="!w-28 shrink-0" label="Edge roundness" :value="item.radiusY ?? 0" :step="0.05" :min="0"
              @change="(v) => fp.updateFurniture(item.id, { radiusY: v })"
            />
          </div>
          <div v-else class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <span class="text-[11px] text-fg-muted">Top</span>
              <SettingsNumber label="Top edge" :value="item.edgeRadii?.[0] ?? 0" :step="0.05" :min="0" :max="item.h / 2" @change="(v) => setEdge(0, v ?? 0)" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-[11px] text-fg-muted">Bottom</span>
              <SettingsNumber label="Bottom edge" :value="item.edgeRadii?.[1] ?? 0" :step="0.05" :min="0" :max="item.h / 2" @change="(v) => setEdge(1, v ?? 0)" />
            </div>
          </div>
        </SettingsField>
      </template>

      <!-- Curve resolution (any curved shape) -->
      <SettingsField
        v-if="effectiveShape !== 'box'"
        label="Smoothness"
        hint="Higher = smoother curves · lower = faster on the Pi"
        :resettable="item.segments !== undefined"
        :reset-label="`Auto (${autoSegments})`"
        @reset="fp.updateFurniture(item.id, { segments: undefined })"
      >
        <div class="flex items-center gap-3">
          <input
            type="range" :min="effectiveShape === 'sphere' ? 8 : 4" max="128" step="1" class="flex-1 min-w-0 h-8 accent-accent"
            :value="item.segments ?? autoSegments"
            @input="fp.updateFurniture(item.id, { segments: numVal($event) })"
          />
          <SettingsNumber
            class="!w-28 shrink-0" label="Smoothness" :value="item.segments ?? autoSegments" :step="1" :min="effectiveShape === 'sphere' ? 8 : 4" :max="128"
            @change="(v) => fp.updateFurniture(item.id, { segments: v })"
          />
        </div>
      </SettingsField>
    </SettingsSection>

    <SettingsSection title="Appearance">
      <SettingsField
        label="Type"
        :hint="item.subtract
          ? (item.groupId ? 'Cuts a hole in the other parts of its group · only visible while editing' : 'Add this to a group to cut holes in the other parts')
          : undefined"
      >
        <div class="segmented compact">
          <button :aria-pressed="!item.subtract" @click.stop="fp.updateFurniture(item.id, { subtract: undefined })">Solid</button>
          <button :aria-pressed="!!item.subtract" @click.stop="fp.updateFurniture(item.id, { subtract: true })">Cut-out</button>
        </div>
      </SettingsField>
      <!-- Cut-outs always render red, so colour doesn't apply -->
      <SettingsField v-if="!item.subtract" label="Colour">
        <SettingsColor :value="item.color" placeholder="Theme colour" @update="(v) => fp.updateFurniture(item.id, { color: v })" />
      </SettingsField>
    </SettingsSection>
  </div>
</template>
