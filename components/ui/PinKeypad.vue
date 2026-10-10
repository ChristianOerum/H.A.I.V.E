<script setup lang="ts">
import { Icon } from '@iconify/vue'

const emit = defineEmits<{ close: [] }>()

const { verify } = useAuth()

const digits = ref('')
const shake = ref(false)
const wrong = ref(false)
const verifying = ref(false)
const MAX = 16 // safety cap

let debounceTimer: ReturnType<typeof setTimeout> | null = null

const submit = async () => {
  if (!digits.value || verifying.value) return
  verifying.value = true
  const ok = await verify(digits.value)
  verifying.value = false
  if (ok) {
    emit('close')
  } else {
    shake.value = true
    wrong.value = true
    digits.value = ''
    setTimeout(() => (shake.value = false), 600)
  }
}

const press = (key: string) => {
  if (verifying.value) return
  if (key === 'DEL') {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    digits.value = digits.value.slice(0, -1)
    return
  }
  if (digits.value.length >= MAX) return
  wrong.value = false
  digits.value += key
  // Auto-submit 300 ms after the last keypress
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(submit, 400)
}

// Always show at least 4 slots so the expected length is obvious, growing for longer PINs.
const slots = computed(() => Math.max(4, digits.value.length))

const onKey = (e: KeyboardEvent) => {
  if (e.key >= '0' && e.key <= '9') press(e.key)
  else if (e.key === 'Backspace') press('DEL')
  else if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (debounceTimer) clearTimeout(debounceTimer)
})

// Layout: 1-2-3 / 4-5-6 / 7-8-9 / [blank]-0-DEL
const keys = ['1','2','3','4','5','6','7','8','9','','0','DEL'] as const
</script>

<template>
  <!-- Backdrop -->
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      @click.self="emit('close')"
    >
      <div
        class="bg-bg-panel border border-fg/10 rounded-3xl p-6 sm:p-8 w-full max-w-sm shadow-2xl select-none animate-pop-in"
        :class="shake ? 'animate-shake' : ''"
        role="dialog"
        aria-modal="true"
        aria-label="Enter PIN"
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-2 text-fg">
            <Icon icon="mdi:lock-outline" width="22" height="22" class="text-accent" />
            <span class="text-base font-semibold tracking-wide">Enter PIN</span>
          </div>
          <button class="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-fg-muted active:bg-bg-elevated" aria-label="Close" @click="emit('close')">
            <Icon icon="mdi:close" width="20" height="20" />
          </button>
        </div>

        <!-- PIN display -->
        <div class="flex flex-col items-center justify-center h-16 mb-5">
          <Icon v-if="verifying" icon="mdi:loading" width="28" height="28" class="animate-spin text-accent" />
          <template v-else>
            <div class="flex gap-3">
              <span
                v-for="i in slots"
                :key="i"
                class="w-3.5 h-3.5 rounded-full transition-colors duration-100"
                :class="i <= digits.length ? 'bg-accent' : wrong ? 'bg-red-400/40' : 'bg-fg/15'"
              />
            </div>
            <span class="text-xs mt-3 h-4" :class="wrong ? 'text-red-400' : 'text-fg-muted'">
              {{ wrong ? 'Wrong PIN — try again' : 'Unlocks editing for 1 hour' }}
            </span>
          </template>
        </div>

        <!-- Keypad -->
        <div class="grid grid-cols-3 gap-3">
          <template v-for="key in keys" :key="key || 'blank'">
            <div v-if="key === ''" />
            <button
              v-else-if="key === 'DEL'"
              class="keypad-btn text-fg-muted"
              :disabled="verifying"
              @click="press('DEL')"
            >
              <Icon icon="mdi:backspace-outline" width="24" height="24" />
            </button>
            <button
              v-else
              class="keypad-btn text-fg font-medium text-2xl"
              :disabled="verifying"
              @click="press(key)"
            >
              {{ key }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.keypad-btn {
  @apply flex items-center justify-center rounded-xl
         bg-fg/5 active:bg-accent/25 active:scale-95
         border border-fg/10 transition
         disabled:opacity-40 disabled:cursor-not-allowed;
  height: 4.5rem;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-10px); }
  40%       { transform: translateX(10px); }
  60%       { transform: translateX(-7px); }
  80%       { transform: translateX(7px); }
}
/* Chained selector so the shake overrides the entrance animation on the same element */
.animate-pop-in.animate-shake {
  animation: shake 0.5s ease-in-out;
}

@keyframes fade-in { from { opacity: 0; } }
@keyframes pop-in { from { opacity: 0; transform: scale(0.95); } }
.animate-fade-in { animation: fade-in 0.15s ease-out; }
.animate-pop-in { animation: pop-in 0.18s ease-out; }
</style>
