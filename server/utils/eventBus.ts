/**
 * In-process pub/sub for cross-client live updates.
 *
 * Every SSE subscriber registers a `send(event)` callback here; server-side
 * writes (layout, floorplan, device config) call `publish()` to broadcast to
 * every connected browser.
 */

export type LiveEvent =
  | { type: 'layout' }
  | { type: 'floorplan' }
  | { type: 'device' }

type Subscriber = (e: LiveEvent) => void

const subscribers = new Set<Subscriber>()

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

export function publish(event: LiveEvent): void {
  for (const fn of subscribers) {
    try { fn(event) } catch { /* ignore dead subscribers */ }
  }
}
