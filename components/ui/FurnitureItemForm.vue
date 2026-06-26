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
  <div class="mt-3 grid grid-cols-2 gap-2" @click.stop>
    <!-- Label -->
    <label class="col-span-2 flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Label</span>
      <input
        class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.label"
        @change="fp.updateFurniture(item.id, { label: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <!-- Group assignment -->
    <label class="col-span-2 flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Group</span>
      <select
        class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.groupId ?? ''"
        @change="fp.setFurnitureGroup(item.id, ($event.target as HTMLSelectElement).value || undefined)"
      >
        <option value="">— No group —</option>
        <option v-for="g in fp.furnitureGroups" :key="g.id" :value="g.id">{{ g.label }}</option>
      </select>
    </label>

    <!-- Position -->
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">X</span>
      <input type="number" step="0.25" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.x" @change="fp.updateFurniture(item.id, { x: numVal($event) })" />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Z</span>
      <input type="number" step="0.25" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.z" @change="fp.updateFurniture(item.id, { z: numVal($event) })" />
    </label>

    <!-- Dimensions -->
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Width</span>
      <input type="number" step="0.25" min="0.1" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.w" @change="fp.updateFurniture(item.id, { w: numVal($event) })" />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Height</span>
      <input type="number" step="0.1" min="0.1" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.h" @change="fp.updateFurniture(item.id, { h: numVal($event) })" />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Depth</span>
      <input type="number" step="0.25" min="0.1" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.d" @change="fp.updateFurniture(item.id, { d: numVal($event) })" />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Y (lift)</span>
      <input type="number" step="0.05" min="0" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.y" @change="fp.updateFurniture(item.id, { y: numVal($event) })" />
    </label>
    <div class="col-span-2 grid grid-cols-3 gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Rot X °</span>
        <input type="number" step="5" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
          :value="item.rotX ?? 0" @change="fp.updateFurniture(item.id, { rotX: numVal($event) })" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Rot Y °</span>
        <input type="number" step="5" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
          :value="item.rotY ?? 0" @change="fp.updateFurniture(item.id, { rotY: numVal($event) })" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Rot Z °</span>
        <input type="number" step="5" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
          :value="item.rotZ ?? 0" @change="fp.updateFurniture(item.id, { rotZ: numVal($event) })" />
      </label>
    </div>
    <div class="col-span-2 flex gap-1">
      <button
        class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
        :class="effectiveShape === 'box' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
        @click.stop="setBox()"
      >Box</button>
      <button
        class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
        :class="effectiveShape === 'rounded' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
        @click.stop="setRounded()"
      >Rounded</button>
      <button
        class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
        :class="effectiveShape === 'ellipse' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
        @click.stop="setEllipse()"
      >Ellipse</button>
      <button
        class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
        :class="effectiveShape === 'sphere' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
        @click.stop="setSphere()"
      >Sphere</button>
    </div>

    <!-- ── Sphere controls ──────────────────────────────────────────────────── -->
    <template v-if="effectiveShape === 'sphere'">

      <!-- Full / Half toggle -->
      <div class="col-span-2 flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Mode</span>
        <div class="flex gap-1">
          <button
            class="flex-1 py-1 rounded-lg border text-[10px] transition-colors"
            :class="(item.sphereMode ?? 'full') === 'full' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
            @click.stop="fp.updateFurniture(item.id, { sphereMode: 'full' })"
          >Full sphere</button>
          <button
            class="flex-1 py-1 rounded-lg border text-[10px] transition-colors"
            :class="(item.sphereMode ?? 'full') === 'half' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
            @click.stop="fp.updateFurniture(item.id, { sphereMode: 'half' })"
          >Half sphere</button>
        </div>
      </div>

      <!-- Pill / Elliptical toggle -->
      <div class="col-span-2 flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Style</span>
        <div class="flex gap-1">
          <button
            class="flex-1 py-1 rounded-lg border text-[10px] transition-colors"
            :class="(item.sphereStyle ?? 'pill') === 'pill' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
            @click.stop="fp.updateFurniture(item.id, { sphereStyle: 'pill' })"
          >Pill</button>
          <button
            class="flex-1 py-1 rounded-lg border text-[10px] transition-colors"
            :class="(item.sphereStyle ?? 'pill') === 'elliptical' ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
            @click.stop="fp.updateFurniture(item.id, { sphereStyle: 'elliptical' })"
          >Elliptical</button>
        </div>
        <p class="text-[9px] text-fg-muted leading-snug">
          <template v-if="(item.sphereStyle ?? 'pill') === 'pill'">Circular footprint — XZ radius = min(W, D) / 2.</template>
          <template v-else>Elliptical footprint — X = W / 2, Z = D / 2, Y = H / 2.</template>
        </p>
      </div>

      <!-- Cut-off position (half sphere only) -->
      <template v-if="(item.sphereMode ?? 'full') === 'half'">
        <label class="col-span-2 flex flex-col gap-1">
          <span class="text-[10px] text-fg-muted uppercase tracking-wide">Cut position</span>
          <div class="flex items-center gap-2">
            <input type="range" min="-1" max="1" step="0.01"
              class="flex-1 accent-accent"
              :value="item.sphereCutY ?? 0"
              @input="fp.updateFurniture(item.id, { sphereCutY: numVal($event) })"
            />
            <input type="number" step="0.05" min="-1" max="1"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-16 shrink-0"
              :value="item.sphereCutY ?? 0"
              @change="fp.updateFurniture(item.id, { sphereCutY: Math.max(-1, Math.min(1, numVal($event))) })"
            />
          </div>
          <span class="text-[9px] text-fg-muted">−1 = bottom · 0 = equator (true half) · +1 = top</span>
        </label>
      </template>

      <!-- Resolution slider (sphere) -->
      <label class="col-span-2 flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-fg-muted uppercase tracking-wide">Resolution</span>
          <button
            v-if="item.segments !== undefined"
            class="text-[9px] text-fg-muted hover:text-fg px-1"
            @click.stop="fp.updateFurniture(item.id, { segments: undefined })"
          >Auto ({{ autoSegments }})</button>
          <span v-else class="text-[9px] text-fg-muted">Auto ({{ autoSegments }})</span>
        </div>
        <div class="flex items-center gap-2">
          <input type="range" min="8" max="128" step="1"
            class="flex-1 accent-accent"
            :value="item.segments ?? autoSegments"
            @input="fp.updateFurniture(item.id, { segments: numVal($event) })"
          />
          <input type="number" min="8" max="128" step="1"
            class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-16 shrink-0"
            :value="item.segments ?? autoSegments"
            @change="fp.updateFurniture(item.id, { segments: numVal($event) })"
          />
        </div>
        <span class="text-[9px] text-fg-muted">Higher = smoother · lower = faster render</span>
      </label>

    </template>

    <!-- Radius controls (rounded or ellipse) -->
    <template v-if="effectiveShape !== 'box' && effectiveShape !== 'sphere'">

      <!-- Uniform / Per-corner toggle (rounded and ellipse) -->
      <div class="col-span-2 flex gap-1">
        <button
          class="flex-1 py-1 rounded-lg border text-[10px] transition-colors"
          :class="!hasPerCorner ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
          @click.stop="disablePerCorner()"
        >Uniform</button>
        <button
          class="flex-1 py-1 rounded-lg border text-[10px] transition-colors"
          :class="hasPerCorner ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
          @click.stop="enablePerCorner()"
        >Per corner</button>
      </div>

      <!-- Ellipse note (uniform only) -->
      <p v-if="effectiveShape === 'ellipse' && !hasPerCorner" class="col-span-2 text-[9px] text-fg-muted leading-relaxed">
        True oval footprint — adjust Width &amp; Depth for shape. Per corner gives independent arc control.
      </p>

      <!-- Uniform corner radius slider (rounded + uniform only) -->
      <label v-if="effectiveShape === 'rounded' && !hasPerCorner" class="col-span-2 flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Corner radius (XZ)</span>
        <div class="flex items-center gap-2">
          <input type="range" min="0" :max="Math.min(item.w, item.d) / 2" step="0.01"
            class="flex-1 accent-accent"
            :value="item.radius ?? 0"
            @input="fp.updateFurniture(item.id, { radius: numVal($event) })"
          />
          <input type="number" step="0.05" min="0"
            class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-16 shrink-0"
            :value="item.radius ?? 0"
            @change="fp.updateFurniture(item.id, { radius: numVal($event) })"
          />
        </div>
        <span class="text-[9px] text-fg-muted">0 = square corners · max = circle footprint</span>
      </label>

      <!-- Per-corner 2×2 grid (rounded mode) -->
      <div v-if="hasPerCorner && effectiveShape === 'rounded'" class="col-span-2 flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Corner radii (XZ)</span>
        <div class="grid grid-cols-2 gap-1.5">
          <label v-for="corner in ([['↖ TL', 0], ['↗ TR', 1], ['↙ BL', 3], ['↘ BR', 2]] as [string, 0|1|2|3][])"
            :key="corner[0]" class="flex flex-col gap-0.5">
            <span class="text-[9px] text-fg-muted">{{ corner[0] }}</span>
            <input type="number" step="0.05" min="0"
              :max="Math.min(item.w, item.d) / 2"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
              :value="item.cornerRadii?.[corner[1]] ?? 0"
              @change="setCorner(corner[1], numVal($event))"
            />
          </label>
        </div>
        <span class="text-[9px] text-fg-muted">Max = min(W,D) / 2</span>
      </div>

      <!-- Per-corner table with r + ρ (ellipse mode) -->
      <div v-if="hasPerCorner && effectiveShape === 'ellipse'" class="col-span-2 flex flex-col gap-1">
        <div class="grid gap-x-1.5 gap-y-1" style="grid-template-columns: auto 1fr 1fr">
          <span></span>
          <span class="text-[9px] text-fg-muted text-center uppercase tracking-wide">r</span>
          <span class="text-[9px] text-fg-muted text-center uppercase tracking-wide">ρ</span>
          <template v-for="corner in ([['↖ TL', 0], ['↗ TR', 1], ['↘ BR', 2], ['↙ BL', 3]] as [string, 0|1|2|3][])" :key="corner[0]">
            <span class="text-[9px] text-fg-muted leading-none self-center">{{ corner[0] }}</span>
            <input type="number" step="0.05" min="0" :max="item.w / 2"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1 border border-bg-elevated w-full"
              :value="item.cornerRadii?.[corner[1]] ?? 0"
              @change="setCorner(corner[1], numVal($event))"
            />
            <input type="number" step="0.05" min="0"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1 border border-bg-elevated w-full"
              :value="+(item.cornerRho?.[corner[1]] ?? (item.d / item.w)).toFixed(3)"
              @change="setCornerRho(corner[1], numVal($event))"
            />
          </template>
        </div>
        <span class="text-[9px] text-fg-muted">r = arc reach · ρ = ry/rx (1 = circle, D/W = oval)</span>
      </div>

      <!-- Y edge radius — uniform or per-edge (top / bottom) -->
      <div class="col-span-2 flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-fg-muted uppercase tracking-wide">Edge roundness (Y)</span>
          <div class="flex gap-0.5">
            <button
              class="py-0.5 px-2 rounded border text-[10px] transition-colors"
              :class="!hasPerEdge ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
              @click.stop="disablePerEdge()"
            >Uniform</button>
            <button
              class="py-0.5 px-2 rounded border text-[10px] transition-colors"
              :class="hasPerEdge ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
              @click.stop="enablePerEdge()"
            >Per edge</button>
          </div>
        </div>
        <!-- Uniform -->
        <template v-if="!hasPerEdge">
          <div class="flex items-center gap-2">
            <input type="range" min="0" :max="item.h / 2" step="0.01"
              class="flex-1 accent-accent"
              :value="item.radiusY ?? 0"
              @input="fp.updateFurniture(item.id, { radiusY: numVal($event) })"
            />
            <input type="number" step="0.05" min="0"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-16 shrink-0"
              :value="item.radiusY ?? 0"
              @change="fp.updateFurniture(item.id, { radiusY: numVal($event) })"
            />
          </div>
          <span class="text-[9px] text-fg-muted">0 = flat &middot; max = dome / pillow</span>
        </template>
        <!-- Per edge: top + bottom -->
        <template v-else>
          <div class="grid gap-x-2 gap-y-1" style="grid-template-columns: auto 1fr">
            <span class="text-[9px] text-fg-muted self-center">↑ Top</span>
            <input type="number" step="0.05" min="0" :max="item.h / 2"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1 border border-bg-elevated w-full"
              :value="item.edgeRadii?.[0] ?? 0"
              @change="setEdge(0, numVal($event))"
            />
            <span class="text-[9px] text-fg-muted self-center">↓ Bottom</span>
            <input type="number" step="0.05" min="0" :max="item.h / 2"
              class="bg-bg text-fg text-xs rounded-lg px-2 py-1 border border-bg-elevated w-full"
              :value="item.edgeRadii?.[1] ?? 0"
              @change="setEdge(1, numVal($event))"
            />
          </div>
          <span class="text-[9px] text-fg-muted">0 = flat &middot; max = dome</span>
        </template>
      </div>

      <!-- Resolution slider -->
      <label class="col-span-2 flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-fg-muted uppercase tracking-wide">Resolution</span>
          <button
            v-if="item.segments !== undefined"
            class="text-[9px] text-fg-muted hover:text-fg px-1"
            @click.stop="fp.updateFurniture(item.id, { segments: undefined })"
          >Auto ({{ autoSegments }})</button>
          <span v-else class="text-[9px] text-fg-muted">Auto ({{ autoSegments }})</span>
        </div>
        <div class="flex items-center gap-2">
          <input type="range" min="4" max="128" step="1"
            class="flex-1 accent-accent"
            :value="item.segments ?? autoSegments"
            @input="fp.updateFurniture(item.id, { segments: numVal($event) })"
          />
          <input type="number" min="4" max="128" step="1"
            class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-16 shrink-0"
            :value="item.segments ?? autoSegments"
            @change="fp.updateFurniture(item.id, { segments: numVal($event) })"
          />
        </div>
        <span class="text-[9px] text-fg-muted">Higher = smoother curves · lower = faster render</span>
      </label>

    </template>

    <!-- Subtract boolean (group-only feature) -->
    <div class="col-span-2 flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Boolean</span>
      <div class="flex gap-1">
        <button
          class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
          :class="!item.subtract ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
          @click.stop="fp.updateFurniture(item.id, { subtract: undefined })"
        >Solid</button>
        <button
          class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
          :class="item.subtract ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-bg border-bg-elevated text-fg-muted hover:border-rose-500/40'"
          @click.stop="fp.updateFurniture(item.id, { subtract: true })"
        >Subtract</button>
      </div>
      <span v-if="item.subtract && !item.groupId" class="text-[9px] text-rose-400/80">Add to a group to cut holes in solid siblings</span>
      <span v-else-if="item.subtract" class="text-[9px] text-rose-400/80">Cuts a hole in all solid siblings · visible in edit mode only</span>
    </div>

    <!-- Color (hidden for subtract items — they always render red) -->
    <label v-if="!item.subtract" class="col-span-2 flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Color</span>
      <div class="flex items-center gap-2">
        <input
          type="color"
          class="h-8 w-10 rounded cursor-pointer border border-bg-elevated bg-bg p-0.5 shrink-0"
          :value="item.color ?? '#808080'"
          @input="fp.updateFurniture(item.id, { color: ($event.target as HTMLInputElement).value })"
        />
        <input
          class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full font-mono"
          :value="item.color ?? ''"
          placeholder="auto (theme)"
          maxlength="7"
          @change="fp.updateFurniture(item.id, { color: ($event.target as HTMLInputElement).value.trim() || undefined })"
        />
        <button
          v-if="item.color"
          class="text-xs text-fg-muted hover:text-fg shrink-0 px-1"
          title="Reset to theme color"
          @click.stop="fp.updateFurniture(item.id, { color: undefined })"
        >✕</button>
      </div>
    </label>
  </div>
</template>
