<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { WifiSecurity } from '~/composables/useDeviceConfig'

const emit = defineEmits<{ done: [] }>()

const { config, save } = useDeviceConfig()

const role = ref<'master' | 'slave'>(config.value.role ?? 'master')
const haUrl = ref(config.value.haUrl || 'http://homeassistant.local:8123')
const haToken = ref('')
const allowedLocalPrefixes = ref(
  (config.value.allowedLocalPrefixes ?? ['127.', '192.168.', '10.', '172.']).join(','),
)
const masterUrl = ref(config.value.masterUrl || '')

// PIN (optional) — empty means the toolbar lock is disabled.
const authPin = ref('')

// WiFi (optional) — empty ssid means the WiFi QR button stays hidden.
const wifiSsid = ref(config.value.wifi?.ssid ?? '')
const wifiPassword = ref('')
const wifiSecurity = ref<WifiSecurity>(config.value.wifi?.security ?? 'WPA')
const wifiHidden = ref(!!config.value.wifi?.hidden)

const saving = ref(false)
const error = ref('')

const pinValid = computed(() => {
  const v = authPin.value.trim()
  return v.length === 0 || (v.length >= 4 && /^\d+$/.test(v))
})

const canSubmit = computed(() => {
  if (saving.value) return false
  if (!pinValid.value) return false
  if (role.value === 'master') return !!haUrl.value.trim() && !!haToken.value.trim()
  return /^https?:\/\/.+/i.test(masterUrl.value.trim())
})

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  try {
    await save({
      role: role.value,
      haUrl: haUrl.value.trim(),
      haToken: haToken.value.trim(),
      allowedLocalPrefixes: allowedLocalPrefixes.value.trim(),
      masterUrl: masterUrl.value.trim(),
      authPin: authPin.value.trim(),
      wifi: {
        ssid: wifiSsid.value.trim(),
        password: wifiPassword.value,
        security: wifiSecurity.value,
        hidden: wifiHidden.value,
      },
    })
    emit('done')
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string; message?: string }
    error.value = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Failed to save configuration'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-bg text-fg p-4 overflow-auto"
    :style="{
      '--bg': '243 238 226',
      '--bg-panel': '248 245 238',
      '--bg-elevated': '229 222 207',
      '--fg': '41 37 36',
      '--fg-muted': '120 113 108',
    }"
  >
    <div class="w-full max-w-lg flex flex-col gap-6 bg-bg-panel rounded-3xl p-6 sm:p-8 shadow-2xl">
      <!-- Header -->
      <div class="flex flex-col items-center gap-2 text-center">
        <div class="flex items-center gap-2">
          <Icon icon="mdi:home-assistant" width="28" height="28" class="text-accent" />
          <span class="text-lg font-semibold tracking-[0.2em] text-accent">H.A.I.V.E.</span>
        </div>
        <h1 class="text-xl font-semibold">Welcome — let's set up this screen</h1>
        <p class="text-sm text-fg-muted">
          This runs once. Choose whether this device hosts the data (Master) or mirrors another (Slave).
        </p>
      </div>

      <!-- Role selector -->
      <div class="grid grid-cols-2 gap-3">
        <button
          type="button"
          class="flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors"
          :class="role === 'master' ? 'border-accent bg-accent/10' : 'border-bg-elevated hover:border-fg-muted'"
          @click="role = 'master'"
        >
          <Icon icon="mdi:server-network" width="22" height="22" :class="role === 'master' ? 'text-accent' : 'text-fg-muted'" />
          <span class="text-sm font-semibold">Master</span>
          <span class="text-[11px] text-fg-muted leading-snug">Hosts the server and connects to Home Assistant.</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors"
          :class="role === 'slave' ? 'border-accent bg-accent/10' : 'border-bg-elevated hover:border-fg-muted'"
          @click="role = 'slave'"
        >
          <Icon icon="mdi:monitor-multiple" width="22" height="22" :class="role === 'slave' ? 'text-accent' : 'text-fg-muted'" />
          <span class="text-sm font-semibold">Slave</span>
          <span class="text-[11px] text-fg-muted leading-snug">Mirrors a Master so screens stay in sync.</span>
        </button>
      </div>

      <!-- Master fields -->
      <div v-if="role === 'master'" class="flex flex-col gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] text-fg-muted uppercase tracking-wide">Home Assistant URL</span>
          <input
            v-model="haUrl"
            type="url"
            inputmode="url"
            placeholder="http://homeassistant.local:8123"
            class="w-full rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] text-fg-muted uppercase tracking-wide">Long-Lived Access Token</span>
          <textarea
            v-model="haToken"
            rows="3"
            placeholder="Paste your HA long-lived access token"
            class="w-full resize-none rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-xs font-mono text-fg focus:outline-none focus:border-accent/60"
          />
          <span class="text-[11px] text-fg-muted">Home Assistant → Profile → Long-Lived Access Tokens.</span>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] text-fg-muted uppercase tracking-wide">Allowed Local Prefixes</span>
          <input
            v-model="allowedLocalPrefixes"
            type="text"
            placeholder="127.,192.168.,10.,172."
            class="w-full rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
          />
          <span class="text-[11px] text-fg-muted">Comma-separated IP prefixes permitted to reach the API.</span>
        </label>
      </div>

      <!-- Slave fields -->
      <div v-else class="flex flex-col gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] text-fg-muted uppercase tracking-wide">Master URL</span>
          <input
            v-model="masterUrl"
            type="url"
            inputmode="url"
            placeholder="http://192.168.1.50:3000"
            class="w-full rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
          />
          <span class="text-[11px] text-fg-muted">Address of the Master HAIVE server on your network.</span>
        </label>
        <p class="text-[11px] text-fg-muted leading-snug">
          Slaves inherit the toolbar PIN and WiFi QR credentials from the Master, so you only configure them once.
        </p>
      </div>

      <!-- Optional: toolbar PIN (Master only — Slaves inherit) -->
      <div v-if="role === 'master'" class="flex flex-col gap-4 pt-2 border-t border-bg-elevated">
        <div class="flex items-center gap-2">
          <Icon icon="mdi:lock-outline" width="18" height="18" class="text-fg-muted" />
          <span class="text-sm font-semibold">Toolbar PIN <span class="text-fg-muted font-normal">(optional)</span></span>
        </div>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] text-fg-muted uppercase tracking-wide">PIN</span>
          <input
            v-model="authPin"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            placeholder="Leave blank to disable lock"
            class="w-full rounded-xl border bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
            :class="pinValid ? 'border-bg-elevated' : 'border-red-400/70'"
          />
          <span v-if="!pinValid" class="text-[11px] text-red-500">PIN must be at least 4 digits.</span>
          <span v-else class="text-[11px] text-fg-muted">Locks the editor toolbar behind a numeric PIN.</span>
        </label>
      </div>

      <!-- Optional: WiFi QR credentials (Master only — Slaves inherit) -->
      <div v-if="role === 'master'" class="flex flex-col gap-4 pt-2 border-t border-bg-elevated">
        <div class="flex items-center gap-2">
          <Icon icon="mdi:wifi" width="18" height="18" class="text-fg-muted" />
          <span class="text-sm font-semibold">WiFi QR <span class="text-fg-muted font-normal">(optional)</span></span>
        </div>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] text-fg-muted uppercase tracking-wide">Network name (SSID)</span>
          <input
            v-model="wifiSsid"
            type="text"
            autocomplete="off"
            placeholder="Leave blank to hide the WiFi button"
            class="w-full rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
          />
        </label>
        <div v-if="wifiSsid.trim()" class="flex flex-col gap-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-[11px] text-fg-muted uppercase tracking-wide">Security</span>
            <select
              v-model="wifiSecurity"
              class="w-full rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
            >
              <option value="WPA">WPA / WPA2 / WPA3</option>
              <option value="WEP">WEP</option>
              <option value="NONE">None (open)</option>
            </select>
          </label>
          <label v-if="wifiSecurity !== 'NONE'" class="flex flex-col gap-1.5">
            <span class="text-[11px] text-fg-muted uppercase tracking-wide">Password</span>
            <input
              v-model="wifiPassword"
              type="password"
              autocomplete="new-password"
              placeholder="WiFi password"
              class="w-full rounded-xl border border-bg-elevated bg-bg px-3 py-2.5 text-sm text-fg focus:outline-none focus:border-accent/60"
            />
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              v-model="wifiHidden"
              type="checkbox"
              class="h-4 w-4 rounded border-bg-elevated text-accent focus:ring-accent/40"
            />
            <span>Hidden network</span>
          </label>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-400 text-center">{{ error }}</p>

      <!-- Submit -->
      <button
        type="button"
        class="w-full btn-touch text-sm font-semibold rounded-xl transition-colors"
        :class="canSubmit ? 'bg-accent text-bg-panel' : 'opacity-40 cursor-not-allowed bg-bg-elevated text-fg'"
        :disabled="!canSubmit"
        @click="submit"
      >
        <Icon v-if="saving" icon="mdi:loading" class="animate-spin" width="18" height="18" />
        <span>{{ saving ? 'Saving…' : 'Finish setup' }}</span>
      </button>
    </div>
  </div>
</template>
