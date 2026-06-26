<script setup lang="ts">
/**
 * Renderless component — lives inside TresCanvas.
 * Handles saving and restoring the preferred camera view angle via
 * useCameraView(), bridging the Three.js camera context to the UI.
 * Also returns the camera to the saved view after 30 s of inactivity.
 */
import { Vector3 } from 'three'

const IDLE_TIMEOUT_MS = 30_000
const LERP_ALPHA = 0.015   // smoothness per frame
const SNAP_DISTANCE = 0.01 // snap threshold in world units

const { camera, renderer } = useTresContext()
const { registerSaveCallback, persistView, savedView, isReturning } = useCameraView()

let idleTimer: ReturnType<typeof setTimeout> | null = null
const _target = new Vector3()

function scheduleReturn() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (savedView.value) isReturning.value = true
  }, IDLE_TIMEOUT_MS)
}

function onUserInteraction() {
  isReturning.value = false
  scheduleReturn()
}

onMounted(() => {
  registerSaveCallback(() => {
    if (!camera.value) return
    const { x, y, z } = camera.value.position
    persistView([x, y, z])
    onUserInteraction()
  })

  const canvas = renderer.value?.domElement
  if (canvas) {
    canvas.addEventListener('pointerdown', onUserInteraction)
    canvas.addEventListener('wheel', onUserInteraction, { passive: true })
  }

  scheduleReturn()
})

onUnmounted(() => {
  if (idleTimer) clearTimeout(idleTimer)
  const canvas = renderer.value?.domElement
  if (canvas) {
    canvas.removeEventListener('pointerdown', onUserInteraction)
    canvas.removeEventListener('wheel', onUserInteraction)
  }
})

// Smooth return animation — runs every frame when active.
const { onLoop } = useRenderLoop()

onLoop(() => {
  if (!isReturning.value || !savedView.value || !camera.value) return

  _target.set(...savedView.value.position)
  camera.value.position.lerp(_target, LERP_ALPHA)

  if (camera.value.position.distanceTo(_target) < SNAP_DISTANCE) {
    camera.value.position.copy(_target)
    isReturning.value = false
    scheduleReturn()
  }
})
</script>

<template><!-- renderless --></template>
