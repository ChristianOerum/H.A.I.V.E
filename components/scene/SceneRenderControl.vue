<script setup lang="ts">
/**
 * Renderless component — lives inside TresCanvas. Keeps the main scene cheap
 * when nothing is happening:
 *  - static shadow maps: switches `shadowMap.autoUpdate` off and re-renders the
 *    maps only on the frame after a requestShadowUpdate() (see useShadowUpdates)
 *  - pauses the whole render loop while `sceneSuspended` is set, e.g. while a
 *    fullscreen 3D editor covers the scene with its own canvas
 */
import { useLoop } from '@tresjs/core'
import { setShadowUpdateNotifier, takeShadowUpdate, requestShadowUpdate } from '~/composables/useShadowUpdates'

const { renderer, invalidate } = useTresContext()
const { onBeforeRender, pause, resume, pauseRender, resumeRender } = useLoop()
const { sceneSuspended, settings } = useGraphicsQuality()

// Lights start casting again when leaving Potato quality; their maps need drawing.
watch(() => settings.value.shadows, () => requestShadowUpdate())

watch(renderer, (r) => {
  if (!r) return
  r.shadowMap.autoUpdate = false
  requestShadowUpdate()
}, { immediate: true })

setShadowUpdateNotifier(() => invalidate())
onUnmounted(() => setShadowUpdateNotifier(null))

onBeforeRender(({ renderer: r, invalidate: inv }) => {
  if (!r || !takeShadowUpdate()) return
  r.shadowMap.needsUpdate = true
  // A request can land after this tick's render already ran; make sure a
  // frame follows so the new maps are actually drawn.
  inv()
})

// pause() only stops the per-frame callbacks; pauseRender() also skips drawing.
watch(sceneSuspended, (suspended) => {
  if (suspended) {
    pause()
    pauseRender()
  } else {
    resume()
    resumeRender()
    invalidate()
  }
}, { immediate: true })
</script>

<template><!-- renderless --></template>
