/**
 * Shared singleton that maps entity_id → 2D screen position.
 *
 * Writer: SceneProjector.vue (inside TresCanvas) calls setContext() + project()
 *         every render frame via useRenderLoop().
 * Reader: SceneMarkerOverlay.vue (outside TresCanvas) reads `positions`.
 */
import { Vector3 } from 'three'
import type { Camera } from 'three'
import type { DevicePlacement } from '~/stores/layout'

export interface MarkerScreenPos {
  x: number
  y: number
  /** false when the point is behind the camera */
  visible: boolean
}

// Module-level singletons — safe because this only runs on the client.
const positions = ref<Record<string, MarkerScreenPos>>({})
const _v = new Vector3()
let _cam: Camera | null = null
let _w = 0
let _h = 0

export function useMarkerOverlay() {
  /** Called from inside TresCanvas each frame to supply the live camera + viewport size. */
  function setContext(cam: Camera, width: number, height: number) {
    _cam = cam
    _w = width
    _h = height
  }

  /** Projects all placements to screen-space and writes into `positions`. */
  function project(placements: DevicePlacement[]) {
    if (!_cam || !_w) return
    const next: Record<string, MarkerScreenPos> = {}
    for (const p of placements) {
      _v.set(p.position[0], p.position[1], p.position[2])
      _v.project(_cam)
      // NDC → screen: x: [-1,1]→[0,w], y: [1,-1]→[0,h]
      next[p.entity_id] = {
        x: (_v.x * 0.5 + 0.5) * _w,
        y: (-_v.y * 0.5 + 0.5) * _h,
        visible: _v.z < 1,
      }
    }
    positions.value = next
  }

  return { positions: readonly(positions), setContext, project }
}
