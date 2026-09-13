import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { verifyCloudflareOpsAccess } from '../_shared/ops-access.ts'
import {
  executeMoneyDeskRequest,
  isMoneyDeskActionType,
  MONEY_DESK_ACTION_TYPES,
  type MoneyDeskActionType,
  type OpsMoneyActor,
} from '../_shared/ops-money-execution.ts'
import { isOpsMoneyCommand, selectOpsMoneyActorRole } from '../_shared/ops-money-policy.ts'
import { isActiveOpsReadPrincipal } from '../_shared/ops-read-policy.ts'
import { sendMoneyApprovalRequiredNotification } from '../_shared/ops-notifications.ts'

const FN = 'ops-money-action'

class MoneyDeskInputError extends Error {}

function list(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
}

function isFounderMoneyApprover(email: string) {
  const configured = list(Deno.env.get('OPS_MONEY_APPROVER_EMAILS') ?? 'founders@drapeon.co')
  return configured.some((entry) => entry.toLowerCase() === email.trim().toLowerCase())
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function json(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

function environment() {
  const value = (Deno.env.get('DRAPE_OPS_ENV') ?? '').trim().toLowerCase()
  return value === 'development' || value === 'production' ? value : null
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function validateReason(value: unknown, maxLength: number) {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (reason.length < 12 || reason.length > maxLength) throw new MoneyDeskInputError(`Explain this money action in 12 to ${maxLength} characters.`)
  return reason
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
}

async function activeGrant(client: SupabaseClient, actor: OpsMoneyActor, actionType: MoneyDeskActionType) {
  const { data, error } = await client
    .from('money_desk_jit_grants')
    .select('id')
    .eq('actor_email', actor.email.toLowerCase())
    .eq('actor_subject', actor.subject)
    .eq('actor_role', actor.role.toUpperCase())
    .contains('action_scopes', [actionType])
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)
  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID()

  try {
    const identity = await verifyCloudflareOpsAccess(
      request.headers.get('x-drape-ops-access-assertion')?.trim() ?? '',
      {
        teamDomain: Deno.env.get('CF_ACCESS_TEAM_DOMAIN') ?? '',
        normalAudiences: list(Deno.env.get('CF_ACCESS_AUD')),
        sensitiveAudiences: list(Deno.env.get('CF_ACCESS_SENSITIVE_AUD')),
        requireSensitive: true,
        allowedEmailDomain: Deno.env.get('OPS_ALLOWED_EMAIL_DOMAIN') ?? 'drapeon.co',
        allowedEmails: list(Deno.env.get('OPS_ALLOWED_EMAILS')),
      },
    )
    if (!identity?.sensitiveAssurance) return json({ error: 'Fresh MFA-backed Money Desk access is required.', correlationId }, 401, cors)

    const raw = await request.text()
    if (raw.length > 16_384) return json({ error: 'Request is too large.', correlationId }, 413, cors)
    const body = asRecord(JSON.parse(raw || '{}'))
    const commandValue = typeof body.action === 'string' ? body.action.trim().toUpperCase() : ''
    if (!isOpsMoneyCommand(commandValue)) return json({ error: 'Invalid Money Desk action.', correlationId }, 400, cors)

    const env = environment()
    if (!env) return json({ error: 'Ops environment is not configured.', correlationId }, 503, cors)
    const client: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const principalResult = await client
      .from('ops_workforce_principals')
      .select('id,email,roles,permitted_environments,access_subject,session_revoked_before,access_review_due_at,status')
      .eq('email', identity.email)
      .maybeSingle()
    if (principalResult.error) throw principalResult.error
    const principal = principalResult.data
    const principalRoles = Array.isArray(principal?.roles) ? principal.roles.map(String) : []
    const actorRole = selectOpsMoneyActorRole(principalRoles, commandValue)
    if (
      !principal ||
      !actorRole ||
      !isActiveOpsReadPrincipal({
        status: String(principal.status),
        accessSubject: typeof principal.access_subject === 'string' ? principal.access_subject : null,
        permittedEnvironments: Array.isArray(principal.permitted_environments) ? principal.permitted_environments.map(String) : [],
        sessionRevokedBefore: typeof principal.session_revoked_before === 'string' ? principal.session_revoked_before : null,
        accessReviewDueAt: typeof principal.access_review_due_at === 'string' ? principal.access_review_due_at : null,
        assertedSubject: identity.subject,
        assertionIssuedAt: identity.issuedAt,
        environment: env.toUpperCase() as 'DEVELOPMENT' | 'PRODUCTION',
      })
    ) {
      return json({ error: 'Money Desk authority is unavailable, expired, or revoked.', correlationId }, 403, cors)
    }

    const actor: OpsMoneyActor = { email: identity.email, subject: identity.subject, role: actorRole }
    if ((commandValue === 'DECIDE' || commandValue === 'EXECUTE') && !isFounderMoneyApprover(actor.email)) {
      return json({ error: 'Founder Money Desk approval is required.', correlationId }, 403, cors)
    }
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
    const payoutChangeRequestId = typeof body.payoutChangeRequestId === 'string' ? body.payoutChangeRequestId.trim() : ''
    const limiterTarget = requestId || payoutChangeRequestId
    const limiterResult = await client.rpc('check_rate_limit', {
      p_key: `ops-money:${await hash(`${identity.email}:${commandValue}:${limiterTarget}`)}`,
      p_window_seconds: 300,
      p_max_requests: commandValue === 'ELEVATE' ? 6 : commandValue === 'EXECUTE' ? 8 : 16,
    })
    if (limiterResult.error) return json({ error: 'Rate limit is unavailable.', correlationId }, 503, cors)
    if (limiterResult.data !== true) return json({ error: 'Too many Money Desk actions.', correlationId }, 429, cors)

    if (commandValue === 'ELEVATE') {
      const reason = validateReason(body.reason, 500)
      const requestedScopes = Array.isArray(body.actionScopes) ? body.actionScopes.filter(isMoneyDeskActionType) : []
      const actionScopes = [...new Set(requestedScopes.length > 0 ? requestedScopes : MONEY_DESK_ACTION_TYPES)]
      const result = await client.rpc('issue_money_desk_jit_grant', {
        p_actor_email: actor.email,
        p_actor_subject: actor.subject,
        p_actor_role: actor.role.toUpperCase(),
        p_assurance_source: 'CLOUDFLARE_ACCESS',
        p_authentication_methods: identity.authenticationMethods,
        p_action_scopes: actionScopes,
        p_reason: reason,
        p_correlation_id: correlationId,
      })
      if (result.error) throw result.error
      return json({ ok: true, result: result.data, correlationId }, 200, cors)
    }

    if (commandValue === 'PREPARE') {
      const issueId = typeof body.issueId === 'string' ? body.issueId.trim() : ''
      const reason = validateReason(body.reason, 1_000)
      if (!validUuid(payoutChangeRequestId) || !validUuid(issueId)) {
        return json({ error: 'A valid payout-change request and case are required.', correlationId }, 400, cors)
      }
      const payoutResult = await client
        .from('payout_change_requests')
        .select('id,status,tailor_user_id,tailor_profile_id,requested_destination,metadata')
        .eq('id', payoutChangeRequestId)
        .maybeSingle()
      if (payoutResult.error || !payoutResult.data?.id || payoutResult.data.status !== 'PENDING') {
        return json({ error: 'The payout destination request is no longer pending review.', correlationId }, 409, cors)
      }
      const metadata = asRecord(payoutResult.data.metadata)
      const destination = asRecord(payoutResult.data.requested_destination)
      if (metadata.lifecycle_state !== 'OPS_REVIEW' || metadata.confirmation_status !== 'CONFIRMED' || destination.payout_account_verified !== true) {
        return json({ error: 'The payout destination must be confirmed and provider-verified before review.', correlationId }, 409, cors)
      }
      const grantId = await activeGrant(client, actor, 'PAYOUT_DESTINATION_CHANGE')
      if (!grantId) return json({ error: 'Money Desk elevation is required.', correlationId }, 401, cors)
      const provider = typeof destination.payout_provider === 'string' ? destination.payout_provider.trim().toUpperCase() : null
      const requestedCurrency = typeof destination.payout_currency === 'string' ? destination.payout_currency.trim().toUpperCase() : null
      const submitResult = await client.rpc('submit_money_desk_request', {
        p_idempotency_key: `payout-change-request:${payoutResult.data.id}`,
        p_jit_grant_id: grantId,
        p_actor_email: actor.email,
        p_actor_subject: actor.subject,
        p_actor_role: actor.role.toUpperCase(),
        p_action_type: 'PAYOUT_DESTINATION_CHANGE',
        p_target_type: 'PAYOUT_CHANGE_REQUEST',
        p_target_id: payoutResult.data.id,
        p_order_id: null,
        // money_desk_requests.case_id references financial_cases. The review
        // currently in hand is an Ops issue, retained in action_payload below.
        p_case_id: null,
        p_amount: null,
        p_currency: null,
        p_amount_usd_equivalent: null,
        p_usd_equivalent_source: null,
        p_reason: reason,
        p_action_payload: {
          opsIssueId: issueId,
          payoutChangeRequestId: payoutResult.data.id,
          tailorUserId: payoutResult.data.tailor_user_id,
          tailorProfileId: payoutResult.data.tailor_profile_id,
          provider,
          requestedCurrency,
          note: reason,
        },
        p_correlation_id: correlationId,
      })
      if (submitResult.error) throw submitResult.error
      const submitted = asRecord(submitResult.data)
      const submittedRequestId = typeof submitted.requestId === 'string' ? submitted.requestId : ''
      const reference = typeof submitted.reference === 'string' ? submitted.reference : 'Money Desk request'
      const riskLevel = typeof submitted.riskLevel === 'string' ? submitted.riskLevel : 'HIGH'
      const notification = { email: 'failed', slack: 'failed' } as {
        email: 'sent' | 'skipped' | 'failed'
        slack: 'queued' | 'already-queued' | 'failed'
      }
      if (validUuid(submittedRequestId)) {
        const priorEmail = await client.from('money_desk_events').select('id')
          .eq('request_id', submittedRequestId).eq('event_type', 'FOUNDER_APPROVAL_EMAIL_SENT').limit(1).maybeSingle()
        if (priorEmail.data?.id) {
          notification.email = 'sent'
        } else {
          const email = await sendMoneyApprovalRequiredNotification({
            requestId: submittedRequestId,
            reference,
            actionLabel: 'Payout destination change',
            riskLevel,
            preparedBy: actor.email,
            reason,
          }).catch(() => ({ ok: false as const, skipped: false as const }))
          notification.email = email.ok ? 'sent' : email.skipped ? 'skipped' : 'failed'
          await client.from('money_desk_events').insert({
            request_id: submittedRequestId,
            event_type: email.ok ? 'FOUNDER_APPROVAL_EMAIL_SENT' : email.skipped ? 'FOUNDER_APPROVAL_EMAIL_SKIPPED' : 'FOUNDER_APPROVAL_EMAIL_FAILED',
            actor_email: actor.email,
            actor_role: actor.role,
            payload: { deliveryId: 'deliveryId' in email ? email.deliveryId : null },
            correlation_id: correlationId,
          })
        }

        const existingSlack = await client.from('ops_audit_logs').select('id')
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
            performed_by: actor.email,
            performed_role: actor.role,
            reason: 'Founder approval is required for a protected payout destination change.',
            before_state: { payout_change_request_id: payoutResult.data.id },
            after_state: { money_desk_request_id: submittedRequestId, money_desk_reference: reference, status: 'PENDING_APPROVAL' },
          })
          notification.slack = slackAudit.error ? 'failed' : 'queued'
        }
      }
      const warning = notification.email !== 'sent' || notification.slack === 'failed'
        ? 'The Money Desk request is safe, but one or more founder alerts need attention.'
        : null
      return json({ ok: true, result: submitResult.data, notification, warning, correlationId }, 200, cors)
    }

    if (!validUuid(requestId)) return json({ error: 'A valid Money Desk request is required.', correlationId }, 400, cors)

    if (commandValue === 'DECIDE') {
      const decision = typeof body.decision === 'string' ? body.decision.trim().toUpperCase() : ''
      if (decision !== 'APPROVE' && decision !== 'REJECT') return json({ error: 'Invalid Money Desk decision.', correlationId }, 400, cors)
      const reason = validateReason(body.reason, 1_000)
      const requestResult = await client.from('money_desk_requests').select('action_type,requester_email,status').eq('id', requestId).maybeSingle()
      if (requestResult.error || !requestResult.data || !isMoneyDeskActionType(requestResult.data.action_type)) {
        return json({ error: 'Money Desk request was not found.', correlationId }, 404, cors)
      }
      if (requestResult.data.status !== 'PENDING_APPROVAL') return json({ error: 'Money Desk request is not awaiting approval.', correlationId }, 409, cors)
      const grantId = await activeGrant(client, actor, requestResult.data.action_type)
      if (!grantId) return json({ error: 'Money Desk elevation is required.', correlationId }, 401, cors)
      const decisionResult = await client.rpc('decide_money_desk_request', {
        p_request_id: requestId,
        p_jit_grant_id: grantId,
        p_actor_email: actor.email,
        p_actor_subject: actor.subject,
        p_actor_role: actor.role.toUpperCase(),
        p_decision: decision,
        p_reason: reason,
      })
      if (decisionResult.error) throw decisionResult.error
      return json({ ok: true, result: decisionResult.data, correlationId }, 200, cors)
    }

    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
    if (idempotencyKey.length < 16 || idempotencyKey.length > 180) return json({ error: 'A bounded idempotency key is required.', correlationId }, 400, cors)
    const execution = await executeMoneyDeskRequest(client, actor, { requestId, idempotencyKey })
    return json({ ok: execution.ok, result: execution, correlationId }, execution.ok ? (execution.pending ? 202 : 200) : 409, cors)
  } catch (error) {
    if (error instanceof MoneyDeskInputError) {
      return json({ error: error.message, code: 'INVALID_REQUEST', correlationId }, 400, cors)
    }
    const code = databaseErrorCode(error)
    const conflict = code === '40001' || code === '23505' || code === 'P0001'
    const forbidden = code === '42501'
    const terminal = code === '55000'
    const invalid = code === '22023' || code === '23514' || code === '23503'
    const missing = code === 'P0002'
    log('error', FN, 'unhandled', {
      correlation_id: correlationId,
      code,
      error: error instanceof Error ? error.message : String(error),
    })
    return json(
      {
        error: conflict
          ? 'The Money Desk request changed or is no longer eligible. Reload it before acting.'
          : forbidden
            ? 'This workforce role is not authorized for that Money Desk action.'
            : terminal
              ? 'This Money Desk request cannot accept that action in its current state.'
              : invalid
                ? 'The Money Desk action is invalid.'
                : missing
                  ? 'The Money Desk request could not be found.'
                  : 'The Money Desk action could not be completed.',
        code: code ?? 'INTERNAL_ERROR',
        correlationId,
      },
      conflict || terminal ? 409 : forbidden ? 403 : invalid ? 400 : missing ? 404 : 500,
      cors,
    )
  }
})
