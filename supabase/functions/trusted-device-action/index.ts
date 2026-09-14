import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  DEVICE_TRUST_CODE_TTL_MINUTES,
  DEVICE_TRUST_MAX_ATTEMPTS,
  deviceTrustExpiry,
  isDeviceTrustCode,
  normalizeDeviceLabel,
  type DeviceTrustPlatform,
} from '../../../packages/shared/src/device-trust.ts'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  normalizeDrapeonSender,
  renderDrapeonTransactionalEmail,
} from '../_shared/email-template.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { reviewerAccessFromEnv } from '../_shared/reviewer-access.ts'
import { parseBody, z } from '../_shared/validate.ts'

const FN = 'trusted-device-action'
const RESEND_API = 'https://api.resend.com/emails'

const PlatformSchema = z.enum(['WEB', 'IOS', 'ANDROID'])
const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assess'),
    deviceToken: z.string().trim().min(32).max(512).optional(),
    rememberDevice: z.boolean().default(false),
    label: z.string().trim().max(120).optional(),
    platform: PlatformSchema,
  }),
  z.object({
    action: z.literal('verify'),
    challengeId: z.string().uuid(),
    code: z.string().trim().min(6).max(12),
  }),
  z.object({ action: z.literal('resume') }),
  z.object({
    action: z.literal('list'),
    deviceToken: z.string().trim().min(32).max(512).optional(),
  }),
  z.object({ action: z.literal('revoke'), deviceId: z.string().uuid() }),
  z.object({ action: z.literal('revoke-all'), exceptDeviceId: z.string().uuid().optional() }),
])

function json(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function randomCode() {
  const values = crypto.getRandomValues(new Uint32Array(1))
  return String(values[0] % 1_000_000).padStart(6, '0')
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

async function challengeHash(challengeId: string, userId: string, code: string) {
  const pepper = Deno.env.get('DEVICE_TRUST_PEPPER')?.trim() || getServiceRoleKey()
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${challengeId}:${userId}:${code}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function maskEmail(value: string) {
  const [local = '', domain = ''] = value.toLowerCase().split('@')
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`
}

function siteUrl() {
  return (Deno.env.get('SITE_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? 'https://drapeon.co')
    .replace(/\/+$/u, '')
}

function recipientName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const metadata = user.user_metadata ?? {}
  const candidate = [metadata.full_name, metadata.name, metadata.first_name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
  return candidate?.trim().split(/\s+/u)[0] ?? user.email?.split('@')[0] ?? 'there'
}

async function sendSecurityEmail(input: {
  to: string
  subject: string
  html: string
  text: string
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  if (!apiKey) return { accepted: false, providerReference: null, reason: 'missing_api_key' }
  const from = normalizeDrapeonSender(
    Deno.env.get('RESEND_FROM'),
    'Drapeon Security',
    'security@drapeon.co',
  )
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drapeon-device-trust/1.0',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  })
  if (!response.ok) {
    return { accepted: false, providerReference: null, reason: `resend_${response.status}` }
  }
  const payload = await response.json().catch(() => ({})) as { id?: string }
  return { accepted: true, providerReference: payload.id ?? null, reason: null }
}

async function sendCodeEmail(input: { to: string; code: string; label: string; name: string }) {
  const email = renderDrapeonTransactionalEmail({
    preheader: `${input.code} is your Drapeon sign-in code. It expires in ${DEVICE_TRUST_CODE_TTL_MINUTES} minutes.`,
    eyebrow: 'New device verification',
    headline: 'Confirm this sign-in',
    recipientName: input.name,
    body: `Someone signed in to your Drapeon account on ${input.label}. Enter this code only in Drapeon.`,
    details: [{ label: 'Device', value: input.label }],
    verificationCode: input.code,
    verificationHint: `Expires in ${DEVICE_TRUST_CODE_TTL_MINUTES} minutes. Never share this code.`,
    ctaLabel: 'Security help',
    ctaUrl: `${siteUrl()}/security`,
  })
  return sendSecurityEmail({
    to: input.to,
    subject: `${input.code} is your Drapeon sign-in code`,
    ...email,
  })
}

async function sendDeviceApprovedEmail(input: {
  to: string
  label: string
  name: string
  remembered: boolean
}) {
  const email = renderDrapeonTransactionalEmail({
    preheader: `A new device was approved for your Drapeon account.`,
    eyebrow: 'Security receipt',
    headline: 'New device approved',
    recipientName: input.name,
    body: input.remembered
      ? 'This device can now sign in without another email code for up to 30 days. You can revoke it at any time from Login & security.'
      : 'This sign-in was approved. Because the device was not remembered, it will need another email code after this session ends.',
    details: [
      { label: 'Device', value: input.label },
      { label: 'Trust', value: input.remembered ? 'Remembered for up to 30 days' : 'This session only' },
    ],
    ctaLabel: 'Review trusted devices',
    ctaUrl: `${siteUrl()}/account/settings#login-security`,
    secondaryCtaLabel: 'This was not me',
    secondaryCtaUrl: `${siteUrl()}/security`,
  })
  return sendSecurityEmail({
    to: input.to,
    subject: 'A new device was approved for your Drapeon account',
    ...email,
  })
}

function summarizeDevice(row: Record<string, unknown>, currentHash: string | null) {
  return {
    id: row.id,
    label: row.label,
    platform: row.platform,
    trustedAt: row.trusted_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    remembered: row.remembered,
    current: Boolean(currentHash && row.token_hash === currentHash),
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const caller = await getAuthUser(req)
    if (!caller) return json({ error: 'Sign in again before verifying this device.' }, 401, cors)
    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return json({ error: parsed.error }, 400, cors)

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 60, 5)
    if (!allowed) return rateLimitExceededResponse(cors)

    const body = parsed.data
    if (body.action === 'resume') {
      const { data: challenge } = await supabase
        .from('auth_device_challenges')
        .select('id, expires_at')
        .eq('user_id', caller.id)
        .eq('status', 'PENDING')
        .eq('delivery_status', 'ACCEPTED')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!challenge || !caller.email) {
        return json({ ok: true, challengeId: null }, 200, cors)
      }
      return json({
        ok: true,
        trusted: false,
        challengeId: challenge.id,
        maskedEmail: maskEmail(caller.email),
        expiresAt: challenge.expires_at,
      }, 200, cors)
    }

    if (body.action === 'assess') {
      const tokenHash = body.deviceToken ? await sha256(body.deviceToken) : null
      if (tokenHash) {
        const { data: trusted } = await supabase
          .from('auth_trusted_devices')
          .select('id, expires_at')
          .eq('user_id', caller.id)
          .eq('token_hash', tokenHash)
          .is('revoked_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()
        if (trusted?.id) {
          await supabase.from('auth_trusted_devices').update({ last_used_at: new Date().toISOString() }).eq('id', trusted.id)
          await audit(supabase, {
            event: 'auth.trusted_device_recognized',
            actor_id: caller.id,
            payload: { device_id: trusted.id, platform: body.platform },
          })
          return json({ ok: true, trusted: true, deviceId: trusted.id }, 200, cors)
        }
      }

      const reviewerAccess = reviewerAccessFromEnv(caller.email)
      if (reviewerAccess) {
        await audit(supabase, {
          event: 'auth.reviewer_device_challenge_bypassed',
          actor_id: caller.id,
          severity: 'info',
          payload: {
            platform: body.platform,
            expires_at: reviewerAccess.expiresAt,
          },
        })
        return json({ ok: true, trusted: true }, 200, cors)
      }

      if (!caller.email) return json({ error: 'This account has no verified email for device confirmation.' }, 409, cors)
      await supabase
        .from('auth_device_challenges')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('user_id', caller.id)
        .eq('status', 'PENDING')

      const challengeId = crypto.randomUUID()
      const code = randomCode()
      const expiresAt = new Date(Date.now() + DEVICE_TRUST_CODE_TTL_MINUTES * 60_000).toISOString()
      const label = normalizeDeviceLabel(body.label, body.platform as DeviceTrustPlatform)
      const codeHash = await challengeHash(challengeId, caller.id, code)
      const { error: insertError } = await supabase.from('auth_device_challenges').insert({
        id: challengeId,
        user_id: caller.id,
        code_hash: codeHash,
        label,
        platform: body.platform,
        remember_device: body.rememberDevice,
        expires_at: expiresAt,
      })
      if (insertError) throw insertError

      const delivery = await sendCodeEmail({
        to: caller.email,
        code,
        label,
        name: recipientName(caller),
      })
      await supabase.from('auth_device_challenges').update({
        delivery_status: delivery.accepted ? 'ACCEPTED' : 'FAILED',
        provider: 'RESEND',
        provider_reference: delivery.providerReference,
        updated_at: new Date().toISOString(),
      }).eq('id', challengeId)
      await audit(supabase, {
        event: delivery.accepted ? 'auth.device_challenge_sent' : 'auth.device_challenge_delivery_failed',
        actor_id: caller.id,
        severity: delivery.accepted ? 'info' : 'warn',
        payload: { challenge_id: challengeId, platform: body.platform, remembered: body.rememberDevice, reason: delivery.reason },
      })
      if (!delivery.accepted) {
        return json({ error: 'The verification email could not be sent. Try again shortly.' }, 503, cors)
      }
      return json({ ok: true, trusted: false, challengeId, maskedEmail: maskEmail(caller.email), expiresAt }, 200, cors)
    }

    if (body.action === 'verify') {
      if (!isDeviceTrustCode(body.code)) return json({ error: 'Enter the six-digit code.' }, 400, cors)
      const { data: challenge, error } = await supabase
        .from('auth_device_challenges')
        .select('*')
        .eq('id', body.challengeId)
        .eq('user_id', caller.id)
        .maybeSingle()
      if (error || !challenge) return json({ error: 'That verification request is no longer available.' }, 404, cors)
      if (challenge.status !== 'PENDING') return json({ error: 'That verification request has already finished.' }, 409, cors)
      if (Date.parse(challenge.expires_at) <= Date.now()) {
        await supabase.from('auth_device_challenges').update({ status: 'EXPIRED', updated_at: new Date().toISOString() }).eq('id', challenge.id)
        return json({ error: 'That code expired. Return to sign in for a new code.' }, 410, cors)
      }
      const attempts = Number(challenge.attempts ?? 0) + 1
      const candidate = await challengeHash(challenge.id, caller.id, body.code)
      if (!constantTimeEqual(candidate, challenge.code_hash)) {
        const locked = attempts >= DEVICE_TRUST_MAX_ATTEMPTS
        await supabase.from('auth_device_challenges').update({
          attempts,
          status: locked ? 'LOCKED' : 'PENDING',
          updated_at: new Date().toISOString(),
        }).eq('id', challenge.id)
        await audit(supabase, {
          event: locked ? 'auth.device_challenge_locked' : 'auth.device_challenge_failed',
          actor_id: caller.id,
          severity: 'warn',
          payload: { challenge_id: challenge.id, attempts },
        })
        return json({ error: locked ? 'Too many incorrect codes. Sign in again.' : 'That code is incorrect.', attemptsRemaining: Math.max(0, DEVICE_TRUST_MAX_ATTEMPTS - attempts) }, locked ? 423 : 400, cors)
      }

      const token = randomToken()
      const tokenHash = await sha256(token)
      const remembered = Boolean(challenge.remember_device)
      const expiresAt = deviceTrustExpiry(remembered).toISOString()
      const { data: device, error: deviceError } = await supabase.from('auth_trusted_devices').insert({
        user_id: caller.id,
        token_hash: tokenHash,
        label: challenge.label,
        platform: challenge.platform,
        remembered,
        expires_at: expiresAt,
      }).select('id').single()
      if (deviceError) throw deviceError
      await supabase.from('auth_device_challenges').update({
        attempts,
        status: 'VERIFIED',
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', challenge.id)
      await audit(supabase, {
        event: 'auth.device_verified',
        actor_id: caller.id,
        payload: { challenge_id: challenge.id, device_id: device.id, platform: challenge.platform, remembered },
      })
      if (caller.email) {
        const receipt = await sendDeviceApprovedEmail({
          to: caller.email,
          label: challenge.label,
          name: recipientName(caller),
          remembered,
        })
        await audit(supabase, {
          event: receipt.accepted
            ? 'auth.device_approved_receipt_accepted'
            : 'auth.device_approved_receipt_failed',
          actor_id: caller.id,
          severity: receipt.accepted ? 'info' : 'warn',
          payload: {
            challenge_id: challenge.id,
            device_id: device.id,
            provider: 'RESEND',
            provider_reference: receipt.providerReference,
            reason: receipt.reason,
          },
        })
      }
      return json({ ok: true, trusted: true, token, deviceId: device.id, remembered, expiresAt }, 200, cors)
    }

    const currentHash = 'deviceToken' in body && body.deviceToken ? await sha256(body.deviceToken) : null
    if (body.action === 'list') {
      const { data, error } = await supabase
        .from('auth_trusted_devices')
        .select('id, token_hash, label, platform, remembered, trusted_at, last_used_at, expires_at')
        .eq('user_id', caller.id)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('last_used_at', { ascending: false })
      if (error) throw error
      return json({ ok: true, devices: (data ?? []).map((row) => summarizeDevice(row, currentHash)) }, 200, cors)
    }

    if (body.action === 'revoke') {
      await supabase.from('auth_trusted_devices').update({ revoked_at: new Date().toISOString(), revoked_reason: 'USER_REVOKED' }).eq('id', body.deviceId).eq('user_id', caller.id)
      await audit(supabase, { event: 'auth.trusted_device_revoked', actor_id: caller.id, payload: { device_id: body.deviceId } })
      return json({ ok: true }, 200, cors)
    }

    let revokeQuery = supabase.from('auth_trusted_devices').update({ revoked_at: new Date().toISOString(), revoked_reason: 'USER_REVOKED_ALL' }).eq('user_id', caller.id).is('revoked_at', null)
    if (body.exceptDeviceId) revokeQuery = revokeQuery.neq('id', body.exceptDeviceId)
    const { error: revokeError } = await revokeQuery
    if (revokeError) throw revokeError
    await audit(supabase, { event: 'auth.trusted_devices_revoked_all', actor_id: caller.id, payload: { except_device_id: body.exceptDeviceId ?? null } })
    return json({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'Device verification could not finish. Try again.' }, 500, cors)
  }
})
