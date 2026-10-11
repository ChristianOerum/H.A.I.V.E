<script setup lang="ts">
import { Icon } from '@iconify/vue'
import changelog from '~/changelog.json'

const device = useDeviceConfig()
const entities = useEntitiesStore()
const toast = useToast()

const version = (changelog as { version: string }[])[0]?.version ?? '0.0.0'

// ── Address to hand to other screens (LAN IP instead of localhost / .local) ──
const { origin: shareUrl, resolve: resolveShareUrl } = useShareOrigin()
onMounted(resolveShareUrl)
function copyShareUrl() {
  navigator.clipboard.writeText(shareUrl.value)
    .then(() => toast.success('Address copied', 'mdi:clipboard-check-outline'))
    .catch(() => toast.error('Couldn’t access the clipboard'))
}

const connection = computed(() => {
  const source = device.config.value.haSource === 'supervisor'
    ? 'via the Home Assistant add-on'
    : device.config.value.haSource === 'manual'
      ? `direct to ${device.config.value.haUrl || 'Home Assistant'}`
      : 'not configured'
  switch (entities.status) {
    case 'connected': return { dot: 'bg-emerald-400', label: 'Connected', detail: `${source} · ${entities.list.length} entities` }
    case 'connecting': return { dot: 'bg-yellow-400 animate-pulse', label: 'Connecting…', detail: source }
    case 'disconnected': return { dot: 'bg-orange-400 animate-pulse', label: 'Reconnecting…', detail: source }
    case 'error': return { dot: 'bg-red-500', label: 'Offline', detail: entities.error || source }
    default: return { dot: 'bg-fg-muted', label: 'Not started', detail: source }
  }
})

// ── Factory reset ──
const confirmingReset = ref(false)
const resetting = ref(false)
async function doFactoryReset() {
  resetting.value = true
  try {
    await device.factoryReset()
    if (import.meta.client) location.reload()
  } catch {
    toast.error('Factory reset failed — is the server reachable?')
  } finally {
    resetting.value = false
    confirmingReset.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 px-1 py-1">
    <SettingsSection title="Home Assistant" card>
      <div class="flex items-start gap-3">
        <span class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" :class="connection.dot" />
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ connection.label }}</div>
          <div class="text-xs text-fg-muted break-words">{{ connection.detail }}</div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection title="Add another screen" hint="Every screen that opens this address shares the same floorplan, devices and theme.">
      <div class="flex items-center gap-2">
        <div class="field-input flex items-center font-mono text-xs select-all truncate">{{ shareUrl || '—' }}</div>
        <button class="btn-touch shrink-0 !px-3" :disabled="!shareUrl" aria-label="Copy address" @click="copyShareUrl">
          <Icon icon="mdi:content-copy" width="18" height="18" />
        </button>
      </div>
    </SettingsSection>

    <SettingsSection title="Security & guests" card>
      <div class="flex items-center gap-3">
        <Icon icon="mdi:lock-outline" width="20" height="20" class="text-fg-muted shrink-0" />
        <div class="flex-1 text-sm">Toolbar PIN</div>
        <span class="text-xs font-medium" :class="device.authEnabled.value ? 'text-accent' : 'text-fg-muted'">{{ device.authEnabled.value ? 'On' : 'Off' }}</span>
      </div>
      <div class="flex items-center gap-3">
        <Icon icon="mdi:wifi" width="20" height="20" class="text-fg-muted shrink-0" />
        <div class="flex-1 text-sm">Guest WiFi QR</div>
        <span class="text-xs font-medium truncate max-w-[50%]" :class="device.config.value.wifi.configured ? 'text-accent' : 'text-fg-muted'">
          {{ device.config.value.wifi.configured ? device.config.value.wifi.ssid : 'Off' }}
        </span>
      </div>
      <p class="field-hint">These are set on the setup screen. Use Factory reset below to change them.</p>
    </SettingsSection>

    <SettingsSection title="About" card>
      <div class="flex items-center justify-between text-sm">
        <span>HAIVE version</span>
        <span class="font-mono text-fg-muted">v{{ version }}</span>
      </div>
    </SettingsSection>

    <SettingsSection title="Danger zone">
      <button class="btn-touch gap-2 text-sm !bg-transparent border border-red-500/40 text-red-500 active:!bg-red-500/10" @click="confirmingReset = true">
        <Icon icon="mdi:restore-alert" width="18" height="18" />
        <span>Factory reset</span>
      </button>
      <p class="field-hint">Returns every screen to the setup screen. Your floorplan, furniture and devices are kept.</p>
    </SettingsSection>

    <SettingsModal :open="confirmingReset" title="Factory reset?" size="sm" @close="confirmingReset = false">
      <p class="text-sm text-fg-muted leading-relaxed">
        All screens go back to the setup screen and the PIN and WiFi settings are cleared.
        Your floorplan, furniture and device layout stay as they are.
      </p>
      <template #footer>
        <button class="btn-touch flex-1 text-sm" :disabled="resetting" @click="confirmingReset = false">Cancel</button>
        <button class="btn-touch flex-1 gap-2 text-sm font-semibold !bg-red-500 !text-white" :disabled="resetting" @click="doFactoryReset">
          <Icon v-if="resetting" icon="mdi:loading" class="animate-spin" width="18" height="18" />
          <span>{{ resetting ? 'Resetting…' : 'Reset' }}</span>
        </button>
      </template>
    </SettingsModal>
  </div>
</template>
