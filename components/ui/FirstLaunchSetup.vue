<script setup lang="ts">
import { Icon } from '@iconify/vue'

const emit = defineEmits<{ done: [] }>()

const { config, save } = useDeviceConfig()

const role = ref<'master' | 'slave'>(config.value.role ?? 'master')
const haUrl = ref(config.value.haUrl || 'http://homeassistant.local:8123')
const haToken = ref('')
const allowedLocalPrefixes = ref(
  (config.value.allowedLocalPrefixes ?? ['127.', '192.168.', '10.', '172.']).join(','),
)
const masterUrl = ref(config.value.masterUrl || '')

const saving = ref(false)
const error = ref('')

const canSubmit = computed(() => {
  if (saving.value) return false
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
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-bg text-fg p-4 overflow-auto">
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
