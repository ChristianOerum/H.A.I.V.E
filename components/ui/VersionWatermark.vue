<script setup lang="ts">
// Version watermark shown at the bottom of the main screen. It renders the
// current release version (imported from changelog.json, baked into the build)
// as a faint, low-opacity mark. Tapping it opens the full changelog history.
import changelog from '~/changelog.json'

type Release = {
  version: string
  date: string
  changes: string[]
}

const history = changelog as Release[]
const version = history[0]?.version ?? '0.0.0'

const open = ref(false)
</script>

<template>
  <div>
    <!-- Faint watermark, centered at the bottom of the screen -->
    <button
      class="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-20 pointer-events-auto
             text-[11px] font-mono tracking-wide text-fg opacity-30 hover:opacity-70
             transition-opacity duration-200 select-none"
      :title="`HAIVE v${version} — tap for changelog`"
      aria-label="Show version history"
      @click="open = true"
    >
      v{{ version }}
    </button>

    <!-- Changelog history modal -->
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
        class="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4 pointer-events-auto"
        @pointerdown.self="open = false"
      >
        <div class="w-full max-w-md max-h-[80vh] flex flex-col bg-bg-panel rounded-2xl shadow-2xl overflow-hidden">
          <div class="flex items-center justify-between px-5 py-4 border-b border-bg-elevated">
            <div>
              <h2 class="text-lg font-semibold text-fg">Changelog</h2>
              <p class="text-xs text-fg-muted">Currently running v{{ version }}</p>
            </div>
            <button
              class="btn-touch !px-3 text-sm"
              aria-label="Close"
              @click="open = false"
            >✕</button>
          </div>

          <div class="overflow-y-auto px-5 py-4 space-y-5">
            <div v-for="release in history" :key="release.version" class="text-sm">
              <div class="flex items-baseline gap-2 mb-1.5">
                <span class="font-mono font-semibold text-accent">v{{ release.version }}</span>
                <span class="text-xs text-fg-muted">{{ release.date }}</span>
              </div>
              <ul class="list-disc pl-5 space-y-1 text-fg/90">
                <li v-for="(change, i) in release.changes" :key="i">{{ change }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
