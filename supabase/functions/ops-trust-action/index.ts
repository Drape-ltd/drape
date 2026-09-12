import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'

const FN = 'ops-trust-action'

function list(value: string | undefined) { return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean) }
function stringValue(value: unknown, maxLength = 1_000) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : null }
function json(body: Record<string, unknown>, status: number, cors: HeadersInit) { return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' } }) }
function hasVerifiedServiceRoleBroker(request: Request) {
  const authorization = request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '').trim() ?? ''
  const apiKey = request.headers.get('apikey')?.trim() ?? ''
  const [encodedHeader, encodedPayload, encodedSignature, extra] = authorization.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra || authorization !== apiKey) return false

  try {
    const normalized = encodedPayload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { exp?: unknown; iat?: unknown; ref?: unknown; role?: unknown }
    const expectedProjectRef = new URL(getSupabaseUrl()).hostname.split('.')[0]
    const now = Math.floor(Date.now() / 1000)
    return claims.role === 'service_role' &&
      claims.ref === expectedProjectRef &&
      typeof claims.iat === 'number' && Number.isFinite(claims.iat) && claims.iat <= now + 30 &&
      typeof claims.exp === 'number' && Number.isFinite(claims.exp) && claims.exp > now
  } catch {
    return false
  }
}

async function completeReceipt(supabase: SupabaseClient, input: { receiptId: string; principalId: string; outcome: 'SUCCEEDED' | 'FAILED'; humanStatus: string; sideEffects?: unknown[]; blockers?: unknown[]; nextAction?: string | null; failureCode?: string | null }) {
  const { data, error } = await supabase.rpc('complete_ops_action_receipt', {
    p_receipt_id: input.receiptId,
    p_actor_principal_id: input.principalId,
    p_outcome: input.outcome,
    p_human_status: input.humanStatus,
    p_side_effects: input.sideEffects ?? [],
    p_blockers: input.blockers ?? [],
    p_next_action: input.nextAction ?? null,
    p_failure_code: input.failureCode ?? null,
  })
  if (error) throw new Error(`Could not complete trust receipt: ${error.message}`)
  return data
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()

  try {
    // Supabase's gateway verifies this JWT before invocation (`verify_jwt = true`).
    // Bind that verified server credential to this exact project before accepting
    // the separately signed Cloudflare workforce assertion below.
    if (!hasVerifiedServiceRoleBroker(request)) {
      return json({ error: 'Trusted Ops broker authentication is required.', correlationId }, 401, cors)
    }
    const sensitiveAudiences = list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')).map((audience) => audience.toLowerCase())
    const identity = await verifyCloudflareOpsAccess(request.headers.get('x-drape-ops-access-assertion')?.trim() ?? '', {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences,
      requireSensitive: false,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    const brokeredSensitiveAssurance = Boolean(
      identity &&
      sensitiveAudiences.some((audience) => identity.audiences.includes(audience)) &&
      Math.floor(Date.now() / 1000) - identity.issuedAt <= 15 * 60,
    )
    if (!identity || !brokeredSensitiveAssurance) {
      return json({ error: 'Fresh protected workforce access is required.', correlationId }, 401, cors)
    }

    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = JSON.parse(raw || '{}') as Record<string, unknown>
    const issueId = stringValue(body.issueId, 180)
    const profileId = stringValue(body.profileId, 180)
    const tailorUserId = stringValue(body.tailorUserId, 180)
    const decision = stringValue(body.decision, 20)?.toUpperCase() ?? null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const rejectionCode = typeof body.rejectionCode === 'string' ? body.rejectionCode.trim().toUpperCase() : ''
    const idempotencyKey = stringValue(body.idempotencyKey, 180)
    const requestCorrelationId = stringValue(body.correlationId, 180) ?? correlationId
    const expectedRecordVersion = typeof body.expectedRecordVersion === 'number' && Number.isSafeInteger(body.expectedRecordVersion) ? body.expectedRecordVersion : null
    if (!issueId || !profileId || !tailorUserId || !decision || !idempotencyKey || !expectedRecordVersion || !['APPROVE', 'REJECT'].includes(decision)) {
      return json({ error: 'Case, profile, tailor, decision, version, and idempotency key are required.', correlationId }, 400, cors)
    }

    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: principal, error: principalError } = await supabase.from('ops_workforce_principals').select('id,email,access_subject,status,roles,permitted_environments,session_revoked_before').eq('email', identity.email).maybeSingle()
    if (principalError) throw principalError
    const issuedAt = identity.issuedAt ?? 0
    const revokedBefore = principal?.session_revoked_before ? Math.floor(Date.parse(principal.session_revoked_before) / 1000) : 0
    if (!principal || principal.status !== 'ACTIVE' || (principal.access_subject && principal.access_subject !== identity.subject) || !(principal.permitted_environments ?? []).includes(environment.toLowerCase()) || issuedAt <= revokedBefore) {
      return json({ error: 'Workforce principal is unavailable or revoked.', correlationId }, 403, cors)
    }

    const { data: prepared, error: prepareError } = await supabase.rpc('prepare_ops_trust_verification_decision', {
      p_issue_id: issueId,
      p_profile_id: profileId,
      p_tailor_user_id: tailorUserId,
      p_decision: decision,
      p_reason: reason,
      p_rejection_code: rejectionCode || null,
      p_expected_record_version: expectedRecordVersion,
      p_idempotency_key: idempotencyKey,
      p_actor_principal_id: principal.id,
      p_actor_label: identity.email,
      p_environment: environment,
      p_sensitive_assurance: brokeredSensitiveAssurance,
      p_correlation_id: requestCorrelationId,
    })
    if (prepareError) {
      const conflict = prepareError.code === '40001'
      return json({ error: conflict ? 'This case changed. Reload it before deciding.' : prepareError.message, code: prepareError.code, correlationId }, conflict ? 409 : 400, cors)
    }
    const preflight = prepared as { duplicate?: boolean; receiptId?: string; receiptOutcome?: string }
    if (preflight.duplicate) return json({ ok: true, duplicate: true, receipt: preflight, correlationId }, 200, cors)
    if (!preflight.receiptId) throw new Error('Trust preflight did not return a receipt.')

    const decisionResponse = await fetch(`${getSupabaseUrl().replace(/\/+$/u, '')}/functions/v1/handle-verification-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getServiceRoleKey()}`, apikey: getServiceRoleKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailorUserId, decision, reason: reason || null, rejectionCode: rejectionCode || null, performedBy: identity.email, performedRole: (principal.roles ?? []).join(','), }),
    })
    const outcome = await decisionResponse.json().catch(() => ({})) as Record<string, unknown>
    if (!decisionResponse.ok || outcome.ok !== true) {
      const receipt = await completeReceipt(supabase, { receiptId: preflight.receiptId, principalId: principal.id, outcome: 'FAILED', humanStatus: 'The protected trust decision did not reach an authoritative domain outcome.', sideEffects: [{ type: 'VERIFICATION_DECISION', status: 'FAILED' }], blockers: [{ code: String(outcome.error ?? 'VERIFICATION_DECISION_FAILED') }], nextAction: 'Reread the case and retry only after correcting the recorded failure.', failureCode: String(outcome.error ?? 'VERIFICATION_DECISION_FAILED') })
      return json({ error: outcome.message ?? outcome.error ?? 'Trust decision failed.', receipt, correlationId }, decisionResponse.status >= 400 ? decisionResponse.status : 502, cors)
    }

    const emailSent = outcome.emailSent === true
    const pushStatus = typeof outcome.pushStatus === 'string' ? outcome.pushStatus : null
    const communicationNeedsAttention = !emailSent || pushStatus === 'ERROR'
    const receipt = await completeReceipt(supabase, {
      receiptId: preflight.receiptId,
      principalId: principal.id,
      outcome: 'SUCCEEDED',
      humanStatus: communicationNeedsAttention ? 'Trust decision persisted; one or more notification outcomes need review.' : 'Trust decision persisted and notification outcomes were recorded.',
      sideEffects: [
        { type: 'VERIFICATION_DECISION', status: 'COMPLETED', decision, profileId },
        { type: 'EMAIL', status: emailSent ? 'SENT' : 'FAILED' },
        { type: 'PUSH', status: pushStatus ?? 'UNKNOWN' },
      ],
      blockers: communicationNeedsAttention ? [{ code: 'COMMUNICATION_OUTCOME_NEEDS_ATTENTION' }] : [],
      nextAction: communicationNeedsAttention ? 'Retry or reconcile the failed communication without repeating the trust decision.' : null,
      failureCode: communicationNeedsAttention ? 'COMMUNICATION_OUTCOME_NEEDS_ATTENTION' : null,
    })
    return json({ ok: true, receipt, decision: outcome, warning: communicationNeedsAttention ? 'Decision saved; notification follow-up is required.' : undefined, correlationId }, communicationNeedsAttention ? 207 : 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The protected trust decision could not be completed.', correlationId }, 500, cors)
  }
})
