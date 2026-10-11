import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import forge from 'node-forge'
import { lanAddresses } from './lanAddresses'

/**
 * Self-signed HTTPS for the LAN.
 *
 * iPhones only give a page the camera and motion sensors over HTTPS, and unlike
 * Android Chrome there's no flag to treat a LAN http:// address as secure. So
 * the server also listens on an HTTPS port (server/plugins/https.ts) with a
 * certificate from its own little CA. The CA is name-constrained to private IP
 * ranges and .local names: even if its key leaked, a phone that trusts it can't
 * be fooled about any public site.
 *
 * Everything lives in config/ssl, which is the add-on's persistent /data.
 */
const SSL_DIR = resolve(process.cwd(), 'config/ssl')
const CA_KEY = resolve(SSL_DIR, 'ca.key')
const CA_CERT = resolve(SSL_DIR, 'ca.crt')
const SERVER_KEY = resolve(SSL_DIR, 'server.key')
const SERVER_CERT = resolve(SSL_DIR, 'server.crt')

/** Apple rejects server certificates valid for longer than 825 days. */
const SERVER_DAYS = 800
const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000
const FIXED_NAMES = ['localhost', 'homeassistant.local']

const { pki, asn1 } = forge

let listeningPort: number | null = null

/** The port the HTTPS listener is running on, or null when it isn't. */
export function httpsPort() {
  return listeningPort
}
export function setHttpsPort(port: number | null) {
  listeningPort = port
}

function newKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { privateKeyPem: privateKey, publicKey: pki.publicKeyFromPem(publicKey), privateKey: pki.privateKeyFromPem(privateKey) }
}

function serial() {
  // Positive (top bit clear) and unique.
  const bytes = randomBytes(16)
  bytes[0]! &= 0x7f
  return bytes.toString('hex')
}

const ipBytes = (ip: string) => String.fromCharCode(...ip.split('.').map(Number))

/** X.509 NameConstraints: only private IPv4 ranges and local hostnames. */
function nameConstraints() {
  const ranges: [string, string][] = [
    ['10.0.0.0', '255.0.0.0'],
    ['172.16.0.0', '255.240.0.0'],
    ['192.168.0.0', '255.255.0.0'],
    ['169.254.0.0', '255.255.0.0'],
    ['127.0.0.0', '255.0.0.0'],
  ]
  const subtree = (tag: number, value: string) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, false, value),
    ])
  const permitted = [
    ...ranges.map(([ip, mask]) => subtree(7, ipBytes(ip) + ipBytes(mask))),
    subtree(2, 'local'),
    subtree(2, 'localhost'),
    subtree(2, 'lan'),
    subtree(2, 'home.arpa'),
  ]
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, permitted),
  ])
}

function createCa() {
  const keys = newKeys()
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
  cert.validity.notAfter = new Date(Date.now() + 20 * 365 * 24 * 3600 * 1000)
  const attrs = [{ name: 'commonName', value: `HAIVE local CA ${serial().slice(0, 6)}` }, { name: 'organizationName', value: 'HAIVE' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    { id: '2.5.29.30', critical: true, value: nameConstraints() },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { keyPem: keys.privateKeyPem, certPem: pki.certificateToPem(cert) }
}

function createServerCert(caKeyPem: string, caCertPem: string, ips: string[]) {
  const caKey = pki.privateKeyFromPem(caKeyPem)
  const caCert = pki.certificateFromPem(caCertPem)
  const keys = newKeys()
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
  cert.validity.notAfter = new Date(Date.now() + SERVER_DAYS * 24 * 3600 * 1000)
  cert.setSubject([{ name: 'commonName', value: 'HAIVE' }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
    {
      name: 'subjectAltName',
      altNames: [
        ...FIXED_NAMES.map((value) => ({ type: 2, value })),
        ...['127.0.0.1', ...ips].map((ip) => ({ type: 7, ip })),
      ],
    },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return { keyPem: keys.privateKeyPem, certPem: pki.certificateToPem(cert) }
}

/** IPs the current server certificate covers, or null if it's missing or due for renewal. */
function coveredIps(certPem: string): Set<string> | null {
  try {
    const cert = pki.certificateFromPem(certPem)
    if (cert.validity.notAfter.getTime() - Date.now() < RENEW_BEFORE_MS) return null
    const san = cert.getExtension('subjectAltName') as { altNames?: { type: number; ip?: string }[] } | null
    return new Set((san?.altNames ?? []).filter((n) => n.type === 7 && n.ip).map((n) => n.ip!))
  } catch {
    return null
  }
}

/** The PEM of the local CA, for phones to install and trust. */
export async function caCertificate(): Promise<string | null> {
  return existsSync(CA_CERT) ? readFile(CA_CERT, 'utf8') : null
}

/**
 * Key and certificate for the HTTPS listener, created on first use and
 * re-issued when the LAN address changes or expiry gets close. The CA stays
 * the same, so a phone that trusted it once keeps working.
 */
export async function serverCredentials(): Promise<{ key: string; cert: string; changed: boolean }> {
  await mkdir(SSL_DIR, { recursive: true })

  let caKeyPem: string, caCertPem: string
  if (existsSync(CA_KEY) && existsSync(CA_CERT)) {
    caKeyPem = await readFile(CA_KEY, 'utf8')
    caCertPem = await readFile(CA_CERT, 'utf8')
  } else {
    const ca = createCa()
    caKeyPem = ca.keyPem
    caCertPem = ca.certPem
    await writeFile(CA_KEY, caKeyPem, { mode: 0o600 })
    await writeFile(CA_CERT, caCertPem)
  }

  const ips = (await lanAddresses()).filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip))
  if (existsSync(SERVER_KEY) && existsSync(SERVER_CERT)) {
    const cert = await readFile(SERVER_CERT, 'utf8')
    const covered = coveredIps(cert)
    if (covered && ips.every((ip) => covered.has(ip))) {
      return { key: await readFile(SERVER_KEY, 'utf8'), cert, changed: false }
    }
  }

  const server = createServerCert(caKeyPem, caCertPem, ips)
  await writeFile(SERVER_KEY, server.keyPem, { mode: 0o600 })
  await writeFile(SERVER_CERT, server.certPem)
  return { key: server.keyPem, cert: server.certPem, changed: true }
}
