import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { getClientIp, rateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { sendSmsDirect } from '../_shared/sms.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { TAILOR_TRUST_VIDEO_CHALLENGES } from '../../../packages/shared/src/identity-trust.ts'

const FN = 'identity-handoff-action'
const RESEND_API = 'https://api.resend.com/emails'
const TOKEN_TTL_MS = 15 * 60 * 1000
const SIGNED_UPLOAD_EXPIRES_SECONDS = 10 * 60
const TRUST_VIDEO_BUCKET = 'trust-verification'
const IDENTITY_RETENTION_ENFORCEMENT = Deno.env.get('IDENTITY_RETENTION_ENFORCEMENT') === 'true'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
  }),
  z.object({
    action: z.literal('send-link'),
    token: z.string().trim().min(32).max(256),
    channel: z.enum(['SMS', 'EMAIL']),
    requestedDelivery: z.string().trim().min(3).max(320),
  }),
  z.object({
    action: z.literal('resolve-token'),
    token: z.string().trim().min(32).max(256),
  }),
  z.object({
    action: z.literal('create-upload-url'),
    token: z.string().trim().min(32).max(256),
    contentType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  }),
  z.object({
    action: z.literal('submit'),
    token: z.string().trim().min(32).max(256),
    storagePath: z.string().trim().min(1).max(500),
    consentGranted: z.boolean().optional(),
    consentVersion: z.string().trim().min(1).max(120).optional(),
    consentSource: z.enum(['MOBILE_SETUP', 'WEB_SETUP', 'MOBILE_HANDOFF', 'WEB_HANDOFF']).optional(),
    locale: z.string().trim().min(2).max(40).optional(),
  }),
])

type HandoffRow = {
  id: string
  tailor_user_id: string
  status: 'CREATED' | 'OPENED' | 'CAPTURED' | 'SUBMITTED' | 'EXPIRED' | 'CANCELLED'
  expires_at: string
  storage_path?: string | null
  challenge_id?: string | null
  challenge_text?: string | null
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  const payload =
    typeof body.error === 'string' && typeof body.message !== 'string'
      ? { ...body, message: body.error }
      : body
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function getSiteUrl() {
  return (
    Deno.env.get('SITE_URL') ??
    Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
    'https://drapeon.co'
  ).replace(/\/+$/u, '')
}

function getResendFrom() {
  return Deno.env.get('RESEND_FROM') ?? 'Drapeon Trust <security@drapeon.co>'
}

function getResendApiKey() {
  return Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
}

async function notifyOpsVerification(
  supabase: SupabaseClient,
  tailorId: string,
  deliveryKey: string,
) {
  const serviceRoleKey = getServiceRoleKey()
  const { data, error } = await supabase.functions.invoke('notify-ops-verification', {
    body: { tailorId, deliveryKey },
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true) {
    throw new Error('Verification notification returned an invalid response.')
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function createRawToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function handoffPath(token: string) {
  return `/verify-handoff/${encodeURIComponent(token)}`
}

function handoffUrl(token: string) {
  return `${getSiteUrl()}${handoffPath(token)}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function maskDelivery(value: string) {
  const trimmed = value.trim()
  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.toLowerCase().split('@')
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`
  }
  return trimmed.replace(/\d(?=\d{4})/gu, '•')
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())
}

function normalizePhone(value: string) {
  const trimmed = value.trim()
  if (/^\+\d{7,15}$/u.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D+/gu, '')
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`
  return null
}

async function sendHandoffEmail(input: { to: string; url: string }) {
  const apiKey = getResendApiKey()
  if (!apiKey) throw new Error('Email delivery is not configured.')

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drape-identity-handoff/1.0',
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [input.to],
      subject: 'Complete your Drapeon trust video',
      html: `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h1 style="font-size:24px;margin:0 0 12px">Record your trust video on your phone</h1>
  <p style="line-height:1.6;margin:0 0 16px">Open this secure link on your smartphone, keep your face visible, and record the private phrase shown on screen. Drapeon does not ask for a government ID.</p>
  <a href="${escapeHtml(input.url)}" style="display:inline-block;padding:12px 20px;background:#2f6844;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Open trust video</a>
  <p style="line-height:1.6;color:#6b7280;margin-top:20px">This link expires in 15 minutes and only works for this verification session.</p>
</div>`,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Email delivery failed with ${response.status}${body ? `: ${body}` : ''}`)
  }
}

function assertActive(row: HandoffRow) {
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error('Verification handoff session has expired. Start a new verification session.')
  }
  if (row.status === 'SUBMITTED') {
    throw new Error('Verification handoff session was already submitted.')
  }
  if (row.status === 'EXPIRED' || row.status === 'CANCELLED') {
    throw new Error('Verification handoff session is no longer active.')
  }
}

async function getHandoffByToken(supabase: any, token: string) {
  const tokenHash = await sha256Base64Url(token)
  const { data, error } = await supabase
    .from('identity_verification_handoffs')
    .select('id, tailor_user_id, status, expires_at, storage_path, challenge_id, challenge_text')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    log('error', FN, 'handoff.lookup_failed', { error: error.message })
    throw new Error('Verification handoff lookup failed. Try again.')
  }
  if (!data) throw new Error('Verification handoff session was not found.')

  const row = data as HandoffRow
  assertActive(row)
  return row
}

async function expireIfNeeded(supabase: any, row: HandoffRow) {
  if (new Date(row.expires_at).getTime() > Date.now()) return false
  await supabase
    .from('identity_verification_handoffs')
    .update({ status: 'EXPIRED' })
    .eq('id', row.id)
  return true
}

function videoExtension(contentType: 'video/mp4' | 'video/quicktime' | 'video/webm') {
  if (contentType === 'video/quicktime') return 'mov'
  if (contentType === 'video/webm') return 'webm'
  return 'mp4'
}

function challengeVideoPath(
  userId: string,
  challengeId: string,
  contentType: 'video/mp4' | 'video/quicktime' | 'video/webm',
) {
  return `verification-video/${userId}/challenge_${challengeId}_${Date.now()}.${videoExtension(contentType)}`
}

function splitStoragePath(path: string) {
  const parts = path.split('/')
  return {
    folder: parts.slice(0, -1).join('/'),
    filename: parts.at(-1) ?? '',
  }
}

async function ensureStorageObjectExists(supabase: any, path: string) {
  const { folder, filename } = splitStoragePath(path)
  if (!folder || !filename) return false
  const { data, error } = await supabase.storage
    .from(TRUST_VIDEO_BUCKET)
    .list(folder, { search: filename, limit: 1 })
  if (error) {
    log('warn', FN, 'storage.lookup_failed', { path, error: error.message })
    return false
  }
  return (data ?? []).some((entry: { name?: string }) => entry.name === filename)
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors)

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ip = getClientIp(req)

  try {
    const raw = await req.json().catch(() => null)
    const parsed = parseBody(BodySchema, raw)
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400, cors)
    const body = parsed.data
    const caller = await getAuthUser(req)
    const rateLimitKey = caller?.id ?? ip
    const limit = body.action === 'resolve-token' ? 30 : body.action === 'send-link' ? 3 : 10
    const allowed = await rateLimit(
      supabase,
      rateLimitKey,
      `identity-handoff:${body.action}`,
      limit,
      15 * 60_000,
      { ip, userId: caller?.id ?? null, userAgent: req.headers.get('user-agent') },
    )
    if (!allowed.allowed) return rateLimitExceededResponse(cors, allowed.retryAfter)

    if (body.action === 'create') {
      if (!caller?.id) return jsonResponse({ error: 'Sign in before starting trust verification.' }, 401, cors)

      const { data: profile, error: profileError } = await supabase
        .from('tailor_profiles')
        .select('id, id_verification_status')
        .eq('user_id', caller.id)
        .maybeSingle()

      if (profileError) throw new Error('Could not load your tailor profile.')
      if (!profile?.id) {
        return jsonResponse({ error: 'Complete your tailor profile before trust verification.' }, 409, cors)
      }
      if (['PENDING', 'VERIFIED', 'APPROVED'].includes(String(profile.id_verification_status ?? ''))) {
        return jsonResponse({ error: 'Trust verification is already pending or approved.' }, 409, cors)
      }

      await supabase
        .from('identity_verification_handoffs')
        .update({ status: 'CANCELLED' })
        .eq('tailor_user_id', caller.id)
        .in('status', ['CREATED', 'OPENED', 'CAPTURED'])

      const token = createRawToken()
      const tokenHash = await sha256Base64Url(token)
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
      const randomBytes = new Uint32Array(1)
      crypto.getRandomValues(randomBytes)
      const challenge = TAILOR_TRUST_VIDEO_CHALLENGES[
        randomBytes[0] % TAILOR_TRUST_VIDEO_CHALLENGES.length
      ] ?? TAILOR_TRUST_VIDEO_CHALLENGES[0]
      const { data, error } = await supabase
        .from('identity_verification_handoffs')
        .insert({
          tailor_user_id: caller.id,
          token_hash: tokenHash,
          status: 'CREATED',
          channel: 'QR',
          expires_at: expiresAt,
          challenge_id: challenge.id,
          challenge_text: challenge.text,
          metadata: {
            created_ip: ip,
            user_agent: req.headers.get('user-agent') ?? null,
            evidence_type: 'CHALLENGE_VIDEO',
            government_id_collected: false,
            automated_biometrics: false,
          },
        })
        .select('id')
        .single()

      if (error) throw new Error('Could not start trust verification. Try again.')

      await audit(supabase, {
        event: 'identity_handoff.created',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: 'info',
        payload: { handoff_id: data.id, expires_at: expiresAt },
      })

      return jsonResponse({
        handoffId: data.id,
        token,
        path: handoffPath(token),
        url: handoffUrl(token),
        expiresAt,
        challengeId: challenge.id,
        challengeText: challenge.text,
      }, 200, cors)
    }

    if (body.action === 'send-link') {
      if (!caller?.id) return jsonResponse({ error: 'Sign in before sending the trust video link.' }, 401, cors)
      const row = await getHandoffByToken(supabase, body.token)
      if (row.tailor_user_id !== caller.id) return jsonResponse({ error: 'This handoff does not belong to your account.' }, 403, cors)

      const url = handoffUrl(body.token)
      if (body.channel === 'EMAIL') {
        if (!isEmail(body.requestedDelivery)) {
          return jsonResponse({ error: 'Enter a valid email address.' }, 400, cors)
        }
        await sendHandoffEmail({ to: body.requestedDelivery, url })
      } else {
        const phone = normalizePhone(body.requestedDelivery)
        if (!phone) return jsonResponse({ error: 'Enter a valid phone number with country code.' }, 400, cors)
        await sendSmsDirect(phone, `Drapeon trust video: open ${url} on your phone. The link expires in 15 minutes.`)
      }

      await supabase
        .from('identity_verification_handoffs')
        .update({
          channel: body.channel,
          requested_delivery: body.requestedDelivery,
          metadata: { delivery_masked: maskDelivery(body.requestedDelivery) },
        })
        .eq('id', row.id)

      return jsonResponse({ ok: true, message: 'Trust video link sent.' }, 200, cors)
    }

    const row = await getHandoffByToken(supabase, body.token)
    if (await expireIfNeeded(supabase, row)) {
      return jsonResponse({ error: 'Verification handoff session has expired. Start a new verification session.' }, 410, cors)
    }

    if (body.action === 'resolve-token') {
      if (row.status === 'CREATED') {
        await supabase
          .from('identity_verification_handoffs')
          .update({
            status: 'OPENED',
            opened_at: new Date().toISOString(),
            metadata: { opened_ip: ip, user_agent: req.headers.get('user-agent') ?? null },
          })
          .eq('id', row.id)
      }
      return jsonResponse({
        handoffId: row.id,
        status: row.status === 'CREATED' ? 'OPENED' : row.status,
        expiresAt: row.expires_at,
        challengeId: row.challenge_id ?? null,
        challengeText: row.challenge_text ?? null,
      }, 200, cors)
    }

    if (body.action === 'create-upload-url') {
      if (!['CREATED', 'OPENED', 'CAPTURED'].includes(row.status)) {
        return jsonResponse({ error: 'Open the verification handoff before recording your video.' }, 409, cors)
      }
      if (!row.challenge_id || !row.challenge_text) {
        return jsonResponse({ error: 'Verification challenge is missing. Start a new session.' }, 409, cors)
      }
      const path = challengeVideoPath(row.tailor_user_id, row.challenge_id, body.contentType)
      const { data, error } = await supabase.storage
        .from(TRUST_VIDEO_BUCKET)
        .createSignedUploadUrl(path)
      if (error || !data?.signedUrl || !data?.path || !data?.token) {
        log('error', FN, 'storage.signed_upload_failed', { handoff_id: row.id, error: error?.message })
        throw new Error('Could not prepare secure upload. Try again.')
      }
      await supabase
        .from('identity_verification_handoffs')
        .update({
          status: 'CAPTURED',
          opened_at: row.status === 'CREATED' ? new Date().toISOString() : undefined,
          storage_path: path,
          media_content_type: body.contentType,
        })
        .eq('id', row.id)
      return jsonResponse({
        bucket: TRUST_VIDEO_BUCKET,
        path,
        signedUrl: data.signedUrl,
        uploadToken: data.token,
        expiresInSeconds: SIGNED_UPLOAD_EXPIRES_SECONDS,
      }, 200, cors)
    }

    if (body.action === 'submit') {
      const hasVersionedConsent =
        body.consentGranted === true &&
        typeof body.consentVersion === 'string' &&
        typeof body.consentSource === 'string'

      if (IDENTITY_RETENTION_ENFORCEMENT && !hasVersionedConsent) {
        return jsonResponse({
          code: 'IDENTITY_CONSENT_REQUIRED',
          error: 'Review and accept the trust verification consent before submitting.',
        }, 400, cors)
      }

      const expectedPrefix = `verification-video/${row.tailor_user_id}/challenge_${row.challenge_id}_`
      if (!body.storagePath.startsWith(expectedPrefix) || !/\.(mp4|mov|webm)$/iu.test(body.storagePath)) {
        return jsonResponse({ error: 'Invalid trust verification video path.' }, 400, cors)
      }
      if (row.storage_path && row.storage_path !== body.storagePath) {
        return jsonResponse({ error: 'Trust video path does not match this handoff session.' }, 400, cors)
      }

      const exists = await ensureStorageObjectExists(supabase, body.storagePath)
      if (!exists) return jsonResponse({ error: 'Trust video upload was not found. Record and upload again.' }, 409, cors)

      const submissionRpc = hasVersionedConsent
        ? 'submit_identity_verification_handoff_with_consent'
        : 'submit_identity_verification_handoff'
      const submissionParams = hasVersionedConsent
        ? {
            p_handoff_id: row.id,
            p_tailor_user_id: row.tailor_user_id,
            p_storage_path: body.storagePath,
            p_policy_version: body.consentVersion,
            p_source: body.consentSource,
            p_locale: body.locale ?? null,
          }
        : {
            p_handoff_id: row.id,
            p_tailor_user_id: row.tailor_user_id,
            p_storage_path: body.storagePath,
          }

      const { data, error } = await supabase.rpc(submissionRpc, submissionParams)

      if (error) {
        log('warn', FN, 'handoff.submit_failed', {
          handoff_id: row.id,
          tailor_user_id: row.tailor_user_id,
          error: error.message,
        })
        return jsonResponse({ error: error.message }, 409, cors)
      }

      const result = Array.isArray(data) ? data[0] : data
      const profileId = typeof result?.profile_id === 'string' ? result.profile_id : null

      await audit(supabase, {
        event: 'trust_video_handoff.submitted',
        actor_id: row.tailor_user_id,
        actor_role: 'TAILOR',
        severity: 'info',
        payload: {
          handoff_id: row.id,
          storage_path: body.storagePath,
          consent_version: hasVersionedConsent ? body.consentVersion : null,
          consent_source: hasVersionedConsent ? body.consentSource : null,
          challenge_id: row.challenge_id,
          evidence_type: 'CHALLENGE_VIDEO',
        },
      })

      const reviewIssue = await createOrRefreshOpsIssue(supabase, {
        issueType: 'TAILOR_VERIFICATION',
        severity: 'HIGH',
        source: FN,
        actorId: row.tailor_user_id,
        actorRole: 'TAILOR',
        userId: row.tailor_user_id,
        tailorProfileId: profileId,
        relatedEntityType: 'identity_verification_handoff',
        relatedEntityId: row.id,
        stage: 'PENDING_REVIEW',
        title: 'A tailor trust verification is ready for review',
        description: 'A tailor submitted the required private challenge video and completed marketplace setup.',
        recommendedAction: 'Review the challenge video, profile photo, portfolio evidence, and onboarding proof item before approving or rejecting the tailor.',
        dedupeKey: `tailor-verification:${profileId ?? row.tailor_user_id}`,
        metadata: {
          handoff_id: row.id,
          challenge_id: row.challenge_id,
          evidence_type: 'CHALLENGE_VIDEO',
          submission_status: 'PENDING',
        },
      })

      if (!reviewIssue) {
        log('error', FN, 'ops_issue.create_failed', {
          handoff_id: row.id,
          tailor_user_id: row.tailor_user_id,
          tailor_profile_id: profileId,
        })
      }

      let notificationQueued = false
      try {
        await enqueueBackgroundJob(supabase, {
          jobType: 'SEND_OPS_VERIFICATION_EMAIL',
          eventType: 'tailor.verification_submitted',
          aggregateType: 'tailor_profile',
          aggregateId: profileId ?? row.tailor_user_id,
          actorId: row.tailor_user_id,
          actorRole: 'TAILOR',
          idempotencyKey: `tailor-verification-email:${row.id}`,
          payload: {
            tailorId: row.tailor_user_id,
            profileId,
            handoffId: row.id,
            deliveryKey: `verification-${row.id}`,
          },
          metadata: {
            source: FN,
            opsIssueId: reviewIssue?.id ?? null,
          },
          priority: 10,
          maxAttempts: 8,
        })
        notificationQueued = true
      } catch (enqueueError) {
        log('error', FN, 'notify_ops.enqueue_failed', {
          handoff_id: row.id,
          tailor_user_id: row.tailor_user_id,
          error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
        })
      }

      let opsEmailAccepted = false
      try {
        await notifyOpsVerification(
          supabase,
          row.tailor_user_id,
          `verification-${row.id}`,
        )
        opsEmailAccepted = true
      } catch (notifyError) {
        log('error', FN, 'notify_ops.immediate_failed', {
          handoff_id: row.id,
          tailor_user_id: row.tailor_user_id,
          notification_queued: notificationQueued,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        })
      }

      return jsonResponse({
        ok: true,
        status: 'PENDING',
        profileId,
        reviewQueued: Boolean(reviewIssue),
        notificationQueued,
        opsEmailAccepted,
        message: 'Trust video submitted for review.',
      }, 200, cors)
    }

    return jsonResponse({ error: 'Unsupported action.' }, 400, cors)
  } catch (error) {
    log('error', FN, 'request.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Verification handoff could not finish right now.',
    }, 500, cors)
  }
})
