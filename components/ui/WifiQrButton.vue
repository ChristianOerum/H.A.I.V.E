<script setup lang="ts">
import QRCode from 'qrcode'

type WifiCreds = {
  configured: true
  ssid: string
  password: string
  security: string
  hidden: boolean
} | { configured: false }

const open = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const creds = ref<Extract<WifiCreds, { configured: true }> | null>(null)
const showPassword = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// WiFi QR payload — escape per the de-facto spec used by Android/iOS scanners.
function escapeWifiField(value: string): string {
  return value.replace(/([\\;,":])/g, '\\$1')
}

function buildPayload(c: Extract<WifiCreds, { configured: true }>): string {
  const t = c.security && c.security.toUpperCase() !== 'NONE' ? c.security.toUpperCase() : 'nopass'
  const s = escapeWifiField(c.ssid)
  const p = c.security && c.security.toUpperCase() !== 'NONE' ? escapeWifiField(c.password) : ''
  const h = c.hidden ? 'true' : 'false'
  return `WIFI:T:${t};S:${s};P:${p};H:${h};;`
}

async function loadCreds() {
  if (creds.value) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<WifiCreds>('/api/wifi')
    if (!res.configured) {
      error.value = 'WiFi credentials are not configured on the server.'
      return
    }
    creds.value = res
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to load WiFi credentials'
  } finally {
    loading.value = false
  }
}

async function renderQr() {
  if (!creds.value || !canvasRef.value) return
  await QRCode.toCanvas(canvasRef.value, buildPayload(creds.value), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

async function openSheet() {
  open.value = true
  await loadCreds()
  await nextTick()
  await renderQr()
}

function close() {
  open.value = false
  showPassword.value = false
}

// Re-render if creds load after the sheet was already opened.
watch([creds, canvasRef], () => {
  if (open.value) renderQr()
})
</script>

<template>
  <div>
    <!-- Floating bottom-left button -->
    <button
      v-if="!open"
      class="absolute bottom-4 left-4 surface w-12 h-12 rounded-2xl flex items-center justify-center text-fg-muted active:bg-bg-elevated pointer-events-auto z-20"
      aria-label="Show WiFi QR code"
      title="WiFi"
      @click="openSheet"
    >
      <!-- Heroicons: wifi (outline) -->
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M1.5 8.25a12.75 12.75 0 0 1 21 0" />
        <path d="M5.25 11.25a9 9 0 0 1 13.5 0" />
        <path d="M9 14.25a5.25 5.25 0 0 1 6 0" />
        <circle cx="12" cy="17.25" r=".75" fill="currentColor" stroke="none" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="absolute inset-0 bg-black/30 z-10"
        @pointerdown="close"
      />
    </Transition>

    <div class="z-20">
      <BottomSheet :open="open" @close="close">
        <div class="flex flex-col items-center text-center gap-4">
          <div>
            <h2 class="text-lg font-semibold">Join the WiFi</h2>
            <p class="text-sm text-fg-muted">Point your phone camera at the code</p>
          </div>

          <div v-if="loading" class="text-fg-muted text-sm py-8">Loading…</div>
          <div v-else-if="error" class="text-red-400 text-sm py-8">{{ error }}</div>

          <template v-else-if="creds">
            <div class="bg-white p-3 rounded-xl">
              <canvas ref="canvasRef" class="block" />
            </div>

            <div class="w-full max-w-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <span class="text-fg-muted text-right">Network</span>
              <span class="text-left font-mono break-all">{{ creds.ssid }}</span>
              <span class="text-fg-muted text-right">Password</span>
              <span class="text-left font-mono break-all">
                <template v-if="creds.security.toUpperCase() === 'NONE'">—</template>
                <template v-else-if="showPassword">{{ creds.password }}</template>
                <template v-else>••••••••</template>
                <button
                  v-if="creds.security.toUpperCase() !== 'NONE'"
                  class="ml-2 px-2 py-1 -my-1 rounded-md text-xs text-accent active:bg-bg-elevated"
                  @click="showPassword = !showPassword"
                >{{ showPassword ? 'Hide' : 'Show' }}</button>
              </span>
              <span class="text-fg-muted text-right">Security</span>
              <span class="text-left font-mono">{{ creds.security }}</span>
            </div>

            
          </template>
        </div>
      </BottomSheet>
    </div>
  </div>
</template>
