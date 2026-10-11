<script setup lang="ts">
import QRCode from 'qrcode'

/** Shows a QR code that opens the AR room scanner (pages/scan.vue) on a phone. */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
/** The address a phone can reach (not localhost or a .local name). */
const { origin, resolve: resolveOrigin } = useShareOrigin()

const scanUrl = computed(() => (origin.value ? `${origin.value}/scan` : ''))
const needsFlag = computed(() => origin.value.startsWith('http:'))

watch(() => props.open, async (open) => {
  if (!open) return
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
}, { immediate: true })
</script>

<template>
  <SettingsModal :open="open" title="Scan rooms with a phone" subtitle="Android + Chrome with ARCore" @close="emit('close')">
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

    <p class="field-hint mt-4">
      Scan all rooms in one go: rooms scanned together line up with each other.
      Expect a few centimetres of drift per room and check the result before saving.
    </p>
  </SettingsModal>
</template>
