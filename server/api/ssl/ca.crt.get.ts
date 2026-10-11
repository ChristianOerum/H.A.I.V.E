import { assertLanClient } from '~~/server/utils/lanGuard'
import { caCertificate } from '~~/server/utils/https'

/**
 * The local CA certificate (server/utils/https.ts). Opening this in Safari on
 * an iPhone offers to install it as a profile; once trusted, the HTTPS port
 * opens without a warning.
 */
export default defineEventHandler(async (event) => {
  await assertLanClient(event)
  const pem = await caCertificate()
  if (!pem) throw createError({ statusCode: 404, statusMessage: 'HTTPS is not set up' })
  setResponseHeaders(event, {
    'Content-Type': 'application/x-x509-ca-cert',
    'Content-Disposition': 'attachment; filename="haive-ca.crt"',
    'Cache-Control': 'no-store',
  })
  return pem
})
