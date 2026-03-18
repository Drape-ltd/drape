/**
 * HMAC-SHA256 sign / verify helpers using the Web Crypto API.
 * Used for generating tamper-proof, expiring decision tokens.
 */

/** Returns a hex-encoded HMAC-SHA256 signature of payload using secret. */
export async function signPayload(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Timing-safe verification of a hex HMAC-SHA256 token.
 * Returns true if expectedHex matches HMAC-SHA256(secret, payload).
 */
export async function verifyPayload(secret: string, payload: string, expectedHex: string): Promise<boolean> {
  const enc = new TextEncoder()
  const clean = expectedHex.trim()
  if (clean.length % 2 !== 0) return false

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const sigBytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    sigBytes[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  }
  // crypto.subtle.verify is constant-time — prevents timing attacks
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload))
}

/** Escapes HTML special characters to prevent injection in email templates. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
