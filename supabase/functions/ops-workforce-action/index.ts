import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import { isOpsUuid, validateOpsWorkforceRequest } from '../_shared/ops-workforce-policy.ts'

const FN = 'ops-workforce-action'

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function isPhoneClient(value: string | null) {
  return /Android|iPad|iPhone|iPod|IEMobile|Mobile|Opera Mini/iu.test(value ?? '')
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const suppliedCorrelationId = request.headers.get('x-correlation-id')?.trim()
  const correlationId = isOpsUuid(suppliedCorrelationId) ? suppliedCorrelationId : crypto.randomUUID()

  try {
    if (isPhoneClient(`${request.headers.get('user-agent') ?? ''} ${request.headers.get('x-drape-client-user-agent') ?? ''}`)) {
      return json({ error: 'Workforce access changes are desktop-only.', correlationId }, 403, cors)
    }

    const identity = await verifyCloudflareOpsAccess(request.headers.get('x-drape-ops-access-assertion')?.trim() ?? '', {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
      requireSensitive: true,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity || !identity.sensitiveAssurance) {
      return json({ error: 'Fresh protected workforce access is required.', correlationId }, 401, cors)
    }

    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    let body: unknown
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return json({ error: 'The workforce offboarding request is invalid.', correlationId }, 400, cors)
    }
    const requestPolicy = validateOpsWorkforceRequest(body)
    if (!requestPolicy.ok) return json({ error: 'The workforce offboarding request is invalid.', correlationId }, 400, cors)
    const command = requestPolicy.value

    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) {
      return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    }

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: principal, error: principalError } = await supabase
      .from('ops_workforce_principals')
      .select('id,email,access_subject,status,roles,permitted_environments,session_revoked_before,access_review_due_at')
      .eq('email', identity.email)
      .maybeSingle()
    if (principalError) throw principalError
    const revokedBefore = principal?.session_revoked_before ? Math.floor(Date.parse(principal.session_revoked_before) / 1000) : 0
    const accessReviewDueAt = principal?.access_review_due_at ? Date.parse(principal.access_review_due_at) : Number.NaN
    if (
      !principal
      || principal.status !== 'ACTIVE'
      || !Array.isArray(principal.roles)
      || !principal.roles.includes('admin')
      || (principal.access_subject && principal.access_subject !== identity.subject)
      || !(principal.permitted_environments ?? []).includes(environment.toLowerCase())
      || identity.issuedAt <= revokedBefore
      || !Number.isFinite(accessReviewDueAt)
      || accessReviewDueAt <= Date.now()
    ) {
      return json({ error: 'An active, reviewed admin principal is required.', correlationId }, 403, cors)
    }

    const { data, error } = await supabase.rpc('perform_ops_workforce_offboarding_action', {
      p_target_principal_id: command.targetPrincipalId,
      p_action: command.action,
      p_reason: command.reason,
      p_expected_target_updated_at: command.expectedTargetUpdatedAt,
      p_expected_case_version: command.expectedCaseVersion,
      p_evidence_refs: command.evidenceRefs,
      p_idempotency_key: command.idempotencyKey,
      p_actor_principal_id: principal.id,
      p_actor_label: identity.email,
      p_environment: environment,
      p_sensitive_assurance: identity.sensitiveAssurance,
      p_correlation_id: correlationId,
    })
    if (error) {
      const conflict = error.code === '40001'
      const forbidden = error.code === '42501'
      const terminal = error.code === '55000'
      const invalid = error.code === '22023' || error.code === '22P02'
      if (!conflict && !forbidden && !terminal && !invalid) {
        log('error', FN, 'rpc.failed', { correlation_id: correlationId, code: error.code })
      }
      return json({
        error: conflict
          ? 'The workforce or offboarding case changed. Reload before continuing.'
          : forbidden
            ? 'This operator cannot perform the requested workforce access action.'
            : terminal
              ? 'The offboarding workflow is already terminal or missing required prior evidence.'
              : invalid
                ? 'The workforce offboarding request is invalid.'
                : 'The workforce offboarding action could not be persisted.',
        code: error.code,
        correlationId,
      }, conflict || terminal ? 409 : forbidden ? 403 : invalid ? 400 : 500, cors)
    }

    const receipt = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
    const receiptCorrelationId = isOpsUuid(receipt.correlationId) ? receipt.correlationId : correlationId
    return json({ ok: true, receipt: data, correlationId: receiptCorrelationId }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The protected workforce action could not be completed.', correlationId }, 500, cors)
  }
})
