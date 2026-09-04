import { sendWebResponse } from 'h3'
import { assertLanClient } from '~~/server/utils/lanGuard'
import { resolveHaTarget } from '~~/server/utils/haTarget'

/**
 * Read-only proxy for Home Assistant HTTP resources (camera snapshots, media
 * artwork, …) so browsers never need direct network access to Home Assistant
 * and never receive the access token.
 *
 * Deliberately GET/HEAD only — anything that changes state goes over the
 * WebSocket bridge instead.
 */

/** Request headers worth passing upstream; everything else is dropped. */
const FORWARDED = ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since']

/** Response headers passed back to the browser. */
const RETURNED = ['content-type', 'content-length', 'content-range', 'cache-control', 'etag', 'last-modified']

export default defineEventHandler(async (event) => {
  await assertLanClient(event)

  if (event.method !== 'GET' && event.method !== 'HEAD') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
  }

  const target = await resolveHaTarget()
  if (target.source === 'none') {
    throw createError({ statusCode: 503, statusMessage: 'Home Assistant is not configured' })
  }

  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')
  const upstream = `${target.baseUrl}/${path}${getRequestURL(event).search}`

  const headers: Record<string, string> = { authorization: `Bearer ${target.token}` }
  for (const name of FORWARDED) {
    const value = getRequestHeader(event, name)
    if (value) headers[name] = value
  }

  let res: Response
  try {
    res = await fetch(upstream, { method: event.method, headers, redirect: 'follow' })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Home Assistant is unreachable' })
  }

  const out = new Headers()
  for (const name of RETURNED) {
    const value = res.headers.get(name)
    if (value) out.set(name, value)
  }

  return sendWebResponse(event, new Response(res.body, { status: res.status, headers: out }))
})
