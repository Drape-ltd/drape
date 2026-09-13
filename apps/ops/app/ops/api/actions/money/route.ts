import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { isMoneyDeskActionType } from '@drape/shared/money-desk'
import {
  allMoneyDeskActionScopes,
  decideMoneyDeskRequest,
  getActiveMoneyDeskGrant,
  issueMoneyDeskElevation,
  isFounderMoneyDeskApprover,
  submitMoneyDeskRequest,
} from '../../../../../../web/lib/money-desk'
import { executeMoneyDeskRequest } from '../../../../../../web/lib/money-desk-execution'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../../web/lib/ops-auth'
import { canPerformOpsAction } from '../../../../../../web/lib/ops-console'
import { validateOpsMutationOrigin } from '../../../../../../web/lib/ops-request-security'
import { sendMoneyApprovalRequiredEmail } from '../../../../../../web/lib/ops-notifications'
import { createServiceRoleClient } from '../../../../../../web/lib/server-supabase'
import { isRestrictedOpsPhoneHeaders } from '../../../../../lib/client-surface'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function moneyBrokerConfiguration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !anonKey) return null
  return { supabaseUrl: supabaseUrl.replace(/\/+$/u, ''), anonKey }
}

async function invokeMoneyBroker(request: Request, body: Record<string, unknown>, correlationId: string) {
  const config = moneyBrokerConfiguration()
  if (!config) return json({ ok: false, error: 'money-desk-broker-unconfigured', correlationId }, 503)
  const assertion = request.headers.get('cf-access-jwt-assertion')?.trim()
  if (!assertion) return json({ ok: false, error: 'workforce-assertion-required', correlationId }, 401)
  const response = await fetch(`${config.supabaseUrl}/functions/v1/ops-money-action`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
      'x-drape-ops-access-assertion': assertion,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({ ok: false, error: 'money-desk-broker-invalid-response', correlationId })) as Record<string, unknown>
  return json(payload, response.status)
}

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID()
  if (!validateOpsMutationOrigin(request).ok) return json({ ok: false, error: 'invalid-origin', correlationId }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers)) return json({ ok: false, error: 'desktop-only-action', correlationId }, 403)

  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session)) {
    return json({ ok: false, error: 'named-workforce-session-required', correlationId }, 401)
  }
  if (!hasFreshOpsMfa(session)) {
    return json({ ok: false, error: 'fresh-mfa-assurance-required', correlationId }, 401)
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action.trim().toUpperCase() : ''
  const requiredPermission = action === 'ELEVATE'
    ? 'money-desk-elevation'
    : action === 'PREPARE'
      ? 'money-desk-request'
    : action === 'DECIDE'
      ? 'money-desk-decision'
      : action === 'EXECUTE'
        ? 'money-desk-execution'
        : null
  if (!requiredPermission || !canPerformOpsAction(session.role, requiredPermission)) {
    return json({ ok: false, error: 'action-not-authorized', correlationId }, 403)
  }
  if ((action === 'DECIDE' || action === 'EXECUTE') && !isFounderMoneyDeskApprover(session.email)) {
    return json({ ok: false, error: 'founder-money-approval-required', correlationId }, 403)
  }

  if (session.mode === 'cloudflare-access') {
    return invokeMoneyBroker(request, body ?? {}, correlationId)
  }

  const client = createServiceRoleClient()
  if (!client) return json({ ok: false, error: 'money-desk-unavailable', correlationId }, 503)

  try {
    if (action === 'ELEVATE') {
      const reason = typeof body?.reason === 'string' ? body.reason : ''
      const requestedScopes = Array.isArray(body?.actionScopes)
        ? body.actionScopes.filter(isMoneyDeskActionType)
        : allMoneyDeskActionScopes()
      const result = await issueMoneyDeskElevation(client, session, {
        actionScopes: requestedScopes.length > 0 ? requestedScopes : allMoneyDeskActionScopes(),
        reason,
      })
      return json({ ok: true, correlationId, result }, 200)
    }

    if (action === 'PREPARE') {
      const payoutChangeRequestId = typeof body?.payoutChangeRequestId === 'string' ? body.payoutChangeRequestId.trim() : ''
      const issueId = typeof body?.issueId === 'string' ? body.issueId.trim() : ''
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
      if (!payoutChangeRequestId || !issueId || reason.length < 12 || reason.length > 1_000) {
        return json({ ok: false, error: 'payout-change-request-issue-and-reason-required', correlationId }, 400)
      }
      const { data: payoutChange, error: payoutChangeError } = await client
        .from('payout_change_requests')
        .select('id,status,tailor_user_id,tailor_profile_id,requested_destination,metadata')
        .eq('id', payoutChangeRequestId)
        .maybeSingle()
      if (payoutChangeError || !payoutChange?.id || payoutChange.status !== 'PENDING') {
        return json({ ok: false, error: payoutChangeError?.message ?? 'payout-change-review-unavailable', correlationId }, 409)
      }
      const metadata = payoutChange.metadata && typeof payoutChange.metadata === 'object' && !Array.isArray(payoutChange.metadata)
        ? payoutChange.metadata as Record<string, unknown>
        : {}
      const destination = payoutChange.requested_destination && typeof payoutChange.requested_destination === 'object' && !Array.isArray(payoutChange.requested_destination)
        ? payoutChange.requested_destination as Record<string, unknown>
        : {}
      if (metadata.lifecycle_state !== 'OPS_REVIEW' || metadata.confirmation_status !== 'CONFIRMED' || destination.payout_account_verified !== true) {
        return json({ ok: false, error: 'payout-change-must-be-confirmed-and-provider-verified', correlationId }, 409)
      }
      const grant = await getActiveMoneyDeskGrant(client, session, 'PAYOUT_DESTINATION_CHANGE')
      if (!grant) return json({ ok: false, error: 'money-desk-elevation-required', correlationId }, 401)
      const provider = typeof destination.payout_provider === 'string' ? destination.payout_provider.trim().toUpperCase() : null
      const requestedCurrency = typeof destination.payout_currency === 'string' ? destination.payout_currency.trim().toUpperCase() : null
      const result = await submitMoneyDeskRequest(client, session, grant, {
        actionType: 'PAYOUT_DESTINATION_CHANGE',
        targetType: 'PAYOUT_CHANGE_REQUEST',
        targetId: payoutChange.id,
        // money_desk_requests.case_id belongs to the financial_cases domain.
        // This workflow is owned by an Ops issue, so retain that link in the
        // immutable action snapshot instead of crossing foreign-key domains.
        caseId: null,
        reason,
        actionPayload: {
          opsIssueId: issueId,
          payoutChangeRequestId: payoutChange.id,
          tailorUserId: payoutChange.tailor_user_id,
          tailorProfileId: payoutChange.tailor_profile_id,
          provider,
          requestedCurrency,
          note: reason,
        },
        idempotencyKey: `payout-change-request:${payoutChange.id}`,
      })
      const requestId = typeof result.requestId === 'string' ? result.requestId : ''
      const reference = typeof result.reference === 'string' ? result.reference : 'Money Desk request'
      const riskLevel = typeof result.riskLevel === 'string' ? result.riskLevel : 'HIGH'
      const notification = { email: 'failed', slack: 'failed' } as { email: 'sent' | 'skipped' | 'failed'; slack: 'queued' | 'already-queued' | 'failed' }
      if (requestId) {
        const priorEmail = await client.from('money_desk_events').select('id')
          .eq('request_id', requestId).eq('event_type', 'FOUNDER_APPROVAL_EMAIL_SENT').limit(1).maybeSingle()
        if (priorEmail.data?.id) {
          notification.email = 'sent'
        } else {
          let email: { ok: boolean; skipped: boolean; deliveryId?: string | null } = await sendMoneyApprovalRequiredEmail({
            requestId,
            reference,
            actionLabel: 'Payout destination change',
            riskLevel,
            preparedBy: session.email,
            reason,
          }).catch(() => ({ ok: false as const, skipped: false as const }))
          if (!email.ok) {
            const edgeDelivery = await client.functions.invoke('notify-money-approval', { body: { requestId } })
            const edgePayload = edgeDelivery.data && typeof edgeDelivery.data === 'object' ? edgeDelivery.data as Record<string, unknown> : {}
            if (!edgeDelivery.error && edgePayload.ok === true) email = { ok: true, skipped: false }
          }
          notification.email = email.ok ? 'sent' : email.skipped ? 'skipped' : 'failed'
          await client.from('money_desk_events').insert({
            request_id: requestId,
            event_type: email.ok ? 'FOUNDER_APPROVAL_EMAIL_SENT' : email.skipped ? 'FOUNDER_APPROVAL_EMAIL_SKIPPED' : 'FOUNDER_APPROVAL_EMAIL_FAILED',
            actor_email: session.email,
            actor_role: session.role,
            payload: { deliveryId: 'deliveryId' in email ? email.deliveryId : null },
            correlation_id: correlationId,
          })
        }

        const existingSlack = await client
          .from('ops_audit_logs')
          .select('id')
          .eq('issue_id', issueId)
          .eq('action_taken', 'MONEY_DESK_APPROVAL_REQUESTED')
          .limit(1)
          .maybeSingle()
        if (existingSlack.data?.id) {
          notification.slack = 'already-queued'
        } else {
          const slackAudit = await client.from('ops_audit_logs').insert({
            issue_id: issueId,
            action_taken: 'MONEY_DESK_APPROVAL_REQUESTED',
            performed_by: session.email,
            performed_role: session.role,
            reason: 'Founder approval is required for a protected payout destination change.',
            before_state: { payout_change_request_id: payoutChange.id },
            after_state: { money_desk_request_id: requestId, money_desk_reference: reference, status: 'PENDING_APPROVAL' },
          })
          notification.slack = slackAudit.error ? 'failed' : 'queued'
        }
      }
      const warning = notification.email !== 'sent' || notification.slack === 'failed'
        ? 'The Money Desk request is safe, but one or more founder alerts need attention.'
        : null
      return json({ ok: true, correlationId, result, notification, warning }, 200)
    }

    const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : ''
    if (action === 'EXECUTE') {
      const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
      if (!requestId || idempotencyKey.length < 16 || idempotencyKey.length > 180) {
        return json({ ok: false, error: 'request-and-idempotency-key-required', correlationId }, 400)
      }
      const result = await executeMoneyDeskRequest(client, session, { requestId, idempotencyKey })
      return json({ ok: result.ok, correlationId, result }, result.ok ? (result.pending ? 202 : 200) : 409)
    }

    const decision = typeof body?.decision === 'string' ? body.decision.trim().toUpperCase() : ''
    const reason = typeof body?.reason === 'string' ? body.reason : ''
    if (!requestId || (decision !== 'APPROVE' && decision !== 'REJECT')) {
      return json({ ok: false, error: 'invalid-decision', correlationId }, 400)
    }

    const { data: moneyRequest, error } = await client
      .from('money_desk_requests')
      .select('action_type,requester_email,status')
      .eq('id', requestId)
      .maybeSingle()
    if (error || !moneyRequest || !isMoneyDeskActionType(moneyRequest.action_type)) {
      return json({ ok: false, error: error?.message ?? 'money-request-not-found', correlationId }, 404)
    }
    if (String(moneyRequest.status) !== 'PENDING_APPROVAL') {
      return json({ ok: false, error: 'money-request-is-not-awaiting-approval', correlationId }, 409)
    }
    const grant = await getActiveMoneyDeskGrant(client, session, moneyRequest.action_type)
    if (!grant) return json({ ok: false, error: 'money-desk-elevation-required', correlationId }, 401)
    const result = await decideMoneyDeskRequest(client, session, grant, {
      requestId,
      decision,
      reason,
    })
    return json({ ok: true, correlationId, result }, 200)
  } catch {
    return json({ ok: false, error: 'The Money Desk action could not be completed. Reload and retry.', correlationId }, 409)
  }
}
