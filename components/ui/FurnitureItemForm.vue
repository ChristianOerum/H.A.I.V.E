<script setup lang="ts">
import type { FloorplanFurniture } from '~/stores/floorplan'

const props = defineProps<{ item: FloorplanFurniture }>()
const fp = useFloorplanStore()

function numVal(e: Event) {
  return +(e.target as HTMLInputElement).value
}

const isRounded = computed(() => (props.item.radius ?? 0) > 0.001 || (props.item.radiusY ?? 0) > 0.001)

function setBox() {
  fp.updateFurniture(props.item.id, { radius: 0, radiusY: 0 })
}
function setRounded() {
  const r = Math.min(props.item.w, props.item.d) / 2
  fp.updateFurniture(props.item.id, { radius: r, radiusY: r })
}
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
    <label class="flex flex-col gap-1">
      <span class="text-[10px] text-fg-muted uppercase tracking-wide">Rotation °</span>
      <input type="number" step="5" class="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-bg-elevated w-full"
        :value="item.rotY ?? 0" @change="fp.updateFurniture(item.id, { rotY: numVal($event) })" />
    </label>

    <!-- Shape toggle -->
    <div class="col-span-2 flex gap-1">
      <button
        class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
        :class="!isRounded ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
        @click.stop="setBox()"
      >Box</button>
      <button
        class="flex-1 py-1.5 rounded-lg border text-xs transition-colors"
        :class="isRounded ? 'bg-accent/20 border-accent text-accent' : 'bg-bg border-bg-elevated text-fg-muted hover:border-accent/50'"
        @click.stop="setRounded()"
      >Rounded</button>
    </div>

    <!-- Radius sliders (only shown when rounded) -->
    <template v-if="isRounded">
      <label class="col-span-2 flex flex-col gap-1">
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
      <label class="col-span-2 flex flex-col gap-1">
        <span class="text-[10px] text-fg-muted uppercase tracking-wide">Edge roundness (Y)</span>
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
        <span class="text-[9px] text-fg-muted">0 = flat top/bottom · max = dome / pillow</span>
      </label>
    </template>

    <!-- Color -->
    <label class="col-span-2 flex flex-col gap-1">
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
