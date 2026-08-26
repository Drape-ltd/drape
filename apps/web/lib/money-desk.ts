import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import {
  MONEY_DESK_ACTION_TYPES,
  MONEY_DESK_JIT_DURATION_MINUTES,
  isMoneyDeskActionType,
  validateMoneyDeskReason,
  type MoneyDeskActionType,
} from '@drape/shared/money-desk'
import {
  getOpsIdentityAssuranceSource,
  isNamedOpsWorkforceSession,
  type OpsSession,
} from './ops-auth'
import type { createServiceRoleClient } from './server-supabase'

type ServiceRoleClient = NonNullable<ReturnType<typeof createServiceRoleClient>>

export type MoneyDeskGrant = {
  id: string
  expiresAt: string
  actionScopes: MoneyDeskActionType[]
}

export type MoneyDeskRequestInput = {
  actionType: MoneyDeskActionType
  targetType: string
  targetId: string
  orderId?: string | null
  caseId?: string | null
  amount?: number | null
  currency?: string | null
  amountUsdEquivalent?: number | null
  usdEquivalentSource?: string | null
  reason: string
  actionPayload?: Record<string, unknown>
  idempotencyKey?: string
}

function requireNamedWorkforceSession(session: OpsSession) {
  if (!isNamedOpsWorkforceSession(session) || !session.email || !session.mfaVerified) {
    throw new Error('Money Desk requires a named workforce session with verified MFA assurance.')
  }
  const now = Math.floor(Date.now() / 1000)
  if (!session.authenticatedAt || now - session.authenticatedAt > MONEY_DESK_JIT_DURATION_MINUTES * 60) {
    throw new Error('Re-authenticate through Cloudflare Access with MFA before starting a Money Desk elevation.')
  }
}

function actorRole(session: OpsSession) {
  return session.role.toUpperCase()
}

function readRpcObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Money Desk returned an invalid response.')
  }
  return value as Record<string, unknown>
}

export async function getActiveMoneyDeskGrant(
  client: ServiceRoleClient,
  session: OpsSession,
  actionType?: MoneyDeskActionType,
): Promise<MoneyDeskGrant | null> {
  if (!isNamedOpsWorkforceSession(session) || !session.email) return null

  let query = client
    .from('money_desk_jit_grants')
    .select('id, expires_at, action_scopes')
    .eq('actor_email', session.email.toLowerCase())
    .eq('actor_subject', session.subject)
    .eq('actor_role', actorRole(session))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)

  if (actionType) query = query.contains('action_scopes', [actionType])

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) return null

  return {
    id: data.id,
    expiresAt: data.expires_at,
    actionScopes: (data.action_scopes ?? []).filter(isMoneyDeskActionType),
  }
}

export async function issueMoneyDeskElevation(
  client: ServiceRoleClient,
  session: OpsSession,
  input: { actionScopes: MoneyDeskActionType[]; reason: string },
) {
  requireNamedWorkforceSession(session)
  const reason = validateMoneyDeskReason(input.reason)
  const actionScopes = [...new Set(input.actionScopes)].filter(isMoneyDeskActionType)
  if (actionScopes.length === 0) throw new Error('Choose at least one Money Desk action scope.')

  const { data, error } = await client.rpc('issue_money_desk_jit_grant', {
    p_actor_email: session.email,
    p_actor_subject: session.subject,
    p_actor_role: actorRole(session),
    p_assurance_source: getOpsIdentityAssuranceSource(session),
    p_authentication_methods: session.authenticationMethods,
    p_action_scopes: actionScopes,
    p_reason: reason,
    p_correlation_id: randomUUID(),
  })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

export async function submitMoneyDeskRequest(
  client: ServiceRoleClient,
  session: OpsSession,
  grant: MoneyDeskGrant,
  input: MoneyDeskRequestInput,
) {
  requireNamedWorkforceSession(session)
  const reason = validateMoneyDeskReason(input.reason)
  const correlationId = randomUUID()
  const idempotencyKey = input.idempotencyKey?.trim() || createHash('sha256')
    .update(`${session.subject}:${input.actionType}:${input.targetType}:${input.targetId}:${correlationId}`)
    .digest('hex')

  const { data, error } = await client.rpc('submit_money_desk_request', {
    p_idempotency_key: idempotencyKey,
    p_jit_grant_id: grant.id,
    p_actor_email: session.email,
    p_actor_subject: session.subject,
    p_actor_role: actorRole(session),
    p_action_type: input.actionType,
    p_target_type: input.targetType.trim(),
    p_target_id: input.targetId.trim(),
    p_order_id: input.orderId ?? null,
    p_case_id: input.caseId ?? null,
    p_amount: input.amount ?? null,
    p_currency: input.currency?.trim().toUpperCase() || null,
    p_amount_usd_equivalent: input.amountUsdEquivalent ?? null,
    p_usd_equivalent_source: input.usdEquivalentSource?.trim() || null,
    p_reason: reason,
    p_action_payload: input.actionPayload ?? {},
    p_correlation_id: correlationId,
  })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

export async function decideMoneyDeskRequest(
  client: ServiceRoleClient,
  session: OpsSession,
  grant: MoneyDeskGrant,
  input: { requestId: string; decision: 'APPROVE' | 'REJECT'; reason: string },
) {
  requireNamedWorkforceSession(session)
  const reason = validateMoneyDeskReason(input.reason)
  const { data, error } = await client.rpc('decide_money_desk_request', {
    p_request_id: input.requestId,
    p_jit_grant_id: grant.id,
    p_actor_email: session.email,
    p_actor_subject: session.subject,
    p_actor_role: actorRole(session),
    p_decision: input.decision,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

export async function beginMoneyDeskExecution(
  client: ServiceRoleClient,
  session: OpsSession,
  grant: MoneyDeskGrant,
  requestId: string,
  idempotencyKey: string,
) {
  requireNamedWorkforceSession(session)
  const { data, error } = await client.rpc('begin_money_desk_execution', {
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_jit_grant_id: grant.id,
    p_actor_email: session.email,
    p_actor_subject: session.subject,
    p_actor_role: actorRole(session),
  })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

export async function completeMoneyDeskExecution(
  client: ServiceRoleClient,
  input: {
    attemptId: string
    outcome: 'SUCCEEDED' | 'FAILED' | 'BLOCKED'
    providerReference?: string | null
    failureCode?: string | null
    failureSummary?: string | null
  },
) {
  const { data, error } = await client.rpc('complete_money_desk_execution', {
    p_attempt_id: input.attemptId,
    p_status: input.outcome,
    p_provider_reference: input.providerReference ?? null,
    p_failure_code: input.failureCode ?? null,
    p_failure_summary: input.failureSummary?.slice(0, 500) ?? null,
  })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

export function allMoneyDeskActionScopes() {
  return [...MONEY_DESK_ACTION_TYPES]
}
