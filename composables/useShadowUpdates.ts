/**
 * Static shadow maps for the main scene.
 *
 * Nothing that casts shadows animates (walls, sills, the spill blockers, and
 * lights that only move when edited), so the renderer's shadow maps are drawn
 * once and then reused: SceneRenderControl turns `shadowMap.autoUpdate` off and
 * re-renders them only after someone calls `requestShadowUpdate()`. Each point
 * light shadow is six depth renders, so redrawing them every frame was the
 * single biggest GPU cost on Pi-class hardware.
 *
 * Call it whenever a shadow caster or a shadow-casting light is added, removed,
 * moved, resized, or changes its castShadow flag.
 */

let pending = true
let notify: (() => void) | null = null

export function requestShadowUpdate() {
  pending = true
  notify?.()
}

/** Internal: SceneRenderControl consumes the pending flag once per frame. */
export function takeShadowUpdate(): boolean {
  const p = pending
  pending = false
  return p
}

/** Internal: lets SceneRenderControl request a frame when an update is queued. */
export function setShadowUpdateNotifier(fn: (() => void) | null) {
  notify = fn
}
