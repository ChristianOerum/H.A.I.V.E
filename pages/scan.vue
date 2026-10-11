<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type * as THREE_NS from 'three'
import type { ScanResult } from '~/utils/scanGeometry'
import { convertScan } from '~/utils/scanGeometry'

/**
 * Phone AR room scanner (WebXR: Chrome on Android with ARCore).
 *
 * The user walks around and taps each room's floor corners, plus both sides of
 * every door and window. All rooms in one AR session share a coordinate frame,
 * so they line up with each other. The raw points are posted to /api/scan and
 * the floorplan editor turns them into rooms (utils/scanGeometry.ts).
 */

useHead({ title: 'H.A.I.V.E. · Room scan' })

type Pt3 = [number, number, number]
type Mode = 'corner' | 'door' | 'window'
type Phase = 'intro' | 'scanning' | 'review' | 'sent'
type Support = 'checking' | 'ok' | 'insecure' | 'no-xr' | 'no-ar'
type Action = 'corner' | 'start' | 'opening' | 'room'

const COLORS = { current: 0xfacc15, room: 0x2dd4bf, door: 0xfb923c, window: 0x38bdf8, reticle: 0xffffff }

const phase = ref<Phase>('intro')
const support = ref<Support>('checking')
const error = ref<string | null>(null)
const origin = ref('')

const mode = ref<Mode>('corner')
const rooms = ref<{ name: string; corners: Pt3[] }[]>([])
const current = ref<Pt3[]>([])
const openings = ref<{ type: 'door' | 'window'; a: Pt3; b: Pt3 }[]>([])
const openingStart = ref<Pt3 | null>(null)
const log = reactive<Action[]>([])

/** Where the centre of the screen hits a real surface, refreshed a few times a second for the UI. */
const aim = ref<Pt3 | null>(null)
const tracking = ref(true)

const overlayEl = ref<HTMLElement | null>(null)
const canvasHost = ref<HTMLElement | null>(null)
const sending = ref(false)

onMounted(async () => {
  origin.value = location.origin
  if (!window.isSecureContext) { support.value = 'insecure'; return }
  if (!navigator.xr) { support.value = 'no-xr'; return }
  try {
    support.value = (await navigator.xr.isSessionSupported('immersive-ar')) ? 'ok' : 'no-ar'
    // Load three.js now: AR must start within a few seconds of the tap on "Start scan".
    if (support.value === 'ok') THREE = await import('three')
  } catch {
    support.value = 'no-ar'
  }
})

// ── Derived UI state ──

const flatDist = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[2] - a[2])

const liveDistance = computed(() => {
  const from = openingStart.value ?? (mode.value === 'corner' ? current.value.at(-1) : undefined)
  return from && aim.value ? flatDist(from, aim.value) : null
})

const hint = computed(() => {
  if (!tracking.value) return 'Tracking lost. Point the phone at the room and move it slowly.'
  if (!aim.value) return 'Move the phone slowly and point at the floor until the ring appears.'
  if (mode.value === 'corner') {
    return current.value.length === 0 ? 'Tap anywhere to place the first corner of this room.' : 'Tap to place the next corner.'
  }
  const what = mode.value === 'door' ? 'door' : 'window'
  return openingStart.value ? `Now tap the other side of the ${what}.` : `Tap one side of the ${what}.`
})

const roomLabel = computed(() => `Room ${rooms.value.length + 1}`)

// ── Three.js / WebXR ──
// Kept out of Vue's reactivity on purpose: these are mutated every frame.
let THREE: typeof THREE_NS
let renderer: THREE_NS.WebGLRenderer | null = null
let scene: THREE_NS.Scene
let camera: THREE_NS.PerspectiveCamera
let reticle: THREE_NS.Mesh
let marks: THREE_NS.Group
let preview: THREE_NS.Mesh
let session: XRSession | null = null
let hitSource: XRHitTestSource | null = null
let aimNow: Pt3 | null = null
let frameCount = 0

function material(color: number) {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })
}

/** A thin bar from a to b, slightly above the floor so it doesn't flicker into it. */
function placeBar(mesh: THREE_NS.Mesh, a: Pt3, b: Pt3) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.01, (a[2] + b[2]) / 2)
  mesh.lookAt(b[0], b[1] + 0.01, b[2])
  mesh.scale.set(1, 1, Math.max(len, 0.001))
}

function bar(a: Pt3, b: Pt3, color: number, thickness = 0.015) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, 1), material(color))
  placeBar(mesh, a, b)
  mesh.renderOrder = 1
  return mesh
}

function dot(p: Pt3, color: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), material(color))
  mesh.position.set(p[0], p[1] + 0.01, p[2])
  mesh.renderOrder = 2
  return mesh
}

/** Redraws everything placed so far. Called on every change; the scene stays small. */
function rebuildMarks() {
  if (!marks) return
  for (const child of [...marks.children]) {
    marks.remove(child)
    const m = child as THREE_NS.Mesh
    m.geometry.dispose()
    ;(m.material as THREE_NS.Material).dispose()
  }
  for (const room of rooms.value) {
    room.corners.forEach((p, i) => {
      marks.add(dot(p, COLORS.room))
      marks.add(bar(p, room.corners[(i + 1) % room.corners.length], COLORS.room))
    })
  }
  current.value.forEach((p, i) => {
    marks.add(dot(p, COLORS.current))
    if (i > 0) marks.add(bar(current.value[i - 1], p, COLORS.current))
  })
  // Dashed-looking closing edge so the user sees the room shape before finishing.
  if (current.value.length >= 3) {
    marks.add(bar(current.value.at(-1)!, current.value[0], COLORS.current, 0.006))
  }
  for (const op of openings.value) {
    marks.add(bar(op.a, op.b, op.type === 'door' ? COLORS.door : COLORS.window, 0.04))
  }
  if (openingStart.value) marks.add(dot(openingStart.value, mode.value === 'door' ? COLORS.door : COLORS.window))
}

function onFrame(_t: number, frame?: XRFrame) {
  if (!renderer || !frame) return
  const ref = renderer.xr.getReferenceSpace()
  if (ref && hitSource) {
    tracking.value = !!frame.getViewerPose(ref)
    const hit = frame.getHitTestResults(hitSource)[0]
    const pose = hit?.getPose(ref)
    if (pose) {
      reticle.visible = true
      reticle.matrix.fromArray(pose.transform.matrix)
      const { x, y, z } = pose.transform.position
      aimNow = [x, y, z]
    } else {
      reticle.visible = false
      aimNow = null
    }
  }

  // Rubber band from the last point to where the user is aiming.
  const from = openingStart.value ?? (mode.value === 'corner' ? current.value.at(-1) : undefined)
  if (from && aimNow) {
    placeBar(preview, from, aimNow)
    ;(preview.material as THREE_NS.MeshBasicMaterial).color.setHex(
      mode.value === 'corner' ? COLORS.current : mode.value === 'door' ? COLORS.door : COLORS.window,
    )
    preview.visible = true
  } else {
    preview.visible = false
  }

  // Reactive copy for the overlay text, throttled to ~10 Hz.
  if (++frameCount % 6 === 0) aim.value = aimNow

  renderer.render(scene, camera)
}

async function startScan() {
  error.value = null
  phase.value = 'scanning'
  await nextTick() // the overlay root must be in the DOM before the session starts
  try {
    session = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'dom-overlay'],
      domOverlay: { root: overlayEl.value! },
    })

    THREE ??= await import('three')
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local')
    canvasHost.value?.appendChild(renderer.domElement)

    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera()
    reticle = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2), material(COLORS.reticle))
    reticle.matrixAutoUpdate = false
    reticle.visible = false
    scene.add(reticle)
    marks = new THREE.Group()
    scene.add(marks)
    preview = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 1), material(COLORS.current))
    preview.visible = false
    scene.add(preview)
    rebuildMarks()

    await renderer.xr.setSession(session)
    const viewer = await session.requestReferenceSpace('viewer')
    hitSource = (await session.requestHitTestSource!({ space: viewer })) ?? null

    session.addEventListener('select', addPoint)
    session.addEventListener('end', onSessionEnd)
    renderer.setAnimationLoop(onFrame)
  } catch (e) {
    error.value = `Couldn't start AR: ${(e as Error)?.message ?? e}`
    teardown()
    phase.value = 'intro'
  }
}

function teardown() {
  hitSource?.cancel()
  hitSource = null
  if (renderer) {
    renderer.setAnimationLoop(null)
    renderer.dispose()
    renderer.domElement.remove()
    renderer = null
  }
  session = null
  aimNow = null
  aim.value = null
}

function onSessionEnd() {
  // Auto-close a room the user forgot to finish.
  if (current.value.length >= 3) finishRoom()
  teardown()
  phase.value = rooms.value.length ? 'review' : 'intro'
}

// ── Actions ──

function addPoint() {
  const p = aimNow
  if (!p) return
  if (mode.value === 'corner') {
    current.value.push(p)
    log.push('corner')
  } else if (!openingStart.value) {
    openingStart.value = p
    log.push('start')
  } else {
    openings.value.push({ type: mode.value, a: openingStart.value, b: p })
    openingStart.value = null
    log.push('opening')
  }
  navigator.vibrate?.(15)
  rebuildMarks()
}

function setMode(m: Mode) {
  if (openingStart.value) {
    openingStart.value = null
    const i = log.lastIndexOf('start')
    if (i >= 0) log.splice(i, 1)
  }
  mode.value = m
  rebuildMarks()
}

function undo() {
  const last = log.pop()
  if (last === 'corner') current.value.pop()
  else if (last === 'start') openingStart.value = null
  else if (last === 'opening') openings.value.pop()
  else if (last === 'room') {
    const room = rooms.value.pop()
    if (room) current.value = room.corners
  }
  rebuildMarks()
}

function finishRoom() {
  if (current.value.length < 3) return
  rooms.value.push({ name: roomLabel.value, corners: current.value })
  current.value = []
  log.push('room')
  setMode('corner')
}

function endScan() {
  session?.end()
}

// ── Review & send ──

const scanResult = computed<ScanResult>(() => ({
  rooms: rooms.value.map((r) => ({ name: r.name, corners: r.corners.map(([x, , z]) => [x, z] as [number, number]) })),
  openings: openings.value.map((o) => ({ type: o.type, a: [o.a[0], o.a[2]], b: [o.b[0], o.b[2]] })),
  createdAt: Date.now(),
}))

/** The cleaned-up plan, exactly as the editor will import it. */
const previewPlan = computed(() => {
  let n = 0
  return convertScan(scanResult.value, [], () => `p${n++}`)
})

const previewBox = computed(() => {
  const pts = previewPlan.value.rooms.flatMap((r) => r.vertices)
  if (!pts.length) return '0 0 1 1'
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1])
  const pad = 0.5
  const minX = Math.min(...xs) - pad, minZ = Math.min(...zs) - pad
  return `${minX} ${minZ} ${Math.max(...xs) + pad - minX} ${Math.max(...zs) + pad - minZ}`
})

function openingSegment(op: { roomId: string; edgeIdx: number; t: number; width: number }) {
  const room = previewPlan.value.rooms.find((r) => r.id === op.roomId)
  if (!room) return null
  const p = room.vertices[op.edgeIdx]
  const q = room.vertices[(op.edgeIdx + 1) % room.vertices.length]
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
  const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len
  const cx = p[0] + (q[0] - p[0]) * op.t, cz = p[1] + (q[1] - p[1]) * op.t
  const h = op.width / 2
  return { x1: cx - ux * h, y1: cz - uz * h, x2: cx + ux * h, y2: cz + uz * h }
}

async function send() {
  sending.value = true
  error.value = null
  try {
    await $fetch('/api/scan', { method: 'POST', body: scanResult.value })
    phase.value = 'sent'
  } catch (e) {
    error.value = `Couldn't send the scan: ${(e as Error)?.message ?? 'server unreachable'}`
  } finally {
    sending.value = false
  }
}

const discardArmed = ref(false)
function startOver() {
  if (!discardArmed.value) {
    discardArmed.value = true
    setTimeout(() => { discardArmed.value = false }, 3000)
    return
  }
  rooms.value = []
  current.value = []
  openings.value = []
  openingStart.value = null
  log.length = 0
  discardArmed.value = false
  phase.value = 'intro'
}

onBeforeUnmount(() => {
  session?.end().catch(() => {})
  teardown()
})
</script>

<template>
  <div class="min-h-screen bg-bg text-fg">
    <!-- ── Intro ── -->
    <main v-if="phase === 'intro'" class="max-w-md mx-auto px-5 py-8 flex flex-col gap-5">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
          <Icon icon="mdi:cellphone-marker" width="26" height="26" />
        </div>
        <div>
          <h1 class="text-lg font-semibold leading-tight">Scan your rooms</h1>
          <p class="text-xs text-fg-muted">Builds a floorplan for HAIVE</p>
        </div>
      </div>

      <div v-if="support === 'checking'" class="text-sm text-fg-muted">Checking AR support…</div>

      <div v-else-if="support === 'insecure'" class="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm leading-snug flex flex-col gap-2">
        <b>AR needs a secure connection.</b>
        <span>In Chrome, open <span class="font-mono text-xs break-all">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>, add</span>
        <span class="font-mono text-xs break-all">{{ origin }}</span>
        <span>set it to <b>Enabled</b>, relaunch Chrome and reload this page.</span>
      </div>

      <div v-else-if="support === 'no-xr' || support === 'no-ar'" class="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm leading-snug">
        <b>This browser can't do AR.</b>
        Open this page in Chrome on an Android phone with
        <i>Google Play Services for AR</i> installed. iPhones and desktop browsers aren't supported.
      </div>

      <template v-else>
        <ol class="flex flex-col gap-3 text-sm leading-snug list-decimal pl-5">
          <li>Start in a corner and move the phone slowly until a white ring appears on the floor.</li>
          <li>Put the ring on each corner of the room and tap the screen, going around the room in order.</li>
          <li>Switch to <b>Door</b> or <b>Window</b> and tap both sides of each one.</li>
          <li>Tap <b>Finish room</b> and walk to the next room. Scan the whole home in one go so the rooms line up.</li>
        </ol>
        <p class="field-hint">Good light and a bit of texture on the floor help. Expect a few centimetres of drift per room.</p>
        <button class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg" @click="startScan">
          <Icon icon="mdi:cube-scan" width="20" height="20" />
          Start scan
        </button>
      </template>

      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </main>

    <!-- ── Review ── -->
    <main v-else-if="phase === 'review'" class="max-w-md mx-auto px-5 py-6 flex flex-col gap-4">
      <h1 class="text-lg font-semibold">Check your scan</h1>
      <svg :viewBox="previewBox" class="w-full aspect-square rounded-2xl bg-bg-panel border border-fg/10">
        <polygon
          v-for="room in previewPlan.rooms"
          :key="room.id"
          :points="room.vertices.map((p) => p.join(',')).join(' ')"
          fill="rgb(var(--accent) / 0.12)"
          stroke="rgb(var(--accent))"
          stroke-width="0.06"
          stroke-linejoin="round"
        />
        <template v-for="op in previewPlan.openings" :key="op.id">
          <line
            v-if="openingSegment(op)"
            v-bind="openingSegment(op)!"
            :stroke="op.type === 'door' ? '#fb923c' : '#38bdf8'"
            stroke-width="0.14"
            stroke-linecap="round"
          />
        </template>
      </svg>
      <p class="field-hint">
        Straightened and squared up. {{ openings.length }} door{{ openings.length === 1 ? '' : 's' }}/windows marked<template v-if="previewPlan.droppedOpenings">, {{ previewPlan.droppedOpenings }} too far from any wall</template>.
      </p>

      <div class="flex flex-col gap-2">
        <label v-for="(room, i) in rooms" :key="i" class="flex items-center gap-3">
          <span class="text-xs text-fg-muted w-14 shrink-0">Room {{ i + 1 }}</span>
          <input v-model="room.name" class="field-input flex-1" maxlength="80" />
        </label>
      </div>

      <button class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg" :disabled="sending" @click="send">
        <Icon :icon="sending ? 'mdi:loading' : 'mdi:send'" :class="{ 'animate-spin': sending }" width="18" height="18" />
        Send to HAIVE
      </button>
      <button class="btn-touch text-sm" :class="discardArmed ? '!bg-red-500 !text-white' : ''" @click="startOver">
        {{ discardArmed ? 'Tap again to throw this scan away' : 'Start over' }}
      </button>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </main>

    <!-- ── Sent ── -->
    <main v-else-if="phase === 'sent'" class="max-w-md mx-auto px-5 py-16 flex flex-col items-center text-center gap-3">
      <div class="w-14 h-14 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
        <Icon icon="mdi:check" width="30" height="30" />
      </div>
      <h1 class="text-lg font-semibold">Scan sent</h1>
      <p class="text-sm text-fg-muted leading-snug">
        Open <b>Settings → Rooms</b> on your HAIVE screen and tap <b>Import into floorplan</b>.
        Then adjust anything that's off and save.
      </p>
    </main>

    <!-- ── AR overlay (shown by WebXR on top of the camera feed while scanning) ── -->
    <div ref="canvasHost" class="hidden" />
    <div
      v-show="phase === 'scanning'"
      ref="overlayEl"
      class="fixed inset-0 flex flex-col justify-between text-white select-none"
    >
      <div class="p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div class="rounded-2xl bg-black/60 backdrop-blur px-4 py-3 flex flex-col gap-1">
          <div class="flex items-center gap-2 text-xs text-white/70">
            <span class="font-semibold text-white">{{ roomLabel }}</span>
            <span>· {{ current.length }} corner{{ current.length === 1 ? '' : 's' }}</span>
            <span v-if="rooms.length">· {{ rooms.length }} done</span>
            <span v-if="openings.length">· {{ openings.length }} doors/windows</span>
          </div>
          <div class="text-sm leading-snug">{{ hint }}</div>
          <div v-if="liveDistance !== null" class="text-2xl font-semibold tabular-nums">{{ liveDistance.toFixed(2) }} m</div>
        </div>
      </div>

      <!-- Aiming cross: the hit test fires from the centre of the screen -->
      <div class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6">
        <div class="absolute top-1/2 left-0 right-0 h-px bg-white/80" />
        <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/80" />
      </div>

      <!-- Controls. beforexrselect stops taps here from also placing a point. -->
      <div class="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" @beforexrselect.prevent>
        <div class="rounded-2xl bg-black/60 backdrop-blur p-2 flex flex-col gap-2">
          <div class="grid grid-cols-3 gap-1">
            <button
              v-for="m in (['corner', 'door', 'window'] as const)"
              :key="m"
              class="h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 capitalize"
              :class="mode === m ? 'bg-white text-black' : 'bg-white/10'"
              @click="setMode(m)"
            >
              <Icon :icon="m === 'corner' ? 'mdi:vector-square' : m === 'door' ? 'mdi:door' : 'mdi:window-closed-variant'" width="18" height="18" />
              {{ m }}
            </button>
          </div>
          <div class="grid grid-cols-3 gap-1">
            <button class="h-12 rounded-xl bg-white/10 text-sm flex items-center justify-center gap-1.5 disabled:opacity-40" :disabled="!log.length && !current.length" @click="undo">
              <Icon icon="mdi:undo" width="18" height="18" /> Undo
            </button>
            <button class="h-12 rounded-xl bg-white/10 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-40" :disabled="current.length < 3" @click="finishRoom">
              <Icon icon="mdi:check" width="18" height="18" /> Finish room
            </button>
            <button class="h-12 rounded-xl bg-teal-400 text-black text-sm font-semibold flex items-center justify-center gap-1.5" @click="endScan">
              <Icon icon="mdi:flag-checkered" width="18" height="18" /> Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
