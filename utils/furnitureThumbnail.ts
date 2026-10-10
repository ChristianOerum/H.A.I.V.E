/**
 * Still-image thumbnails for furniture presets, drawn by ONE shared offscreen
 * WebGL renderer.
 *
 * Each library card used to be a live TresCanvas — its own WebGL context
 * rendering at 60 fps. Browsers cap a page at ~16 contexts and drop the oldest
 * (the main 3D scene) past that, and even below the cap every card cost a full
 * render per frame. A preset never moves, so one render to an <img> is enough.
 *
 * Callers hold a lease (acquireThumbnailRenderer / release) so the context is
 * freed once no previews are on screen.
 */
import * as THREE from 'three'

let renderer: THREE.WebGLRenderer | null = null
let leases = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null

export function acquireThumbnailRenderer() {
  leases++
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null }
}

export function releaseThumbnailRenderer() {
  leases = Math.max(0, leases - 1)
  if (leases > 0 || !renderer) return
  // Grace period so closing and reopening the library doesn't churn contexts.
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (leases > 0 || !renderer) return
    renderer.dispose()
    renderer.forceContextLoss()
    renderer = null
  }, 5000)
}

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true })
    // Match TresCanvas defaults so thumbnails look like the old live previews.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
  }
  return renderer
}

/** Render `scene` from `camera` at the given CSS size and return a PNG data URL. */
export function renderThumbnail(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): string {
  const r = getRenderer()
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  r.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  r.render(scene, camera)
  // Read back in the same task, before the drawing buffer is cleared.
  return r.domElement.toDataURL('image/png')
}
