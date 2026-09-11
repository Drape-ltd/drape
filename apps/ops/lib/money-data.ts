import 'server-only'

import { MONEY_DESK_ACTION_LABELS, isMoneyDeskActionType } from '@drape/shared/money-desk'
import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

export type MoneyDecision = { id: string; requestId: string; decision: string; approverEmail: string; approverRole: string; reason: string; createdAt: string }
export type MoneyAttempt = { id: string; requestId: string; status: string; executorEmail: string; executorRole: string; providerReference: string | null; failureCode: string | null; failureSummary: string | null; correlationId: string; startedAt: string; completedAt: string | null }
export type MoneyRequest = {
  id: string; reference: string; actionType: string; actionLabel: string; status: string; targetType: string; targetId: string
  orderId: string | null; orderReference: string | null; amount: number | null; currency: string | null; reason: string
  requesterEmail: string; requesterRole: string; riskLevel: string; riskReasons: string[]; requiredApprovalCount: number
  approvalCount: number; correlationId: string; executionOutcome: string | null; providerReference: string | null
  createdAt: string; updatedAt: string; decisions: MoneyDecision[]; attempts: MoneyAttempt[]
}
export type MoneyData = {
  requests: MoneyRequest[]
  payouts: Array<{ id: string; orderId: string | null; status: string; amount: number; currency: string; provider: string; processedAt: string | null }>
  tranches: Array<{ id: string; orderId: string; code: string; status: string; amount: number; currency: string; eligibleAt: string | null; correlationId: string }>
  payoutSummary: { pending: number; blocked: number; processing: number }
  settlementSummary: { eligible: number; requested: number; blocked: number }
  observedAt: string
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function loadMoneyData(): Promise<MoneyData> {
  if (requiresOpsEdgeBroker()) {
    const data = await invokeOpsReadBroker<MoneyData>('money')
    return {
      ...data,
      payouts: Array.isArray(data.payouts) ? data.payouts : [],
      tranches: Array.isArray(data.tranches) ? data.tranches : [],
      requests: data.requests.map((request) => ({
        ...request,
        actionLabel: isMoneyDeskActionType(request.actionType) ? MONEY_DESK_ACTION_LABELS[request.actionType] : request.actionType,
      })),
    }
  }
  const client = createServiceRoleClient()
  if (!client) throw new Error('Money Desk is unavailable because the server database client is not configured.')

  const [requestResult, decisionResult, attemptResult, payoutResult, trancheResult] = await Promise.all([
    client.from('money_desk_requests').select('id,reference,action_type,status,target_type,target_id,order_id,amount,currency,reason,requester_email,requester_role,risk_level,risk_reasons,required_approval_count,approval_count,correlation_id,execution_outcome,provider_reference,created_at,updated_at').order('created_at', { ascending: false }).limit(150),
    client.from('money_desk_decisions').select('id,request_id,decision,approver_email,approver_role,reason,created_at').order('created_at', { ascending: false }).limit(500),
    client.from('money_desk_execution_attempts').select('id,request_id,status,executor_email,executor_role,provider_reference,failure_code,failure_summary,correlation_id,started_at,completed_at').order('started_at', { ascending: false }).limit(500),
    client.from('payouts').select('id,order_id,status,amount,currency,provider,processed_at').in('status', ['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED']).limit(500),
    client.from('order_settlement_tranches').select('id,order_id,code,status,amount,currency,eligible_at,correlation_id').in('status', ['ELIGIBLE', 'RELEASE_REQUESTED', 'BLOCKED']).limit(500),
  ])

  for (const [label, result] of [['Money Desk requests', requestResult], ['Money Desk decisions', decisionResult], ['Money Desk attempts', attemptResult], ['Payout summary', payoutResult], ['Settlement summary', trancheResult]] as const) {
    if (result.error) throw new Error(`${label} is unavailable: ${result.error.message}`)
  }

  const orderIds = [...new Set((requestResult.data ?? []).map((row) => text(row.order_id)).filter((value): value is string => Boolean(value)))]
  const orderResult = orderIds.length > 0 ? await client.from('orders').select('id,reference').in('id', orderIds) : { data: [], error: null }
  if (orderResult.error) throw new Error(`Money Desk order context is unavailable: ${orderResult.error.message}`)
  const orders = new Map((orderResult.data ?? []).map((row) => [String(row.id), text(row.reference)]))
  const decisions = (decisionResult.data ?? []).map((row) => ({ id: String(row.id), requestId: String(row.request_id), decision: String(row.decision), approverEmail: String(row.approver_email), approverRole: String(row.approver_role), reason: String(row.reason), createdAt: String(row.created_at) }))
  const attempts = (attemptResult.data ?? []).map((row) => ({ id: String(row.id), requestId: String(row.request_id), status: String(row.status), executorEmail: String(row.executor_email), executorRole: String(row.executor_role), providerReference: text(row.provider_reference), failureCode: text(row.failure_code), failureSummary: text(row.failure_summary), correlationId: String(row.correlation_id), startedAt: String(row.started_at), completedAt: text(row.completed_at) }))
  const payoutStatuses = (payoutResult.data ?? []).map((row) => String(row.status).toUpperCase())
  const trancheStatuses = (trancheResult.data ?? []).map((row) => String(row.status).toUpperCase())

  return {
    requests: (requestResult.data ?? []).map((row) => {
      const actionType = String(row.action_type)
      const orderId = text(row.order_id)
      return {
        id: String(row.id), reference: String(row.reference), actionType, actionLabel: isMoneyDeskActionType(actionType) ? MONEY_DESK_ACTION_LABELS[actionType] : actionType,
        status: String(row.status), targetType: String(row.target_type), targetId: String(row.target_id), orderId, orderReference: orderId ? orders.get(orderId) ?? null : null,
        amount: typeof row.amount === 'number' ? row.amount : null, currency: text(row.currency), reason: String(row.reason), requesterEmail: String(row.requester_email), requesterRole: String(row.requester_role),
        riskLevel: String(row.risk_level), riskReasons: Array.isArray(row.risk_reasons) ? row.risk_reasons.map(String) : [], requiredApprovalCount: Number(row.required_approval_count), approvalCount: Number(row.approval_count),
        correlationId: String(row.correlation_id), executionOutcome: text(row.execution_outcome), providerReference: text(row.provider_reference), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
        decisions: decisions.filter((decision) => decision.requestId === String(row.id)), attempts: attempts.filter((attempt) => attempt.requestId === String(row.id)),
      }
    }),
    payouts: (payoutResult.data ?? []).map((row) => ({ id: String(row.id), orderId: text(row.order_id), status: String(row.status), amount: Number(row.amount), currency: String(row.currency), provider: String(row.provider), processedAt: text(row.processed_at) })),
    tranches: (trancheResult.data ?? []).map((row) => ({ id: String(row.id), orderId: String(row.order_id), code: String(row.code), status: String(row.status), amount: Number(row.amount), currency: String(row.currency), eligibleAt: text(row.eligible_at), correlationId: String(row.correlation_id) })),
    payoutSummary: { pending: payoutStatuses.filter((status) => status === 'PENDING').length, blocked: payoutStatuses.filter((status) => ['BLOCKED', 'FAILED'].includes(status)).length, processing: payoutStatuses.filter((status) => status === 'PROCESSING').length },
    settlementSummary: { eligible: trancheStatuses.filter((status) => status === 'ELIGIBLE').length, requested: trancheStatuses.filter((status) => status === 'RELEASE_REQUESTED').length, blocked: trancheStatuses.filter((status) => status === 'BLOCKED').length },
    observedAt: new Date().toISOString(),
  }
}
