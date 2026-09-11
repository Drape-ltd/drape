import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../web/lib/ops-auth'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'
import { validateOpsWorkforceRequest } from '../../../../../../supabase/functions/_shared/ops-workforce-policy'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function actionError(code: string | undefined) {
  if (code === '40001') return { error: 'workforce-or-case-version-conflict', status: 409 }
  if (code === '42501') return { error: 'workforce-action-forbidden', status: 403 }
  if (code === '55000') return { error: 'workforce-offboarding-state-conflict', status: 409 }
  if (code === '22023' || code === '22P02') return { error: 'invalid-workforce-action', status: 400 }
  return { error: 'workforce-action-failed', status: 500 }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID()
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin', correlationId }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'desktop-only-action', correlationId }, 403)

  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session)) {
    return json({ error: 'named-workforce-session-required', correlationId }, 401)
  }
  if (session.role !== 'admin') return json({ error: 'admin-required', correlationId }, 403)
  if (!hasFreshOpsMfa(session)) return json({ error: 'protected-access-required', correlationId }, 401)

  const raw = await request.text()
  if (raw.length > 16_384) return json({ error: 'request-too-large', correlationId }, 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return json({ error: 'invalid-json', correlationId }, 400)
  }
  const requestPolicy = validateOpsWorkforceRequest(body)
  if (!requestPolicy.ok) return json({ error: 'invalid-workforce-action', correlationId }, 400)
  const command = requestPolicy.value

  if (session.mode === 'local-workforce') {
    const local = await resolveLocalWorkforcePrincipal(session)
    if (!local || !local.principal.roles.includes('admin')) {
      return json({ error: 'local-admin-principal-unavailable', correlationId }, 403)
    }
    const { data, error } = await local.client.rpc('perform_ops_workforce_offboarding_action', {
      p_target_principal_id: command.targetPrincipalId,
      p_action: command.action,
      p_reason: command.reason,
      p_expected_target_updated_at: command.expectedTargetUpdatedAt,
      p_expected_case_version: command.expectedCaseVersion,
      p_evidence_refs: command.evidenceRefs,
      p_idempotency_key: command.idempotencyKey,
      p_actor_principal_id: local.principal.id,
      p_actor_label: session.email,
      p_environment: 'DEVELOPMENT',
      p_sensitive_assurance: true,
      p_correlation_id: correlationId,
    })
    if (error) {
      const mapped = actionError(error.code)
      return json({ error: mapped.error, code: error.code, correlationId }, mapped.status)
    }
    return json({ ok: true, receipt: data, correlationId }, 200)
  }

  if (!session.principalId) return json({ error: 'cloudflare-workforce-principal-required', correlationId }, 401)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return json({ error: 'ops-broker-unavailable', correlationId }, 503)
  const assertion = request.headers.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return json({ error: 'cloudflare-access-assertion-required', correlationId }, 401)

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/ops-workforce-action`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-ops-access-assertion': assertion,
      'x-drape-client-user-agent': request.headers.get('user-agent')?.slice(0, 512) ?? '',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({ error: 'invalid-broker-response', correlationId }))
  return json(payload as Record<string, unknown>, response.status)
}
