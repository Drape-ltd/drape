/**
 * auth-sms-hook
 *
 * Supabase Auth Send SMS hook for routing OTP delivery through Drapeon's
 * configured SMS provider. This keeps Supabase in charge of OTP generation
 * and verification while Drapeon controls the carrier/provider.
 */

import { getCorsHeaders } from '../_shared/cors.ts'
import { log } from '../_shared/logger.ts'
import { normalizeStoredPhone } from '../_shared/phone.ts'
import { sendSmsDirect } from '../_shared/sms.ts'

const FN = 'auth-sms-hook'

type JsonRecord = Record<string, unknown>

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const leftBytes = new Uint8Array(leftHash)
  const rightBytes = new Uint8Array(rightHash)
  let diff = 0
  for (let index = 0; index < 32; index += 1) diff |= leftBytes[index] ^ rightBytes[index]
  return diff === 0
}

function getHookSecret() {
  return (
    Deno.env.get('AUTH_SMS_HOOK_SECRET') ??
    Deno.env.get('SUPABASE_AUTH_HOOK_SECRET') ??
    ''
  ).trim()
}

async function authorizeHook(req: Request) {
  const expected = getHookSecret()
  if (!expected) return { ok: false, status: 503, message: 'Auth SMS hook is not configured.' }

  const authHeader = req.headers.get('Authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const xHookSecret = req.headers.get('x-drape-auth-hook-secret')?.trim() ?? ''
  const provided = bearerToken || xHookSecret
  if (!provided) return { ok: false, status: 401, message: 'Auth SMS hook request is not authorized.' }

  const ok = await timingSafeEqual(provided, expected)
  return ok
    ? { ok: true, status: 200, message: 'Authorized' }
    : { ok: false, status: 401, message: 'Auth SMS hook request is not authorized.' }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolvePhone(payload: JsonRecord) {
  const user = asRecord(payload.user)
  return normalizeStoredPhone(
    asString(user.phone) ??
    asString(payload.phone) ??
    asString(payload.phone_number) ??
    asString(payload.to)
  )
}

function resolveOtp(payload: JsonRecord) {
  const sms = asRecord(payload.sms)
  return (
    asString(sms.otp) ??
    asString(sms.token) ??
    asString(payload.otp) ??
    asString(payload.token)
  )
}

function buildOtpMessage(otp: string) {
  return `Your Drapeon verification code is ${otp}. It expires soon. Do not share this code.`
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405, cors)
  }

  const auth = await authorizeHook(req)
  if (!auth.ok) {
    log('warn', FN, 'auth.rejected', { status: auth.status, reason: auth.message })
    return jsonResponse({ error: 'UNAUTHORIZED', message: auth.message }, auth.status, cors)
  }

  const payload = asRecord(await req.json().catch(() => ({})))
  const phone = resolvePhone(payload)
  const otp = resolveOtp(payload)

  if (!phone) {
    log('warn', FN, 'validation.missing_phone')
    return jsonResponse({ error: 'MISSING_PHONE', message: 'Auth SMS payload is missing a phone number.' }, 400, cors)
  }

  if (!otp) {
    log('warn', FN, 'validation.missing_otp')
    return jsonResponse({ error: 'MISSING_OTP', message: 'Auth SMS payload is missing an OTP.' }, 400, cors)
  }

  try {
    const result = await sendSmsDirect(phone, buildOtpMessage(otp))
    log('info', FN, 'otp.sent', { provider: result.provider })
    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('warn', FN, 'otp.failed', { error: message })
    return jsonResponse({
      error: 'SMS_SEND_FAILED',
      message: 'Drapeon could not send the verification SMS right now.',
    }, 502, cors)
  }
})
