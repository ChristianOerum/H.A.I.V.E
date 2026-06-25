<script setup lang="ts">
/**
 * Renderless component — lives inside TresCanvas.
 * Every render frame it projects all entity positions to screen coords
 * and publishes them via useMarkerOverlay() so SceneMarkerOverlay can
 * render HTML icons outside the Three.js context.
 */
const layout = useLayoutStore()
const { setContext, project } = useMarkerOverlay()
const { camera, sizes } = useTresContext()
const { onLoop } = useRenderLoop()

onLoop(() => {
  if (camera.value && sizes.width.value) {
    setContext(camera.value, sizes.width.value, sizes.height.value)
    project(layout.placements)
  }
})
</script>

<template><!-- renderless --></template>
