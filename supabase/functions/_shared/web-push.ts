import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { log } from './logger.ts'

const FN = 'web-push'
const DEFAULT_VAPID_SUBJECT = 'mailto:ops@drapeon.co'

type WebPushSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string | null
  auth: string | null
}

export type WebPushPayload = {
  path: string
  correlationKey: string
}

export type WebPushFanoutResult = {
  sent: number
  skipped: number
  failed: number
}

function base64UrlToBytes(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function concatBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function bytesBuffer(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer
}

async function hmacSha256(keyBytes: Uint8Array, value: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', bytesBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytesBuffer(value)))
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  if (length > 32) throw new Error('Web Push HKDF output exceeds one SHA-256 block.')
  const block = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])))
  return block.slice(0, length)
}

export async function encryptWebPushPayload(
  subscription: Pick<WebPushSubscriptionRow, 'p256dh' | 'auth'>,
  payload: WebPushPayload,
) {
  if (!subscription.p256dh || !subscription.auth) throw new Error('The Web Push subscription is missing encryption keys.')
  const clientPublicBytes = base64UrlToBytes(subscription.p256dh)
  const authSecret = base64UrlToBytes(subscription.auth)
  if (clientPublicBytes.length !== 65 || clientPublicBytes[0] !== 4 || authSecret.length < 16) {
    throw new Error('The Web Push subscription has invalid encryption keys.')
  }

  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const serverPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey))
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeys.privateKey,
    256,
  ))
  const authenticationPrk = await hmacSha256(authSecret, sharedSecret)
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    clientPublicBytes,
    serverPublicBytes,
  )
  const ikm = await hkdfExpand(authenticationPrk, keyInfo, 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const contentPrk = await hmacSha256(salt, ikm)
  const contentEncryptionKey = await hkdfExpand(contentPrk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(contentPrk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)
  const plaintext = concatBytes(
    new TextEncoder().encode(JSON.stringify(payload)),
    new Uint8Array([2]),
  )
  const key = await crypto.subtle.importKey('raw', contentEncryptionKey, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext))
  const recordHeader = new Uint8Array(5)
  new DataView(recordHeader.buffer).setUint32(0, 4_096)
  recordHeader[4] = serverPublicBytes.length
  return concatBytes(salt, recordHeader, serverPublicBytes, ciphertext)
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
  const publicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')?.trim() ?? ''
  const privateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')?.trim() ?? ''
  const subject = Deno.env.get('WEB_PUSH_VAPID_SUBJECT')?.trim() || DEFAULT_VAPID_SUBJECT
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

async function importVapidPrivateKey(publicKey: string, privateKey: string) {
  const publicBytes = base64UrlToBytes(publicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY must be an uncompressed P-256 public key.')
  }

  return crypto.subtle.importKey(
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
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  ))
  const jwt = `${signingInput}.${bytesToBase64Url(derToJose(signature))}`

  return `vapid t=${jwt}, k=${config.publicKey}`
}

async function markSubscriptionFailed(
  supabase: SupabaseClient,
  endpoint: string,
  reason: string,
  disable: boolean,
) {
  await supabase
    .rpc('record_web_push_delivery_result', {
      p_endpoint: endpoint,
      p_delivered: false,
      p_failure_reason: reason,
      p_disable: disable,
    })
}

async function markSubscriptionDelivered(supabase: SupabaseClient, endpoint: string) {
  await supabase.rpc('record_web_push_delivery_result', {
    p_endpoint: endpoint,
    p_delivered: true,
    p_failure_reason: null,
    p_disable: false,
  })
}

async function sendWebPushEndpoint(
  supabase: SupabaseClient,
  subscription: WebPushSubscriptionRow,
  payload: WebPushPayload,
) {
  const authorization = await buildVapidAuthorization(subscription.endpoint)
  if (!authorization) return 'skipped' as const
  const encryptedPayload = await encryptWebPushPayload(subscription, payload)

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      TTL: '3600',
      Urgency: 'high',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
    },
    body: encryptedPayload,
  })

  if (response.ok || response.status === 201 || response.status === 202) {
    await markSubscriptionDelivered(supabase, subscription.endpoint)
    return 'sent' as const
  }

  const reason = `http-${response.status}`
  await markSubscriptionFailed(supabase, subscription.endpoint, reason, response.status === 404 || response.status === 410)
  return 'failed' as const
}

async function fanoutWebPush(
  supabase: SupabaseClient,
  subscriptions: WebPushSubscriptionRow[],
  payload: WebPushPayload,
): Promise<WebPushFanoutResult> {
  const result: WebPushFanoutResult = { sent: 0, skipped: 0, failed: 0 }
  if (subscriptions.length === 0) {
    result.skipped += 1
    return result
  }

  for (const subscription of subscriptions) {
    try {
      const status = await sendWebPushEndpoint(supabase, subscription, payload)
      result[status] += 1
    } catch (error) {
      result.failed += 1
      log('warn', FN, 'send.failed', {
        subscription_id: subscription.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

export async function sendWebPushToUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<WebPushFanoutResult> {
  const { data, error } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('audience', 'ACCOUNT')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('last_seen_at', { ascending: false })
    .limit(10)

  if (error) {
    log('warn', FN, 'account.lookup_failed', { user_id: userId, error: error.message })
    return { sent: 0, skipped: 0, failed: 1 }
  }

  return fanoutWebPush(supabase, (data ?? []) as WebPushSubscriptionRow[], {
    path: '/account',
    correlationKey: `account:${userId}`,
  })
}

export async function sendWebPushToOps(
  supabase: SupabaseClient,
  payload: WebPushPayload = { path: '/ops/my-work', correlationKey: 'ops-attention' },
): Promise<WebPushFanoutResult> {
  const configuredEnvironment = (Deno.env.get('DRAPE_OPS_ENV') ?? Deno.env.get('DRAPE_ENV') ?? Deno.env.get('ENVIRONMENT') ?? '')
    .trim()
    .toLowerCase()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const inferredEnvironment = supabaseUrl.includes('wkfsrunetmgjdtcurmoj')
    ? 'production'
    : supabaseUrl.includes('pqptfuqogvrajozfsqzi')
      ? 'development'
      : null
  const environment = configuredEnvironment === 'production' || configuredEnvironment === 'development'
    ? configuredEnvironment
    : inferredEnvironment
  if (!environment) {
    log('error', FN, 'ops.environment_unresolved', {})
    return { sent: 0, skipped: 0, failed: 1 }
  }
  const { data: principals, error: principalError } = await supabase
    .from('ops_workforce_principals')
    .select('id')
    .eq('status', 'ACTIVE')
    .contains('permitted_environments', [environment])

  if (principalError) {
    log('warn', FN, 'ops.principal_lookup_failed', { error: principalError.message })
    return { sent: 0, skipped: 0, failed: 1 }
  }

  const principalIds = (principals ?? []).map((principal) => principal.id).filter(Boolean)
  if (principalIds.length === 0) return { sent: 0, skipped: 1, failed: 0 }

  const { data, error } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('audience', 'OPS')
    .eq('ops_environment', environment)
    .eq('enabled', true)
    .in('ops_principal_id', principalIds)
    .gt('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false })
    .limit(25)

  if (error) {
    log('warn', FN, 'ops.lookup_failed', { error: error.message })
    return { sent: 0, skipped: 0, failed: 1 }
  }

  return fanoutWebPush(supabase, (data ?? []) as WebPushSubscriptionRow[], payload)
}
