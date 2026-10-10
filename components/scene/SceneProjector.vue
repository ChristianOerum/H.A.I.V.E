<script setup lang="ts">
/**
 * Renderless component — lives inside TresCanvas.
 * After every rendered frame it projects all entity positions to screen coords
 * and publishes them via useMarkerOverlay() so SceneMarkerOverlay can
 * render HTML icons outside the Three.js context.
 *
 * Runs in the canvas loop's onAfterRender (not the global useRenderLoop):
 * OrbitControls applies its damped camera motion in onBeforeRender of that
 * same loop, and the global loop is a separate rAF with no ordering guarantee.
 * Projecting there used the previous frame's camera, so icons lagged while
 * dragging and then snapped into place. After render, the camera matrices are
 * exactly the ones the frame was drawn with.
 *
 * The callback fires every tick even when the on-demand renderer skipped the
 * frame, so it only re-projects when the camera, viewport or placements changed.
 */
import { Matrix4 } from 'three'

const layout = useLayoutStore()
const { setContext, project } = useMarkerOverlay()
const { sizes } = useTresContext()
const { onAfterRender } = useLoop()

const lastView = new Matrix4()
const lastProj = new Matrix4()
let lastW = 0
let lastH = 0
let placementsDirty = true
watch(() => layout.placements, () => { placementsDirty = true }, { deep: true })

onAfterRender(({ camera }) => {
  const w = sizes.width.value, h = sizes.height.value
  if (!camera || !w) return
  if (
    !placementsDirty && w === lastW && h === lastH &&
    camera.matrixWorld.equals(lastView) && camera.projectionMatrix.equals(lastProj)
  ) return
  placementsDirty = false
  lastW = w; lastH = h
  lastView.copy(camera.matrixWorld)
  lastProj.copy(camera.projectionMatrix)
  setContext(camera, w, h)
  project(layout.placements)
})
</script>

<template><!-- renderless --></template>
