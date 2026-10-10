<script setup lang="ts">
import { Icon } from '@iconify/vue'

const entities = useEntitiesStore()
const { start, isMock } = useHomeAssistant()
const device = useDeviceConfig()

// Don't flash the card for a connection that completes almost instantly.
const SHOW_DELAY_MS = 700
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const problem = computed(() => !isMock() && entities.status !== 'connected' && entities.status !== 'idle')
watch(problem, (p) => {
  if (timer) { clearTimeout(timer); timer = null }
  if (p) timer = setTimeout(() => { visible.value = true }, SHOW_DELAY_MS)
  else visible.value = false
}, { immediate: true })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

// "Not connected" is a configuration problem, not a network blip — retrying won't help.
const notConfigured = computed(() => entities.error === 'Home Assistant is not connected')

const copy = computed(() => {
  if (notConfigured.value) {
    return {
      icon: 'mdi:home-alert-outline',
      title: 'Home Assistant isn’t set up',
      body: device.supervised.value
        ? 'The add-on couldn’t get credentials from the Supervisor. Restart the add-on from Home Assistant.'
        : 'Run Factory Reset from Settings → System to enter your Home Assistant URL and token.',
    }
  }
  switch (entities.status) {
    case 'connecting':
      return { icon: 'mdi:loading', title: 'Connecting to Home Assistant…', body: '' }
    case 'disconnected':
      return { icon: 'mdi:loading', title: 'Connection lost', body: 'Reconnecting automatically…' }
    default:
      return {
        icon: 'mdi:lan-disconnect',
        title: 'Can’t reach Home Assistant',
        body: 'Retrying every few seconds.',
      }
  }
})

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try { await start() } catch { /* status/error surfaced via store */ } finally { retrying.value = false }
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 scale-95"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible"
      class="absolute inset-0 z-30 flex items-center justify-center p-6 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div class="surface pointer-events-auto rounded-3xl px-8 py-7 max-w-sm w-full text-center flex flex-col items-center gap-3">
        <Icon
          :icon="copy.icon"
          width="40"
          height="40"
          :class="copy.icon === 'mdi:loading' ? 'animate-spin text-accent' : 'text-orange-400'"
        />
        <h2 class="text-lg font-semibold">{{ copy.title }}</h2>
        <p v-if="copy.body" class="text-sm text-fg-muted leading-snug">{{ copy.body }}</p>
        <p
          v-if="entities.error && !notConfigured && entities.status === 'error'"
          class="text-xs font-mono text-fg-muted/80 break-words max-w-full"
        >{{ entities.error }}</p>
        <button
          v-if="entities.status === 'error' && !notConfigured"
          class="btn-touch mt-1 gap-2 text-sm"
          :disabled="retrying"
          @click="retry"
        >
          <Icon icon="mdi:refresh" width="18" height="18" :class="retrying ? 'animate-spin' : ''" />
          <span>Retry now</span>
        </button>
      </div>
    </div>
  </Transition>
</template>
