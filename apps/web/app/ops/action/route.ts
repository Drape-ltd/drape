import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '../../../lib/supabase-config'
import { getOpsSession } from '../../../lib/ops-auth'
import { canPerformOpsAction, type OpsActionKind } from '../../../lib/ops-console'
import { sendOpsCustomerRefundEmail } from '../../../lib/ops-customer-email'
import { sendSmsToUser } from '../../../lib/sms'
import { buildOrderReviewRefundTerminalRequest } from '@drape/shared'
import { OPS_ISSUE_SEVERITIES, OPS_ISSUE_TYPES } from '@drape/shared'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '@drape/shared'
import {
  buildCustomerReviewResolutionSms,
  buildCustomerStageSms,
  buildTailorReviewResolutionSms,
  buildTailorStageSms,
} from '@drape/shared/sms-copy'
import { sendCriticalOpsIssueEmail } from '../../../lib/ops-notifications'

const APPLICATION_STATUSES = new Set(['PENDING', 'REVIEWING', 'CONTACTED', 'APPROVED', 'REJECTED'])
const DISPUTE_STATUSES = new Set(['OPEN', 'UNDER_REVIEW'])
const DISPUTE_OUTCOMES = new Set(['REFUND', 'RELEASE'])
const VERIFICATION_DECISIONS = new Set(['APPROVE', 'REJECT'])
const DELETION_STATUSES = new Set(['PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'REJECTED'])
const REVIEW_VISIBILITY_ACTIONS = new Set(['PUBLISH', 'HOLD'])
const CONVERSATION_ACCESS_ACTIONS = new Set(['BLOCK', 'UNBLOCK'])
const DISPATCH_TARGETS = new Set(['OUT_FOR_DELIVERY', 'SHIPPED'])
const ORDER_REVIEW_TYPES = new Set(['CANCELLATION', 'DELIVERY'])
const ORDER_REVIEW_OUTCOMES = new Set(['REFUND', 'CONTINUE'])
const OPS_ISSUE_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'RESOLVED', 'ESCALATED'])
const MANUAL_OPS_ISSUE_TYPES = new Set<string>(OPS_ISSUE_TYPES)
const MANUAL_OPS_ISSUE_SEVERITIES = new Set<string>(OPS_ISSUE_SEVERITIES)
const PAYOUT_RESOLUTION_MODES = new Set(['ORIGINAL_CURRENCY', 'CONVERT_TO_CURRENT', 'REFUND_CUSTOMER'])
const SELLER_ITEM_VISIBILITY_ACTIONS = new Set(['HIDE', 'RESTORE'])

type OrderReviewMeta = {
  status?: 'OPEN' | 'RESOLVED' | null
  requestedFromStage?: string | null
  resolvedAt?: string | null
}

type OrderSupportMeta = {
  cancellationReview?: OrderReviewMeta | null
  deliveryReview?: OrderReviewMeta | null
  dispatchRecord?: {
    providerUsed?: string | null
    bookedBy?: string | null
    bookedAt?: string | null
    serviceLevel?:
      | 'STANDARD'
      | 'SAME_DAY'
      | 'NEXT_DAY'
      | 'INTERNATIONAL_STANDARD'
      | 'INTERNATIONAL_EXPRESS'
      | 'CUSTOM'
      | null
    premiumException?: boolean | null
  } | null
}

type DispatchServiceLevel =
  NonNullable<NonNullable<OrderSupportMeta['dispatchRecord']>['serviceLevel']>

function sanitizeRedirect(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.startsWith('/ops')) return '/ops'
  return value
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseMajorAmountToMinor(value: string) {
  if (!value) return Number.NaN
  const normalized = value.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN
  const numeric = Number.parseFloat(normalized)
  if (!Number.isFinite(numeric) || numeric <= 0) return Number.NaN
  return Math.round(numeric * 100)
}

function formatMinorMoney(amount: number, currency: string | null | undefined) {
  const normalizedCurrency = typeof currency === 'string' && currency.trim().length > 0 ? currency.trim().toUpperCase() : null
  if (!normalizedCurrency) return `${amount}`

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(amount / 100)
  } catch {
    return `${normalizedCurrency} ${(amount / 100).toFixed(2)}`
  }
}

function isConflictError(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false
  }

  return (
    error.message.includes('no longer open for review') ||
    error.message.includes('no longer in dispute') ||
    error.message.includes('no longer pending')
  )
}

function parseOrderSupportMeta(value: string | null | undefined): OrderSupportMeta {
  if (!value?.trim()) return {}

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as OrderSupportMeta
  } catch {
    return {}
  }
}

function serializeOrderSupportMeta(meta: OrderSupportMeta | null | undefined) {
  if (!meta || typeof meta !== 'object') return null
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
}

function restoreStageForReview(reviewType: 'CANCELLATION' | 'DELIVERY', requestedFromStage: string | null | undefined) {
  const normalized = typeof requestedFromStage === 'string' ? requestedFromStage.trim().toUpperCase() : ''
  if (normalized && normalized !== 'IN_DISPUTE') return normalized
  return reviewType === 'CANCELLATION' ? 'CONFIRMED' : 'READY_FOR_DRAPE_DISPATCH'
}

function redirectWithMessage(
  request: Request,
  redirectTo: string,
  key: 'notice' | 'error',
  value: string,
  detail?: string | null,
) {
  const url = new URL(redirectTo, request.url)
  url.searchParams.set(key, value)
  if (detail?.trim()) {
    url.searchParams.set(`${key}Detail`, detail.trim().slice(0, 300))
  }
  return NextResponse.redirect(url, { status: 303 })
}

async function recordRefundApprovalFailure(
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  input: {
    orderId: string
    orderReference: string | null
    reviewType: string
    error: string
    performedBy: string
    performedRole: string
    actionLabel?: string
    actionTaken?: string
    auditEvent?: string
    relatedEntityType?: string
  },
) {
  const now = new Date().toISOString()
  const normalizedError = input.error.trim() || 'refund approval failed'
  const actionLabel = input.actionLabel?.trim() || `${input.reviewType.toLowerCase()} review`
  const dedupeKey = `ops-review-refund-failed:${input.orderId}:${normalizedError
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)}`

  const { data: issue } = await client
    .from('ops_issues')
    .upsert(
      {
        issue_type: 'REFUND_FAILED',
        severity: 'CRITICAL',
        status: 'OPEN',
        source: 'ops-dashboard',
        actor_id: input.performedBy,
        actor_role: input.performedRole,
        order_id: input.orderId,
        related_entity_type: input.relatedEntityType ?? 'order_review',
        related_entity_id: input.orderId,
        title: `${actionLabel[0]?.toUpperCase() ?? 'R'}${actionLabel.slice(1)} refund failed`,
        description: `Ops could not complete ${actionLabel} because the refund step failed.`,
        recommended_action:
          'Check the order payment ledger, provider refund reference, and refund Edge Function health before retrying approval.',
        dedupe_key: dedupeKey,
        metadata: {
          order_reference: input.orderReference,
          review_type: input.reviewType,
          error: normalizedError,
        },
        last_seen_at: now,
      },
      { onConflict: 'dedupe_key' },
    )
    .select('id')
    .maybeSingle()

  if (issue?.id) {
    await client.from('ops_audit_logs').insert({
      issue_id: issue.id,
      action_taken: input.actionTaken ?? 'ORDER_REVIEW_REFUND_FAILED',
      performed_by: input.performedBy,
      performed_role: input.performedRole,
      reason: normalizedError,
      before_state: { order_id: input.orderId, review_type: input.reviewType },
      after_state: { status: 'OPEN', error: normalizedError },
    })
  }

  await client.from('audit_logs').insert({
    actor_role: 'OPS',
    order_id: input.orderId,
    event: input.auditEvent ?? 'ops.order_review_refund_failed',
    severity: 'error',
    payload: {
      order_reference: input.orderReference,
      review_type: input.reviewType,
      error: normalizedError,
      performed_by: input.performedBy,
    },
  })
}

async function syncEntityOpsIssue(options: {
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>
  issueType: string
  relatedEntityType: string
  relatedEntityId: string
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ESCALATED'
  performedBy: string
  performedRole: string
  actionTaken: string
  reason: string | null
}) {
  const { client, issueType, relatedEntityType, relatedEntityId, status, performedBy, performedRole, actionTaken, reason } = options

  const { data: issue } = await client
    .from('ops_issues')
    .select('id, status, assigned_to, resolved_at')
    .eq('issue_type', issueType)
    .eq('related_entity_type', relatedEntityType)
    .eq('related_entity_id', relatedEntityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!issue?.id) return

  const resolvedAt = status === 'RESOLVED' ? new Date().toISOString() : null
  await client
    .from('ops_issues')
    .update({
      status,
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    })
    .eq('id', issue.id)

  await client.from('ops_audit_logs').insert({
    issue_id: issue.id,
    action_taken: actionTaken,
    performed_by: performedBy,
    performed_role: performedRole,
    reason,
    before_state: {
      status: issue.status,
      assigned_to: issue.assigned_to ?? null,
      resolved_at: issue.resolved_at ?? null,
    },
    after_state: {
      status,
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    },
  })
}

async function syncOpsIssueById(options: {
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>
  issueId: string
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ESCALATED'
  performedBy: string
  performedRole: string
  actionTaken: string
  reason: string | null
}) {
  const { client, issueId, status, performedBy, performedRole, actionTaken, reason } = options

  const { data: issue } = await client
    .from('ops_issues')
    .select('id, status, assigned_to, resolved_at')
    .eq('id', issueId)
    .maybeSingle()

  if (!issue?.id) return

  const resolvedAt = status === 'RESOLVED' ? new Date().toISOString() : null
  await client
    .from('ops_issues')
    .update({
      status,
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    })
    .eq('id', issueId)

  await client.from('ops_audit_logs').insert({
    issue_id: issueId,
    action_taken: actionTaken,
    performed_by: performedBy,
    performed_role: performedRole,
    reason,
    before_state: {
      status: issue.status,
      assigned_to: issue.assigned_to ?? null,
      resolved_at: issue.resolved_at ?? null,
    },
    after_state: {
      status,
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    },
  })
}

async function resolveOrderReviewOpsIssue(options: {
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>
  orderId: string
  reviewType: 'CANCELLATION' | 'DELIVERY'
  performedBy: string
  performedRole: string
  reason: string | null
}) {
  const { client, orderId, reviewType, performedBy, performedRole, reason } = options
  const issueType = reviewType === 'DELIVERY' ? 'DELIVERY_REVIEW' : 'ORDER_REVIEW'
  const dedupeKey = `order-review:${reviewType.toLowerCase()}:${orderId}`

  const { data: issue } = await client
    .from('ops_issues')
    .select('id, status, assigned_to, resolved_at')
    .eq('issue_type', issueType)
    .eq('order_id', orderId)
    .eq('dedupe_key', dedupeKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!issue?.id) return

  const resolvedAt = new Date().toISOString()
  await client
    .from('ops_issues')
    .update({
      status: 'RESOLVED',
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    })
    .eq('id', issue.id)

  await client.from('ops_audit_logs').insert({
    issue_id: issue.id,
    action_taken: 'ORDER_REVIEW_RESOLVED',
    performed_by: performedBy,
    performed_role: performedRole,
    reason,
    before_state: {
      status: issue.status,
      assigned_to: issue.assigned_to ?? null,
      resolved_at: issue.resolved_at ?? null,
    },
    after_state: {
      status: 'RESOLVED',
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    },
  })
}

async function resolveOrderLinkedOpsIssues(options: {
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>
  orderId: string
  issueTypes: string[]
  performedBy: string
  performedRole: string
  actionTaken: string
  reason: string | null
}) {
  const { client, orderId, issueTypes, performedBy, performedRole, actionTaken, reason } = options
  if (issueTypes.length === 0) return

  const { data: issues } = await client
    .from('ops_issues')
    .select('id, issue_type, status, assigned_to, resolved_at')
    .eq('order_id', orderId)
    .in('issue_type', issueTypes)
    .neq('status', 'RESOLVED')

  const openIssues = issues ?? []
  if (openIssues.length === 0) return

  const resolvedAt = new Date().toISOString()
  const issueIds = openIssues.map((issue) => issue.id)
  await client
    .from('ops_issues')
    .update({
      status: 'RESOLVED',
      assigned_to: performedBy,
      resolved_at: resolvedAt,
    })
    .in('id', issueIds)

  await client.from('ops_audit_logs').insert(
    openIssues.map((issue) => ({
      issue_id: issue.id,
      action_taken: actionTaken,
      performed_by: performedBy,
      performed_role: performedRole,
      reason,
      before_state: {
        status: issue.status,
        assigned_to: issue.assigned_to ?? null,
        resolved_at: issue.resolved_at ?? null,
      },
      after_state: {
        status: 'RESOLVED',
        assigned_to: performedBy,
        resolved_at: resolvedAt,
      },
    })),
  )
}

function lockedOrderPayoutAmount(order: {
  source_amount?: number | null
  subtotal_amount?: number | null
}) {
  if (typeof order.source_amount === 'number' && order.source_amount > 0) return order.source_amount
  if (typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0) return order.subtotal_amount
  return 0
}

function lockedOrderPayoutCurrency(order: {
  tailor_payout_currency_locked?: string | null
  source_currency?: string | null
  currency?: string | null
}) {
  return normalizeAccountCurrency(order.tailor_payout_currency_locked ?? order.source_currency ?? order.currency)
}

function restoredSellerItemStatus(inventoryQuantity: number | null | undefined) {
  const quantity = typeof inventoryQuantity === 'number' && Number.isFinite(inventoryQuantity)
    ? inventoryQuantity
    : 0

  if (quantity <= 0) return 'SOLD_OUT'
  if (quantity <= 1) return 'LOW_STOCK'
  return 'IN_STOCK'
}

async function fetchFxQuoteForOps(from: string, to: string) {
  if (from === to) {
    return { rate: 1, timestamp: new Date().toISOString() }
  }

  const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`FX quote request failed with ${response.status}`)
  }

  const payload = await response.json()
  const rate = Number(payload?.rates?.[to])
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX quote for ${from}/${to} is unavailable`)
  }

  return {
    rate,
    timestamp: typeof payload?.date === 'string' && payload.date.length > 0
      ? new Date(`${payload.date}T00:00:00.000Z`).toISOString()
      : new Date().toISOString(),
  }
}

async function refundOrderPaymentsForReview(orderId: string, input: {
  reason: string | null
  amount?: number | null
}) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false as const, error: 'missing-service-role-config' }
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/refund-order-payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orderId,
      reason: input.reason,
      ...(typeof input.amount === 'number' && input.amount > 0 ? { amount: input.amount } : {}),
    }),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    error?: string
    reason?: string
    message?: string
    refundMode?: 'FULL' | 'PARTIAL'
    totalRefundedAmount?: number
    remainingRefundableAmount?: number
    refundedAttempts?: Array<Record<string, unknown>>
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.message ?? payload?.reason ?? payload?.error ?? `refund-function-${response.status}`,
    }
  }

  return {
    ok: true as const,
    refundMode: payload?.refundMode ?? 'FULL',
    totalRefundedAmount: payload?.totalRefundedAmount ?? 0,
    remainingRefundableAmount: payload?.remainingRefundableAmount ?? 0,
    refundedAttempts: payload?.refundedAttempts ?? [],
  }
}

async function triggerOrderPayoutRelease(orderId: string) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false as const, error: 'missing-service-role-config' }
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/release-order-payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ orderId }),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    error?: string
    reason?: string
    message?: string
    results?: Array<{ result?: string; reason?: string }>
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.message ?? payload?.reason ?? payload?.error ?? `payout-release-function-${response.status}`,
    }
  }

  const result = payload.results?.[0]
  if (result?.result === 'blocked') {
    return {
      ok: false as const,
      error: result.reason ?? 'payout-blocked',
    }
  }

  return { ok: true as const }
}

async function triggerMaterialAdvanceRelease(advanceId: string, note: string | null) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false as const, error: 'missing-service-role-config' }
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/material-advance-action`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'release-advance',
      advanceId,
      note: note ?? undefined,
    }),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    error?: string
    message?: string
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.message ?? payload?.error ?? `material-advance-release-function-${response.status}`,
    }
  }

  return { ok: true as const }
}

async function submitVerificationDecision(input: {
  tailorUserId: string
  decision: string
  reason: string | null
  performedBy: string
  performedRole: string
}) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false as const, error: 'missing-service-role-config' }
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/handle-verification-decision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    error?: string
    message?: string
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.error ?? `verification-decision-function-${response.status}`,
    }
  }

  return { ok: true as const }
}

function ensureAuthorizedAction(kind: string): OpsActionKind | null {
  switch (kind) {
    case 'seller-item-visibility':
    case 'dispute-status':
    case 'dispute-resolution':
    case 'bypass-review':
    case 'application-status':
    case 'verification-decision':
    case 'deletion-status':
    case 'review-visibility':
    case 'conversation-access':
    case 'dispatch-stage':
    case 'order-review-resolution':
    case 'order-partial-refund':
    case 'payout-release':
    case 'payout-block-resolution':
    case 'ops-issue-status':
    case 'manual-issue-create':
      return kind
    default:
      return null
  }
}

export async function POST(request: Request) {
  const session = await getOpsSession()
  const formData = await request.formData()
  const redirectTo = sanitizeRedirect(formData.get('redirectTo'))

  if (!session) {
    return redirectWithMessage(request, redirectTo, 'error', 'locked')
  }

  const client = createServiceRoleClient()
  if (!client) {
    return redirectWithMessage(request, redirectTo, 'error', 'service-role-missing')
  }

  const kind = readString(formData, 'kind')
  const actionKind = ensureAuthorizedAction(kind)

  if (!actionKind || !canPerformOpsAction(session.role, actionKind)) {
    return redirectWithMessage(request, redirectTo, 'error', 'forbidden')
  }

  try {
    if (kind === 'seller-item-visibility') {
      const itemId = readString(formData, 'itemId')
      const visibilityAction = readString(formData, 'visibilityAction').toUpperCase()
      const note = readString(formData, 'note')

      if (!itemId || !SELLER_ITEM_VISIBILITY_ACTIONS.has(visibilityAction)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existingItem, error: existingItemError } = await client
        .from('seller_items')
        .select('id, title, is_live, stock_status, inventory_quantity, tailor_profile_id')
        .eq('id', itemId)
        .maybeSingle()

      if (existingItemError || !existingItem?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'seller-item-save-failed')
      }

      const nextIsLive = visibilityAction === 'RESTORE'
      const nextStockStatus = visibilityAction === 'RESTORE'
        ? restoredSellerItemStatus(existingItem.inventory_quantity)
        : 'HIDDEN'

      const { error } = await client
        .from('seller_items')
        .update({
          is_live: nextIsLive,
          stock_status: nextStockStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'seller-item-save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.seller_item_visibility_updated',
        severity: visibilityAction === 'HIDE' ? 'warn' : 'info',
        payload: {
          seller_item_id: itemId,
          title: existingItem.title,
          tailor_profile_id: existingItem.tailor_profile_id,
          previous_is_live: existingItem.is_live,
          previous_stock_status: existingItem.stock_status,
          next_is_live: nextIsLive,
          next_stock_status: nextStockStatus,
          note: note.length > 0 ? note : null,
          performed_by: session.email ?? session.role,
        },
      })

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        visibilityAction === 'RESTORE' ? 'seller-item-restored' : 'seller-item-hidden',
      )
    }

    if (kind === 'dispute-status') {
      const disputeId = readString(formData, 'disputeId')
      const status = readString(formData, 'status').toUpperCase()

      if (!disputeId || !DISPUTE_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client
        .from('disputes')
        .update({ status })
        .eq('id', disputeId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.dispute_status_updated',
        severity: 'info',
        payload: { dispute_id: disputeId, status },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'dispute-saved')
    }

    if (kind === 'dispute-resolution') {
      const disputeId = readString(formData, 'disputeId')
      const outcome = readString(formData, 'outcome').toUpperCase()
      const resolution = readString(formData, 'resolution')

      if (!disputeId || !DISPUTE_OUTCOMES.has(outcome)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client.rpc('ops_resolve_dispute', {
        p_dispute_id: disputeId,
        p_outcome: outcome,
        p_resolution: resolution.length > 0 ? resolution : null,
      })

      if (error) {
        return redirectWithMessage(
          request,
          redirectTo,
          'error',
          isConflictError(error) ? 'conflict' : 'save-failed',
        )
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'dispute-resolved')
    }

    if (kind === 'bypass-review') {
      const logId = readString(formData, 'logId')
      const reviewed = readString(formData, 'reviewed') === 'true'

      if (!logId) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client
        .from('contact_bypass_logs')
        .update({
          reviewed,
          reviewed_at: reviewed ? new Date().toISOString() : null,
          reviewed_by: null,
        })
        .eq('id', logId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.contact_bypass_review_updated',
        severity: 'info',
        payload: { log_id: logId, reviewed },
      })

      await syncEntityOpsIssue({
        client,
        issueType: 'CONTACT_BYPASS',
        relatedEntityType: 'contact_bypass_log',
        relatedEntityId: logId,
        status: reviewed ? 'RESOLVED' : 'OPEN',
        performedBy: session.email ?? session.role,
        performedRole: session.role.toUpperCase(),
        actionTaken: reviewed ? 'CONTACT_BYPASS_REVIEWED' : 'CONTACT_BYPASS_REOPENED',
        reason: null,
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'bypass-saved')
    }

    if (kind === 'application-status') {
      const applicationId = readString(formData, 'applicationId')
      const status = readString(formData, 'status').toUpperCase()

      if (!applicationId || !APPLICATION_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client
        .from('tailor_applications')
        .update({ status })
        .eq('id', applicationId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.tailor_application_status_updated',
        severity: 'info',
        payload: { application_id: applicationId, status },
      })

      await syncEntityOpsIssue({
        client,
        issueType: 'TAILOR_APPLICATION',
        relatedEntityType: 'tailor_application',
        relatedEntityId: applicationId,
        status: status === 'APPROVED' || status === 'REJECTED' ? 'RESOLVED' : status === 'PENDING' ? 'OPEN' : 'IN_REVIEW',
        performedBy: session.email ?? session.role,
        performedRole: session.role.toUpperCase(),
        actionTaken: 'TAILOR_APPLICATION_STATUS_UPDATED',
        reason: status,
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'application-saved')
    }

    if (kind === 'verification-decision') {
      const tailorUserId = readString(formData, 'tailorUserId')
      const decision = readString(formData, 'decision').toUpperCase()
      const reason = readString(formData, 'reason') || readString(formData, 'note')

      if (!tailorUserId || !VERIFICATION_DECISIONS.has(decision)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const result = await submitVerificationDecision({
        tailorUserId,
        decision,
        reason: reason.length > 0 ? reason : null,
        performedBy: session.email ?? session.role,
        performedRole: session.role.toUpperCase(),
      })

      if (!result.ok) {
        const error =
          result.error === 'REJECTION_REASON_REQUIRED'
            ? 'verification-rejection-reason-required'
            : result.error === 'VERIFICATION_ALREADY_PROCESSED'
              ? 'conflict'
              : 'save-failed'

        return redirectWithMessage(request, redirectTo, 'error', error)
      }

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        decision === 'APPROVE' ? 'verification-approved' : 'verification-rejected',
      )
    }

    if (kind === 'deletion-status') {
      const deletionRequestId = readString(formData, 'deletionRequestId')
      const status = readString(formData, 'status').toUpperCase()

      if (!deletionRequestId || !DELETION_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existing, error: existingError } = await client
        .from('account_deletion_requests')
        .select('id, status, acknowledged_at, processed_at')
        .eq('id', deletionRequestId)
        .maybeSingle()

      if (existingError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      if (!existing?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const now = new Date().toISOString()
      const acknowledgedAt =
        status === 'PENDING'
          ? null
          : existing.acknowledged_at ?? now
      const processedAt =
        status === 'COMPLETED' || status === 'REJECTED'
          ? existing.processed_at ?? now
          : null

      const { error } = await client
        .from('account_deletion_requests')
        .update({
          status,
          acknowledged_at: acknowledgedAt,
          processed_at: processedAt,
        })
        .eq('id', deletionRequestId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.account_deletion_status_updated',
        severity: status === 'REJECTED' ? 'warn' : 'info',
        payload: {
          deletion_request_id: deletionRequestId,
          previous_status: existing.status,
          status,
        },
      })

      await syncEntityOpsIssue({
        client,
        issueType: 'ACCOUNT_DELETION_REQUEST',
        relatedEntityType: 'account_deletion_request',
        relatedEntityId: deletionRequestId,
        status: status === 'COMPLETED' || status === 'REJECTED' ? 'RESOLVED' : status === 'ACKNOWLEDGED' ? 'IN_REVIEW' : 'OPEN',
        performedBy: session.email ?? session.role,
        performedRole: session.role.toUpperCase(),
        actionTaken: 'ACCOUNT_DELETION_STATUS_UPDATED',
        reason: status,
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'deletion-saved')
    }

    if (kind === 'review-visibility') {
      const reviewId = readString(formData, 'reviewId')
      const visibility = readString(formData, 'visibility').toUpperCase()

      if (!reviewId || !REVIEW_VISIBILITY_ACTIONS.has(visibility)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const publishNow = visibility === 'PUBLISH'
      const now = new Date().toISOString()
      const { error } = await client
        .from('reviews')
        .update({
          published_at: publishNow ? now : null,
          flagged: !publishNow,
        })
        .eq('id', reviewId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.review_visibility_updated',
        severity: publishNow ? 'info' : 'warn',
        payload: {
          review_id: reviewId,
          visibility: publishNow ? 'PUBLISHED' : 'HELD',
        },
      })

      await syncEntityOpsIssue({
        client,
        issueType: 'CONTENT_FLAG',
        relatedEntityType: 'review',
        relatedEntityId: reviewId,
        status: 'RESOLVED',
        performedBy: session.email ?? session.role,
        performedRole: session.role.toUpperCase(),
        actionTaken: publishNow ? 'REVIEW_PUBLISHED' : 'REVIEW_HELD',
        reason: publishNow ? 'PUBLISHED' : 'HELD',
      })

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        publishNow ? 'review-published' : 'review-held',
      )
    }

    if (kind === 'conversation-access') {
      const orderId = readString(formData, 'orderId')
      const accessAction = readString(formData, 'accessAction').toUpperCase()
      const reason = readString(formData, 'reason')

      if (!orderId || !CONVERSATION_ACCESS_ACTIONS.has(accessAction)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existingOrder, error: orderError } = await client
        .from('orders')
        .select('id, stage')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !existingOrder?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const { error } = await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: accessAction === 'BLOCK' ? 'conversation.blocked' : 'conversation.unblocked',
        severity: accessAction === 'BLOCK' ? 'warn' : 'info',
        payload: {
          source: 'ops-dashboard',
          surface: 'messages',
          reason: reason.length > 0 ? reason : null,
          order_stage: existingOrder.stage,
        },
      })

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        accessAction === 'BLOCK' ? 'conversation-blocked' : 'conversation-unblocked',
      )
    }

    if (kind === 'order-review-resolution') {
      const orderId = readString(formData, 'orderId')
      const reviewType = readString(formData, 'reviewType').toUpperCase()
      const outcome = readString(formData, 'outcome').toUpperCase()
      const resolution = readString(formData, 'resolution')

      if (!orderId || !ORDER_REVIEW_TYPES.has(reviewType) || !ORDER_REVIEW_OUTCOMES.has(outcome)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existingOrder, error: orderError } = await client
        .from('orders')
        .select('id, reference, stage, order_kind, garment_type, item_title, item_size, delivery_method, customer_id, tailor_id, recipient_phone, special_note')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !existingOrder?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      if (existingOrder.stage !== 'IN_DISPUTE') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const reviewMeta = parseOrderSupportMeta(existingOrder.special_note)
      const review =
        reviewType === 'CANCELLATION'
          ? reviewMeta.cancellationReview
          : reviewMeta.deliveryReview

      if (review?.status !== 'OPEN') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const now = new Date().toISOString()
      const restoreStage = restoreStageForReview(
        reviewType === 'CANCELLATION' ? 'CANCELLATION' : 'DELIVERY',
        review.requestedFromStage,
      )
      const nextStage = outcome === 'REFUND' ? 'REFUNDED' : restoreStage
      const nextMeta: OrderSupportMeta =
        reviewType === 'CANCELLATION'
          ? {
              ...reviewMeta,
              cancellationReview: {
                ...reviewMeta.cancellationReview,
                status: 'RESOLVED',
                resolvedAt: now,
              },
            }
          : {
              ...reviewMeta,
              deliveryReview: {
                ...reviewMeta.deliveryReview,
                status: 'RESOLVED',
                resolvedAt: now,
              },
            }
      const nextSpecialNote = serializeOrderSupportMeta(nextMeta)

      if (outcome === 'REFUND') {
        const refund = await refundOrderPaymentsForReview(orderId, {
          reason: resolution.length > 0 ? resolution : null,
        })

        if (!refund.ok) {
          await recordRefundApprovalFailure(client, {
            orderId,
            orderReference: existingOrder.reference ?? null,
            reviewType,
            error: refund.error,
            performedBy: session.email ?? session.role,
            performedRole: session.role.toUpperCase(),
          })
          return redirectWithMessage(request, redirectTo, 'error', 'refund-failed', refund.error)
        }

        const requestPayload = buildOrderReviewRefundTerminalRequest({
          reviewType: reviewType as 'CANCELLATION' | 'DELIVERY',
          resolution,
          restoreStage,
          specialNote: nextSpecialNote ?? '{}',
        })

        const { error: updateError } = await client.rpc('finalize_order_terminal', {
          p_order_id: orderId,
          p_target_stage: requestPayload.p_target_stage,
          p_actor_id: requestPayload.p_actor_id ?? null,
          p_actor_role: requestPayload.p_actor_role ?? null,
          p_event: requestPayload.p_event,
          p_note: requestPayload.p_note,
          p_payload: requestPayload.p_payload ?? {},
          p_expected_stages: requestPayload.p_expected_stages ?? null,
          p_special_note: requestPayload.p_special_note ?? null,
          p_replace_special_note: requestPayload.p_replace_special_note ?? false,
          p_clear_payment_session: requestPayload.p_clear_payment_session ?? false,
          p_reset_fulfillment_payment: requestPayload.p_reset_fulfillment_payment ?? false,
          p_release_ready_made_inventory: requestPayload.p_release_ready_made_inventory ?? false,
        })

        if (updateError) {
          return redirectWithMessage(
            request,
            redirectTo,
            'error',
            isConflictError(updateError) ? 'conflict' : 'save-failed',
          )
        }
      } else {
        const reviewLabel = reviewType === 'CANCELLATION' ? 'cancellation review' : 'delivery review'
        const stageNote =
          `Drapeon reviewed the ${reviewLabel}. The order will continue from ${restoreStage}.`
          + (resolution ? ` Note: ${resolution}` : '')

        const { error: updateError } = await client
          .from('orders')
          .update({
            stage: nextStage,
            stage_updated_at: now,
            special_note: nextSpecialNote,
          })
          .eq('id', orderId)

        if (updateError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }

        const { error: stageUpdateError } = await client.from('order_stage_updates').insert({
          order_id: orderId,
          stage: nextStage,
          note: stageNote,
        })

        if (stageUpdateError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }

        await client.from('audit_logs').insert({
          actor_role: 'OPS',
          order_id: orderId,
          event: 'ops.order_review_resolved',
          severity: 'info',
          payload: {
            review_type: reviewType,
            outcome,
            restored_stage: restoreStage,
            resolution: resolution.length > 0 ? resolution : null,
          },
        })
      }

      await resolveOrderReviewOpsIssue({
        client,
        orderId,
        reviewType: reviewType as 'CANCELLATION' | 'DELIVERY',
        performedBy: session.email ?? session.role,
        performedRole: session.role.toUpperCase(),
        reason: resolution.length > 0 ? resolution : null,
      })

      if (outcome === 'REFUND') {
        await resolveOrderLinkedOpsIssues({
          client,
          orderId,
          issueTypes: ['REFUND_FAILED', 'PAYOUT_BLOCKED'],
          performedBy: session.email ?? session.role,
          performedRole: session.role.toUpperCase(),
          actionTaken: 'ORDER_REVIEW_REFUND_CLEANUP',
          reason: 'Order review refund succeeded; stale order-linked blockers no longer need action.',
        })
      }

      if (existingOrder.customer_id) {
        await sendSmsToUser({
          client,
          userId: existingOrder.customer_id,
          audience: 'CUSTOMER',
          orderId,
          event: outcome === 'REFUND' ? 'order.review_refunded' : 'order.review_continued',
          body: buildCustomerReviewResolutionSms({
            id: existingOrder.id,
            reference: existingOrder.reference,
            orderKind: existingOrder.order_kind,
            garmentType: existingOrder.garment_type,
            itemTitle: existingOrder.item_title,
            itemSize: existingOrder.item_size,
            deliveryMethod: existingOrder.delivery_method,
          }, reviewType as 'CANCELLATION' | 'DELIVERY', outcome as 'REFUND' | 'CONTINUE', outcome === 'CONTINUE' ? restoreStage : null),
        })
      }

      if (existingOrder.tailor_id) {
        await sendSmsToUser({
          client,
          userId: existingOrder.tailor_id,
          audience: 'TAILOR',
          orderId,
          event: outcome === 'REFUND' ? 'order.review_refunded' : 'order.review_continued',
          body: buildTailorReviewResolutionSms({
            id: existingOrder.id,
            reference: existingOrder.reference,
            orderKind: existingOrder.order_kind,
            garmentType: existingOrder.garment_type,
            itemTitle: existingOrder.item_title,
            itemSize: existingOrder.item_size,
            deliveryMethod: existingOrder.delivery_method,
          }, reviewType as 'CANCELLATION' | 'DELIVERY', outcome as 'REFUND' | 'CONTINUE', outcome === 'CONTINUE' ? restoreStage : null),
        })
      }

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        outcome === 'REFUND' ? 'order-review-refunded' : 'order-review-continued',
      )
    }

    if (kind === 'order-partial-refund') {
      const issueId = readString(formData, 'issueId')
      const orderId = readString(formData, 'orderId')
      const note = readString(formData, 'note')
      const amountMinor = parseMajorAmountToMinor(readString(formData, 'amount'))
      const maxRefundableAmount = Number.parseInt(readString(formData, 'maxRefundableAmount'), 10)
      const notifyCustomer = readString(formData, 'notifyCustomer') === 'yes'

      if (!orderId || note.length === 0 || !Number.isFinite(amountMinor) || amountMinor <= 0) {
        return redirectWithMessage(request, redirectTo, 'error', 'partial-refund-invalid')
      }

      if (Number.isFinite(maxRefundableAmount) && (amountMinor >= maxRefundableAmount || maxRefundableAmount <= 0)) {
        return redirectWithMessage(request, redirectTo, 'error', 'partial-refund-invalid')
      }

      const { data: order, error: orderError } = await client
        .from('orders')
        .select('id, reference, stage, customer_id, tailor_id, order_kind, garment_type, item_title, item_size, delivery_method, currency')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !order?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const refund = await refundOrderPaymentsForReview(orderId, {
        reason: note,
        amount: amountMinor,
      })

      if (!refund.ok) {
        await recordRefundApprovalFailure(client, {
          orderId,
          orderReference: order.reference ?? null,
          reviewType: 'PARTIAL_REFUND',
          actionLabel: 'partial refund',
          actionTaken: 'ORDER_PARTIAL_REFUND_FAILED',
          auditEvent: 'ops.order_partial_refund_failed',
          relatedEntityType: 'workflow_issue',
          error: refund.error,
          performedBy: session.email ?? session.role,
          performedRole: session.role.toUpperCase(),
        })
        return redirectWithMessage(request, redirectTo, 'error', 'refund-failed', refund.error)
      }

      const nextStage = refund.remainingRefundableAmount <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED'

      const { error: orderUpdateError } = await client
        .from('orders')
        .update({
          stage: nextStage,
          stage_updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)

      if (orderUpdateError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('order_stage_updates').insert({
        order_id: orderId,
        stage: nextStage,
        note: `Ops issued a partial refund of ${formatMinorMoney(amountMinor, order.currency)}. ${note}`,
      })

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: 'ops.order_partial_refund_issued',
        severity: 'warn',
        payload: {
          issue_id: issueId || null,
          refunded_amount: amountMinor,
          currency: order.currency,
          refund_mode: refund.refundMode,
          remaining_refundable_amount: refund.remainingRefundableAmount,
          refunded_attempts: refund.refundedAttempts,
          note,
          notify_customer: notifyCustomer,
        },
      })

      if (issueId) {
        await syncOpsIssueById({
          client,
          issueId,
          status: 'RESOLVED',
          performedBy: session.email ?? session.role,
          performedRole: session.role.toUpperCase(),
          actionTaken: 'ORDER_PARTIAL_REFUND_ISSUED',
          reason: note,
        })
      }

      if (notifyCustomer && order.customer_id) {
        const [{ data: authUser }, { data: customerProfile }] = await Promise.all([
          client.auth.admin.getUserById(order.customer_id),
          client
            .from('customer_profiles')
            .select('display_name')
            .eq('user_id', order.customer_id)
            .maybeSingle(),
        ])

        const customerEmail = authUser.user?.email?.trim() ?? null
        if (customerEmail) {
          const emailResult = await sendOpsCustomerRefundEmail({
            client,
            order,
            idempotencyKey: `ops-partial-refund-email:${issueId || orderId}:${amountMinor}:${refund.remainingRefundableAmount}`,
            to: customerEmail,
            customerUserId: order.customer_id,
            customerName: customerProfile?.display_name?.trim() || 'there',
            orderReference: order.reference,
            amount: amountMinor,
            currency: order.currency,
            reason: note,
            partial: true,
          })

          await client.from('audit_logs').insert({
            actor_role: 'OPS',
            order_id: orderId,
            event: emailResult.ok
              ? 'ops.customer_refund_email_requested'
              : 'ops.customer_refund_email_failed',
            severity: emailResult.ok ? 'info' : 'warn',
            payload: {
              issue_id: issueId || null,
              amount: amountMinor,
              currency: order.currency,
              queued: 'queued' in emailResult ? emailResult.queued : false,
              skipped: emailResult.skipped,
            },
          })
        }
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'partial-refund-issued')
    }

    if (kind === 'payout-block-resolution') {
      const issueId = readString(formData, 'issueId')
      const orderId = readString(formData, 'orderId')
      const resolutionMode = readString(formData, 'resolutionMode').toUpperCase()
      const note = readString(formData, 'note')

      if (!orderId || !PAYOUT_RESOLUTION_MODES.has(resolutionMode) || note.length === 0) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: order, error: orderError } = await client
        .from('orders')
        .select(`
          id,
          reference,
          stage,
          tailor_id,
          customer_id,
          currency,
          source_currency,
          source_amount,
          subtotal_amount,
          tailor_payout_currency_locked,
          tailor_payout_provider_locked
        `)
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !order?.id || !order.tailor_id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const lockedCurrency = lockedOrderPayoutCurrency(order)
      const lockedAmount = lockedOrderPayoutAmount(order)

      if (!lockedCurrency || lockedAmount <= 0) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const { data: tailorProfile, error: tailorProfileError } = await client
        .from('tailor_profiles')
        .select('id, user_id, payout_currency, payout_account_verified, payout_reverification_required, paystack_recipient_code, stripe_connect_account_id')
        .eq('user_id', order.tailor_id)
        .maybeSingle()

      if (tailorProfileError || !tailorProfile?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const now = new Date().toISOString()

      if (resolutionMode === 'REFUND_CUSTOMER') {
        const refund = await refundOrderPaymentsForReview(orderId, { reason: note })
        if (!refund.ok) {
          await recordRefundApprovalFailure(client, {
            orderId,
            orderReference: order.reference ?? null,
            reviewType: 'PAYOUT_BLOCK',
            actionLabel: 'payout block customer refund',
            actionTaken: 'PAYOUT_BLOCK_REFUND_FAILED',
            auditEvent: 'ops.payout_block_refund_failed',
            relatedEntityType: 'workflow_issue',
            error: refund.error,
            performedBy: session.email ?? session.role,
            performedRole: session.role.toUpperCase(),
          })
          return redirectWithMessage(request, redirectTo, 'error', 'refund-failed', refund.error)
        }

        const { error: orderUpdateError } = await client
          .from('orders')
          .update({
            stage: 'REFUNDED',
            stage_updated_at: now,
            ops_payout_resolution_mode: 'REFUND_CUSTOMER',
            ops_payout_override_currency: null,
            ops_payout_override_provider: null,
            ops_payout_override_amount: null,
            ops_payout_override_fx_rate: null,
            ops_payout_override_fx_rate_timestamp: null,
            ops_payout_override_note: note,
            ops_payout_override_set_at: now,
            ops_payout_override_set_by: session.email ?? session.role,
          })
          .eq('id', orderId)

        if (orderUpdateError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }

        await client.from('order_stage_updates').insert({
          order_id: orderId,
          stage: 'REFUNDED',
          note: `Ops refunded the customer after payout review. ${note}`,
        })

        await client.from('audit_logs').insert({
          actor_role: 'OPS',
          order_id: orderId,
          event: 'ops.payout_block_refund_executed',
          severity: 'warn',
          payload: {
            issue_id: issueId || null,
            resolution_mode: resolutionMode,
            locked_currency: lockedCurrency,
            locked_amount: lockedAmount,
            note,
          },
        })

        if (issueId) {
          await syncOpsIssueById({
            client,
            issueId,
            status: 'RESOLVED',
            performedBy: session.email ?? session.role,
            performedRole: session.role.toUpperCase(),
            actionTaken: 'PAYOUT_BLOCK_REFUNDED_CUSTOMER',
            reason: note,
          })
        }

        return redirectWithMessage(request, redirectTo, 'notice', 'payout-resolution-refunded')
      }

      if (resolutionMode === 'ORIGINAL_CURRENCY') {
        const lockedProvider =
          order.tailor_payout_provider_locked
          ?? resolvePaymentProviderForCurrency(lockedCurrency)

        const { error: orderUpdateError } = await client
          .from('orders')
          .update({
            ops_payout_resolution_mode: 'ORIGINAL_CURRENCY',
            ops_payout_override_currency: lockedCurrency,
            ops_payout_override_provider: lockedProvider,
            ops_payout_override_amount: lockedAmount,
            ops_payout_override_fx_rate: 1,
            ops_payout_override_fx_rate_timestamp: now,
            ops_payout_override_note: note,
            ops_payout_override_set_at: now,
            ops_payout_override_set_by: session.email ?? session.role,
          })
          .eq('id', orderId)

        if (orderUpdateError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }
      }

      if (resolutionMode === 'CONVERT_TO_CURRENT') {
        const currentPayoutCurrency = normalizeAccountCurrency(tailorProfile.payout_currency)
        if (!currentPayoutCurrency) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }

        const quote = await fetchFxQuoteForOps(lockedCurrency, currentPayoutCurrency)
        const convertedAmount = Math.round(lockedAmount * quote.rate)
        if (convertedAmount <= 0) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }

        const { error: orderUpdateError } = await client
          .from('orders')
          .update({
            ops_payout_resolution_mode: 'CONVERT_TO_CURRENT',
            ops_payout_override_currency: currentPayoutCurrency,
            ops_payout_override_provider: resolvePaymentProviderForCurrency(currentPayoutCurrency),
            ops_payout_override_amount: convertedAmount,
            ops_payout_override_fx_rate: quote.rate,
            ops_payout_override_fx_rate_timestamp: quote.timestamp,
            ops_payout_override_note: note,
            ops_payout_override_set_at: now,
            ops_payout_override_set_by: session.email ?? session.role,
          })
          .eq('id', orderId)

        if (orderUpdateError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        }
      }

      const release = await triggerOrderPayoutRelease(orderId)
      if (!release.ok) {
        return redirectWithMessage(request, redirectTo, 'error', 'payout-release-failed', release.error)
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: 'ops.payout_block_resolution_applied',
        severity: 'info',
        payload: {
          issue_id: issueId || null,
          resolution_mode: resolutionMode,
          note,
          locked_currency: lockedCurrency,
          locked_amount: lockedAmount,
        },
      })

      if (issueId) {
        await syncOpsIssueById({
          client,
          issueId,
          status: 'RESOLVED',
          performedBy: session.email ?? session.role,
          performedRole: session.role.toUpperCase(),
          actionTaken: 'PAYOUT_BLOCK_RESOLUTION_APPLIED',
          reason: note,
        })
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'payout-resolution-applied')
    }

    if (kind === 'payout-release') {
      const orderId = readString(formData, 'orderId')

      if (!orderId) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const release = await triggerOrderPayoutRelease(orderId)
      if (!release.ok) {
        return redirectWithMessage(request, redirectTo, 'error', 'payout-release-failed', release.error)
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: 'ops.payout_release_triggered',
        severity: 'info',
        payload: {
          source: 'ops-dashboard',
          order_id: orderId,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'payout-release-triggered')
    }

    if (kind === 'material-advance-release') {
      const advanceId = readString(formData, 'advanceId')
      const note = readString(formData, 'note')

      if (!advanceId) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const release = await triggerMaterialAdvanceRelease(advanceId, note || null)
      if (!release.ok) {
        return redirectWithMessage(request, redirectTo, 'error', 'material-advance-release-failed', release.error)
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.material_advance_release_triggered',
        severity: 'info',
        payload: {
          source: 'ops-dashboard',
          material_advance_id: advanceId,
          note: note || null,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'material-advance-release-triggered')
    }

    if (kind === 'ops-issue-status') {
      const issueId = readString(formData, 'issueId')
      const status = readString(formData, 'status').toUpperCase()
      const note = readString(formData, 'note')

      if (!issueId || !OPS_ISSUE_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: currentIssue, error: currentIssueError } = await client
        .from('ops_issues')
        .select('id, status, issue_type, source, assigned_to, resolved_at')
        .eq('id', issueId)
        .maybeSingle()

      if (currentIssueError || !currentIssue?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'workflow-issue-save-failed')
      }

      const resolvedAt = status === 'RESOLVED' ? new Date().toISOString() : null
      const { error: updateError } = await client
        .from('ops_issues')
        .update({
          status,
          assigned_to: session.email ?? session.role,
          resolved_at: resolvedAt,
        })
        .eq('id', issueId)

      if (updateError) {
        return redirectWithMessage(request, redirectTo, 'error', 'workflow-issue-save-failed')
      }

      await client.from('ops_audit_logs').insert({
        issue_id: issueId,
        action_taken: 'ISSUE_STATUS_UPDATED',
        performed_by: session.email ?? 'ops-session',
        performed_role: session.role.toUpperCase(),
        reason: note.length > 0 ? note : null,
        before_state: {
          status: currentIssue.status,
          assigned_to: currentIssue.assigned_to ?? null,
          resolved_at: currentIssue.resolved_at ?? null,
        },
        after_state: {
          status,
          assigned_to: session.email ?? session.role,
          resolved_at: resolvedAt,
        },
      })

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: 'info',
        event: 'ops.workflow_issue_status_updated',
        payload: {
          issue_id: issueId,
          issue_type: currentIssue.issue_type,
          source: currentIssue.source ?? null,
          from_status: currentIssue.status,
          status,
          note: note.length > 0 ? note : null,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'workflow-issue-saved')
    }

    if (kind === 'manual-issue-create') {
      const issueType = readString(formData, 'issueType').toUpperCase()
      const severity = readString(formData, 'severity').toUpperCase()
      const title = readString(formData, 'title')
      const description = readString(formData, 'description')
      const recommendedAction = readString(formData, 'recommendedAction')
      const orderId = readString(formData, 'orderId')
      const userId = readString(formData, 'userId')
      const tailorProfileId = readString(formData, 'tailorProfileId')
      const provider = readString(formData, 'provider')
      const stage = readString(formData, 'stage')
      const relatedEntityType = readString(formData, 'relatedEntityType')
      const relatedEntityId = readString(formData, 'relatedEntityId')
      const note = readString(formData, 'note')

      if (
        !MANUAL_OPS_ISSUE_TYPES.has(issueType) ||
        !MANUAL_OPS_ISSUE_SEVERITIES.has(severity) ||
        !title ||
        !description ||
        !recommendedAction
      ) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: createdIssue, error: createError } = await client
        .from('ops_issues')
        .insert({
          issue_type: issueType,
          severity,
          status: 'OPEN',
          source: 'ops-dashboard-manual',
          actor_id: session.email ?? session.role,
          actor_role: session.role.toUpperCase(),
          order_id: orderId || null,
          user_id: userId || null,
          tailor_profile_id: tailorProfileId || null,
          related_entity_type: relatedEntityType || null,
          related_entity_id: relatedEntityId || null,
          provider: provider || null,
          stage: stage || null,
          title,
          description,
          recommended_action: recommendedAction,
          dedupe_key: `manual:${crypto.randomUUID()}`,
          metadata: note ? { note } : {},
          last_seen_at: new Date().toISOString(),
        })
        .select('id, issue_number')
        .single()

      if (createError || !createdIssue?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'workflow-issue-save-failed')
      }

      await client.from('ops_audit_logs').insert({
        issue_id: createdIssue.id,
        action_taken: 'ISSUE_CREATED_MANUAL',
        performed_by: session.email ?? 'ops-session',
        performed_role: session.role.toUpperCase(),
        reason: note || null,
        before_state: null,
        after_state: {
          status: 'OPEN',
          severity,
          title,
          issue_type: issueType,
        },
      })

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: severity === 'CRITICAL' ? 'warn' : 'info',
        event: 'ops.manual_issue_created',
        payload: {
          issue_id: createdIssue.id,
          issue_number: createdIssue.issue_number,
          issue_type: issueType,
          severity,
          order_id: orderId || null,
          user_id: userId || null,
          tailor_profile_id: tailorProfileId || null,
        },
      })

      if (severity === 'CRITICAL') {
        await sendCriticalOpsIssueEmail({
          issueNumber: createdIssue.issue_number,
          issueType,
          severity,
          title,
          description,
          recommendedAction,
          source: 'ops-dashboard-manual',
          orderId: orderId || null,
          relatedEntityType: relatedEntityType || null,
          relatedEntityId: relatedEntityId || null,
          provider: provider || null,
          stage: stage || null,
        })
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'manual-issue-created')
    }

    if (kind === 'dispatch-stage') {
      const orderId = readString(formData, 'orderId')
      const targetStage = readString(formData, 'targetStage').toUpperCase()
      const provider = readString(formData, 'provider')
      const reference = readString(formData, 'reference')
      const contactName = readString(formData, 'contactName')
      const contactPhone = readString(formData, 'contactPhone')
      const trackingNumber = readString(formData, 'trackingNumber')
      const serviceLevel = readString(formData, 'serviceLevel').toUpperCase()
      const premiumException = formData.get('premiumException') === 'on'
      const note = readString(formData, 'note')

      if (!orderId || !DISPATCH_TARGETS.has(targetStage) || !provider || !contactName || !contactPhone) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      if (
        serviceLevel &&
        !['STANDARD', 'SAME_DAY', 'NEXT_DAY', 'INTERNATIONAL_STANDARD', 'INTERNATIONAL_EXPRESS', 'CUSTOM'].includes(serviceLevel)
      ) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      const normalizedServiceLevel = serviceLevel ? (serviceLevel as DispatchServiceLevel) : null

      const { data: existingOrder, error: orderError } = await client
        .from('orders')
        .select('id, reference, stage, order_kind, garment_type, item_title, item_size, delivery_method, recipient_name, recipient_phone, delivery_address, customer_id, tailor_id, special_note')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !existingOrder?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      if (existingOrder.stage !== 'READY_FOR_DRAPE_DISPATCH') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      if (existingOrder.delivery_method === 'LOCAL_COLLECTION') {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      if (!existingOrder.delivery_address?.trim() || !existingOrder.recipient_name?.trim() || !existingOrder.recipient_phone?.trim()) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const isLocalDelivery = existingOrder.delivery_method === 'LOCAL_DELIVERY'
      const isShipping = existingOrder.delivery_method === 'SHIPPING'

      if ((isLocalDelivery && targetStage !== 'OUT_FOR_DELIVERY') || (isShipping && targetStage !== 'SHIPPED')) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      if (isShipping && !trackingNumber && !reference) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const now = new Date().toISOString()
      const stageNote =
        note ||
        (targetStage === 'OUT_FOR_DELIVERY'
          ? `${provider} is handling this local delivery now.`
          : `${provider} accepted this shipment for dispatch.`)
      const supportMeta = parseOrderSupportMeta(existingOrder.special_note)
      const nextSupportMeta = {
        ...supportMeta,
        dispatchRecord: {
          providerUsed: provider,
          bookedBy: session.email ?? session.role,
          bookedAt: now,
          serviceLevel: normalizedServiceLevel,
          premiumException,
        },
      }

      const updatePayload: Record<string, string | null> = {
        stage: targetStage,
        stage_updated_at: now,
        fulfillment_provider: provider,
        fulfillment_reference: reference || null,
        fulfillment_contact_name: contactName,
        fulfillment_contact_phone: contactPhone,
        tracking_number: isShipping ? trackingNumber || null : null,
        carrier: isShipping ? provider : null,
        special_note: serializeOrderSupportMeta(nextSupportMeta),
      }

      const { error } = await client
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const { error: stageUpdateError } = await client.from('order_stage_updates').insert({
        order_id: orderId,
        stage: targetStage,
        note: stageNote,
      })

      if (stageUpdateError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: 'ops.dispatch_stage_updated',
        severity: 'info',
        payload: {
          target_stage: targetStage,
          delivery_method: existingOrder.delivery_method,
          provider,
          reference: reference || null,
          tracking_number: isShipping ? trackingNumber || null : null,
          service_level: normalizedServiceLevel,
          premium_exception: premiumException,
        },
      })

      const customerSms = buildCustomerStageSms({
        id: existingOrder.id,
        reference: existingOrder.reference,
        orderKind: existingOrder.order_kind,
        garmentType: existingOrder.garment_type,
        itemTitle: existingOrder.item_title,
        itemSize: existingOrder.item_size,
        deliveryMethod: existingOrder.delivery_method,
        fulfillmentProvider: provider,
        carrier: isShipping ? provider : null,
      }, targetStage)

      if (customerSms && existingOrder.customer_id) {
        await sendSmsToUser({
          client,
          userId: existingOrder.customer_id,
          audience: 'CUSTOMER',
          orderId,
          event: `order.stage_${targetStage.toLowerCase()}`,
          body: customerSms,
          fallbackPhone: existingOrder.recipient_phone ?? null,
        })
      }

      const tailorSms = buildTailorStageSms({
        id: existingOrder.id,
        reference: existingOrder.reference,
        orderKind: existingOrder.order_kind,
        garmentType: existingOrder.garment_type,
        itemTitle: existingOrder.item_title,
        itemSize: existingOrder.item_size,
        deliveryMethod: existingOrder.delivery_method,
        fulfillmentProvider: provider,
        carrier: isShipping ? provider : null,
      }, targetStage)

      if (tailorSms && existingOrder.tailor_id) {
        await sendSmsToUser({
          client,
          userId: existingOrder.tailor_id,
          audience: 'TAILOR',
          orderId,
          event: `order.stage_${targetStage.toLowerCase()}`,
          body: tailorSms,
        })
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'dispatch-saved')
    }

    return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
  } catch {
    return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
  }
}
