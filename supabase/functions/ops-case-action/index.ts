import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'

const FN = 'ops-case-action'

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function stringValue(value: unknown, maxLength = 2_000) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength ? value.trim() : null
}

function isPhoneClient(value: string | null) {
  return /Android|iPad|iPhone|iPod|IEMobile|Mobile|Opera Mini/iu.test(value ?? '')
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' } })
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()

  try {
    const accessAssertion = request.headers.get('x-drape-ops-access-assertion')?.trim() ?? ''
    const identity = await verifyCloudflareOpsAccess(accessAssertion, {
      teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
      normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
      sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
      requireSensitive: false,
      allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
      allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
    })
    if (!identity) return json({ error: 'Workforce access is required.', correlationId }, 401, cors)

    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = JSON.parse(raw || '{}') as Record<string, unknown>
    const issueId = stringValue(body.issueId, 180)
    const action = stringValue(body.action, 40)?.toUpperCase() ?? null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const idempotencyKey = stringValue(body.idempotencyKey, 180)
    const requestCorrelationId = stringValue(body.correlationId, 180) ?? correlationId
    const expectedRecordVersion = typeof body.expectedRecordVersion === 'number' && Number.isSafeInteger(body.expectedRecordVersion) ? body.expectedRecordVersion : null
    if (!issueId || !action || !idempotencyKey || !expectedRecordVersion) {
      return json({ error: 'Case, action, version, and idempotency key are required.', correlationId }, 400, cors)
    }

    const lineageAction = action === 'MERGE_CASE' || action === 'SPLIT_CASE'
    const deadJobReviewAction = action === 'RESOLVE_DEAD_JOB'
    if (lineageAction) {
      if (isPhoneClient(`${request.headers.get('user-agent') ?? ''} ${request.headers.get('x-drape-client-user-agent') ?? ''}`)) {
        return json({ error: 'Case lineage actions are desktop-only.', correlationId }, 403, cors)
      }
      const sensitiveIdentity = await verifyCloudflareOpsAccess(accessAssertion, {
        teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
        normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
        sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
        requireSensitive: true,
        allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
        allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
      })
      if (!sensitiveIdentity || !sensitiveIdentity.sensitiveAssurance) {
        return json({ error: 'Fresh sensitive workforce assurance is required.', correlationId }, 403, cors)
      }
    }

    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: principal, error: principalError } = await supabase
      .from('ops_workforce_principals')
      .select('id,email,access_subject,status,roles,permitted_environments,session_revoked_before,access_review_due_at')
      .eq('email', identity.email)
      .maybeSingle()
    if (principalError) throw principalError
    const issuedAt = identity.issuedAt ?? 0
    const revokedBefore = principal?.session_revoked_before ? Math.floor(Date.parse(principal.session_revoked_before) / 1000) : 0
    const accessReviewDueAt = principal?.access_review_due_at ? Date.parse(principal.access_review_due_at) : Number.NaN
    if (!principal || principal.status !== 'ACTIVE' || (principal.access_subject && principal.access_subject !== identity.subject) || !(principal.permitted_environments ?? []).includes(environment.toLowerCase()) || issuedAt <= revokedBefore || !Number.isFinite(accessReviewDueAt) || accessReviewDueAt <= Date.now()) {
      return json({ error: 'Workforce principal is unavailable or revoked.', correlationId }, 403, cors)
    }

    const selectedContext = Array.isArray(body.selectedContext)
      ? body.selectedContext.filter((entry): entry is string => typeof entry === 'string').slice(0, 5)
      : []
    const { data, error } = lineageAction
      ? await supabase.rpc('perform_ops_case_lineage_action', {
        p_source_issue_id: issueId,
        p_action: action,
        p_target_case_number: stringValue(body.targetCaseNumber, 64) ?? '',
        p_child_title: stringValue(body.childTitle, 180) ?? '',
        p_child_summary: stringValue(body.childSummary, 2_000) ?? '',
        p_selected_context: selectedContext,
        p_reason: reason,
        p_expected_source_version: expectedRecordVersion,
        p_expected_target_version: typeof body.expectedTargetVersion === 'number' && Number.isSafeInteger(body.expectedTargetVersion) ? body.expectedTargetVersion : null,
        p_idempotency_key: idempotencyKey,
        p_actor_principal_id: principal.id,
        p_actor_label: identity.email,
        p_environment: environment,
        p_correlation_id: requestCorrelationId,
      })
      : deadJobReviewAction
        ? await supabase.rpc('perform_ops_dead_job_review_action', {
          p_issue_id: issueId,
          p_reason: reason,
          p_expected_record_version: expectedRecordVersion,
          p_idempotency_key: idempotencyKey,
          p_actor_principal_id: principal.id,
          p_actor_label: identity.email,
          p_environment: environment,
          p_correlation_id: requestCorrelationId,
        })
        : await supabase.rpc('perform_ops_case_collaboration_action', {
        p_issue_id: issueId,
        p_action: action,
        p_reason: reason,
        p_expected_record_version: expectedRecordVersion,
        p_idempotency_key: idempotencyKey,
        p_actor_principal_id: principal.id,
        p_actor_label: identity.email,
        p_environment: environment,
        p_correlation_id: requestCorrelationId,
        })
    if (error) {
      const conflict = error.code === '40001'
      const forbidden = error.code === '42501'
      const terminal = error.code === '55000'
      const invalid = error.code === '22023'
      if (!conflict && !forbidden && !terminal && !invalid) {
        log('error', FN, 'rpc.failed', { correlation_id: correlationId, code: error.code })
      }
      return json(
        {
          error: conflict
            ? 'This case changed. Reload it before acting.'
            : forbidden
              ? 'This workforce role is not authorized for that queue action.'
              : terminal
                ? 'This case is terminal and cannot accept collaboration actions.'
                : invalid
                  ? 'The case action is invalid.'
                  : 'The case action could not be persisted.',
          code: error.code,
          correlationId,
        },
        conflict || terminal ? 409 : forbidden ? 403 : invalid ? 400 : 500,
        cors,
      )
    }
    return json({ ok: true, receipt: data, correlationId }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The case action could not be completed.', correlationId }, 500, cors)
  }
})
