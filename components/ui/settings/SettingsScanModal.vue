<script setup lang="ts">
import QRCode from 'qrcode'

/** Shows a QR code that opens the room scanner (pages/scan.vue) on a phone. */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

type Platform = 'android' | 'iphone'

const canvasRef = ref<HTMLCanvasElement | null>(null)
/** The address a phone can reach (not localhost or a .local name). */
const { origin, resolve: resolveOrigin } = useShareOrigin()
/** The server's HTTPS port (server/plugins/https.ts); iPhones need it for camera and motion access. */
const httpsPort = ref<number | null>(null)
const platform = ref<Platform>('android')
/** Already on a phone: a button is more use than a QR code. */
const onPhone = ref(false)

const httpsOrigin = computed(() =>
  origin.value && httpsPort.value ? `https://${new URL(origin.value).hostname}:${httpsPort.value}` : '',
)
const scanUrl = computed(() => {
  if (platform.value === 'iphone') return httpsOrigin.value ? `${httpsOrigin.value}/scan` : ''
  return origin.value ? `${origin.value}/scan` : ''
})
const needsFlag = computed(() => origin.value.startsWith('http:'))

onMounted(() => {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) platform.value = 'iphone'
  onPhone.value = matchMedia('(pointer: coarse) and (max-width: 640px)').matches
})

watch(() => props.open, async (open) => {
  if (!open) return
  origin.value = await resolveOrigin()
  try {
    httpsPort.value = (await $fetch<{ httpsPort?: number | null }>('/api/ip')).httpsPort ?? null
  } catch {
    httpsPort.value = null
  }
}, { immediate: true })

watch([() => props.open, scanUrl, canvasRef], async ([open]) => {
  if (!open) return
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
  <SettingsModal :open="open" title="Scan rooms with a phone" :subtitle="platform === 'iphone' ? 'iPhone, in Chrome or Safari' : 'Android + Chrome with ARCore'" @close="emit('close')">
    <div class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-fg/5 mb-4">
      <button
        v-for="p in (['android', 'iphone'] as const)"
        :key="p"
        class="h-9 rounded-lg text-sm font-medium"
        :class="platform === p ? 'bg-bg-elevated shadow-sm' : 'text-fg-muted'"
        @click="platform = p"
      >
        {{ p === 'android' ? 'Android' : 'iPhone' }}
      </button>
    </div>

    <p v-if="platform === 'iphone' && !httpsOrigin" class="text-sm leading-snug rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4">
      The server's HTTPS port isn't running, and an iPhone needs it for the camera. Restart HAIVE and check its log.
    </p>

    <template v-else>
      <div class="flex flex-col items-center gap-3">
        <a v-if="onPhone" :href="scanUrl" class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg w-full">Open the scanner</a>
        <canvas v-else ref="canvasRef" class="rounded-2xl bg-white" width="240" height="240" />
        <p class="text-xs text-fg-muted font-mono break-all text-center">{{ scanUrl }}</p>
      </div>

      <ol v-if="platform === 'android'" class="mt-4 flex flex-col gap-2 text-sm leading-snug list-decimal pl-5">
        <li v-if="needsFlag">
          AR needs a secure connection. In Chrome on the phone, open
          <span class="font-mono text-xs">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>,
          add <span class="font-mono text-xs">{{ origin }}</span>, set it to <b>Enabled</b> and relaunch Chrome.
          Only needed once.
        </li>
        <li>{{ onPhone ? 'Open the scanner' : 'Scan the QR code with the phone' }} and tap <b>Start scan</b>.</li>
        <li>Walk around each room and tap every corner on the floor. Mark doors and windows by tapping both sides.</li>
        <li>Send the scan. It shows up here, ready to import.</li>
      </ol>

      <ol v-else class="mt-4 flex flex-col gap-2 text-sm leading-snug list-decimal pl-5">
        <li>{{ onPhone ? 'Open the scanner' : 'Scan the QR code with the iPhone camera' }}.</li>
        <li>
          The browser warns that the connection isn't private, because HAIVE uses its own certificate.
          Tap <b>Show details</b>, then <b>Visit this website</b>.
        </li>
        <li>Enter how high you hold the phone, tap <b>Start scan</b> and allow camera and motion access.</li>
        <li>Aim the cross at each floor corner and tap. Use <b>Move</b> to walk to the next spot or room.</li>
        <li>Send the scan. It shows up here, ready to import.</li>
      </ol>
    </template>

    <p v-if="platform === 'iphone'" class="field-hint mt-4">
      iPhones can't do AR in the browser, so the scanner measures from the phone's tilt instead: less precise than
      Android, so check the sizes before saving.
      <template v-if="httpsOrigin">
        Camera won't start? Trust HAIVE's certificate once: open
        <span class="font-mono break-all">{{ origin }}/api/ssl/ca.crt</span> in Safari, install it under
        Settings → General → VPN &amp; Device Management, then turn it on under Settings → General → About → Certificate Trust Settings.
      </template>
    </p>
    <p v-else class="field-hint mt-4">
      Scan all rooms in one go: rooms scanned together line up with each other.
      Expect a few centimetres of drift per room and check the result before saving.
    </p>
  </SettingsModal>
</template>
