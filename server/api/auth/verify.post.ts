import { readDeviceConfig } from '~~/server/utils/deviceConfig'
import { proxyToMaster } from '~~/server/utils/masterProxy'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ pin: string }>(event)

  if (!body?.pin || typeof body.pin !== 'string') {
    throw createError({ statusCode: 400, message: 'PIN required' })
  }

  // Slaves have no PIN of their own — verify against the Master.
  const proxied = await proxyToMaster(event, '/api/auth/verify')
  if (proxied !== null) return proxied

  const { authPin: configuredPin } = await readDeviceConfig()
  if (!configuredPin) {
    // No PIN configured — authentication not enabled; deny access.
    throw createError({ statusCode: 503, message: 'Authentication not configured' })
  }

  // Constant-time comparison to avoid timing attacks.
  const submitted = body.pin.trim()
  let mismatch = submitted.length !== configuredPin.length ? 1 : 0
  for (let i = 0; i < Math.max(submitted.length, configuredPin.length); i++) {
    mismatch |= (submitted.charCodeAt(i) || 0) ^ (configuredPin.charCodeAt(i) || 0)
  }

  if (mismatch !== 0) {
    throw createError({ statusCode: 401, message: 'Invalid PIN' })
  }

  return { ok: true }
})
