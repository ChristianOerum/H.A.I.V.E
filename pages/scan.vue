<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type * as THREE_NS from 'three'
import type { ScanResult } from '~/utils/scanGeometry'
import { convertScan } from '~/utils/scanGeometry'

/**
 * Phone room scanner, two ways:
 *
 * - AR (WebXR: Chrome on Android with ARCore). The user walks around and taps
 *   each room's floor corners, plus both sides of every door and window. All
 *   rooms in one AR session share a coordinate frame, so they line up.
 * - Aim (iPhones and anything else without WebXR AR). The user holds the phone
 *   at a known height and aims a crosshair over the camera feed at each floor
 *   corner; tilt and heading from the motion sensors give the point
 *   (composables/useAimTracker.ts). "Move" marks the spot the user walks to
 *   next, which keeps every room in one frame here too. Needs HTTPS, which the
 *   server provides on its own port (server/plugins/https.ts).
 *
 * The raw points are posted to /api/scan and the floorplan editor turns them
 * into rooms (utils/scanGeometry.ts).
 */

useHead({ title: 'H.A.I.V.E. · Room scan' })

type Pt3 = [number, number, number]
type Mode = 'corner' | 'door' | 'window' | 'move'
type Phase = 'intro' | 'scanning' | 'review' | 'sent'
type Support = 'checking' | 'ok' | 'insecure' | 'no-ar'
type Method = 'ar' | 'aim'
type Action = 'corner' | 'start' | 'opening' | 'room' | 'move'

const COLORS = { current: 0xfacc15, room: 0x2dd4bf, door: 0xfb923c, window: 0x38bdf8, reticle: 0xffffff }
const modeIcon: Record<Mode, string> = {
  corner: 'mdi:vector-square',
  door: 'mdi:door',
  window: 'mdi:window-closed-variant',
  move: 'mdi:walk',
}

const phase = ref<Phase>('intro')
const support = ref<Support>('checking')
const error = ref<string | null>(null)
const origin = ref('')
const method = ref<Method>('ar')
/** This page on the server's HTTPS port, for phones that can't use it over http. */
const httpsUrl = ref('')
const isIos = ref(false)

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
  isIos.value = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  try {
    const saved = parseFloat(localStorage.getItem('haive.scanHeight') ?? '')
    if (saved >= MIN_HEIGHT && saved <= MAX_HEIGHT) phoneHeight.value = saved
  } catch { /* storage blocked */ }

  if (!window.isSecureContext) {
    support.value = 'insecure'
    try {
      const { httpsPort } = await $fetch<{ httpsPort: number | null }>('/api/ip')
      if (httpsPort) httpsUrl.value = `https://${location.hostname}:${httpsPort}/scan`
    } catch { /* older server without HTTPS */ }
    return
  }
  try {
    if (navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))) {
      method.value = 'ar'
      support.value = 'ok'
      // Load three.js now: AR must start within a few seconds of the tap on "Start scan".
      THREE = await import('three')
      return
    }
  } catch { /* fall through to aim mode */ }
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
    method.value = 'aim'
    support.value = 'ok'
  } else {
    support.value = 'no-ar'
  }
})

// ── Derived UI state ──

const flatDist = (a: Pt3, b: Pt3) => Math.hypot(b[0] - a[0], b[2] - a[2])

/** The point the rubber band and the distance readout start from. */
function measureFrom(): Pt3 | undefined {
  if (openingStart.value) return openingStart.value
  if (mode.value === 'corner') return current.value.at(-1)
  if (mode.value === 'move') return standAt.value
  return undefined
}

const liveDistance = computed(() => {
  const from = measureFrom()
  return from && aim.value ? flatDist(from, aim.value) : null
})

/** In aim mode, far points are unreliable: a 1° wobble moves them tens of centimetres. */
const tooFar = computed(() => method.value === 'aim' && !!aim.value && flatDist(standAt.value, aim.value) > MAX_AIM_DIST)

const hint = computed(() => {
  if (method.value === 'aim') {
    if (!tracking.value) return 'No motion sensor readings. Hold the phone still for a moment.'
    if (!aim.value) return 'Tilt the phone down and put the cross on the floor.'
    if (tooFar.value && mode.value !== 'move') return 'That spot is far away and won\'t be accurate. Use Move to walk closer.'
    if (mode.value === 'move') return 'Aim at the floor where you\'ll stand next and tap. Then walk there and stand on that spot.'
  } else {
    if (!tracking.value) return 'Tracking lost. Point the phone at the room and move it slowly.'
    if (!aim.value) return 'Move the phone slowly and point at the floor until the ring appears.'
  }
  if (mode.value === 'corner') {
    if (method.value === 'aim') {
      return current.value.length === 0 ? 'Put the cross on the floor right in a corner and tap.' : 'Aim at the next corner and tap.'
    }
    return current.value.length === 0 ? 'Tap anywhere to place the first corner of this room.' : 'Tap to place the next corner.'
  }
  const what = mode.value === 'door' ? 'door' : 'window'
  const where = method.value === 'aim' ? 'the floor at ' : ''
  return openingStart.value ? `Now tap ${where}the other side of the ${what}.` : `Tap ${where}one side of the ${what}.`
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
  const from = measureFrom()
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

function startScan() {
  if (method.value === 'aim') startAim()
  else startAr()
}

async function startAr() {
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

// ── Aim mode (no WebXR) ──

const MIN_HEIGHT = 0.5
const MAX_HEIGHT = 2.2
/** Beyond this, aim-mode points get too inaccurate to place. */
const MAX_AIM_DIST = 6

const aimTracker = useAimTracker()
/** Height of the phone above the floor while scanning. Every aim-mode point scales with it. */
const phoneHeight = ref(1.4)
/** Where the user stands, on the floor. Changed by "Move". */
const standAt = ref<Pt3>([0, 0, 0])
/** Earlier standing spots, for undoing a move. */
const moves: Pt3[] = []
const videoEl = ref<HTMLVideoElement | null>(null)
let stream: MediaStream | null = null
let wakeLock: { release: () => Promise<void> } | null = null
let aimTimer: ReturnType<typeof setInterval> | undefined

/** Scales every aim-mode point: they're all proportional to the phone height. */
function rescale(f: number) {
  const s = (p: Pt3): Pt3 => [p[0] * f, p[1] * f, p[2] * f]
  for (const r of rooms.value) r.corners = r.corners.map(s)
  current.value = current.value.map(s)
  openings.value = openings.value.map((o) => ({ ...o, a: s(o.a), b: s(o.b) }))
  if (openingStart.value) openingStart.value = s(openingStart.value)
  standAt.value = s(standAt.value)
  moves.forEach((m, i) => { moves[i] = s(m) })
}

function setPhoneHeight(raw: string) {
  const v = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parseFloat(raw.replace(',', '.')) || phoneHeight.value))
  const f = v / phoneHeight.value
  phoneHeight.value = v
  if (method.value === 'aim' && f !== 1) rescale(f)
  try { localStorage.setItem('haive.scanHeight', String(v)) } catch { /* storage blocked */ }
}

async function startAim() {
  error.value = null
  // iOS only shows the motion prompt when asked straight from the tap.
  const permitted = aimTracker.requestPermission()
  try {
    if (!(await permitted)) {
      throw new Error('motion access was denied. Close Chrome completely, open this page again and tap Allow.')
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    if (!(await aimTracker.start())) throw new Error('this device doesn\'t report its orientation.')
    phase.value = 'scanning'
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      // Not awaited: it only settles once the first frame arrives.
      videoEl.value.play().catch(() => {})
    }
    aimTimer = setInterval(() => {
      tracking.value = aimTracker.alive()
      const d = aimTracker.direction(150, 0)
      aim.value = d ? floorPoint(d, phoneHeight.value, standAt.value) : null
    }, 100)
    ;(navigator as any).wakeLock?.request('screen').then((l: NonNullable<typeof wakeLock>) => {
      if (stream) wakeLock = l
      else l.release().catch(() => {})
    }, () => {})
  } catch (e) {
    const err = e as Error
    const msg = err?.name === 'NotAllowedError' ? 'camera access was denied. Allow it for this site and try again.' : err?.message ?? String(e)
    error.value = `Couldn't start the scan: ${msg}`
    stopAim()
    phase.value = 'intro'
  }
}

function stopAim() {
  clearInterval(aimTimer)
  aimTracker.stop()
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  wakeLock?.release().catch(() => {})
  wakeLock = null
  aim.value = null
}

function tapAim() {
  const d = aimTracker.direction()
  aimNow = d ? floorPoint(d, phoneHeight.value, standAt.value) : null
  // Way off: almost certainly aimed at a wall by accident.
  if (aimNow && flatDist(standAt.value, aimNow) > MAX_AIM_DIST * 1.5) {
    navigator.vibrate?.([30, 50, 30])
    return
  }
  addPoint()
}

/** Top-down view of the scan so far, for aim mode (nothing is drawn on the camera feed). */
const miniMap = computed(() => {
  const pts: Pt3[] = [standAt.value, ...rooms.value.flatMap((r) => r.corners), ...current.value, ...openings.value.flatMap((o) => [o.a, o.b])]
  if (aim.value) pts.push(aim.value)
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const size = Math.max(4, Math.max(...xs) - Math.min(...xs) + 1, Math.max(...zs) - Math.min(...zs) + 1)
  return { viewBox: `${cx - size / 2} ${cz - size / 2} ${size} ${size}`, r: size * 0.025 }
})
const svgPoints = (ps: Pt3[]) => ps.map((p) => `${p[0]},${p[2]}`).join(' ')

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
  if (mode.value === 'move') {
    moves.push(standAt.value)
    standAt.value = p
    log.push('move')
    mode.value = 'corner'
  } else if (mode.value === 'corner') {
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
  else if (last === 'move') standAt.value = moves.pop() ?? [0, 0, 0]
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
  if (method.value === 'ar') {
    session?.end()
    return
  }
  if (current.value.length >= 3) finishRoom()
  stopAim()
  phase.value = rooms.value.length ? 'review' : 'intro'
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

/** Width × depth of each squared-up room, so the user can sanity-check the scale. */
const roomSizes = computed(() => previewPlan.value.rooms.map((r) => {
  const xs = r.vertices.map((p) => p[0]), zs = r.vertices.map((p) => p[1])
  return `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...zs) - Math.min(...zs)).toFixed(1)} m`
}))

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
  standAt.value = [0, 0, 0]
  moves.length = 0
  discardArmed.value = false
  phase.value = 'intro'
}

onBeforeUnmount(() => {
  session?.end().catch(() => {})
  teardown()
  stopAim()
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

      <!-- iPhones can't treat http as secure, so they go to the HTTPS port instead -->
      <div v-else-if="support === 'insecure' && isIos && httpsUrl" class="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm leading-snug flex flex-col gap-3">
        <b>The scanner needs a secure connection.</b>
        <span>Open the secure version of this page. Chrome will warn that the connection isn't private, because HAIVE uses its own certificate: tap <b>Show details</b>, then <b>Visit this website</b>.</span>
        <a :href="httpsUrl" class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg">
          <Icon icon="mdi:lock" width="18" height="18" />
          Open secure scanner
        </a>
        <span class="text-xs text-fg-muted">
          If the camera still won't start, trust HAIVE's certificate once: open
          <span class="font-mono break-all">{{ origin }}/api/ssl/ca.crt</span> in <b>Safari</b>, allow the download, install it under
          <b>Settings → General → VPN &amp; Device Management</b>, then turn it on under
          <b>Settings → General → About → Certificate Trust Settings</b>.
        </span>
      </div>

      <div v-else-if="support === 'insecure'" class="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm leading-snug flex flex-col gap-2">
        <b>AR needs a secure connection.</b>
        <span>In Chrome, open <span class="font-mono text-xs break-all">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>, add</span>
        <span class="font-mono text-xs break-all">{{ origin }}</span>
        <span>set it to <b>Enabled</b>, relaunch Chrome and reload this page.</span>
        <a v-if="httpsUrl" :href="httpsUrl" class="text-xs underline text-fg-muted">Or open the secure version of this page</a>
      </div>

      <div v-else-if="support === 'no-ar'" class="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm leading-snug">
        <b>This browser can't scan rooms.</b>
        It has no camera access or motion sensors. Open this page on a phone, in Chrome or Safari.
      </div>

      <template v-else-if="method === 'aim'">
        <ol class="flex flex-col gap-3 text-sm leading-snug list-decimal pl-5">
          <li>
            Hold the phone at chest height and keep it at that height the whole time. Enter how high that is above the floor:
            <label class="flex items-center gap-3 mt-2">
              <span class="text-xs text-fg-muted">Phone height</span>
              <input
                class="field-input w-24"
                inputmode="decimal"
                :value="phoneHeight.toFixed(2)"
                @change="setPhoneHeight(($event.target as HTMLInputElement).value)"
              />
              <span class="text-xs text-fg-muted">m</span>
            </label>
          </li>
          <li>Stand where you can see the corners. Put the cross on the floor right in each corner and tap, going around the room in order.</li>
          <li>Switch to <b>Door</b> or <b>Window</b> and tap the floor at both sides of each one.</li>
          <li>Corner hidden, or on to the next room? Tap <b>Move</b>, aim at the floor where you'll stand, tap, and walk there. That keeps the rooms lined up.</li>
          <li>Tap <b>Finish room</b> after each room, and <b>Done</b> at the end.</li>
        </ol>
        <p class="field-hint">Corners 1–4 m away are the most accurate. A wrong phone height only changes the scale, and you can fix it afterwards.</p>
        <button class="btn-touch gap-2 text-sm font-semibold bg-accent !text-bg" @click="startScan">
          <Icon icon="mdi:crosshairs-gps" width="20" height="20" />
          Start scan
        </button>
      </template>

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
          <input v-model="room.name" class="field-input flex-1 min-w-0" maxlength="80" />
          <span v-if="roomSizes[i]" class="text-xs text-fg-muted tabular-nums shrink-0">{{ roomSizes[i] }}</span>
        </label>
      </div>

      <label v-if="method === 'aim'" class="flex flex-col gap-1">
        <span class="flex items-center gap-3">
          <span class="text-xs text-fg-muted">Phone height</span>
          <input
            class="field-input w-24"
            inputmode="decimal"
            :value="phoneHeight.toFixed(2)"
            @change="setPhoneHeight(($event.target as HTMLInputElement).value)"
          />
          <span class="text-xs text-fg-muted">m</span>
        </span>
        <span class="field-hint">Sizes off? Change the phone height: everything scales with it.</span>
      </label>

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
      :class="{ 'bg-black': method === 'aim' }"
    >
      <!-- Aim mode: camera feed, and the whole screen is the shutter -->
      <template v-if="method === 'aim'">
        <video ref="videoEl" class="absolute inset-0 w-full h-full object-cover" playsinline muted autoplay />
        <div class="absolute inset-0" @pointerdown.prevent="tapAim" />
      </template>

      <div class="relative p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pointer-events-none">
        <div class="rounded-2xl bg-black/60 backdrop-blur px-4 py-3 flex gap-3">
          <div class="flex-1 min-w-0 flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-x-2 text-xs text-white/70">
              <span class="font-semibold text-white">{{ roomLabel }}</span>
              <span>· {{ current.length }} corner{{ current.length === 1 ? '' : 's' }}</span>
              <span v-if="rooms.length">· {{ rooms.length }} done</span>
              <span v-if="openings.length">· {{ openings.length }} doors/windows</span>
            </div>
            <div class="text-sm leading-snug">{{ hint }}</div>
            <div v-if="liveDistance !== null" class="text-2xl font-semibold tabular-nums" :class="{ 'text-yellow-300': tooFar }">{{ liveDistance.toFixed(2) }} m</div>
          </div>
          <!-- Top-down map, north up: you (white), aim (yellow line), rooms so far -->
          <svg v-if="method === 'aim'" :viewBox="miniMap.viewBox" class="w-24 h-24 shrink-0 rounded-xl bg-white/5">
            <polygon
              v-for="(room, i) in rooms"
              :key="i"
              :points="svgPoints(room.corners)"
              fill="rgb(45 212 191 / 0.2)"
              stroke="#2dd4bf"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
            />
            <polyline :points="svgPoints(current)" fill="none" stroke="#facc15" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            <line
              v-for="(op, i) in openings"
              :key="`o${i}`"
              :x1="op.a[0]" :y1="op.a[2]" :x2="op.b[0]" :y2="op.b[2]"
              :stroke="op.type === 'door' ? '#fb923c' : '#38bdf8'"
              stroke-width="3"
              vector-effect="non-scaling-stroke"
            />
            <template v-if="aim">
              <line
                :x1="standAt[0]" :y1="standAt[2]" :x2="aim[0]" :y2="aim[2]"
                stroke="white" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="2 2"
                vector-effect="non-scaling-stroke"
              />
              <circle :cx="aim[0]" :cy="aim[2]" :r="miniMap.r" :fill="tooFar ? '#fde047' : '#facc15'" />
            </template>
            <circle :cx="standAt[0]" :cy="standAt[2]" :r="miniMap.r * 1.4" fill="white" />
          </svg>
        </div>
      </div>

      <!-- Aiming cross: points are taken where the centre of the screen points -->
      <div class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" :class="method === 'aim' ? 'w-10 h-10' : 'w-6 h-6'">
        <div class="absolute top-1/2 left-0 right-0 h-px bg-white/80" :class="{ 'h-0.5 shadow': method === 'aim' }" />
        <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/80" :class="{ 'w-0.5 shadow': method === 'aim' }" />
      </div>

      <!-- Controls. beforexrselect stops taps here from also placing a point. -->
      <div class="relative p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" @beforexrselect.prevent>
        <div class="rounded-2xl bg-black/60 backdrop-blur p-2 flex flex-col gap-2">
          <div class="grid gap-1" :class="method === 'aim' ? 'grid-cols-4' : 'grid-cols-3'">
            <button
              v-for="m in (method === 'aim' ? ['corner', 'door', 'window', 'move'] as const : ['corner', 'door', 'window'] as const)"
              :key="m"
              class="h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 capitalize"
              :class="mode === m ? 'bg-white text-black' : 'bg-white/10'"
              @click="setMode(m)"
            >
              <Icon :icon="modeIcon[m]" width="18" height="18" />
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
