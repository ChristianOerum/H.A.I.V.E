<script setup lang="ts">
/**
 * Renderless component — lives inside TresCanvas.
 * Handles saving and restoring the preferred camera view angle via
 * useCameraView(), bridging the Three.js camera context to the UI.
 */
import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const props = defineProps<{
  controls: ThreeOrbitControls | null
}>()

const { camera } = useTresContext()
const { registerSaveCallback, persistView } = useCameraView()

onMounted(() => {
  // Register the save callback so the UI button can trigger it.
  registerSaveCallback(() => {
    if (!camera.value) return
    const { x, y, z } = camera.value.position
    persistView([x, y, z])
  })
})
</script>

<template><!-- renderless --></template>
