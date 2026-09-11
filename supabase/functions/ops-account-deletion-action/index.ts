import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueDomainEvent } from '../_shared/jobs.ts'
import { audit, log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'

const FN = 'ops-account-deletion-action'

type ActionBody = {
  issueId?: unknown
  requestId?: unknown
  action?: unknown
  reason?: unknown
  expectedRecordVersion?: unknown
  idempotencyKey?: unknown
  correlationId?: unknown
}

type ActionResult = {
  duplicate: boolean
  receiptId: string
  receiptOutcome: string
  requestId?: string
  requestStatus: string | null
  userId?: string
  recipientEmail?: string | null
  accountRole?: string
  recordVersion: number | null
  correlationId: string
}

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}

function stringValue(value: unknown, maxLength = 180) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null
}

function messageFor(status: string) {
  if (status === 'ACKNOWLEDGED') return {
    subject: 'Drapeon has started reviewing your deletion request',
    headline: 'Your deletion request is under review',
    body: 'Privacy Ops acknowledged your request and is checking active orders, payments, disputes, and other obligations before deletion can continue.',
  }
  return {
    subject: 'Your Drapeon deletion request needs an obligation resolved',
    headline: 'Your deletion request is temporarily blocked',
    body: 'Drapeon cannot finish deletion while an active order, payment, dispute, payout, or legal obligation remains. Open the request to review its current status and next step.',
  }
}

async function completeReceipt(
  supabase: SupabaseClient,
  input: {
    receiptId: string
    principalId: string
    outcome: 'SUCCEEDED' | 'FAILED'
    humanStatus: string
    sideEffects: Array<Record<string, unknown>>
    blockers?: Array<Record<string, unknown>>
    nextAction?: string | null
    failureCode?: string | null
  },
) {
  const { data, error } = await supabase.rpc('complete_ops_action_receipt', {
    p_receipt_id: input.receiptId,
    p_actor_principal_id: input.principalId,
    p_outcome: input.outcome,
    p_human_status: input.humanStatus,
    p_side_effects: input.sideEffects,
    p_blockers: input.blockers ?? [],
    p_next_action: input.nextAction ?? null,
    p_failure_code: input.failureCode ?? null,
  })
  if (error) throw new Error(`Could not complete action receipt: ${error.message}`)
  return data
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
    const body = JSON.parse(raw || '{}') as ActionBody
    const issueId = stringValue(body.issueId)
    const requestId = stringValue(body.requestId)
    const action = stringValue(body.action)?.toUpperCase() ?? null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const idempotencyKey = stringValue(body.idempotencyKey)
    const requestCorrelationId = stringValue(body.correlationId) ?? correlationId
    const expectedRecordVersion = typeof body.expectedRecordVersion === 'number' && Number.isSafeInteger(body.expectedRecordVersion)
      ? body.expectedRecordVersion
      : null
    if (!issueId || !requestId || !action || !idempotencyKey || !expectedRecordVersion) {
      return json({ error: 'Case, request, action, version, and idempotency key are required.', correlationId }, 400, cors)
    }

    const requireSensitive = action !== 'ACKNOWLEDGE'
    if (requireSensitive && !identity.sensitiveAssurance) {
      return json({ error: 'Fresh protected workforce access is required.', correlationId }, 401, cors)
    }

    const environment = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toUpperCase()
    if (!['DEVELOPMENT', 'PRODUCTION'].includes(environment)) {
      return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    }

    const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: principal, error: principalError } = await supabase
      .from('ops_workforce_principals')
      .select('id,email,access_subject,status,roles,permitted_environments,session_revoked_before')
      .eq('email', identity.email)
      .maybeSingle()
    if (principalError) throw principalError
    const issuedAt = identity.issuedAt ?? 0
    const revokedBefore = principal?.session_revoked_before ? Math.floor(Date.parse(principal.session_revoked_before) / 1000) : 0
    if (!principal
      || principal.status !== 'ACTIVE'
      || (principal.access_subject && principal.access_subject !== identity.subject)
      || !(principal.permitted_environments ?? []).includes(environment.toLowerCase())
      || issuedAt <= revokedBefore) {
      return json({ error: 'Workforce principal is unavailable or revoked.', correlationId }, 403, cors)
    }

    const { data, error } = await supabase.rpc('perform_ops_account_deletion_action', {
      p_issue_id: issueId,
      p_request_id: requestId,
      p_action: action,
      p_reason: reason,
      p_expected_record_version: expectedRecordVersion,
      p_idempotency_key: idempotencyKey,
      p_actor_principal_id: principal.id,
      p_actor_label: identity.email,
      p_environment: environment,
      p_sensitive_assurance: identity.sensitiveAssurance,
      p_correlation_id: requestCorrelationId,
    })
    if (error) {
      const conflict = error.code === '40001'
      const forbidden = error.code === '42501'
      const terminal = error.code === '55000'
      const invalid = error.code === '22023'
      const missing = error.code === 'P0002'
      if (!conflict && !forbidden && !terminal && !invalid && !missing) {
        log('error', FN, 'rpc.failed', { correlation_id: correlationId, code: error.code })
      }
      return json(
        {
          error: conflict
            ? 'This case changed. Reload it before acting.'
            : forbidden
              ? 'This workforce role is not authorized for that deletion action.'
              : terminal
                ? 'This deletion request cannot accept that action in its current state.'
                : invalid
                  ? 'The deletion action is invalid.'
                  : missing
                    ? 'The deletion request could not be found.'
                    : 'The deletion action could not be persisted.',
          code: error.code,
          correlationId,
        },
        conflict || terminal ? 409 : forbidden ? 403 : invalid ? 400 : missing ? 404 : 500,
        cors,
      )
    }
    const result = data as ActionResult
    if (result.duplicate) return json({ ok: true, duplicate: true, receipt: result, correlationId }, 200, cors)

    if (action === 'ACKNOWLEDGE' || action === 'RECORD_BLOCKER') {
      const status = result.requestStatus ?? (action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'BLOCKED')
      const copy = messageFor(status)
      try {
        const domainEventId = await enqueueDomainEvent(supabase, {
          eventType: 'ACCOUNT_DELETION_STATUS_CHANGED',
          aggregateType: 'account_deletion_request',
          aggregateId: requestId,
          actorId: result.userId ?? null,
          actorRole: result.accountRole ?? 'UNKNOWN',
          idempotencyKey: `account-deletion-status:v2:${requestId}:${status.toLowerCase()}`,
          jobs: ['SEND_ACCOUNT_EVENT_EMAIL', 'SEND_PUSH'],
          priority: 18,
          payload: {
            userId: result.userId,
            recipientEmail: result.recipientEmail,
            subject: copy.subject,
            eyebrow: 'Privacy request',
            headline: copy.headline,
            body: copy.body,
            ctaLabel: 'Review deletion request',
            webPath: '/account?view=settings#delete-account',
            appUrl: 'drape://profile/delete-account',
            details: [{ label: 'Request ID', value: requestId }],
            notification: {
              title: copy.headline,
              body: copy.body,
              preferenceKey: 'orderUpdates',
              data: { destination: 'ACCOUNT_SETTINGS', deletionRequestId: requestId, deletionStatus: status },
            },
          },
        })
        const receipt = await completeReceipt(supabase, {
          receiptId: result.receiptId,
          principalId: principal.id,
          outcome: 'SUCCEEDED',
          humanStatus: status === 'ACKNOWLEDGED'
            ? 'The deletion request is acknowledged and customer communication is queued.'
            : 'The deletion request is blocked and customer communication is queued.',
          sideEffects: [{ type: 'DOMAIN_EVENT', id: domainEventId, status: 'QUEUED' }],
          nextAction: status === 'ACKNOWLEDGED' ? 'Complete the obligation review.' : 'Resolve the blocker, then re-evaluate the request.',
        })
        return json({ ok: true, duplicate: false, receipt, case: { recordVersion: result.recordVersion, requestStatus: status }, correlationId }, 200, cors)
      } catch (deliveryError) {
        const receipt = await completeReceipt(supabase, {
          receiptId: result.receiptId,
          principalId: principal.id,
          outcome: 'SUCCEEDED',
          humanStatus: 'The deletion decision is persisted, but customer communication needs a retry.',
          sideEffects: [{ type: 'CUSTOMER_COMMUNICATION', status: 'FAILED' }],
          blockers: [{ code: 'COMMUNICATION_ENQUEUE_FAILED' }],
          nextAction: 'Retry the recorded customer communication without repeating the decision.',
          failureCode: 'COMMUNICATION_ENQUEUE_FAILED',
        })
        log('error', FN, 'communication.enqueue_failed', { issue_id: issueId, receipt_id: result.receiptId, correlation_id: correlationId })
        return json({ ok: true, duplicate: false, receipt, warning: 'Customer communication needs a retry.', correlationId }, 207, cors)
      }
    }

    const finalizerResponse = await fetch(`${getSupabaseUrl().replace(/\/+$/u, '')}/functions/v1/finalize-account-deletions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getServiceRoleKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    })
    const finalizer = await finalizerResponse.json().catch(() => ({})) as Record<string, unknown>
    const failed = typeof finalizer.failed === 'number' ? finalizer.failed : finalizerResponse.ok ? 0 : 1
    const blocked = typeof finalizer.blocked === 'number' ? finalizer.blocked : 0
    const completed = typeof finalizer.completed === 'number' ? finalizer.completed : 0
    const receipt = await completeReceipt(supabase, {
      receiptId: result.receiptId,
      principalId: principal.id,
      outcome: failed > 0 ? 'FAILED' : 'SUCCEEDED',
      humanStatus: completed > 0
        ? 'Account deletion completed; retained records were anonymized under policy.'
        : blocked > 0
          ? 'Finalization rechecked the account and recorded an authoritative blocker.'
          : 'Finalization ran without a terminal deletion; the request remains recoverable.',
      sideEffects: [{ type: 'DELETION_FINALIZER', status: finalizerResponse.ok ? 'COMPLETED' : 'FAILED', completed, blocked, failed }],
      blockers: blocked > 0 ? [{ code: 'FINALIZER_RECORDED_BLOCKER' }] : [],
      nextAction: completed > 0 ? null : blocked > 0 ? 'Resolve the newly recorded blocker.' : 'Inspect the finalizer outcome and retry safely.',
      failureCode: failed > 0 ? 'FINALIZER_FAILED' : null,
    })
    await audit(supabase, {
      event: 'ops.account_deletion_finalizer_completed',
      actor_id: principal.id,
      actor_role: 'OPS',
      severity: failed > 0 ? 'error' : 'info',
      payload: { issue_id: issueId, request_id: requestId, receipt_id: result.receiptId, completed, blocked, failed, correlation_id: correlationId },
    })
    return json({ ok: failed === 0, duplicate: false, receipt, finalizer: { completed, blocked, failed }, correlationId }, failed > 0 ? 502 : 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { correlation_id: correlationId, error: error instanceof Error ? error.message : String(error) })
    return json({ error: 'The protected deletion action could not be completed.', correlationId }, 500, cors)
  }
})
