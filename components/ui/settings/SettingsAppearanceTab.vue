<script setup lang="ts">
import { Icon } from '@iconify/vue'
import {
  hexToHsl, hslToHex, hueToHex, rgbTripletToHex, hexToRgbTriplet,
  DARK_PALETTES, LIGHT_PALETTES, type CustomPalette, type Palette, type ThemeMode,
} from '~/stores/theme'
import type { GraphicsQuality } from '~/composables/useGraphicsQuality'

const theme = useThemeStore()
const toast = useToast()

// ── Mode ──
const MODES: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: 'mdi:theme-light-dark' },
  { value: 'light', label: 'Light', icon: 'mdi:white-balance-sunny' },
  { value: 'dark', label: 'Dark', icon: 'mdi:weather-night' },
]

// ── UI scale ──
const uiScalePct = computed(() => Math.round(theme.uiScale * 100))

// ── 3D quality (per screen) ──
const graphics = useGraphicsQuality()
const QUALITIES: { value: GraphicsQuality; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: 'mdi:auto-fix' },
  { value: 'high', label: 'High', icon: 'mdi:quality-high' },
  { value: 'low', label: 'Smooth', icon: 'mdi:speedometer' },
  { value: 'potato', label: 'Potato', icon: 'mdi:feather' },
]
const qualityHint = computed(() => {
  const base = 'Smooth lowers shadow detail, sharpness and weather density so slower screens keep up. Potato also turns shadows off and renders 3D at lower resolution, so lamp light can spill through walls. Only affects this screen.'
  return graphics.quality.value === 'auto'
    ? `${base} Auto picked ${graphics.tier.value === 'low' ? 'Smooth' : 'High'} for this device.`
    : base
})

// ── Accent ──
const DEFAULT_HUE = 174
const ACCENT_PRESETS: { label: string; hue: number }[] = [
  { label: 'Teal', hue: 174 },
  { label: 'Blue', hue: 217 },
  { label: 'Indigo', hue: 243 },
  { label: 'Purple', hue: 270 },
  { label: 'Rose', hue: 347 },
  { label: 'Amber', hue: 38 },
  { label: 'Green', hue: 142 },
]
const accentHex = computed(() => hslToHex(theme.accentHue, theme.accentSat, theme.accentLit))
const accentLightHex = computed(() => hslToHex(
  theme.accentHue,
  Math.round(theme.accentSat * (70 / 78)),
  Math.round(theme.accentLit * (42 / 62)),
))
// Presets use the default saturation/lightness, so compare the resolved colour.
const isPreset = (hue: number) => hueToHex(hue) === accentHex.value
function setCustomAccent(hex: string | undefined) {
  if (!hex) return
  const [h, s, l] = hexToHsl(hex)
  theme.setAccentColor(h, s, l)
}

// ── Palettes ──
type PaletteOption = { key: string; name: string; palette: Palette; custom: boolean }
const darkOptions = computed<PaletteOption[]>(() => [
  ...Object.entries(DARK_PALETTES).map(([key, palette]) => ({ key, name: key, palette, custom: false })),
  ...(theme.customPalettes ?? []).filter((p) => p.type === 'dark').map((p) => ({ key: p.id, name: p.name, palette: p, custom: true })),
])
const lightOptions = computed<PaletteOption[]>(() => [
  ...Object.entries(LIGHT_PALETTES).map(([key, palette]) => ({ key, name: key, palette, custom: false })),
  ...(theme.customPalettes ?? []).filter((p) => p.type === 'light').map((p) => ({ key: p.id, name: p.name, palette: p, custom: true })),
])

// ── Custom palette editor ──
const editingId = ref<string | null>(null)

function addPalette(type: 'dark' | 'light') {
  editingId.value = theme.addCustomPalette(type)
}
function updateField(id: string, field: keyof CustomPalette, value: string) {
  theme.updateCustomPalette(id, { [field]: value })
}
const UI_FIELDS = [['bg', 'Background'], ['bgPanel', 'Panels'], ['bgElevated', 'Buttons'], ['fg', 'Text'], ['fgMuted', 'Muted text']] as const
const SCENE_FIELDS = [['sceneClear', 'Sky'], ['sceneFloor', 'Floor'], ['sceneWall', 'Walls'], ['sceneFurniture', 'Furniture']] as const

const showTransfer = ref(false)
const importJson = ref('')
const importError = ref('')
function copyExport() {
  navigator.clipboard.writeText(theme.exportCustomPalettes())
    .then(() => toast.success('Palettes copied to the clipboard', 'mdi:clipboard-check-outline'))
    .catch(() => toast.error('Couldn’t access the clipboard'))
}
function doImport() {
  importError.value = ''
  try {
    theme.importCustomPalettes(importJson.value)
    importJson.value = ''
    showTransfer.value = false
    toast.success('Palettes imported')
  } catch {
    importError.value = 'That isn’t valid palette JSON.'
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 px-1 py-1">
    <SettingsSection title="Theme" hint="Auto switches between light and dark with the sun. Saved instantly on every screen.">
      <div class="segmented">
        <button v-for="m in MODES" :key="m.value" :aria-pressed="theme.mode === m.value" @click="theme.set(m.value)">
          <Icon :icon="m.icon" width="18" height="18" />
          <span>{{ m.label }}</span>
        </button>
      </div>
    </SettingsSection>

    <SettingsSection title="Accent colour">
      <div class="grid grid-cols-7 gap-1">
        <button
          v-for="p in ACCENT_PRESETS"
          :key="p.hue"
          class="flex flex-col items-center gap-1 py-1 rounded-lg active:bg-bg-elevated"
          :aria-pressed="isPreset(p.hue)"
          :aria-label="p.label"
          @click="theme.setAccentHue(p.hue)"
        >
          <span
            class="w-9 h-9 rounded-full flex items-center justify-center transition-shadow"
            :class="isPreset(p.hue) ? 'ring-2 ring-offset-2 ring-offset-bg-panel ring-fg' : ''"
            :style="{ background: hueToHex(p.hue) }"
          >
            <Icon v-if="isPreset(p.hue)" icon="mdi:check" width="18" height="18" class="text-white" />
          </span>
          <span class="text-[10px] text-fg-muted">{{ p.label }}</span>
        </button>
      </div>
      <SettingsField label="Custom colour" :resettable="!isPreset(DEFAULT_HUE)" reset-label="Reset to Teal" @reset="theme.setAccentHue(DEFAULT_HUE)">
        <SettingsColor :value="accentHex" :clearable="false" @update="setCustomAccent" />
      </SettingsField>
      <!-- Light / dark preview of the accent -->
      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="pv in [
            { name: 'Dark', pal: darkOptions.find((o) => o.key === theme.darkVariant)?.palette ?? DARK_PALETTES.slate, accent: accentHex },
            { name: 'Light', pal: lightOptions.find((o) => o.key === theme.lightVariant)?.palette ?? LIGHT_PALETTES.warm, accent: accentLightHex },
          ]"
          :key="pv.name"
          class="rounded-xl p-3 flex flex-col gap-2 border border-fg/10"
          :style="{ background: `rgb(${pv.pal.bg})` }"
        >
          <span class="text-[10px] uppercase tracking-wider" :style="{ color: `rgb(${pv.pal.fgMuted})` }">{{ pv.name }}</span>
          <span class="text-sm font-semibold" :style="{ color: pv.accent }">Active text</span>
          <div class="flex gap-1.5">
            <span class="px-2 py-0.5 rounded text-[11px] font-medium" :style="{ background: pv.accent, color: `rgb(${pv.pal.bg})` }">Button</span>
            <span class="px-2 py-0.5 rounded text-[11px] border" :style="{ borderColor: pv.accent + '80', color: pv.accent }">Outline</span>
          </div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection
      v-for="group in [
        { title: 'Dark style', options: darkOptions, current: theme.darkVariant, set: (k: string) => theme.setDarkVariant(k) },
        { title: 'Light style', options: lightOptions, current: theme.lightVariant, set: (k: string) => theme.setLightVariant(k) },
      ]"
      :key="group.title"
      :title="group.title"
    >
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="o in group.options"
          :key="o.key"
          class="rounded-xl border-2 p-1 text-left transition-colors"
          :class="group.current === o.key ? 'border-accent' : 'border-transparent active:border-fg/20'"
          :aria-pressed="group.current === o.key"
          @click="group.set(o.key)"
        >
          <!-- Mini mock-up of the palette -->
          <div class="h-12 rounded-lg p-1.5 flex flex-col gap-1 border border-fg/10" :style="{ background: `rgb(${o.palette.bg})` }">
            <div class="h-2 w-8 rounded-sm" :style="{ background: `rgb(${o.palette.fg})` }" />
            <div class="flex-1 rounded" :style="{ background: `rgb(${o.palette.bgPanel})` }" />
          </div>
          <div class="text-[11px] font-medium mt-1 px-0.5 truncate capitalize">{{ o.name }}</div>
        </button>
      </div>
    </SettingsSection>

    <SettingsSection title="Display">
      <SettingsField
        hint="Makes every button and label bigger or smaller. Phones never go above 100%."
        :resettable="theme.uiScale !== 1"
        reset-label="Reset to 100%"
        @reset="theme.setUiScale(1)"
      >
        <template #label>Interface size <span class="text-accent tabular-nums ml-1">{{ uiScalePct }}%</span></template>
        <div class="flex items-center gap-3">
          <span class="text-xs text-fg-muted">A</span>
          <input
            type="range"
            min="75"
            max="150"
            step="5"
            class="flex-1 h-8 accent-accent"
            :value="uiScalePct"
            @input="theme.setUiScale(+($event.target as HTMLInputElement).value / 100)"
          />
          <span class="text-lg text-fg-muted">A</span>
        </div>
      </SettingsField>
      <SettingsField :hint="qualityHint">
        <template #label>3D quality</template>
        <!-- 2×2 grid: four options side by side overflow the settings panel -->
        <div class="segmented !grid grid-cols-2">
          <button v-for="q in QUALITIES" :key="q.value" :aria-pressed="graphics.quality.value === q.value" @click="graphics.setQuality(q.value)">
            <Icon :icon="q.icon" width="18" height="18" />
            <span>{{ q.label }}</span>
          </button>
        </div>
      </SettingsField>
    </SettingsSection>

    <SettingsSection title="Custom palettes" hint="Custom palettes are saved as you edit them and appear in the style pickers above.">
      <template #actions>
        <button class="field-action" @click="showTransfer = true">Import / export</button>
      </template>

      <SettingsItem
        v-for="p in (theme.customPalettes ?? [])"
        :key="p.id"
        :title="p.name"
        :subtitle="`${p.type === 'dark' ? 'Dark' : 'Light'} palette${(p.type === 'dark' ? theme.darkVariant : theme.lightVariant) === p.id ? ' · in use' : ''}`"
        :icon-color="`rgb(${p.bg})`"
        :open="editingId === p.id"
        @toggle="editingId = editingId === p.id ? null : p.id"
      >
        <template #actions>
          <SettingsDelete :label="p.name" @confirm="theme.deleteCustomPalette(p.id)" />
        </template>

        <SettingsField label="Name">
          <input class="field-input" :value="p.name" @change="updateField(p.id, 'name', ($event.target as HTMLInputElement).value)" />
        </SettingsField>
        <SettingsSection title="Interface">
          <div class="grid grid-cols-2 gap-x-3 gap-y-2">
            <label v-for="[field, name] in UI_FIELDS" :key="field" class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <span class="relative w-8 h-8 shrink-0 rounded-lg border border-fg/10 overflow-hidden" :style="{ background: rgbTripletToHex(p[field]) }">
                <input type="color" class="absolute inset-0 opacity-0 cursor-pointer" :value="rgbTripletToHex(p[field])" @input="updateField(p.id, field, hexToRgbTriplet(($event.target as HTMLInputElement).value))" />
              </span>
              {{ name }}
            </label>
          </div>
        </SettingsSection>
        <SettingsSection title="3D scene">
          <div class="grid grid-cols-2 gap-x-3 gap-y-2">
            <label v-for="[field, name] in SCENE_FIELDS" :key="field" class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <span class="relative w-8 h-8 shrink-0 rounded-lg border border-fg/10 overflow-hidden" :style="{ background: p[field] }">
                <input type="color" class="absolute inset-0 opacity-0 cursor-pointer" :value="p[field]" @input="updateField(p.id, field, ($event.target as HTMLInputElement).value)" />
              </span>
              {{ name }}
            </label>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <SettingsField label="Ambient light">
              <SettingsNumber label="Ambient light" :value="Number(p.sceneAmbient)" :step="0.05" :min="0" :max="1" @change="(v) => updateField(p.id, 'sceneAmbient', String(v))" />
            </SettingsField>
            <SettingsField label="Sunlight">
              <SettingsNumber label="Sunlight" :value="Number(p.sceneSun)" :step="0.05" :min="0" :max="2" @change="(v) => updateField(p.id, 'sceneSun', String(v))" />
            </SettingsField>
          </div>
        </SettingsSection>
      </SettingsItem>

      <div class="grid grid-cols-2 gap-2">
        <button class="btn-touch gap-2 text-xs !bg-transparent border border-dashed border-fg/15 text-fg-muted" @click="addPalette('dark')">
          <Icon icon="mdi:plus" width="16" height="16" />
          <span>Dark palette</span>
        </button>
        <button class="btn-touch gap-2 text-xs !bg-transparent border border-dashed border-fg/15 text-fg-muted" @click="addPalette('light')">
          <Icon icon="mdi:plus" width="16" height="16" />
          <span>Light palette</span>
        </button>
      </div>
    </SettingsSection>

    <SettingsModal :open="showTransfer" title="Import / export palettes" size="md" @close="showTransfer = false; importError = ''">
      <div class="flex flex-col gap-4">
        <button class="btn-touch gap-2 text-sm" :disabled="!theme.customPalettes?.length" @click="copyExport">
          <Icon icon="mdi:content-copy" width="18" height="18" />
          <span>Copy all custom palettes</span>
        </button>
        <SettingsField label="Import" hint="Paste exported palette JSON. Palettes with the same ID are replaced.">
          <textarea
            v-model="importJson"
            rows="6"
            placeholder="Paste exported JSON here…"
            class="w-full rounded-lg bg-bg border border-fg/10 px-3 py-2 text-xs font-mono text-fg outline-none focus:border-accent/60 resize-y"
          />
        </SettingsField>
        <p v-if="importError" class="text-xs text-red-400">{{ importError }}</p>
      </div>
      <template #footer>
        <button class="btn-touch flex-1 text-sm font-semibold bg-accent !text-bg" :disabled="!importJson.trim()" @click="doImport">Import</button>
      </template>
    </SettingsModal>
  </div>
</template>
