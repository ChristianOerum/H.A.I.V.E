import { createServer } from 'node:https'
import { toNodeListener } from 'h3'
import { caCertificate, serverCredentials, setHttpsPort } from '~~/server/utils/https'

/**
 * Serves the same app over HTTPS on a second port (default 3443), next to the
 * plain HTTP one. Needed for the iPhone room scanner: iOS only allows camera
 * and motion-sensor access on secure pages. See server/utils/https.ts.
 *
 * Set HAIVE_HTTPS_PORT=0 to turn it off. Not started by `nuxt dev`, whose
 * assets come from Vite on the dev port; use `nuxt dev --https` there.
 */
const RECHECK_MS = 10 * 60 * 1000

export default defineNitroPlugin(async (nitroApp) => {
  if (import.meta.dev) return
  const port = Number(process.env.HAIVE_HTTPS_PORT ?? 3443)
  if (!port) return

  const credentials = async () => {
    const { key, cert, changed } = await serverCredentials()
    // Send the CA along so phones that trust it can build the chain.
    return { key, cert: cert + ((await caCertificate()) ?? ''), changed }
  }

  try {
    const { key, cert } = await credentials()
    const server = createServer({ key, cert }, toNodeListener(nitroApp.h3App))
    server.on('error', (err) => {
      console.error(`[haive] HTTPS listener on port ${port} failed:`, err.message)
      setHttpsPort(null)
    })
    server.listen(port, process.env.HOST || '0.0.0.0', () => {
      setHttpsPort(port)
      console.log(`[haive] HTTPS listening on port ${port}`)
    })

    // Pick up a changed LAN address without a restart.
    const timer = setInterval(async () => {
      try {
        const next = await credentials()
        if (next.changed) server.setSecureContext({ key: next.key, cert: next.cert })
      } catch (err) {
        console.error('[haive] Renewing the HTTPS certificate failed:', (err as Error).message)
      }
    }, RECHECK_MS)
    timer.unref()

    nitroApp.hooks.hook('close', () => {
      clearInterval(timer)
      server.close()
    })
  } catch (err) {
    console.error('[haive] Could not start HTTPS:', (err as Error).message)
  }
})
