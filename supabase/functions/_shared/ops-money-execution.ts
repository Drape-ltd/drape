import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildRefundOrderPaymentsRequest } from '../../../packages/shared/src/payment-refund-request.ts'
import { getServiceRoleKey, getSupabaseUrl } from './env.ts'

export const MONEY_DESK_ACTION_TYPES = [
  'PAYOUT_RELEASE',
  'TIP_PAYOUT',
  'MATERIAL_ADVANCE_RELEASE',
  'CUSTOMER_REFUND',
  'PAYOUT_DESTINATION_CHANGE',
  'MANUAL_FX',
  'POST_RELEASE_RECOVERY',
  'POLICY_OVERRIDE',
  'OTHER_REVIEWED',
] as const

export type MoneyDeskActionType = (typeof MONEY_DESK_ACTION_TYPES)[number]

export function isMoneyDeskActionType(value: unknown): value is MoneyDeskActionType {
  return typeof value === 'string' && (MONEY_DESK_ACTION_TYPES as readonly string[]).includes(value)
}

type ServiceRoleClient = SupabaseClient

export type OpsMoneyActor = {
  email: string
  subject: string
  role: string
}

type MoneyDeskGrant = {
  id: string
  expiresAt: string
  actionScopes: MoneyDeskActionType[]
}

function readRpcObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Money Desk returned an invalid response.')
  return value as Record<string, unknown>
}

async function getActiveMoneyDeskGrant(client: ServiceRoleClient, actor: OpsMoneyActor, actionType?: MoneyDeskActionType): Promise<MoneyDeskGrant | null> {
  let query = client.from('money_desk_jit_grants').select('id,expires_at,action_scopes').eq('actor_email', actor.email.toLowerCase()).eq('actor_subject', actor.subject).eq('actor_role', actor.role.toUpperCase()).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('expires_at', { ascending: false }).limit(1)
  if (actionType) query = query.contains('action_scopes', [actionType])
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) return null
  return { id: String(data.id), expiresAt: String(data.expires_at), actionScopes: (data.action_scopes ?? []).filter(isMoneyDeskActionType) }
}

async function beginMoneyDeskExecution(client: ServiceRoleClient, actor: OpsMoneyActor, grant: MoneyDeskGrant, requestId: string, idempotencyKey: string) {
  const { data, error } = await client.rpc('begin_money_desk_execution', { p_request_id: requestId, p_idempotency_key: idempotencyKey, p_jit_grant_id: grant.id, p_actor_email: actor.email, p_actor_subject: actor.subject, p_actor_role: actor.role.toUpperCase() })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

async function completeMoneyDeskExecution(client: ServiceRoleClient, input: { attemptId: string; outcome: 'SUCCEEDED' | 'FAILED' | 'BLOCKED'; providerReference?: string | null; failureCode?: string | null; failureSummary?: string | null }) {
  const { data, error } = await client.rpc('complete_money_desk_execution', { p_attempt_id: input.attemptId, p_status: input.outcome, p_provider_reference: input.providerReference ?? null, p_failure_code: input.failureCode ?? null, p_failure_summary: input.failureSummary?.slice(0, 500) ?? null })
  if (error) throw new Error(error.message)
  return readRpcObject(data)
}

type AdapterResult = {
  ok: boolean
  pending?: boolean
  error?: string
  providerReference?: string | null
}

export type MoneyDeskExecutionCommandResult = AdapterResult & {
  attemptId: string
  actionType: MoneyDeskActionType
  state: 'SUCCEEDED' | 'PROCESSING' | 'FAILED' | 'BLOCKED'
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function actorLabel(session: OpsMoneyActor) {
  return session.email ?? session.subject
}

function actorRole(session: OpsMoneyActor) {
  return session.role.toUpperCase()
}

async function invokeEdge<T extends Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ response: Response; payload: T | null }> {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Money Desk provider execution is unavailable because server credentials are missing.')

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null) as T | null
  return { response, payload }
}

async function triggerOrderPayoutRelease(orderId: string, recoveryRequestId?: string | null): Promise<AdapterResult> {
  const { response, payload } = await invokeEdge<{
    ok?: boolean
    error?: string
    reason?: string
    message?: string
    results?: Array<{ result?: string; reason?: string; error?: string; payoutId?: string; providerStatus?: string }>
  }>('release-order-payouts', { orderId, recoveryRequestId: recoveryRequestId || undefined })
  if (!response.ok || !payload?.ok) return { ok: false, error: payload?.message ?? payload?.reason ?? payload?.error ?? `payout-release-function-${response.status}` }
  const result = payload.results?.[0]
  if (result?.result === 'processing') return { ok: true, pending: true, providerReference: result.payoutId ?? null }
  if (['blocked', 'error', 'requires_ops_review'].includes(result?.result ?? '')) {
    return { ok: false, error: result?.error ?? result?.reason ?? (result?.result === 'requires_ops_review' ? 'The failed payout still requires a reviewed recovery.' : 'Payout release was blocked.') }
  }
  return { ok: true, providerReference: result?.payoutId ?? null }
}

async function triggerSimpleProviderAction(
  functionName: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<AdapterResult> {
  const { response, payload } = await invokeEdge<{ ok?: boolean; error?: string; message?: string; pending?: boolean; providerReference?: string | null }>(functionName, body)
  return response.ok && payload?.ok
    ? { ok: true, pending: payload.pending === true, providerReference: payload.providerReference ?? null }
    : { ok: false, error: payload?.message ?? payload?.error ?? `${fallback}-${response.status}` }
}

async function refundOrderPaymentsForReview(orderId: string, input: {
  reason: string | null
  amount?: number | null
  refundResolutionId?: string | null
  materialAdvanceId?: string | null
  includeUnreleasedMaterialAdvances?: boolean
  allowedPhases?: Array<'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT' | 'MATERIAL_ADVANCE'>
  operationContext?: {
    kind: 'ORDER_CANCELLATION'
    moneyDeskRequestId: string
    disputeId: string
  }
}): Promise<AdapterResult> {
  const { response, payload } = await invokeEdge<{
    ok?: boolean
    error?: string
    reason?: string
    message?: string
    providerReference?: string | null
    pending?: boolean
  }>('refund-order-payments', {
    ...buildRefundOrderPaymentsRequest({ orderId, ...input }),
    refundResolutionId: input.refundResolutionId ?? undefined,
    materialAdvanceId: input.materialAdvanceId ?? undefined,
    operationContext: input.operationContext,
  })
  return response.ok && payload?.ok
    ? { ok: true, pending: payload.pending === true, providerReference: payload.providerReference ?? null }
    : { ok: false, error: payload?.message ?? payload?.reason ?? payload?.error ?? `refund-function-${response.status}` }
}

type CancellationRefundClaim = {
  paymentId: string
  phase: string
  amount: number
  refundedAmount: number
  remainingAmount: number
  currency: string
  materialAdvanceId: string | null
}

async function loadCancellationRefundSnapshot(client: ServiceRoleClient, orderId: string) {
  const { data: order, error: orderError } = await client.from('orders').select('id,reference,stage,currency,customer_id,tailor_id').eq('id', orderId).maybeSingle()
  if (orderError || !order?.id) throw new Error(orderError?.message ?? 'Order was not found.')
  if (order.stage !== 'IN_DISPUTE') throw new Error('The order is no longer under dispute review.')

  const [{ data: dispute, error: disputeError }, { data: payments, error: paymentsError }, { data: advances, error: advancesError }] = await Promise.all([
    client.from('disputes').select('id,status').eq('order_id', orderId).in('status', ['OPEN', 'UNDER_REVIEW']).maybeSingle(),
    client.from('order_payments').select('id,phase,amount,currency,status,refunded_amount,provider_payment_id').eq('order_id', orderId).in('phase', ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT', 'MATERIAL_ADVANCE']).order('created_at', { ascending: true }),
    client.from('order_material_advances').select('id,payment_id,status,release_status,provider_release_status,paid_at,released_at').eq('order_id', orderId),
  ])
  if (disputeError || !dispute?.id) throw new Error(disputeError?.message ?? 'The active dispute was not found.')
  if (paymentsError) throw new Error(paymentsError.message)
  if (advancesError) throw new Error(advancesError.message)

  const advancesByPaymentId = new Map((advances ?? []).filter((advance) => advance.payment_id).map((advance) => [String(advance.payment_id), advance]))
  const claims: CancellationRefundClaim[] = []
  for (const payment of payments ?? []) {
    if (!['SUCCEEDED', 'PARTIAL_REFUND'].includes(String(payment.status))) continue
    const amount = Number(payment.amount ?? 0)
    const refundedAmount = Math.max(Math.min(Number(payment.refunded_amount ?? 0), amount), 0)
    const remainingAmount = Math.max(amount - refundedAmount, 0)
    if (remainingAmount <= 0) continue
    if (!String(payment.provider_payment_id ?? '').trim()) throw new Error('A refundable payment is missing its provider reference.')
    const advance = payment.phase === 'MATERIAL_ADVANCE' ? advancesByPaymentId.get(String(payment.id)) : null
    if (payment.phase === 'MATERIAL_ADVANCE' && (!advance?.paid_at || advance.released_at || advance.release_status === 'RELEASED' || !['NOT_REQUESTED', 'BLOCKED'].includes(String(advance.provider_release_status ?? 'NOT_REQUESTED')))) {
      throw new Error('A material advance is not safely refundable through the approved cancellation path.')
    }
    claims.push({ paymentId: String(payment.id), phase: String(payment.phase), amount, refundedAmount, remainingAmount, currency: String(payment.currency), materialAdvanceId: advance?.id ? String(advance.id) : null })
  }
  if (claims.length === 0) throw new Error('No settled payment remains refundable for this order.')
  const currencies = [...new Set(claims.map((claim) => claim.currency))]
  if (currencies.length !== 1) throw new Error('Cancellation payments span multiple currencies and require a reviewed FX exception.')
  return {
    order,
    dispute,
    claims,
    currency: currencies[0]!,
    totalAmount: claims.reduce((sum, claim) => sum + claim.remainingAmount, 0),
    snapshotKey: claims.map((claim) => `${claim.paymentId}:${claim.refundedAmount}:${claim.remainingAmount}`).join('|'),
  }
}

async function resolveOrderLinkedOpsIssues(client: ServiceRoleClient, input: { orderId: string; issueTypes: string[]; performedBy: string; performedRole: string; actionTaken: string; reason: string | null }) {
  const { data: issues } = await client.from('ops_issues').select('id,issue_type,status,assigned_to,resolved_at').eq('order_id', input.orderId).in('issue_type', input.issueTypes).neq('status', 'RESOLVED')
  if (!issues?.length) return
  const resolvedAt = new Date().toISOString()
  await client.from('ops_issues').update({ status: 'RESOLVED', assigned_to: input.performedBy, resolved_at: resolvedAt }).in('id', issues.map((issue) => issue.id))
  await client.from('ops_audit_logs').insert(issues.map((issue) => ({ issue_id: issue.id, action_taken: input.actionTaken, performed_by: input.performedBy, performed_role: input.performedRole, reason: input.reason, before_state: { status: issue.status, assigned_to: issue.assigned_to ?? null, resolved_at: issue.resolved_at ?? null }, after_state: { status: 'RESOLVED', assigned_to: input.performedBy, resolved_at: resolvedAt } })))
}

async function enqueuePayoutChangePush(client: ServiceRoleClient, input: { requestId: string; tailorUserId: string }) {
  const { error } = await client.rpc('enqueue_domain_event', {
    p_event_type: 'notification.push_requested', p_aggregate_type: 'user', p_aggregate_id: input.tailorUserId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: null,
    p_idempotency_key: `payout-change:${input.requestId}:approved:delivery`,
    p_payload: { userId: input.tailorUserId, subject: 'Your new payout account is active', eyebrow: 'Payout account update', headline: 'Your new payout account is active', body: 'Your verified replacement is active now. Eligible earnings can release to it without an extra payout-account hold.', ctaLabel: 'View payout account', webPath: '/account/payout', appUrl: 'drape://profile/payout-setup', details: [], notification: { title: 'Payout destination approved', body: 'Your verified replacement is active now. Eligible earnings can release to it without an extra payout-account hold.', preferenceKey: 'paymentReleased', data: { destination: 'PAYOUT', payoutChangeRequestId: input.requestId } } },
    p_metadata: { source: 'ops-payout-change-review' }, p_jobs: ['SEND_PUSH', 'SEND_ACCOUNT_EVENT_EMAIL'], p_priority: 20, p_max_attempts: 6, p_run_at: new Date().toISOString(),
  })
  if (error) await client.from('audit_logs').insert({ actor_role: 'OPS', event: 'ops.payout_change_notification_enqueue_failed', severity: 'error', payload: { payout_change_request_id: input.requestId, tailor_user_id: input.tailorUserId, outcome: 'APPROVED', error: error.message } })
}

async function runAdapter(client: ServiceRoleClient, session: OpsMoneyActor, moneyRequest: {
  id: string
  action_type: MoneyDeskActionType
  target_type: string
  target_id: string
  order_id: string | null
  amount: number | null
  currency: string | null
  reason: string
  action_payload: unknown
}): Promise<AdapterResult> {
  const payload = objectValue(moneyRequest.action_payload)
  if (moneyRequest.action_type === 'PAYOUT_RELEASE') {
    const trancheId = typeof payload.trancheId === 'string' && payload.trancheId ? payload.trancheId : null
    if (moneyRequest.target_type === 'CONSULTATION_BOOKING') return triggerSimpleProviderAction('release-consultation-earning', { bookingId: moneyRequest.target_id }, 'consultation-release-function')
    if (trancheId) return triggerSimpleProviderAction('release-settlement-tranche', { trancheId, moneyDeskRequestId: moneyRequest.id }, 'settlement-release-function')
    return triggerOrderPayoutRelease(moneyRequest.order_id || moneyRequest.target_id, moneyRequest.target_type === 'ORDER_RESIDUAL_SETTLEMENT' ? moneyRequest.id : null)
  }
  if (moneyRequest.action_type === 'TIP_PAYOUT') return triggerSimpleProviderAction('release-order-tip', { tipId: moneyRequest.target_id }, 'tip-payout-function')
  if (moneyRequest.action_type === 'MATERIAL_ADVANCE_RELEASE') {
    const advanceId = typeof payload.advanceId === 'string' && payload.advanceId ? payload.advanceId : moneyRequest.target_id
    return triggerSimpleProviderAction('material-advance-action', { action: 'release-advance', advanceId, moneyDeskRequestId: moneyRequest.id, note: typeof payload.note === 'string' ? payload.note : undefined }, 'material-advance-release-function')
  }
  if (moneyRequest.action_type === 'CUSTOMER_REFUND') {
    if (moneyRequest.target_type === 'CONSULTATION_BOOKING') {
      if (!moneyRequest.order_id || !moneyRequest.amount) return { ok: false, error: 'The consultation refund is missing its approved order or amount snapshot.' }
      const refund = await refundOrderPaymentsForReview(moneyRequest.order_id, { reason: typeof payload.note === 'string' ? payload.note : moneyRequest.reason, amount: moneyRequest.amount, allowedPhases: ['CONSULTATION'] })
      if (!refund.ok || refund.pending) return refund
      const { error } = await client.from('consultation_bookings').update({ payment_status: 'REFUNDED', settlement_status: 'REFUNDED', refunded_amount: moneyRequest.amount, settlement_outcome: 'CUSTOMER_REFUND_COMPLETED', settled_at: new Date().toISOString(), settlement_provider_reference: refund.providerReference, settlement_failure_reason: null }).eq('id', moneyRequest.target_id).eq('settlement_status', 'REFUND_PENDING')
      return error ? { ok: false, error: 'The refund completed, but consultation reconciliation needs operator attention.' } : refund
    }
    if (moneyRequest.target_type === 'ORDER_CANCELLATION') {
      const snapshot = await loadCancellationRefundSnapshot(client, moneyRequest.order_id || moneyRequest.target_id)
      const expectedClaims = Array.isArray(payload.paymentClaims) ? payload.paymentClaims : []
      if (payload.paymentSnapshotKey !== snapshot.snapshotKey || expectedClaims.length !== snapshot.claims.length || moneyRequest.amount !== snapshot.totalAmount || moneyRequest.currency !== snapshot.currency) {
        return { ok: false, error: 'The refundable payment exposure changed after approval. Prepare a new cancellation refund request.' }
      }
      return refundOrderPaymentsForReview(snapshot.order.id, {
        reason: typeof payload.note === 'string' ? payload.note : moneyRequest.reason,
        includeUnreleasedMaterialAdvances: snapshot.claims.some((claim) => claim.phase === 'MATERIAL_ADVANCE'),
        operationContext: {
          kind: 'ORDER_CANCELLATION',
          moneyDeskRequestId: moneyRequest.id,
          disputeId: snapshot.dispute.id,
        },
      })
    }
    if (moneyRequest.target_type === 'ORDER_MATERIAL_ADVANCE') {
      const { error } = await client.rpc('prepare_material_unused_value_refund', { p_advance_id: moneyRequest.target_id, p_money_desk_request_id: moneyRequest.id, p_actor_email: actorLabel(session) })
      if (error || !moneyRequest.order_id || !moneyRequest.amount) return { ok: false, error: 'The unused fabric value refund could not be prepared.' }
      return refundOrderPaymentsForReview(moneyRequest.order_id, { reason: typeof payload.note === 'string' ? payload.note : 'Refund unused approved fabric value', amount: moneyRequest.amount, materialAdvanceId: moneyRequest.target_id })
    }
    const refundResolutionId = typeof payload.refundResolutionId === 'string' && payload.refundResolutionId ? payload.refundResolutionId : moneyRequest.target_id
    const { data: resolution, error } = await client.from('order_refund_resolutions').select('id,order_id,amount,status').eq('id', refundResolutionId).maybeSingle()
    if (error || !resolution?.id || !resolution.order_id) return { ok: false, error: 'The approved refund resolution could not be loaded.' }
    await client.from('order_refund_resolutions').update({ status: 'APPROVED', money_desk_request_id: moneyRequest.id, updated_at: new Date().toISOString() }).eq('id', resolution.id).in('status', ['MONEY_DESK_REQUIRED', 'APPROVAL_PENDING', 'APPROVED', 'FAILED'])
    const refund = await refundOrderPaymentsForReview(resolution.order_id, { reason: typeof payload.note === 'string' ? payload.note : 'Approved return resolution', amount: resolution.amount, refundResolutionId: resolution.id })
    if (!refund.ok) await client.from('order_refund_resolutions').update({ status: 'FAILED', failure_summary: refund.error ?? 'Refund adapter failed.', updated_at: new Date().toISOString() }).eq('id', resolution.id)
    return refund
  }
  if (moneyRequest.action_type === 'PAYOUT_DESTINATION_CHANGE') {
    if (moneyRequest.target_type === 'PAYOUT_CHANGE_REQUEST') {
      const { data: change, error } = await client.from('payout_change_requests').select('id,status,tailor_user_id,metadata').eq('id', moneyRequest.target_id).maybeSingle()
      const metadata = objectValue(change?.metadata)
      if (error || !change?.id || change.status !== 'PENDING') return { ok: false, error: 'The payout destination request is no longer pending review.' }
      if (metadata.lifecycle_state !== 'OPS_REVIEW' || metadata.confirmation_status !== 'CONFIRMED') return { ok: false, error: 'The tailor must confirm this payout request before Ops can activate it.' }
      const { error: decisionError } = await client.rpc('ops_finalize_payout_change_request', { p_request_id: change.id, p_reason: moneyRequest.reason, p_reviewed_by: actorLabel(session), p_reviewed_role: actorRole(session), p_money_desk_request_id: moneyRequest.id })
      if (decisionError) return { ok: false, error: 'The reviewed payout destination decision could not be persisted.' }
      await enqueuePayoutChangePush(client, { requestId: change.id, tailorUserId: change.tailor_user_id })
      return { ok: true }
    }
    if (moneyRequest.target_type !== 'ORDER_PAYOUT_FAILURE' || !moneyRequest.order_id) return { ok: false, error: 'The approved request is not linked to an order payout failure.' }
    const { data: correction, error } = await client.rpc('apply_reviewed_payout_destination_correction', { p_money_desk_request_id: moneyRequest.id, p_actor_email: actorLabel(session), p_actor_role: actorRole(session) })
    const correctionData = objectValue(correction)
    if (error || typeof correctionData.correctionId !== 'string') return { ok: false, error: 'The reviewed payout destination correction could not be applied.' }
    const release = await triggerOrderPayoutRelease(moneyRequest.order_id, moneyRequest.id)
    if (release.ok) await resolveOrderLinkedOpsIssues(client, { orderId: moneyRequest.order_id, issueTypes: ['PAYOUT_FAILED'], performedBy: actorLabel(session), performedRole: actorRole(session), actionTaken: 'PAYOUT_DESTINATION_CORRECTED_AND_RETRIED', reason: moneyRequest.reason })
    return release
  }
  if (moneyRequest.action_type === 'POST_RELEASE_RECOVERY') {
    return moneyRequest.target_type === 'STRIPE_TRANSFER_REVERSAL'
      ? triggerSimpleProviderAction('reverse-stripe-transfer', { moneyDeskRequestId: moneyRequest.id }, 'stripe-transfer-reversal')
      : { ok: false, error: 'This post-release recovery is not linked to the Stripe transfer-reversal adapter.' }
  }
  return { ok: false, error: 'This action requires its dedicated reviewed execution adapter before money can move.' }
}

export async function executeMoneyDeskRequest(
  client: ServiceRoleClient,
  session: OpsMoneyActor,
  input: { requestId: string; idempotencyKey: string },
): Promise<MoneyDeskExecutionCommandResult> {
  const { data, error } = await client.from('money_desk_requests').select('id,action_type,target_type,target_id,order_id,amount,currency,reason,action_payload,status').eq('id', input.requestId).maybeSingle()
  if (error || !data?.id || !isMoneyDeskActionType(data.action_type)) throw new Error(error?.message ?? 'Money Desk request was not found.')
  const grant = await getActiveMoneyDeskGrant(client, session, data.action_type)
  if (!grant) throw new Error('Money Desk elevation is required before execution.')
  const execution = await beginMoneyDeskExecution(client, session, grant, input.requestId, input.idempotencyKey)
  const attemptId = typeof execution.attemptId === 'string' ? execution.attemptId : null
  if (!attemptId) throw new Error('Money Desk execution attempt was not created.')

  if (execution.duplicate === true) {
    const { data: existingAttempt, error: existingAttemptError } = await client
      .from('money_desk_execution_attempts')
      .select('status,provider_reference,failure_summary')
      .eq('id', attemptId)
      .maybeSingle()
    if (existingAttemptError || !existingAttempt) throw new Error(existingAttemptError?.message ?? 'The existing Money Desk execution attempt could not be loaded.')
    const existingState = String(existingAttempt.status)
    const state: MoneyDeskExecutionCommandResult['state'] = existingState === 'SUCCEEDED'
      ? 'SUCCEEDED'
      : existingState === 'PROCESSING'
        ? 'PROCESSING'
        : existingState === 'BLOCKED'
          ? 'BLOCKED'
          : 'FAILED'
    return {
      ok: state === 'SUCCEEDED' || state === 'PROCESSING',
      pending: state === 'PROCESSING',
      error: state === 'FAILED' || state === 'BLOCKED'
        ? String(existingAttempt.failure_summary ?? 'The prior execution attempt did not succeed.')
        : undefined,
      providerReference: typeof existingAttempt.provider_reference === 'string' ? existingAttempt.provider_reference : null,
      attemptId,
      actionType: data.action_type,
      state,
    }
  }

  let result: AdapterResult
  try {
    result = await runAdapter(client, session, {
      id: String(data.id), action_type: data.action_type, target_type: String(data.target_type), target_id: String(data.target_id),
      order_id: typeof data.order_id === 'string' ? data.order_id : null, amount: typeof data.amount === 'number' ? data.amount : null,
      currency: typeof data.currency === 'string' ? data.currency : null, reason: String(data.reason), action_payload: data.action_payload,
    })
  } catch (adapterError) {
    result = { ok: false, error: adapterError instanceof Error ? adapterError.message : 'Provider execution failed before reaching an authoritative outcome.' }
  }

  if (result.pending) return { ...result, attemptId, actionType: data.action_type, state: 'PROCESSING' }
  const supported = ['PAYOUT_RELEASE', 'TIP_PAYOUT', 'MATERIAL_ADVANCE_RELEASE', 'CUSTOMER_REFUND', 'PAYOUT_DESTINATION_CHANGE', 'POST_RELEASE_RECOVERY'].includes(data.action_type)
  const state = result.ok ? 'SUCCEEDED' : supported ? 'FAILED' : 'BLOCKED'
  await completeMoneyDeskExecution(client, { attemptId, outcome: state, failureCode: result.ok ? null : 'EXECUTION_ADAPTER_BLOCKED', failureSummary: result.error ?? null, providerReference: result.providerReference ?? null })

  if (result.ok && data.action_type === 'CUSTOMER_REFUND' && data.target_type === 'ORDER_MATERIAL_ADVANCE') {
    const finalization = await triggerSimpleProviderAction('material-advance-action', { action: 'finalize-unused-refund', advanceId: data.target_id, moneyDeskRequestId: data.id, actorRef: actorLabel(session) }, 'material-advance-action')
    if (!finalization.ok) throw new Error(`Refund succeeded but material reconciliation could not be finalized: ${finalization.error}`)
  }
  return { ...result, attemptId, actionType: data.action_type, state }
}
