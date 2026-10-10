<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { WifiSecurity } from '~/composables/useDeviceConfig'

const emit = defineEmits<{ done: [] }>()

const { config, supervised, save } = useDeviceConfig()

// ── Home Assistant (only asked for when not running as an add-on) ──
const haUrl = ref(config.value.haUrl || 'http://homeassistant.local:8123')
const haToken = ref('')
const showToken = ref(false)
const urlValid = computed(() => /^https?:\/\/\S+$/i.test(haUrl.value.trim()))

// ── Advanced ──
const showAdvanced = ref(false)
const allowedLocalPrefixes = ref(
  (config.value.allowedLocalPrefixes ?? ['127.', '192.168.', '10.', '172.']).join(','),
)

// ── PIN (optional) — off means the toolbar lock is disabled ──
const pinEnabled = ref(false)
const authPin = ref('')
const showPin = ref(false)
const pinValid = computed(() => {
  if (!pinEnabled.value) return true
  const v = authPin.value.trim()
  return v.length >= 4 && /^\d+$/.test(v)
})
// Only complain once the user has typed something.
const pinError = computed(() => pinEnabled.value && authPin.value.length > 0 && !pinValid.value)

// ── WiFi QR (optional) — off means the WiFi button stays hidden ──
const wifiEnabled = ref(!!config.value.wifi?.ssid)
const wifiSsid = ref(config.value.wifi?.ssid ?? '')
const wifiPassword = ref('')
const showWifiPassword = ref(false)
const wifiSecurity = ref<WifiSecurity>(config.value.wifi?.security ?? 'WPA')
const wifiHidden = ref(!!config.value.wifi?.hidden)
const wifiValid = computed(() => !wifiEnabled.value || !!wifiSsid.value.trim())

const SECURITY_OPTIONS: { value: WifiSecurity; label: string }[] = [
  { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
  { value: 'WEP', label: 'WEP' },
  { value: 'NONE', label: 'Open' },
]

const saving = ref(false)
const error = ref('')

const canSubmit = computed(() => {
  if (saving.value || !pinValid.value || !wifiValid.value) return false
  if (supervised.value) return true
  return urlValid.value && !!haToken.value.trim()
})

/** What's still missing, shown next to the disabled Finish button. */
const blocker = computed(() => {
  if (!supervised.value) {
    if (!urlValid.value) return 'Enter your Home Assistant address'
    if (!haToken.value.trim()) return 'Paste a long-lived access token'
  }
  if (!pinValid.value) return 'PIN needs at least 4 digits'
  if (!wifiValid.value) return 'Enter the WiFi network name'
  return ''
})

// The address other screens should open to join this dashboard. Resolved after
// mount because it comes from the browser's own location.
const shareUrl = ref('')
onMounted(() => { shareUrl.value = window.location.origin })

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  try {
    await save({
      haUrl: haUrl.value.trim(),
      haToken: haToken.value.trim(),
      allowedLocalPrefixes: allowedLocalPrefixes.value.trim(),
      authPin: pinEnabled.value ? authPin.value.trim() : '',
      wifi: {
        ssid: wifiEnabled.value ? wifiSsid.value.trim() : '',
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
  <div class="fixed inset-0 z-[100] bg-bg text-fg overflow-y-auto overscroll-contain">
    <form class="min-h-full flex flex-col" @submit.prevent="submit">
      <div class="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 pt-8 pb-6 flex flex-col gap-6">
        <!-- Header -->
        <header class="flex flex-col items-center gap-2 text-center">
          <div class="w-14 h-14 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
            <Icon icon="mdi:home-assistant" width="32" height="32" />
          </div>
          <span class="text-xs font-semibold tracking-[0.25em] text-accent">H.A.I.V.E.</span>
          <h1 class="text-2xl font-semibold">Welcome — let’s set up your home</h1>
          <p class="text-sm text-fg-muted max-w-xl leading-relaxed">
            You only do this once. Every other screen in the house opens the same address and is instantly in sync.
          </p>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 items-start">
          <!-- ── Left: connection ── -->
          <div class="flex flex-col gap-4">
            <section class="rounded-3xl bg-bg-panel border border-fg/10 p-5 flex flex-col gap-4">
              <div class="flex items-center gap-3">
                <span class="w-7 h-7 rounded-full bg-accent text-bg text-sm font-semibold flex items-center justify-center shrink-0">1</span>
                <h2 class="text-base font-semibold">Home Assistant</h2>
              </div>

              <!-- Add-on install: the Supervisor already provides the connection. -->
              <div v-if="supervised" class="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex gap-3">
                <Icon icon="mdi:check-circle" width="22" height="22" class="shrink-0 text-emerald-500 mt-0.5" />
                <div class="flex flex-col gap-0.5">
                  <span class="text-sm font-semibold">Connected automatically</span>
                  <p class="text-xs text-fg-muted leading-snug">
                    HAIVE runs as a Home Assistant add-on, so there’s no address or token to enter.
                  </p>
                </div>
              </div>

              <template v-else>
                <SettingsField label="Address" hint="Usually http://homeassistant.local:8123 or your server’s IP with :8123.">
                  <input
                    v-model="haUrl"
                    type="url"
                    inputmode="url"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="http://homeassistant.local:8123"
                    class="field-input h-12 text-base"
                    :class="haUrl && !urlValid ? '!border-red-400/70' : ''"
                  />
                </SettingsField>
                <SettingsField label="Long-lived access token" hint="In Home Assistant: your profile → Security → Long-lived access tokens → Create token. It stays on this server and is never sent to the screens.">
                  <div class="relative">
                    <textarea
                      v-if="showToken"
                      v-model="haToken"
                      rows="3"
                      spellcheck="false"
                      placeholder="Paste your token"
                      class="w-full resize-none rounded-lg bg-bg border border-fg/10 px-3 py-2.5 pr-12 text-xs font-mono text-fg outline-none focus:border-accent/60"
                    />
                    <input
                      v-else
                      v-model="haToken"
                      type="password"
                      autocomplete="off"
                      placeholder="Paste your token"
                      class="field-input h-12 pr-12 font-mono"
                    />
                    <button
                      type="button"
                      class="absolute right-1 top-1 w-10 h-10 flex items-center justify-center rounded-lg text-fg-muted active:bg-bg-elevated"
                      :aria-label="showToken ? 'Hide token' : 'Show token'"
                      @click="showToken = !showToken"
                    >
                      <Icon :icon="showToken ? 'mdi:eye-off-outline' : 'mdi:eye-outline'" width="20" height="20" />
                    </button>
                  </div>
                </SettingsField>
              </template>
            </section>

            <div v-if="shareUrl" class="rounded-2xl border border-dashed border-fg/15 p-4 flex gap-3">
              <Icon icon="mdi:monitor-multiple" width="22" height="22" class="shrink-0 text-accent mt-0.5" />
              <p class="text-xs text-fg-muted leading-relaxed">
                To add another screen, open <span class="font-mono font-medium text-fg">{{ shareUrl }}</span> on any tablet,
                phone or wall panel on your network. All screens share this layout, theme and settings.
              </p>
            </div>

            <!-- Advanced: rarely needed, so tucked away -->
            <div class="rounded-2xl border border-fg/10">
              <button
                type="button"
                class="w-full flex items-center gap-3 px-4 h-12 text-sm text-fg-muted"
                :aria-expanded="showAdvanced"
                @click="showAdvanced = !showAdvanced"
              >
                <Icon icon="mdi:tune-variant" width="18" height="18" />
                <span class="flex-1 text-left font-medium">Advanced</span>
                <Icon icon="mdi:chevron-down" width="20" height="20" class="transition-transform" :class="showAdvanced ? 'rotate-180' : ''" />
              </button>
              <div v-if="showAdvanced" class="px-4 pb-4">
                <SettingsField label="Allowed network addresses" hint="Comma-separated IP prefixes that may open this dashboard. The default covers normal home networks.">
                  <input v-model="allowedLocalPrefixes" type="text" spellcheck="false" placeholder="127.,192.168.,10.,172." class="field-input font-mono" />
                </SettingsField>
              </div>
            </div>
          </div>

          <!-- ── Right: optional extras ── -->
          <div class="flex flex-col gap-4">
            <!-- PIN -->
            <section class="rounded-3xl bg-bg-panel border border-fg/10 p-5 flex flex-col gap-4">
              <div class="flex items-center gap-3">
                <span class="w-7 h-7 rounded-full bg-bg-elevated text-fg-muted text-sm font-semibold flex items-center justify-center shrink-0">2</span>
                <div class="flex-1 min-w-0">
                  <h2 class="text-base font-semibold">Lock settings with a PIN</h2>
                  <p class="text-xs text-fg-muted">Optional · stops guests changing the layout</p>
                </div>
                <ToggleSwitch :on="pinEnabled" label="Lock settings with a PIN" @toggle="pinEnabled = !pinEnabled" />
              </div>
              <SettingsField v-if="pinEnabled" label="PIN" :hint="pinError ? undefined : 'At least 4 digits. Device controls stay usable without it.'">
                <div class="relative">
                  <input
                    v-model="authPin"
                    :type="showPin ? 'text' : 'password'"
                    inputmode="numeric"
                    autocomplete="new-password"
                    placeholder="e.g. 4821"
                    class="field-input h-12 pr-12 text-lg tracking-[0.3em] font-mono"
                    :class="pinError ? '!border-red-400/70' : ''"
                  />
                  <button
                    type="button"
                    class="absolute right-1 top-1 w-10 h-10 flex items-center justify-center rounded-lg text-fg-muted active:bg-bg-elevated"
                    :aria-label="showPin ? 'Hide PIN' : 'Show PIN'"
                    @click="showPin = !showPin"
                  >
                    <Icon :icon="showPin ? 'mdi:eye-off-outline' : 'mdi:eye-outline'" width="20" height="20" />
                  </button>
                </div>
                <p v-if="pinError" class="text-xs text-red-500">Use at least 4 digits, numbers only.</p>
              </SettingsField>
            </section>

            <!-- WiFi -->
            <section class="rounded-3xl bg-bg-panel border border-fg/10 p-5 flex flex-col gap-4">
              <div class="flex items-center gap-3">
                <span class="w-7 h-7 rounded-full bg-bg-elevated text-fg-muted text-sm font-semibold flex items-center justify-center shrink-0">3</span>
                <div class="flex-1 min-w-0">
                  <h2 class="text-base font-semibold">Guest WiFi QR code</h2>
                  <p class="text-xs text-fg-muted">Optional · guests scan it to join your WiFi</p>
                </div>
                <ToggleSwitch :on="wifiEnabled" label="Guest WiFi QR code" @toggle="wifiEnabled = !wifiEnabled" />
              </div>
              <template v-if="wifiEnabled">
                <SettingsField label="Network name">
                  <input v-model="wifiSsid" type="text" autocomplete="off" spellcheck="false" placeholder="Your WiFi name (SSID)" class="field-input h-12" />
                </SettingsField>
                <SettingsField label="Security">
                  <div class="segmented compact">
                    <button
                      v-for="o in SECURITY_OPTIONS"
                      :key="o.value"
                      type="button"
                      :aria-pressed="wifiSecurity === o.value"
                      @click="wifiSecurity = o.value"
                    >{{ o.label }}</button>
                  </div>
                </SettingsField>
                <SettingsField v-if="wifiSecurity !== 'NONE'" label="Password">
                  <div class="relative">
                    <input
                      v-model="wifiPassword"
                      :type="showWifiPassword ? 'text' : 'password'"
                      autocomplete="new-password"
                      placeholder="WiFi password"
                      class="field-input h-12 pr-12"
                    />
                    <button
                      type="button"
                      class="absolute right-1 top-1 w-10 h-10 flex items-center justify-center rounded-lg text-fg-muted active:bg-bg-elevated"
                      :aria-label="showWifiPassword ? 'Hide password' : 'Show password'"
                      @click="showWifiPassword = !showWifiPassword"
                    >
                      <Icon :icon="showWifiPassword ? 'mdi:eye-off-outline' : 'mdi:eye-outline'" width="20" height="20" />
                    </button>
                  </div>
                </SettingsField>
                <div class="flex items-center gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium">Hidden network</div>
                    <div class="field-hint">Turn on if your WiFi doesn’t broadcast its name.</div>
                  </div>
                  <ToggleSwitch :on="wifiHidden" label="Hidden network" @toggle="wifiHidden = !wifiHidden" />
                </div>
              </template>
            </section>
          </div>
        </div>
      </div>

      <!-- Footer: always visible -->
      <div class="sticky bottom-0 bg-bg/95 border-t border-fg/10">
        <div class="max-w-5xl mx-auto px-4 sm:px-8 py-3 flex items-center gap-4">
          <div class="flex-1 min-w-0 text-sm">
            <p v-if="error" class="flex items-center gap-2 text-red-500">
              <Icon icon="mdi:alert-circle-outline" width="18" height="18" class="shrink-0" />
              <span class="truncate">{{ error }}</span>
            </p>
            <p v-else-if="blocker" class="text-fg-muted truncate">{{ blocker }}</p>
            <p v-else class="text-fg-muted truncate">You can change these later with Factory reset in Settings.</p>
          </div>
          <button type="submit" class="btn-touch shrink-0 gap-2 h-12 px-8 text-base font-semibold bg-accent !text-bg" :disabled="!canSubmit">
            <Icon v-if="saving" icon="mdi:loading" class="animate-spin" width="20" height="20" />
            <span>{{ saving ? 'Saving…' : 'Finish setup' }}</span>
            <Icon v-if="!saving" icon="mdi:arrow-right" width="20" height="20" />
          </button>
        </div>
      </div>
    </form>
  </div>
</template>
