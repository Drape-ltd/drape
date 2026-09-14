import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin' }, 403)
  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session)) {
    return json({ error: 'named-workforce-session-required' }, 401)
  }

  const headerStore = await headers()
  const raw = await request.text()
  if (raw.length > 16_384) return json({ error: 'request-too-large' }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }
  const action = typeof body?.action === 'string' ? body.action.trim().toUpperCase() : ''
  if (!['ACKNOWLEDGE', 'ASSIGN_SELF', 'ADD_NOTE', 'ESCALATE', 'RESOLVE_DEAD_JOB', 'MERGE_CASE', 'SPLIT_CASE'].includes(action)) return json({ error: 'invalid-action' }, 400)
  if (action === 'MERGE_CASE' || action === 'SPLIT_CASE') {
    if (session.role !== 'admin') return json({ error: 'admin-required' }, 403)
    if (!hasFreshOpsMfa(session)) return json({ error: 'protected-access-required' }, 401)
    if (isRestrictedOpsPhoneHeaders(headerStore)) return json({ error: 'desktop-required' }, 403)
  }

  const correlationId = headerStore.get('x-correlation-id')?.trim() || randomUUID()
  if (session.mode === 'local-workforce') {
    const local = await resolveLocalWorkforcePrincipal(session)
    if (!local) return json({ error: 'local-case-workforce-principal-unavailable', correlationId }, 403)
    const { client, principal } = local
    const expectedRecordVersion = typeof body.expectedRecordVersion === 'number' && Number.isSafeInteger(body.expectedRecordVersion) ? body.expectedRecordVersion : null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
    const requestCorrelationId = typeof body.correlationId === 'string' ? body.correlationId.trim() : correlationId
    const lineageAction = action === 'MERGE_CASE' || action === 'SPLIT_CASE'
    const deadJobReviewAction = action === 'RESOLVE_DEAD_JOB'
    const selectedContext = Array.isArray(body.selectedContext)
      ? body.selectedContext.filter((entry): entry is string => typeof entry === 'string').slice(0, 5)
      : []
    const { data, error } = lineageAction
      ? await client.rpc('perform_ops_case_lineage_action', {
        p_source_issue_id: body.issueId,
        p_action: action,
        p_target_case_number: typeof body.targetCaseNumber === 'string' ? body.targetCaseNumber.trim() : '',
        p_child_title: typeof body.childTitle === 'string' ? body.childTitle.trim() : '',
        p_child_summary: typeof body.childSummary === 'string' ? body.childSummary.trim() : '',
        p_selected_context: selectedContext,
        p_reason: reason,
        p_expected_source_version: expectedRecordVersion,
        p_expected_target_version: typeof body.expectedTargetVersion === 'number' && Number.isSafeInteger(body.expectedTargetVersion) ? body.expectedTargetVersion : null,
        p_idempotency_key: idempotencyKey,
        p_actor_principal_id: principal.id,
        p_actor_label: session.email,
        p_environment: 'DEVELOPMENT',
        p_correlation_id: requestCorrelationId,
      })
      : deadJobReviewAction
        ? await client.rpc('perform_ops_dead_job_review_action', {
          p_issue_id: body.issueId,
          p_reason: reason,
          p_expected_record_version: expectedRecordVersion,
          p_idempotency_key: idempotencyKey,
          p_actor_principal_id: principal.id,
          p_actor_label: session.email,
          p_environment: 'DEVELOPMENT',
          p_correlation_id: requestCorrelationId,
        })
        : await client.rpc('perform_ops_case_collaboration_action', {
        p_issue_id: body.issueId,
        p_action: action,
        p_reason: reason,
        p_expected_record_version: expectedRecordVersion,
        p_idempotency_key: idempotencyKey,
        p_actor_principal_id: principal.id,
        p_actor_label: session.email,
        p_environment: 'DEVELOPMENT',
        p_correlation_id: requestCorrelationId,
        })
    if (error) {
      const versionConflict = error.code === '40001'
        || (error.code === 'P0001' && error.message?.startsWith('CASE_VERSION_CONFLICT:'))
      const conflict = versionConflict || error.code === '55000'
      const forbidden = error.code === '42501'
      const invalid = error.code === '22023'
      return json({
        error: conflict ? 'case-version-or-terminal-conflict' : forbidden ? 'case-action-forbidden' : invalid ? 'invalid-case-action' : 'case-action-failed',
        code: error.code,
        correlationId,
      }, conflict ? 409 : forbidden ? 403 : invalid ? 400 : 500)
    }
    const result = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null
    if (result?.conflict === true) {
      return json({
        error: 'case-version-conflict',
        recordVersion: result.recordVersion,
        correlationId,
      }, 409)
    }
    return json({ ok: true, receipt: data, correlationId }, 200)
  }

  if (!session.principalId) return json({ error: 'cloudflare-workforce-principal-required', correlationId }, 401)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return json({ error: 'ops-broker-unavailable', correlationId }, 503)
  const assertion = headerStore.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return json({ error: 'cloudflare-access-assertion-required', correlationId }, 401)

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/ops-case-action`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-ops-access-assertion': assertion,
      'x-drape-client-user-agent': headerStore.get('user-agent')?.slice(0, 512) ?? '',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({ error: 'invalid-broker-response', correlationId }))
  return json(payload as Record<string, unknown>, response.status)
}
