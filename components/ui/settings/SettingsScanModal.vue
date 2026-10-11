<script setup lang="ts">
import { Icon } from '@iconify/vue'
import QRCode from 'qrcode'
import { convertScan } from '~/utils/scanGeometry'
import { loadRoomModel, scanFromModel } from '~/utils/roomModelImport'

/**
 * Getting rooms from a scan. Mainly: import a Polycam GLTF/GLB export
 * (utils/roomModelImport.ts). Secondary: a QR code that opens the AR scanner
 * (pages/scan.vue) on an Android phone.
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const fp = useFloorplanStore()
const toast = useToast()

// ── Polycam import ──
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

async function importFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // so picking the same file again still fires
  if (!file) return
  busy.value = true
  error.value = null
  try {
    const root = await loadRoomModel(file)
    // Let the spinner paint before the heavy geometry work.
    await new Promise((r) => setTimeout(r, 30))
    const THREE = await import('three')
    const { scan } = scanFromModel(THREE, root)
    const result = convertScan(scan, fp.rooms)
    fp.importScannedRooms(result.rooms, result.openings)
    const n = result.rooms.length
    const openings = result.openings.length ? `, ${result.openings.length} door${result.openings.length === 1 ? '' : 's'}/windows` : ''
    toast.success(`Imported ${n} room${n === 1 ? '' : 's'}${openings}. Check and save.`, 'mdi:cube-scan')
    emit('close')
  } catch (err) {
    error.value = `Couldn't import ${file.name}: ${(err as Error)?.message ?? err}`
  } finally {
    busy.value = false
  }
}

// ── Android AR scanner ──
const showAndroid = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)
/** The address a phone can reach (not localhost or a .local name). */
const { origin, resolve: resolveOrigin } = useShareOrigin()
const scanUrl = computed(() => (origin.value ? `${origin.value}/scan` : ''))
const needsFlag = computed(() => origin.value.startsWith('http:'))

watch(() => props.open, (open) => {
  if (!open) return
  error.value = null
  showAndroid.value = false
})

watch([showAndroid, canvasRef], async ([show]) => {
  if (!show) return
  origin.value = await resolveOrigin()
  await nextTick()
  if (canvasRef.value && scanUrl.value) {
    await QRCode.toCanvas(canvasRef.value, scanUrl.value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    })
  }
})
</script>

<template>
  <SettingsModal
    :open="open"
    :title="showAndroid ? 'Scan with an Android phone' : 'Import a room scan'"
    :subtitle="showAndroid ? 'Android + Chrome with ARCore' : 'From the Polycam app'"
    @close="emit('close')"
  >
    <template v-if="!showAndroid">
      <ol class="flex flex-col gap-2 text-sm leading-snug list-decimal pl-5">
        <li>Scan your home in <b>Polycam</b>. <b>Room</b> mode (iPhone Pro with LiDAR) gives the cleanest walls, doors and windows; <b>Space</b> mode works too.</li>
        <li>Open the scan, tap <b>Export</b> and choose <b>GLTF</b>. It's available on the free plan. Save it to Files, or send it to the device you're using now.</li>
        <li>Choose the file below. HAIVE finds the rooms and adds them to the floorplan for you to check and save.</li>
      </ol>

      <!-- No accept filter: iOS greys out .glb files it doesn't recognise. -->
      <input ref="fileInput" type="file" class="hidden" @change="importFile" />
      <button
        class="btn-touch w-full mt-4 gap-2 text-sm font-semibold bg-accent !text-bg"
        :disabled="busy"
        @click="fileInput?.click()"
      >
        <Icon :icon="busy ? 'mdi:loading' : 'mdi:file-upload-outline'" :class="{ 'animate-spin': busy }" width="20" height="20" />
        {{ busy ? 'Reading the scan…' : 'Choose scan file' }}
      </button>
      <p v-if="error" class="mt-3 text-sm text-red-500 leading-snug">{{ error }}</p>

      <p class="field-hint mt-4">
        Scan all rooms in one go: rooms in the same file line up with each other.
        A separate file is placed next to the existing plan. Accepts .glb, .gltf and .zip.
      </p>

      <button class="mt-3 text-xs text-fg-muted underline" @click="showAndroid = true">
        Android phone with ARCore? Scan with AR instead
      </button>
    </template>

    <template v-else>
      <div class="flex flex-col items-center gap-3">
        <canvas ref="canvasRef" class="rounded-2xl bg-white" width="240" height="240" />
        <p class="text-xs text-fg-muted font-mono break-all text-center">{{ scanUrl }}</p>
      </div>

      <ol class="mt-4 flex flex-col gap-2 text-sm leading-snug list-decimal pl-5">
        <li v-if="needsFlag">
          AR needs a secure connection. In Chrome on the phone, open
          <span class="font-mono text-xs">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>,
          add <span class="font-mono text-xs">{{ origin }}</span>, set it to <b>Enabled</b> and relaunch Chrome.
          Only needed once.
        </li>
        <li>Scan the QR code with the phone and tap <b>Start scan</b>.</li>
        <li>Walk around each room and tap every corner on the floor. Mark doors and windows by tapping both sides.</li>
        <li>Send the scan. It shows up here, ready to import.</li>
      </ol>

      <button class="mt-4 text-xs text-fg-muted underline" @click="showAndroid = false">
        Back to importing a Polycam scan
      </button>
    </template>
  </SettingsModal>
</template>
