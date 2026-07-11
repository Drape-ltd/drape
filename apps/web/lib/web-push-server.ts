import 'server-only'

import { webcrypto } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_VAPID_SUBJECT = 'mailto:ops@drapeon.co'

type WebPushSubscriptionRow = {
  id: string
  endpoint: string
}

function base64UrlToBytes(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

function bytesToBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url')
}

function textToBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function derToJose(signature: Uint8Array) {
  if (signature.length === 64) return signature

  let offset = 0
  if (signature[offset++] !== 0x30) return signature
  const sequenceLength = signature[offset++]
  if (sequenceLength === undefined) return signature
  if (sequenceLength + 2 !== signature.length) return signature
  if (signature[offset++] !== 0x02) return signature
  const rLength = signature[offset++]
  if (rLength === undefined) return signature
  let r = signature.slice(offset, offset + rLength)
  offset += rLength
  if (signature[offset++] !== 0x02) return signature
  const sLength = signature[offset++]
  if (sLength === undefined) return signature
  let s = signature.slice(offset, offset + sLength)

  if (r.length > 32 && r[0] === 0) r = r.slice(1)
  if (s.length > 32 && s[0] === 0) s = s.slice(1)

  const output = new Uint8Array(64)
  output.set(r, 32 - r.length)
  output.set(s, 64 - s.length)
  return output
}

function getVapidConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? ''
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? ''
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

async function importVapidPrivateKey(publicKey: string, privateKey: string) {
  const publicBytes = base64UrlToBytes(publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY must be an uncompressed P-256 public key.')
  }

  return webcrypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
      d: privateKey,
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

async function buildVapidAuthorization(endpoint: string) {
  const config = getVapidConfig()
  if (!config) return null

  const audience = new URL(endpoint).origin
  const header = textToBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = textToBase64Url(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  }))
  const signingInput = `${header}.${payload}`
  const key = await importVapidPrivateKey(config.publicKey, config.privateKey)
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(signingInput, 'utf8'),
  ))
  const jwt = `${signingInput}.${bytesToBase64Url(derToJose(signature))}`

  return `vapid t=${jwt}, k=${config.publicKey}`
}

async function markSubscriptionFailed(
  client: SupabaseClient,
  endpoint: string,
  reason: string,
  disable: boolean,
) {
  await client
    .from('web_push_subscriptions')
    .update({
      ...(disable ? { enabled: false } : {}),
      failed_at: new Date().toISOString(),
      failure_reason: reason,
    })
    .eq('endpoint', endpoint)
}

async function sendWebPushEndpoint(client: SupabaseClient, endpoint: string) {
  const authorization = await buildVapidAuthorization(endpoint)
  if (!authorization) return 'skipped' as const

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      TTL: '3600',
      Urgency: 'high',
    },
  })

  if (response.ok || response.status === 201 || response.status === 202) return 'sent' as const

  const reason = `http-${response.status}`
  await markSubscriptionFailed(client, endpoint, reason, response.status === 404 || response.status === 410)
  return 'failed' as const
}

export async function sendOpsWebPush(client: SupabaseClient) {
  const { data, error } = await client
    .from('web_push_subscriptions')
    .select('id, endpoint')
    .eq('audience', 'OPS')
    .eq('enabled', true)
    .order('last_seen_at', { ascending: false })
    .limit(25)

  if (error) {
    console.warn('[web push] Ops subscription lookup failed.', error.message)
    return { sent: 0, skipped: 0, failed: 1 }
  }

  const rows = (data ?? []) as WebPushSubscriptionRow[]
  const result = { sent: 0, skipped: rows.length === 0 ? 1 : 0, failed: 0 }

  for (const row of rows) {
    try {
      const status = await sendWebPushEndpoint(client, row.endpoint)
      result[status] += 1
    } catch (error) {
      result.failed += 1
      console.warn('[web push] Ops push failed.', {
        subscriptionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
