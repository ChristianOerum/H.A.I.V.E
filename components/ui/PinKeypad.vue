<script setup lang="ts">
import { Icon } from '@iconify/vue'

const emit = defineEmits<{ close: [] }>()

const { verify } = useAuth()

const digits = ref('')
const shake = ref(false)
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
  digits.value += key
  // Auto-submit 300 ms after the last keypress
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(submit, 400)
}

const display = computed(() => '●'.repeat(digits.value.length) || '')

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
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div
        class="bg-bg-panel border border-white/10 rounded-2xl p-8 w-96 shadow-2xl select-none"
        :class="shake ? 'animate-shake' : ''"
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-2 text-fg">
            <Icon icon="mdi:lock-outline" width="22" height="22" class="text-accent" />
            <span class="text-base font-semibold tracking-wide">Enter PIN</span>
          </div>
          <button class="text-fg-muted hover:text-fg transition-colors" @click="emit('close')">
            <Icon icon="mdi:close" width="20" height="20" />
          </button>
        </div>

        <!-- PIN display -->
        <div class="flex justify-center items-center h-14 mb-6 bg-bg rounded-xl border border-white/10">
          <span v-if="verifying" class="text-accent">
            <Icon icon="mdi:loading" width="24" height="24" class="animate-spin" />
          </span>
          <span v-else class="text-3xl tracking-[0.5em] text-accent font-mono min-w-[1ch] pl-[0.5em]">
            {{ display || '‎' }}
          </span>
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
         bg-white/5 hover:bg-white/10 active:bg-accent/20
         border border-white/10 transition-colors
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
.animate-shake {
  animation: shake 0.5s ease-in-out;
}
</style>
