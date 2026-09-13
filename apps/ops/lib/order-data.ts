import 'server-only'

import { invokeOpsReadBroker, requiresOpsEdgeBroker } from '../../web/lib/ops-edge-broker'
import { createServiceRoleClient } from '../../web/lib/server-supabase'

export type OrderSummary = {
  id: string
  reference: string
  kind: string
  item: string
  stage: string
  stageUpdatedAt: string
  createdAt: string
  amount: number | null
  currency: string | null
  deliveryMethod: string | null
  customerId: string
  tailorId: string | null
  paymentStatus: string | null
  paymentPhase: string | null
  openCaseCount: number
  moneyStatus: string | null
  fulfillmentStatus: string | null
  settlementStatus: string | null
  nextOwner: string
  nextAction: string
}

export type OrderTimelineEntry = {
  id: string
  type: string
  title: string
  summary: string | null
  actor: string
  occurredAt: string
  source: 'stage' | 'order' | 'fulfillment'
}

export type OrderDetail = {
  order: OrderSummary & {
    description: string | null
    deadline: string | null
    occasion: string | null
    fabricSource: string | null
    escrowReleased: boolean
    escrowReleasedAt: string | null
    handoffCompletedAt: string | null
    customerHandoffConfirmedAt: string | null
    trackingNumber: string | null
    carrier: string | null
    customerName: string | null
    tailorName: string | null
  }
  timeline: OrderTimelineEntry[]
  payments: Array<{ id: string; phase: string; provider: string | null; amount: number; currency: string; status: string; refundedAmount: number; createdAt: string; confirmedAt: string | null }>
  tranches: Array<{ id: string; code: string; amount: number; currency: string; status: string; eligibleAt: string | null; releasedAt: string | null; blockedReason: string | null; correlationId: string }>
  cases: Array<{ id: string; caseNumber: string; type: string; severity: string; status: string; title: string; recommendedAction: string; updatedAt: string }>
  moneyRequests: Array<{ id: string; reference: string; actionType: string; status: string; amount: number | null; currency: string | null; correlationId: string; createdAt: string }>
  observedAt: string
}

const TERMINAL_STAGES = new Set(['COMPLETE', 'CANCELLED', 'DECLINED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED'])
const CUSTOMER_STAGES = new Set(['QUOTE_SENT', 'PAYMENT_PENDING', 'AWAITING_CUSTOMER_CONFIRMATION', 'DELIVERED', 'READY_FOR_COLLECTION'])
const OPS_STAGES = new Set(['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'IN_DISPUTE'])

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nextStep(stage: string) {
  if (TERMINAL_STAGES.has(stage)) return { nextOwner: 'Closed', nextAction: 'No lifecycle action is available.' }
  if (CUSTOMER_STAGES.has(stage)) return { nextOwner: 'Customer', nextAction: stage === 'PAYMENT_PENDING' ? 'Complete payment.' : stage === 'DELIVERED' ? 'Confirm receipt or raise a concern.' : 'Review and respond.' }
  if (OPS_STAGES.has(stage)) return { nextOwner: 'Drapeon Ops', nextAction: stage === 'IN_DISPUTE' ? 'Review the linked case and evidence.' : 'Verify the handoff or dispatch state.' }
  return { nextOwner: 'Tailor', nextAction: stage === 'PENDING_QUOTE' ? 'Review the brief and quote or request consultation.' : 'Complete the current production step.' }
}

function displayCaseNumber(row: { case_number?: unknown; issue_number?: unknown }) {
  const explicit = text(row.case_number)
  return explicit ?? `OPS-${String(Number(row.issue_number ?? 0)).padStart(6, '0')}`
}

export async function loadOrdersData(): Promise<{ orders: OrderSummary[]; observedAt: string }> {
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker('orders')
  const client = createServiceRoleClient()
  if (!client) throw new Error('Orders are unavailable because the server database client is not configured.')
  const orderResult = await client.from('orders').select('id,reference,order_kind,garment_type,item_title,stage,stage_updated_at,created_at,quoted_amount,total_amount,currency,quoted_currency,delivery_method,customer_id,tailor_id').order('stage_updated_at', { ascending: false }).limit(200)
  if (orderResult.error) throw new Error(`Order lifecycle is unavailable: ${orderResult.error.message}`)
  const rows = orderResult.data ?? []
  const ids = rows.map((row) => String(row.id))
  if (ids.length === 0) return { orders: [], observedAt: new Date().toISOString() }

  const [paymentResult, issueResult, moneyResult, fulfillmentResult, settlementResult] = await Promise.all([
    client.from('order_payments').select('order_id,phase,status,created_at').in('order_id', ids).order('created_at', { ascending: false }).limit(600),
    client.from('ops_issues').select('order_id,status').in('order_id', ids).in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED']).limit(600),
    client.from('money_desk_requests').select('order_id,status,created_at').in('order_id', ids).order('created_at', { ascending: false }).limit(600),
    client.from('order_fulfillment_runs').select('order_id,status').in('order_id', ids).limit(300),
    client.from('order_settlement_plans').select('order_id,status').in('order_id', ids).limit(300),
  ])
  const results = [paymentResult, issueResult, moneyResult, fulfillmentResult, settlementResult]
  const failed = results.find((result) => result.error)
  if (failed?.error) throw new Error(`Order operational context is unavailable: ${failed.error.message}`)

  const payments = paymentResult.data ?? []
  const issues = issueResult.data ?? []
  const requests = moneyResult.data ?? []
  const fulfillments = new Map((fulfillmentResult.data ?? []).map((row) => [String(row.order_id), String(row.status)]))
  const settlements = new Map((settlementResult.data ?? []).map((row) => [String(row.order_id), String(row.status)]))
  return {
    orders: rows.map((row) => {
      const id = String(row.id)
      const latestPayment = payments.find((payment) => String(payment.order_id) === id)
      const latestMoney = requests.find((request) => String(request.order_id) === id)
      const stage = String(row.stage)
      return {
        id,
        reference: String(row.reference),
        kind: text(row.order_kind) ?? 'CUSTOM',
        item: text(row.item_title) ?? text(row.garment_type) ?? 'Order',
        stage,
        stageUpdatedAt: String(row.stage_updated_at),
        createdAt: String(row.created_at),
        amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null,
        currency: text(row.quoted_currency) ?? text(row.currency),
        deliveryMethod: text(row.delivery_method),
        customerId: String(row.customer_id),
        tailorId: text(row.tailor_id),
        paymentStatus: latestPayment ? String(latestPayment.status) : null,
        paymentPhase: latestPayment ? String(latestPayment.phase) : null,
        openCaseCount: issues.filter((issue) => String(issue.order_id) === id).length,
        moneyStatus: latestMoney ? String(latestMoney.status) : null,
        fulfillmentStatus: fulfillments.get(id) ?? null,
        settlementStatus: settlements.get(id) ?? null,
        ...nextStep(stage),
      }
    }),
    observedAt: new Date().toISOString(),
  }
}

export async function loadOrderDetail(orderId: string): Promise<OrderDetail | null> {
  if (requiresOpsEdgeBroker()) return invokeOpsReadBroker<OrderDetail | null>('order-detail', { orderId })
  const client = createServiceRoleClient()
  if (!client) throw new Error('Order detail is unavailable because the server database client is not configured.')
  const { data: row, error } = await client.from('orders').select('id,reference,order_kind,garment_type,item_title,garment_description,stage,stage_updated_at,created_at,quoted_amount,total_amount,currency,quoted_currency,delivery_method,customer_id,tailor_id,deadline,occasion,fabric_source,escrow_released,escrow_released_at,handoff_completed_at,customer_handoff_confirmed_at,tracking_number,carrier').eq('id', orderId).maybeSingle()
  if (error) throw new Error(`Order detail is unavailable: ${error.message}`)
  if (!row) return null
  const id = String(row.id)

  const [stagesResult, eventsResult, paymentsResult, fulfillmentEventsResult, trancheResult, caseResult, moneyResult] = await Promise.all([
    client.from('order_stage_updates').select('id,stage,note,created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
    client.from('order_events').select('id,event_type,title,summary,actor_role,created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
    client.from('order_payments').select('id,phase,provider,amount,currency,status,refunded_amount,created_at,confirmed_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
    client.from('order_fulfillment_events').select('id,event_type,source,customer_note,occurred_at').eq('order_id', id).order('occurred_at', { ascending: false }).limit(100),
    client.from('order_settlement_tranches').select('id,code,amount,currency,status,eligible_at,released_at,blocked_reason,correlation_id').eq('order_id', id).order('sequence'),
    client.from('ops_issues').select('id,case_number,issue_number,issue_type,severity,status,canonical_status,title,recommended_action,updated_at').eq('order_id', id).order('updated_at', { ascending: false }).limit(100),
    client.from('money_desk_requests').select('id,reference,action_type,status,amount,currency,correlation_id,created_at').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
  ])
  const childResults = [stagesResult, eventsResult, paymentsResult, fulfillmentEventsResult, trancheResult, caseResult, moneyResult]
  const childFailure = childResults.find((result) => result.error)
  if (childFailure?.error) throw new Error(`Order evidence is unavailable: ${childFailure.error.message}`)

  const customerId = String(row.customer_id)
  const tailorId = text(row.tailor_id)
  const [customerResult, tailorResult] = await Promise.all([
    client.from('customer_profiles').select('display_name').eq('user_id', customerId).maybeSingle(),
    tailorId ? client.from('tailor_profiles').select('display_name,business_name').eq('user_id', tailorId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (customerResult.error || tailorResult.error) throw new Error('Order participant labels are unavailable.')

  const payments = paymentsResult.data ?? []
  const latestPayment = payments[0]
  const moneyRequests = moneyResult.data ?? []
  const cases = caseResult.data ?? []
  const stage = String(row.stage)
  const timeline: OrderTimelineEntry[] = [
    ...(stagesResult.data ?? []).map((entry) => ({ id: String(entry.id), type: String(entry.stage), title: `Stage · ${String(entry.stage)}`, summary: text(entry.note), actor: 'Order lifecycle', occurredAt: String(entry.created_at), source: 'stage' as const })),
    ...(eventsResult.data ?? []).map((entry) => ({ id: String(entry.id), type: String(entry.event_type), title: String(entry.title), summary: text(entry.summary), actor: String(entry.actor_role), occurredAt: String(entry.created_at), source: 'order' as const })),
    ...(fulfillmentEventsResult.data ?? []).map((entry) => ({ id: String(entry.id), type: String(entry.event_type), title: `Fulfilment · ${String(entry.event_type)}`, summary: text(entry.customer_note), actor: String(entry.source), occurredAt: String(entry.occurred_at), source: 'fulfillment' as const })),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))

  return {
    order: {
      id,
      reference: String(row.reference),
      kind: text(row.order_kind) ?? 'CUSTOM',
      item: text(row.item_title) ?? text(row.garment_type) ?? 'Order',
      stage,
      stageUpdatedAt: String(row.stage_updated_at),
      createdAt: String(row.created_at),
      amount: typeof row.total_amount === 'number' ? row.total_amount : typeof row.quoted_amount === 'number' ? row.quoted_amount : null,
      currency: text(row.quoted_currency) ?? text(row.currency),
      deliveryMethod: text(row.delivery_method),
      customerId,
      tailorId,
      paymentStatus: latestPayment ? String(latestPayment.status) : null,
      paymentPhase: latestPayment ? String(latestPayment.phase) : null,
      openCaseCount: cases.filter((entry) => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(String(entry.canonical_status ?? entry.status))).length,
      moneyStatus: moneyRequests[0] ? String(moneyRequests[0].status) : null,
      fulfillmentStatus: (fulfillmentEventsResult.data ?? [])[0] ? String((fulfillmentEventsResult.data ?? [])[0].event_type) : null,
      settlementStatus: (trancheResult.data ?? []).some((entry) => String(entry.status) === 'BLOCKED') ? 'BLOCKED' : (trancheResult.data ?? []).some((entry) => String(entry.status) === 'ELIGIBLE') ? 'ELIGIBLE' : null,
      ...nextStep(stage),
      description: text(row.garment_description),
      deadline: text(row.deadline),
      occasion: text(row.occasion),
      fabricSource: text(row.fabric_source),
      escrowReleased: Boolean(row.escrow_released),
      escrowReleasedAt: text(row.escrow_released_at),
      handoffCompletedAt: text(row.handoff_completed_at),
      customerHandoffConfirmedAt: text(row.customer_handoff_confirmed_at),
      trackingNumber: text(row.tracking_number),
      carrier: text(row.carrier),
      customerName: text(customerResult.data?.display_name),
      tailorName: text(tailorResult.data?.business_name) ?? text(tailorResult.data?.display_name),
    },
    timeline,
    payments: payments.map((payment) => ({ id: String(payment.id), phase: String(payment.phase), provider: text(payment.provider), amount: Number(payment.amount), currency: String(payment.currency), status: String(payment.status), refundedAmount: Number(payment.refunded_amount ?? 0), createdAt: String(payment.created_at), confirmedAt: text(payment.confirmed_at) })),
    tranches: (trancheResult.data ?? []).map((entry) => ({ id: String(entry.id), code: String(entry.code), amount: Number(entry.amount), currency: String(entry.currency), status: String(entry.status), eligibleAt: text(entry.eligible_at), releasedAt: text(entry.released_at), blockedReason: text(entry.blocked_reason), correlationId: String(entry.correlation_id) })),
    cases: cases.map((entry) => ({ id: String(entry.id), caseNumber: displayCaseNumber(entry), type: String(entry.issue_type), severity: String(entry.severity), status: String(entry.canonical_status ?? entry.status), title: String(entry.title), recommendedAction: String(entry.recommended_action), updatedAt: String(entry.updated_at) })),
    moneyRequests: moneyRequests.map((entry) => ({ id: String(entry.id), reference: String(entry.reference), actionType: String(entry.action_type), status: String(entry.status), amount: typeof entry.amount === 'number' ? entry.amount : null, currency: text(entry.currency), correlationId: String(entry.correlation_id), createdAt: String(entry.created_at) })),
    observedAt: new Date().toISOString(),
  }
}
