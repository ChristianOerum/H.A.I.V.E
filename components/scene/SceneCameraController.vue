<script setup lang="ts">
/**
 * Renderless component — lives inside TresCanvas.
 * Handles saving and restoring the preferred camera view angle via
 * useCameraView(), bridging the Three.js camera context to the UI.
 * Also returns the camera to the saved view after 30 s of inactivity, and
 * keeps two-finger panning of the orbit target within the floorplan — the
 * idle return brings a panned target back to the floorplan centre too.
 */
import { Vector3, type PerspectiveCamera } from 'three'

const IDLE_TIMEOUT_MS = 30_000
const LERP_ALPHA = 0.015   // smoothness per 60 Hz frame
const SNAP_DISTANCE = 0.01 // snap threshold in world units
const PAN_MARGIN = 2       // metres the orbit target may be panned past the floorplan
const PAN_MAX_HEIGHT = 4   // metres the orbit target may be panned above the floor

const fp = useFloorplanStore()
const { camera, renderer, controls, sizes, invalidate } = useTresContext()
const { registerSaveCallback, persistView, savedView, isReturning } = useCameraView()

// Portrait screens (phones): a fixed vertical FOV leaves a sliver of a
// horizontal view, so widen it until the horizontal FOV matches what a square
// screen gets, up to a limit where the perspective starts to look distorted.
const BASE_FOV = 45 // matches the TresPerspectiveCamera in SceneRoot
const MAX_PORTRAIT_FOV = 80
const DEG = Math.PI / 180

// The settings panel covers part of the canvas: the right edge (side panel) or
// the bottom (phone sheet). Shift the projection by half of that so the
// floorplan stays centred in the visible area. Raycasts and marker projection go through the
// projection matrix, so they follow automatically.
const { inset: sheetInset, right: panelRight } = useEditorSheet()
// Explicit sources and the raw camera: the camera ref is deeply reactive, so a
// watchEffect would track the very properties it writes and loop.
watch([camera, sizes.width, sizes.height, sheetInset, panelRight], ([camRef, w, h]) => {
  const cam = toRaw(camRef) as PerspectiveCamera | undefined
  if (!cam?.isPerspectiveCamera) return
  const aspect = w && h ? w / h : 1
  cam.fov = aspect >= 1
    ? BASE_FOV
    : Math.min(MAX_PORTRAIT_FOV, 2 * Math.atan(Math.tan((BASE_FOV / 2) * DEG) / aspect) / DEG)
  if ((sheetInset.value > 0 || panelRight.value > 0) && w && h)
    cam.setViewOffset(w, h, panelRight.value / 2, sheetInset.value / 2, w, h)
  else cam.clearViewOffset() // both update the projection matrix
  invalidate()
}, { immediate: true })

let idleTimer: ReturnType<typeof setTimeout> | null = null
const _target = new Vector3()
const _homeTarget = new Vector3()
const _clamped = new Vector3()

/** Camera position of the standard view: the saved one, else the default SceneRoot starts at. */
const homePosition = computed<[number, number, number]>(() =>
  savedView.value ? savedView.value.position : [fp.center[0], 14, fp.center[1] + 12],
)

/** Floorplan AABB (plus margin) the orbit target is kept inside while panning. */
const panBounds = computed(() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const room of fp.rooms) {
    for (const [x, z] of room.vertices) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
  }
  if (!isFinite(minX)) {
    const [cx, cz] = fp.center
    return { minX: cx - 10, maxX: cx + 10, minZ: cz - 10, maxZ: cz + 10 }
  }
  return { minX: minX - PAN_MARGIN, maxX: maxX + PAN_MARGIN, minZ: minZ - PAN_MARGIN, maxZ: maxZ + PAN_MARGIN }
})

/** The OrbitControls target (SceneRoot registers the controls as default). */
function orbitTarget(): Vector3 | null {
  return (controls.value as { target?: Vector3 } | null)?.target ?? null
}

function isPanned() {
  const target = orbitTarget()
  return !!target && target.distanceTo(_homeTarget.set(fp.center[0], 0, fp.center[1])) > SNAP_DISTANCE
}

function scheduleReturn() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (savedView.value || isPanned()) isReturning.value = true
  }, IDLE_TIMEOUT_MS)
}

/** Pull a panned-out target back inside the bounds, moving the camera along so the view doesn't twist. */
function clampPan(target: Vector3) {
  const b = panBounds.value
  _clamped.set(
    Math.min(Math.max(target.x, b.minX), b.maxX),
    Math.min(Math.max(target.y, 0), PAN_MAX_HEIGHT),
    Math.min(Math.max(target.z, b.minZ), b.maxZ),
  )
  if (_clamped.equals(target)) return
  _clamped.sub(target)
  target.add(_clamped)
  camera.value?.position.add(_clamped)
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
    canvas.addEventListener('wheel', onUserInteraction, { passive: true })
  }

  document.addEventListener('pointerdown', onUserInteraction, { capture: true })

  scheduleReturn()
})

onUnmounted(() => {
  if (idleTimer) clearTimeout(idleTimer)
  const canvas = renderer.value?.domElement
  if (canvas) {
    canvas.removeEventListener('wheel', onUserInteraction)
  }
  document.removeEventListener('pointerdown', onUserInteraction, { capture: true })
})

// Smooth return animation — runs every frame when active. Uses the canvas loop
// so it can request frames (the scene renders on demand).
const { onBeforeRender } = useLoop()

onBeforeRender(({ delta, invalidate }) => {
  const orbit = orbitTarget()
  if (orbit && !isReturning.value) clampPan(orbit)

  if (!isReturning.value || !camera.value) return

  _target.set(...homePosition.value)
  _homeTarget.set(fp.center[0], 0, fp.center[1])
  // LERP_ALPHA is tuned per 60 Hz frame; scale it so the return takes the
  // same time on a device that renders slower.
  const alpha = 1 - Math.pow(1 - LERP_ALPHA, Math.min(delta, 0.1) * 60)
  camera.value.position.lerp(_target, alpha)
  orbit?.lerp(_homeTarget, alpha)
  invalidate()

  if (
    camera.value.position.distanceTo(_target) < SNAP_DISTANCE
    && (!orbit || orbit.distanceTo(_homeTarget) < SNAP_DISTANCE)
  ) {
    camera.value.position.copy(_target)
    orbit?.copy(_homeTarget)
    isReturning.value = false
    scheduleReturn()
  }
})
</script>

<template><!-- renderless --></template>
