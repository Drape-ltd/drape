import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '../../../lib/supabase-config'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession, type OpsSession } from '../../../lib/ops-auth'
import { canAccessOpsSection, canPerformOpsAction, type OpsActionKind } from '../../../lib/ops-console'
import { sendOpsCustomerRefundEmail } from '../../../lib/ops-customer-email'
import { sendSmsToUser } from '../../../lib/sms'
import { checkPublicRateLimit, getClientIp } from '../../../lib/request-security'
import { invalidateOpsDashboardDataCache } from '../../../lib/ops-data'
import { buildOrderReviewRefundTerminalRequest, buildRefundOrderPaymentsRequest } from '@drape/shared'
import { OPS_ISSUE_SEVERITIES, OPS_ISSUE_TYPES } from '@drape/shared'
import {
  OPS_PARTIAL_REFUND_DECISION_BASES,
  OPS_PARTIAL_REFUND_EVIDENCE_SOURCES,
  OPS_PARTIAL_REFUND_REASON_CODES,
  OPS_PARTIAL_REFUND_ORDER_OUTCOMES,
} from '@drape/shared'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '@drape/shared'
import {
  buildCustomerReviewResolutionSms,
  buildCustomerStageSms,
  buildTailorReviewResolutionSms,
  buildTailorStageSms,
} from '@drape/shared/sms-copy'
import { sendCriticalOpsIssueEmail } from '../../../lib/ops-notifications'
import {
  allMoneyDeskActionScopes,
  beginMoneyDeskExecution,
  completeMoneyDeskExecution,
  decideMoneyDeskRequest,
  getActiveMoneyDeskGrant,
  issueMoneyDeskElevation,
  submitMoneyDeskRequest,
} from '../../../lib/money-desk'
import { isMoneyDeskActionType, type MoneyDeskActionType } from '@drape/shared/money-desk'

const APPLICATION_STATUSES = new Set(['PENDING', 'REVIEWING', 'CONTACTED', 'APPROVED', 'REJECTED'])
const DISPUTE_STATUSES = new Set(['OPEN', 'UNDER_REVIEW'])
const DISPUTE_OUTCOMES = new Set(['REFUND', 'RELEASE'])
const VERIFICATION_DECISIONS = new Set(['APPROVE', 'REJECT'])
const DELETION_STATUSES = new Set(['PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'REJECTED'])
const REVIEW_VISIBILITY_ACTIONS = new Set(['PUBLISH', 'HOLD'])
const CONVERSATION_ACCESS_ACTIONS = new Set(['BLOCK', 'UNBLOCK'])
const DISPATCH_TARGETS = new Set(['OUT_FOR_DELIVERY', 'SHIPPED'])
const DISPATCH_EVENT_TYPES = new Set([
  'BOOKED',
  'CARRIER_ACCEPTED',
  'COLLECTED',
  'AT_HUB',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'PICKUP_READY',
  'PICKED_UP',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
  'EXCEPTION_RECORDED',
])
const ORDER_REVIEW_TYPES = new Set(['CANCELLATION', 'DELIVERY'])
const ORDER_REVIEW_OUTCOMES = new Set(['REFUND', 'CONTINUE'])
const OPS_ISSUE_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'RESOLVED', 'ESCALATED'])
const MANUAL_OPS_ISSUE_TYPES = new Set<string>(OPS_ISSUE_TYPES)
const MANUAL_OPS_ISSUE_SEVERITIES = new Set<string>(OPS_ISSUE_SEVERITIES)
const OPS_PARTIAL_REFUND_REASON_SET = new Set<string>(OPS_PARTIAL_REFUND_REASON_CODES)
const OPS_PARTIAL_REFUND_DECISION_BASIS_SET = new Set<string>(OPS_PARTIAL_REFUND_DECISION_BASES)
const OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_SET = new Set<string>(OPS_PARTIAL_REFUND_EVIDENCE_SOURCES)
const OPS_PARTIAL_REFUND_ORDER_OUTCOME_SET = new Set<string>(OPS_PARTIAL_REFUND_ORDER_OUTCOMES)
const OPS_PARTIAL_REFUND_EVIDENCE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PAYOUT_RESOLUTION_MODES = new Set(['ORIGINAL_CURRENCY', 'CONVERT_TO_CURRENT', 'REFUND_CUSTOMER'])
const SELLER_ITEM_VISIBILITY_ACTIONS = new Set(['HIDE', 'RESTORE'])
const OPS_PULSE_CACHE_TTL_MS = 10_000
const OPS_ACTION_RATE_LIMITS: Partial<Record<OpsActionKind, { windowSeconds: number; maxRequests: number }>> = {
  'dispatch-stage': { windowSeconds: 5 * 60, maxRequests: 24 },
  'dispatch-quote': { windowSeconds: 5 * 60, maxRequests: 24 },
  'dispatch-event': { windowSeconds: 5 * 60, maxRequests: 60 },
  'dispute-resolution': { windowSeconds: 5 * 60, maxRequests: 12 },
  'order-cancellation-refund-request': { windowSeconds: 5 * 60, maxRequests: 8 },
  'order-review-resolution': { windowSeconds: 5 * 60, maxRequests: 12 },
  'order-partial-refund': { windowSeconds: 5 * 60, maxRequests: 8 },
  'reviewed-partial-refund-outcome': { windowSeconds: 5 * 60, maxRequests: 8 },
  'payout-release': { windowSeconds: 5 * 60, maxRequests: 10 },
  'payout-bulk-release': { windowSeconds: 5 * 60, maxRequests: 3 },
  'material-advance-release': { windowSeconds: 5 * 60, maxRequests: 10 },
  'material-overage-resolution': { windowSeconds: 5 * 60, maxRequests: 10 },
  'payout-block-resolution': { windowSeconds: 5 * 60, maxRequests: 10 },
  'ops-issue-status': { windowSeconds: 60, maxRequests: 40 },
  'manual-issue-create': { windowSeconds: 5 * 60, maxRequests: 20 },
  'ops-issue-bulk-resolve': { windowSeconds: 5 * 60, maxRequests: 12 },
  'money-desk-elevation': { windowSeconds: 5 * 60, maxRequests: 6 },
  'money-desk-request': { windowSeconds: 5 * 60, maxRequests: 12 },
  'money-desk-decision': { windowSeconds: 5 * 60, maxRequests: 16 },
  'money-desk-execution': { windowSeconds: 5 * 60, maxRequests: 8 },
  'return-refund-prepare': { windowSeconds: 5 * 60, maxRequests: 8 },
  'benefit-campaign-create': { windowSeconds: 5 * 60, maxRequests: 8 },
  'benefit-campaign-activate': { windowSeconds: 5 * 60, maxRequests: 8 },
  'benefit-grant-create': { windowSeconds: 5 * 60, maxRequests: 12 },
}

let opsPulseCache: {
  body: Record<string, unknown>
  expiresAt: number
} | null = null

type OrderReviewMeta = {
  status?: 'OPEN' | 'RESOLVED' | null
  requestedFromStage?: string | null
  resolvedAt?: string | null
  riskAction?: 'OPS_FOLLOW_UP' | 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED' | null
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

function parseOptionalMajorAmountToMinor(value: string) {
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized) return 0
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN
  const numeric = Number.parseFloat(normalized)
  if (!Number.isFinite(numeric) || numeric < 0) return Number.NaN
  return Math.round(numeric * 100)
}

function readOptionalFile(formData: FormData, key: string) {
  const value = formData.get(key)
  return value instanceof File && value.size > 0 ? value : null
}

function privateEvidenceExtension(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return null
}

function readRpcRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const first = value[0]
    return first && typeof first === 'object' && !Array.isArray(first) ? first as Record<string, unknown> : {}
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
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

function dispatchEventErrorFeedback(message: string): { code: string; detail: string } {
  if (message.includes('Trusted custody proof is required before delivery')) {
    return {
      code: 'dispatch-custody-proof-required',
      detail: 'This parcel is already marked in transit, but its earlier handoff photo was not saved. Add the missing provider-acceptance or collection proof; tracking will remain in transit and delivery will then unlock.',
    }
  }
  if (message.includes('Trusted custody proof is required before tracking transit')) {
    return {
      code: 'dispatch-custody-proof-required',
      detail: 'Add a clear provider-acceptance or parcel-collection photo. The parcel cannot enter transit without a recorded handoff.',
    }
  }
  if (message.includes('Dispatch handoff proof is required for this update')) {
    return {
      code: 'dispatch-photo-proof-required',
      detail: 'Add a clear handoff or delivery photo, then save the update again.',
    }
  }
  if (message.includes('Dispatch funding must be ready before booking')) {
    return {
      code: 'dispatch-funding-not-ready',
      detail: 'The provider quote or customer payment is not complete. Finish dispatch funding before booking the provider.',
    }
  }
  if (message.includes('Carrier delivery events are not valid for local collection')) {
    return {
      code: 'dispatch-method-mismatch',
      detail: 'This order is set to pickup. Use a pickup handoff update or complete the fulfillment-method change first.',
    }
  }
  return {
    code: 'dispatch-event-save-failed',
    detail: 'The delivery update was not saved. Review the current dispatch step and required proof, then try again.',
  }
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

function invalidateOpsActionCaches() {
  opsPulseCache = null
  invalidateOpsDashboardDataCache()
}

function requestOrigin(request: Request) {
  const host = request.headers.get('host')?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return host ? `${protocol}://${host}` : request.url
}

function redirectWithMessage(
  request: Request,
  redirectTo: string,
  key: 'notice' | 'error',
  value: string,
  detail?: string | null,
) {
  invalidateOpsActionCaches()
  const url = new URL(redirectTo, requestOrigin(request))
  url.searchParams.set(key, value)
  if (detail?.trim()) {
    url.searchParams.set(`${key}Detail`, detail.trim().slice(0, 300))
  }
  if (request.headers.get('accept')?.includes('application/json')) {
    return opsJson({
      ok: key === 'notice',
      key,
      detail: detail?.trim() || null,
      redirectTo: `${url.pathname}${url.search}`,
    })
  }
  return NextResponse.redirect(url, { status: 303 })
}

function opsJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

async function loadCachedOpsPulse(client: NonNullable<ReturnType<typeof createServiceRoleClient>>) {
  const now = Date.now()
  if (opsPulseCache && opsPulseCache.expiresAt > now) {
    return { status: 200, body: opsPulseCache.body }
  }

  const activeStatuses = ['OPEN', 'IN_REVIEW', 'ESCALATED']
  const [openCountResult, criticalCountResult, latestCriticalResult] = await Promise.all([
    client
      .from('ops_issues')
      .select('id', { count: 'exact', head: true })
      .in('status', activeStatuses),
    client
      .from('ops_issues')
      .select('id', { count: 'exact', head: true })
      .eq('severity', 'CRITICAL')
      .in('status', activeStatuses),
    client
      .from('ops_issues')
      .select('id, issue_number, issue_type, severity, status, source, order_id, provider, stage, title, updated_at, created_at')
      .eq('severity', 'CRITICAL')
      .in('status', activeStatuses)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (openCountResult.error || criticalCountResult.error || latestCriticalResult.error) {
    return {
      status: 500,
      body: {
        ok: false,
        error: 'pulse-load-failed',
        detail:
          openCountResult.error?.message ||
          criticalCountResult.error?.message ||
          latestCriticalResult.error?.message ||
          null,
      },
    }
  }

  const latest = latestCriticalResult.data
  const latestKey = latest
    ? `${latest.id}:${latest.updated_at ?? latest.created_at ?? ''}`
    : ''
  const fingerprint = [
    openCountResult.count ?? 0,
    criticalCountResult.count ?? 0,
    latestKey,
  ].join(':')
  const body = {
    ok: true,
    enabled: true,
    serverTime: new Date().toISOString(),
    openCount: openCountResult.count ?? 0,
    criticalCount: criticalCountResult.count ?? 0,
    fingerprint,
    latest: latest
      ? {
          key: latestKey,
          issueNumber: latest.issue_number,
          issueType: latest.issue_type,
          severity: latest.severity,
          status: latest.status,
          source: latest.source,
          orderId: latest.order_id,
          provider: latest.provider,
          stage: latest.stage,
          title: latest.title,
          updatedAt: latest.updated_at,
          createdAt: latest.created_at,
        }
      : null,
  }

  opsPulseCache = {
    body,
    expiresAt: now + OPS_PULSE_CACHE_TTL_MS,
  }

  return { status: 200, body }
}

async function checkOpsActionRateLimit(
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  request: Request,
  session: OpsSession,
  actionKind: OpsActionKind,
) {
  const policy = OPS_ACTION_RATE_LIMITS[actionKind]
  if (!policy) return { ok: true, allowed: true }

  const identifier = session.email
    ? `email:${session.email}`
    : `${session.mode}:${session.role}:${getClientIp(request)}`

  return checkPublicRateLimit(
    client,
    `ops-action:${actionKind}:${identifier}`,
    policy.windowSeconds,
    policy.maxRequests,
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('kind') !== 'pulse') {
    return opsJson({ ok: false, error: 'not-found' }, 404)
  }

  const session = await getOpsSession()
  if (!session) {
    return opsJson({ ok: false, error: 'locked' }, 401)
  }

  const canSeeIssuePulse =
    canAccessOpsSection(session.role, 'workflow-issues') ||
    canAccessOpsSection(session.role, 'incidents')

  if (!canSeeIssuePulse) {
    return opsJson({
      ok: true,
      enabled: false,
      serverTime: new Date().toISOString(),
    })
  }

  const client = createServiceRoleClient()
  if (!client) {
    return opsJson({ ok: false, error: 'service-role-missing' }, 503)
  }

  const pulse = await loadCachedOpsPulse(client)
  return opsJson(pulse.body, pulse.status)
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

async function recordCancellationReconciliationFailure(
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  input: {
    orderId: string
    orderReference: string | null
    moneyDeskRequestId: string
    error: string
    performedBy: string
    performedRole: string
  },
) {
  const now = new Date().toISOString()
  const dedupeKey = `order-cancellation-refund-reconciliation:${input.orderId}`
  const { data: issue } = await client.from('ops_issues').upsert({
    issue_type: 'REFUND_FAILED',
    severity: 'CRITICAL',
    status: 'OPEN',
    source: 'money-desk',
    actor_id: input.performedBy,
    actor_role: input.performedRole,
    order_id: input.orderId,
    related_entity_type: 'money_desk_request',
    related_entity_id: input.moneyDeskRequestId,
    title: 'Cancellation refund needs ledger reconciliation',
    description: 'Provider refunds completed, but Drapeon could not finish the order or dispute transition.',
    recommended_action: 'Verify every provider refund and ledger entry before changing state. Do not retry a provider refund. Reconcile the order, dispute, material advance, notification jobs, and Money Desk terminal outcome together.',
    dedupe_key: dedupeKey,
    metadata: {
      order_reference: input.orderReference,
      money_desk_request_id: input.moneyDeskRequestId,
      error: input.error,
    },
    last_seen_at: now,
  }, { onConflict: 'dedupe_key' }).select('id').maybeSingle()

  if (issue?.id) {
    await client.from('ops_audit_logs').insert({
      issue_id: issue.id,
      action_taken: 'ORDER_CANCELLATION_REFUND_RECONCILIATION_REQUIRED',
      performed_by: input.performedBy,
      performed_role: input.performedRole,
      reason: input.error,
      before_state: { order_id: input.orderId, money_desk_request_id: input.moneyDeskRequestId },
      after_state: { status: 'OPEN', provider_refunds_completed: true },
    })
  }

  await client.from('audit_logs').insert({
    actor_role: 'OPS',
    order_id: input.orderId,
    event: 'ops.order_cancellation_refund_reconciliation_required',
    severity: 'error',
    payload: {
      order_reference: input.orderReference,
      money_desk_request_id: input.moneyDeskRequestId,
      error: input.error,
      provider_refunds_completed: true,
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

async function enqueuePayoutChangePush(
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  input: {
    requestId: string
    tailorUserId: string
    outcome: 'APPROVED' | 'REJECTED'
  },
) {
  const approved = input.outcome === 'APPROVED'
  const { error } = await client.rpc('enqueue_domain_event', {
    p_event_type: 'notification.push_requested',
    p_aggregate_type: 'user',
    p_idempotency_key: `payout-change:${input.requestId}:${input.outcome.toLowerCase()}:delivery`,
    p_payload: {
      userId: input.tailorUserId,
      subject: approved ? 'Your new payout account is active' : 'Your payout change needs attention',
      eyebrow: 'Payout account update',
      headline: approved ? 'Your new payout account is active' : 'Your payout change needs attention',
      body: approved
        ? 'Your verified replacement is active now. Eligible earnings can release to it without an extra payout-account hold.'
        : 'Drapeon could not approve this replacement. Open payout setup to review the reason and submit corrected details.',
      ctaLabel: 'View payout account',
      webPath: '/account/payout',
      appUrl: 'drape://profile/payout-setup',
      details: [],
      notification: {
        title: approved ? 'Payout destination approved' : 'Payout destination needs changes',
        body: approved
          ? 'Your verified replacement is active now. Eligible earnings can release to it without an extra payout-account hold.'
          : 'Drapeon could not approve this replacement. Open payout setup to review the reason and submit corrected details.',
        preferenceKey: 'paymentReleased',
        data: {
          destination: 'PAYOUT',
          payoutChangeRequestId: input.requestId,
        },
      },
    },
    p_aggregate_id: input.tailorUserId,
    p_actor_id: null,
    p_actor_role: 'OPS',
    p_order_id: null,
    p_metadata: { source: 'ops-payout-change-review' },
    p_jobs: ['SEND_PUSH', 'SEND_ACCOUNT_EVENT_EMAIL'],
    p_priority: 20,
    p_max_attempts: 6,
    p_run_at: new Date().toISOString(),
  })
  if (error) {
    await client.from('audit_logs').insert({
      actor_role: 'OPS',
      event: 'ops.payout_change_notification_enqueue_failed',
      severity: 'error',
      payload: {
        payout_change_request_id: input.requestId,
        tailor_user_id: input.tailorUserId,
        outcome: input.outcome,
        error: error.message,
      },
    })
  }
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
  refundResolutionId?: string | null
  materialAdvanceId?: string | null
  includeUnreleasedMaterialAdvances?: boolean
  allowedPhases?: Array<'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT' | 'MATERIAL_ADVANCE'>
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
      ...buildRefundOrderPaymentsRequest({ orderId, ...input }),
      refundResolutionId: input.refundResolutionId ?? undefined,
      materialAdvanceId: input.materialAdvanceId ?? undefined,
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
    providerReference?: string | null
    pending?: boolean
    pendingAttempts?: Array<Record<string, unknown>>
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.message ?? payload?.reason ?? payload?.error ?? `refund-function-${response.status}`,
    }
  }

  return {
    ok: true as const,
    pending: payload?.pending === true,
    refundMode: payload?.refundMode ?? 'FULL',
    totalRefundedAmount: payload?.totalRefundedAmount ?? 0,
    remainingRefundableAmount: payload?.remainingRefundableAmount ?? 0,
    refundedAttempts: payload?.refundedAttempts ?? [],
    providerReference: payload?.providerReference ?? null,
    pendingAttempts: payload?.pendingAttempts ?? [],
  }
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

async function loadCancellationRefundSnapshot(
  client: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  orderId: string,
) {
  const { data: order, error: orderError } = await client
    .from('orders')
    .select('id,reference,stage,currency,customer_id,tailor_id')
    .eq('id', orderId)
    .maybeSingle()
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

  const advancesByPaymentId = new Map(
    (advances ?? []).filter((advance) => advance.payment_id).map((advance) => [advance.payment_id as string, advance]),
  )
  const claims: CancellationRefundClaim[] = []
  for (const payment of payments ?? []) {
    if (!['SUCCEEDED', 'PARTIAL_REFUND'].includes(payment.status)) continue
    const refundedAmount = Math.max(Math.min(payment.refunded_amount ?? 0, payment.amount), 0)
    const remainingAmount = Math.max(payment.amount - refundedAmount, 0)
    if (remainingAmount <= 0) continue
    if (!payment.provider_payment_id?.trim()) throw new Error('A refundable payment is missing its provider reference.')
    const advance = payment.phase === 'MATERIAL_ADVANCE' ? advancesByPaymentId.get(payment.id) : null
    if (payment.phase === 'MATERIAL_ADVANCE') {
      if (!advance?.paid_at) throw new Error('A material payment is not linked to a paid material advance.')
      if (advance.released_at || advance.release_status === 'RELEASED' || !['NOT_REQUESTED', 'BLOCKED'].includes(advance.provider_release_status ?? 'NOT_REQUESTED')) {
        throw new Error('A material advance has already reached provider release and requires a separate recovery review.')
      }
    }
    claims.push({
      paymentId: payment.id,
      phase: payment.phase,
      amount: payment.amount,
      refundedAmount,
      remainingAmount,
      currency: payment.currency,
      materialAdvanceId: advance?.id ?? null,
    })
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

async function triggerOrderPayoutRelease(orderId: string, recoveryRequestId?: string | null) {
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
    body: JSON.stringify({ orderId, recoveryRequestId: recoveryRequestId || undefined }),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    error?: string
    reason?: string
    message?: string
    results?: Array<{ result?: string; reason?: string; error?: string; payoutId?: string; providerStatus?: string }>
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.message ?? payload?.reason ?? payload?.error ?? `payout-release-function-${response.status}`,
    }
  }

  const result = payload.results?.[0]
  if (result?.result === 'processing') {
    return {
      ok: true as const,
      pending: true as const,
      providerReference: result.payoutId ?? null,
      providerStatus: result.providerStatus ?? null,
    }
  }
  if (result?.result === 'blocked' || result?.result === 'error' || result?.result === 'requires_ops_review') {
    return {
      ok: false as const,
      error: result.error ?? result.reason ?? (result.result === 'requires_ops_review' ? 'The failed payout still requires a reviewed recovery.' : 'payout-blocked'),
    }
  }

  return { ok: true as const, providerReference: result?.payoutId ?? null }
}

function payoutDestinationFingerprint(provider: string, destination: string | null | undefined) {
  return createHash('sha256')
    .update(`${provider}:${destination?.trim() || 'MISSING'}`)
    .digest('hex')
}

async function triggerSettlementTrancheRelease(trancheId: string) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) return { ok: false as const, error: 'missing-service-role-config' }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/release-settlement-tranche`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trancheId }),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; providerReference?: string } | null
  return response.ok && payload?.ok
    ? { ok: true as const, providerReference: payload.providerReference ?? null }
    : { ok: false as const, error: payload?.error ?? `settlement-release-function-${response.status}` }
}

async function triggerStripeTransferReversal(moneyDeskRequestId: string) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) return { ok: false as const, error: 'missing-service-role-config' }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/reverse-stripe-transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneyDeskRequestId }),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; providerReference?: string } | null
  return response.ok && payload?.ok
    ? { ok: true as const, providerReference: payload.providerReference ?? null }
    : { ok: false as const, error: payload?.error ?? `stripe-transfer-reversal-${response.status}` }
}

async function triggerConsultationEarningRelease(bookingId: string) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) return { ok: false as const, error: 'missing-service-role-config' }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/release-consultation-earning`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId }),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; providerReference?: string } | null
  return response.ok && payload?.ok
    ? { ok: true as const, providerReference: payload.providerReference ?? null }
    : { ok: false as const, error: payload?.error ?? `consultation-release-function-${response.status}` }
}

async function triggerConsultationAttendanceResolution(input: {
  reviewId: string
  decision: 'RESCHEDULE' | 'CUSTOMER_REFUND' | 'TAILOR_EARNING'
  note: string
  actorEmail: string
  moneyDeskRequestId?: string | null
}) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) return { ok: false as const, error: 'missing-service-role-config' }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/consultation-attendance-resolution`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewId: input.reviewId,
      decision: input.decision,
      note: input.note,
      actorEmail: input.actorEmail,
      ...(input.moneyDeskRequestId ? { moneyDeskRequestId: input.moneyDeskRequestId } : {}),
    }),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
  return response.ok && payload?.ok
    ? { ok: true as const }
    : { ok: false as const, error: payload?.error ?? `consultation-attendance-resolution-${response.status}` }
}

async function triggerTipPayout(tipId: string) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) return { ok: false as const, error: 'missing-service-role-config' }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/release-order-tip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipId }),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; providerReference?: string } | null
  return response.ok && payload?.ok
    ? { ok: true as const, providerReference: payload.providerReference ?? null }
    : { ok: false as const, error: payload?.error ?? `tip-payout-function-${response.status}` }
}

async function triggerMaterialAdvanceRelease(advanceId: string, moneyDeskRequestId: string, note: string | null) {
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
      moneyDeskRequestId,
      note: note ?? undefined,
    }),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    error?: string
    message?: string
    pending?: boolean
    providerReference?: string | null
  } | null

  if (!response.ok || !payload?.ok) {
    return {
      ok: false as const,
      error: payload?.message ?? payload?.error ?? `material-advance-release-function-${response.status}`,
    }
  }

  return { ok: true as const, pending: payload.pending === true, providerReference: payload.providerReference ?? null }
}

async function triggerMaterialAdvanceOpsAction(input: {
  action: 'finalize-unused-refund' | 'resolve-overage' | 'record-release-rejection'
  advanceId: string
  actorRef: string
  moneyDeskRequestId?: string
  note?: string
}) {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) return { ok: false as const, error: 'missing-service-role-config' }
  const response = await fetch(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/material-advance-action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null
  return response.ok && payload?.ok
    ? { ok: true as const }
    : { ok: false as const, error: payload?.message ?? payload?.error ?? `material-advance-action-${response.status}` }
}

async function submitVerificationDecision(input: {
  tailorUserId: string
  decision: string
  reason: string | null
  rejectionCode?: string | null
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
    case 'order-cancellation-refund-request':
    case 'bypass-review':
    case 'application-status':
    case 'verification-decision':
    case 'profile-change-decision':
    case 'payout-change-decision':
    case 'deletion-status':
    case 'review-visibility':
    case 'conversation-access':
    case 'dispatch-stage':
    case 'dispatch-quote':
    case 'dispatch-event':
    case 'order-review-resolution':
    case 'order-partial-refund':
    case 'reviewed-partial-refund-outcome':
    case 'payout-release':
    case 'payout-block-resolution':
    case 'material-advance-release':
    case 'ops-issue-status':
    case 'manual-issue-create':
    case 'ops-issue-bulk-resolve':
    case 'support-thread-mark-read':
    case 'payout-bulk-release':
    case 'bypass-bulk-review':
    case 'money-desk-elevation':
    case 'money-desk-request':
    case 'money-desk-decision':
    case 'money-desk-execution':
    case 'return-refund-prepare':
    case 'benefit-campaign-create':
    case 'benefit-campaign-activate':
    case 'benefit-grant-create':
    case 'material-overage-resolution':
    case 'consultation-attendance-resolution':
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

  const rateLimit = await checkOpsActionRateLimit(client, request, session, actionKind)
  if (!rateLimit.ok) {
    return redirectWithMessage(request, redirectTo, 'error', 'rate-limit-unavailable')
  }
  if (!rateLimit.allowed) {
    return redirectWithMessage(request, redirectTo, 'error', 'rate-limited')
  }

  const legacyDirectMoneyActions = new Set([
    'payout-release',
    'payout-bulk-release',
    'payout-block-resolution',
    'material-advance-release',
  ])
  const isLegacyMoneyDecision =
    (kind === 'payout-change-decision' && readString(formData, 'decision').toUpperCase() === 'APPROVE') ||
    (kind === 'order-review-resolution' && readString(formData, 'outcome').toUpperCase() === 'REFUND') ||
    (kind === 'dispute-resolution' && DISPUTE_OUTCOMES.has(readString(formData, 'outcome').toUpperCase()))
  if (legacyDirectMoneyActions.has(kind) || isLegacyMoneyDecision) {
    return redirectWithMessage(request, redirectTo, 'error', 'money-desk-required')
  }

  try {
    if (kind === 'benefit-campaign-create' || kind === 'benefit-campaign-activate' || kind === 'benefit-grant-create') {
      if (!isNamedOpsWorkforceSession(session) || !session.email || !hasFreshOpsMfa(session)) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')
      if (kind === 'benefit-campaign-create') {
        const name=readString(formData,'name'), funding=readString(formData,'fundingSource').toUpperCase(), currency=readString(formData,'currency').toUpperCase()
        const benefitKind=readString(formData,'benefitKind').toUpperCase(), code=readString(formData,'code').toUpperCase()||null
        const rawValue=readString(formData,'value').replace(/,/g,'')
        const percentageValue=['PERCENT_DISCOUNT','CREATOR_CODE'].includes(benefitKind)
          ? Number.parseFloat(rawValue)
          : null
        const value=percentageValue == null
          ? parseOptionalMajorAmountToMinor(rawValue)
          : Math.round(percentageValue*100)
        const budget=parseOptionalMajorAmountToMinor(readString(formData,'budgetAmount'))
        const maximum=parseOptionalMajorAmountToMinor(readString(formData,'maximumAmount'))
        const minimum=parseOptionalMajorAmountToMinor(readString(formData,'minimumOrderAmount'))
        if (
          !Number.isFinite(value) || value<0 ||
          (percentageValue!=null&&(!Number.isFinite(percentageValue)||percentageValue<0||percentageValue>100)) ||
          !Number.isFinite(budget)||!Number.isFinite(maximum)||!Number.isFinite(minimum)
        ) return redirectWithMessage(request,redirectTo,'error','conflict','Enter valid major-currency amounts, or a percentage from 0 to 100.')
        const {data,error}=await client.rpc('ops_prepare_commercial_campaign',{p_name:name,p_funding_source:funding,p_currency:currency||null,p_budget_amount:budget>0?budget:null,p_kind:benefitKind,p_value:value,p_maximum_amount:maximum>0?maximum:null,p_minimum_order_amount:minimum,p_code:code,p_actor_email:session.email})
        if(error)return redirectWithMessage(request,redirectTo,'error','conflict',error.message)
        await client.from('audit_logs').insert({actor_role:session.role.toUpperCase(),event:'ops.commercial_campaign_prepared',severity:'warn',payload:{actor_email:session.email,campaign_id:data,name,funding_source:funding,benefit_kind:benefitKind}})
        return redirectWithMessage(request,redirectTo,'notice','saved')
      }
      if (kind === 'benefit-campaign-activate') {
        const campaignId=readString(formData,'campaignId');const {error}=await client.rpc('ops_activate_commercial_campaign',{p_campaign_id:campaignId,p_actor_email:session.email})
        if(error)return redirectWithMessage(request,redirectTo,'error','conflict',error.message)
        await client.from('audit_logs').insert({actor_role:session.role.toUpperCase(),event:'ops.commercial_campaign_activated',severity:'warn',payload:{actor_email:session.email,campaign_id:campaignId}})
        return redirectWithMessage(request,redirectTo,'notice','saved')
      }
      const benefitId=readString(formData,'benefitId'), userId=readString(formData,'userId'), amount=parseOptionalMajorAmountToMinor(readString(formData,'amount')), expiresAt=readString(formData,'expiresAt')||null, reason=readString(formData,'reason')
      if (!Number.isFinite(amount)) return redirectWithMessage(request,redirectTo,'error','conflict','Enter the grant in the full major-currency amount.')
      const {data,error}=await client.rpc('ops_create_commercial_grant',{p_benefit_id:benefitId,p_user_id:userId,p_amount:amount>0?amount:null,p_expires_at:expiresAt?new Date(expiresAt).toISOString():null,p_reason:reason,p_actor_email:session.email})
      if(error)return redirectWithMessage(request,redirectTo,'error','conflict',error.message)
      await client.from('audit_logs').insert({actor_role:session.role.toUpperCase(),event:'ops.commercial_grant_created',severity:'warn',payload:{actor_email:session.email,grant_id:data,benefit_id:benefitId,user_id:userId,amount:amount>0?amount:null}})
      return redirectWithMessage(request,redirectTo,'notice','saved')
    }

    if (kind === 'return-refund-prepare') {
      const returnRequestId = readString(formData, 'returnRequestId')
      const proposalId = readString(formData, 'proposalId')
      const readMinor = (name: string) => Number.parseInt(readString(formData, name) || '0', 10)
      const values = {
        p_return_request_id: returnRequestId,
        p_proposal_id: proposalId,
        p_tailor_work: readMinor('tailorWorkAmount'),
        p_platform_fee: readMinor('platformFeeAmount'),
        p_tax: readMinor('taxAmount'),
        p_fulfillment: readMinor('fulfillmentAmount'),
        p_consultation: readMinor('consultationAmount'),
        p_promotion: readMinor('promotionAmount'),
        p_drapeon_funded: readMinor('drapeonFundedAmount'),
        p_released_tailor_recovery: readMinor('releasedTailorRecoveryAmount'),
      }
      if (!returnRequestId || !proposalId || Object.values(values).some((value) => typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      const { error } = await client.rpc('prepare_order_refund_resolution', values)
      if (error) return redirectWithMessage(request, redirectTo, 'error', 'conflict', error.message)
      await client.from('audit_logs').insert({ actor_role: session.role.toUpperCase(), event: 'ops.refund_resolution_prepared', severity: 'warn', payload: { actor_email: session.email, return_request_id: returnRequestId, proposal_id: proposalId } })
      return redirectWithMessage(request, redirectTo, 'notice', 'refund-resolution-prepared')
    }

    if (kind === 'consultation-attendance-resolution') {
      const reviewId = readString(formData, 'reviewId')
      const issueId = readString(formData, 'issueId')
      const decision = readString(formData, 'decision').toUpperCase()
      const note = readString(formData, 'note')
      if (!reviewId || !['RESCHEDULE', 'CUSTOMER_REFUND', 'TAILOR_EARNING'].includes(decision) || note.length < 12) {
        return redirectWithMessage(request, redirectTo, 'error', 'consultation-attendance-decision-invalid')
      }

      const { data: review, error: reviewError } = await client.from('consultation_attendance_reviews')
        .select('id,booking_id,order_id,financial_case_id,status')
        .eq('id', reviewId).maybeSingle()
      if (reviewError || !review?.id || review.status !== 'OPS_REVIEW') {
        return redirectWithMessage(request, redirectTo, 'error', 'consultation-attendance-decision-conflict', reviewError?.message)
      }
      const { data: booking, error: bookingError } = await client.from('consultation_bookings')
        .select('id,fee_mode,fee_amount,fee_currency,payment_status,settlement_status')
        .eq('id', review.booking_id).maybeSingle()
      if (bookingError || !booking?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'consultation-attendance-decision-conflict', bookingError?.message)
      }

      let moneyDeskRequestId: string | null = null
      if (decision !== 'RESCHEDULE') {
        if (booking.fee_mode !== 'PAID' || booking.payment_status !== 'PAID' || !booking.fee_amount || !booking.fee_currency) {
          return redirectWithMessage(request, redirectTo, 'error', 'consultation-attendance-money-unavailable')
        }
        const actionType = decision === 'CUSTOMER_REFUND' ? 'CUSTOMER_REFUND' : 'PAYOUT_RELEASE'
        const grant = await getActiveMoneyDeskGrant(client, session, actionType)
        if (!grant) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')
        const submitted = await submitMoneyDeskRequest(client, session, grant, {
          actionType,
          targetType: 'CONSULTATION_BOOKING',
          targetId: booking.id,
          orderId: review.order_id,
          caseId: review.financial_case_id,
          amount: booking.fee_amount,
          currency: booking.fee_currency,
          amountUsdEquivalent: booking.fee_currency === 'USD' ? booking.fee_amount : null,
          usdEquivalentSource: booking.fee_currency === 'USD' ? 'NATIVE_USD' : null,
          reason: note,
          actionPayload: { orderId: review.order_id, bookingId: booking.id, attendanceReviewId: review.id, attendanceDecision: decision, note },
          idempotencyKey: `consultation-attendance:${review.id}:${decision}`,
        })
        moneyDeskRequestId = typeof submitted.requestId === 'string' ? submitted.requestId : null
        if (!moneyDeskRequestId) throw new Error('Money Desk did not return a request ID.')
      }

      const resolved = await triggerConsultationAttendanceResolution({
        reviewId,
        decision: decision as 'RESCHEDULE' | 'CUSTOMER_REFUND' | 'TAILOR_EARNING',
        note,
        actorEmail: session.email ?? session.subject,
        moneyDeskRequestId,
      })
      if (!resolved.ok) {
        if (moneyDeskRequestId) {
          await client.from('money_desk_requests').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', moneyDeskRequestId).eq('status', 'PENDING_APPROVAL')
        }
        return redirectWithMessage(request, redirectTo, 'error', 'consultation-attendance-decision-conflict', resolved.error)
      }
      if (issueId) {
        await client.from('ops_audit_logs').insert({
          issue_id: issueId, action_taken: `CONSULTATION_${decision}`, performed_by: session.email ?? session.subject,
          performed_role: session.role.toUpperCase(), reason: note,
        })
      }
      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        decision === 'RESCHEDULE' ? 'consultation-reschedule-recorded' : 'consultation-money-decision-prepared',
      )
    }

    if (kind === 'money-desk-elevation') {
      const requestedScopes = readString(formData, 'actionScopes')
        .split(',')
        .map((scope) => scope.trim().toUpperCase())
        .filter(isMoneyDeskActionType)
      await issueMoneyDeskElevation(client, session, {
        actionScopes: requestedScopes.length > 0 ? requestedScopes : allMoneyDeskActionScopes(),
        reason: readString(formData, 'reason'),
      })
      await client.from('audit_logs').insert({
        actor_role: session.role.toUpperCase(),
        event: 'ops.money_desk_elevation_issued',
        severity: 'warn',
        payload: { actor_email: session.email, action_scopes: requestedScopes },
      })
      return redirectWithMessage(request, redirectTo, 'notice', 'money-desk-elevated')
    }

    if (kind === 'order-cancellation-refund-request') {
      const orderId = readString(formData, 'orderId')
      const reason = readString(formData, 'reason')
      if (!orderId || reason.length < 12) {
        return redirectWithMessage(request, redirectTo, 'error', 'money-desk-request-invalid')
      }
      const grant = await getActiveMoneyDeskGrant(client, session, 'CUSTOMER_REFUND')
      if (!grant) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')
      const snapshot = await loadCancellationRefundSnapshot(client, orderId)
      const submitted = await submitMoneyDeskRequest(client, session, grant, {
        actionType: 'CUSTOMER_REFUND',
        targetType: 'ORDER_CANCELLATION',
        targetId: orderId,
        orderId,
        amount: snapshot.totalAmount,
        currency: snapshot.currency,
        amountUsdEquivalent: snapshot.currency === 'USD' ? snapshot.totalAmount : null,
        usdEquivalentSource: snapshot.currency === 'USD' ? 'NATIVE_USD' : null,
        reason,
        actionPayload: {
          orderId,
          disputeId: snapshot.dispute.id,
          paymentClaims: snapshot.claims,
          paymentSnapshotKey: snapshot.snapshotKey,
          includeUnreleasedMaterialAdvances: snapshot.claims.some((claim) => claim.phase === 'MATERIAL_ADVANCE'),
          note: reason,
        },
        idempotencyKey: `order-cancellation-refund:${orderId}:${snapshot.snapshotKey}`,
      })
      await client.from('audit_logs').insert({
        actor_role: session.role.toUpperCase(),
        order_id: orderId,
        event: 'ops.order_cancellation_refund_prepared',
        severity: 'warn',
        payload: {
          actor_email: session.email,
          money_desk_request_id: typeof submitted.requestId === 'string' ? submitted.requestId : null,
          payment_count: snapshot.claims.length,
          material_payment_count: snapshot.claims.filter((claim) => claim.phase === 'MATERIAL_ADVANCE').length,
          amount: snapshot.totalAmount,
          currency: snapshot.currency,
        },
      })
      return redirectWithMessage(request, redirectTo, 'notice', 'money-desk-requested')
    }

    if (kind === 'money-desk-request') {
      const actionTypeValue = readString(formData, 'actionType').toUpperCase()
      if (!isMoneyDeskActionType(actionTypeValue)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      const grant = await getActiveMoneyDeskGrant(client, session, actionTypeValue)
      if (!grant) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')

      const targetType = readString(formData, 'targetType')
      const targetId = readString(formData, 'targetId')
      const orderId = readString(formData, 'orderId') || null
      const caseId = readString(formData, 'caseId') || null
      const amountRaw = readString(formData, 'amountMinor')
      let amount = amountRaw ? Number.parseInt(amountRaw, 10) : null
      let currency = readString(formData, 'currency').toUpperCase() || null
      const usdRaw = readString(formData, 'amountUsdEquivalent')
      let amountUsdEquivalent = usdRaw ? Number.parseInt(usdRaw, 10) : currency === 'USD' ? amount : null
      if (!targetType || !targetId || ((amount !== null) !== (currency !== null)) || (amount !== null && (!Number.isFinite(amount) || amount <= 0))) {
        return redirectWithMessage(request, redirectTo, 'error', 'money-desk-request-invalid')
      }

      let actionPayload: Record<string, unknown> = {
        orderId,
        advanceId: readString(formData, 'advanceId') || null,
        trancheId: readString(formData, 'trancheId') || (targetType === 'SETTLEMENT_TRANCHE' ? targetId : null),
        refundResolutionId: readString(formData, 'refundResolutionId') || (targetType === 'REFUND_RESOLUTION' ? targetId : null),
        note: readString(formData, 'reason'),
      }
      let reviewedIdempotencyKey = readString(formData, 'idempotencyKey') || undefined

      if (actionTypeValue === 'PAYOUT_RELEASE' && targetType === 'ORDER_RESIDUAL_SETTLEMENT') {
        if (!orderId || targetId !== orderId) {
          return redirectWithMessage(request, redirectTo, 'error', 'money-desk-request-invalid', 'Choose one closed order for residual settlement.')
        }
        const { data: derived, error: deriveError } = await client.rpc('derive_order_residual_settlement', {
          p_order_id: orderId,
        })
        if (deriveError || !derived || typeof derived !== 'object' || Array.isArray(derived)) {
          return redirectWithMessage(
            request,
            redirectTo,
            'error',
            'money-desk-request-invalid',
            deriveError?.message ?? 'The residual settlement could not be derived.',
          )
        }
        const snapshot = derived as Record<string, unknown>
        const derivedAmount = Number(snapshot.residualTailorEntitlement)
        const derivedCurrency = typeof snapshot.currency === 'string' ? snapshot.currency.toUpperCase() : ''
        if (!Number.isInteger(derivedAmount) || derivedAmount <= 0 || !derivedCurrency) {
          return redirectWithMessage(request, redirectTo, 'error', 'money-desk-request-invalid', 'The derived residual settlement is invalid.')
        }
        amount = derivedAmount
        currency = derivedCurrency
        amountUsdEquivalent = derivedCurrency === 'USD' ? derivedAmount : null
        actionPayload = {
          ...snapshot,
          note: readString(formData, 'reason'),
        }
        reviewedIdempotencyKey = `order-residual-settlement:${orderId}:${String(snapshot.sourcePaymentId ?? '')}:${String(snapshot.refundResolutionId ?? '')}`
      }

      if (actionTypeValue === 'PAYOUT_DESTINATION_CHANGE') {
        if (targetType === 'PAYOUT_CHANGE_REQUEST') {
          const { data: payoutChangeRequest, error: payoutChangeRequestError } = await client
            .from('payout_change_requests')
            .select('id,status,tailor_user_id,tailor_profile_id,requested_destination,metadata')
            .eq('id', targetId)
            .maybeSingle()
          if (payoutChangeRequestError || !payoutChangeRequest?.id || payoutChangeRequest.status !== 'PENDING') {
            return redirectWithMessage(
              request,
              redirectTo,
              'error',
              'payout-change-review-unavailable',
              payoutChangeRequestError?.message ?? 'The payout destination request is no longer pending review.',
            )
          }
          const lifecycle = payoutChangeRequest.metadata && typeof payoutChangeRequest.metadata === 'object' && !Array.isArray(payoutChangeRequest.metadata)
            ? String((payoutChangeRequest.metadata as Record<string, unknown>).lifecycle_state ?? '')
            : ''
          const confirmation = payoutChangeRequest.metadata && typeof payoutChangeRequest.metadata === 'object' && !Array.isArray(payoutChangeRequest.metadata)
            ? String((payoutChangeRequest.metadata as Record<string, unknown>).confirmation_status ?? '')
            : ''
          if (lifecycle !== 'OPS_REVIEW' || confirmation !== 'CONFIRMED') {
            return redirectWithMessage(request, redirectTo, 'error', 'payout-change-review-unavailable', 'The tailor must confirm this request before it can enter independent Ops review.')
          }
          const requestedDestination = payoutChangeRequest.requested_destination
          const requestedDestinationRecord = requestedDestination && typeof requestedDestination === 'object' && !Array.isArray(requestedDestination)
            ? requestedDestination as Record<string, unknown>
            : {}
          const provider = typeof requestedDestinationRecord.payout_provider === 'string'
            ? requestedDestinationRecord.payout_provider.toUpperCase()
            : null
          const requestedCurrency = typeof requestedDestinationRecord.payout_currency === 'string'
            ? requestedDestinationRecord.payout_currency.toUpperCase()
            : null
          actionPayload = {
            payoutChangeRequestId: payoutChangeRequest.id,
            tailorUserId: payoutChangeRequest.tailor_user_id,
            tailorProfileId: payoutChangeRequest.tailor_profile_id,
            provider,
            requestedCurrency,
            note: readString(formData, 'reason'),
          }
          reviewedIdempotencyKey = `payout-change-request:${payoutChangeRequest.id}`
        } else if (targetType !== 'ORDER_PAYOUT_FAILURE' || !orderId) {
          return redirectWithMessage(request, redirectTo, 'error', 'money-desk-request-invalid')
        } else {
          const { data: failedPayout, error: failedPayoutError } = await client.from('payouts')
          .select('id,order_id,amount,currency,provider,status')
          .eq('id', targetId).eq('order_id', orderId).maybeSingle()
          const { data: order, error: orderError } = await client.from('orders')
          .select('id,tailor_id,escrow_released,tailor_paystack_recipient_code_locked,tailor_stripe_connect_account_id_locked')
          .eq('id', orderId).maybeSingle()
          if (failedPayoutError || orderError || failedPayout?.status !== 'FAILED' || !order?.id || order.escrow_released) {
            return redirectWithMessage(request, redirectTo, 'error', 'payout-destination-recovery-unavailable', failedPayoutError?.message ?? orderError?.message)
          }
          const { data: profile, error: profileError } = await client.from('tailor_profiles')
          .select('id,payout_provider,payout_currency,payout_account_verified,payout_reverification_required,paystack_recipient_code,stripe_connect_account_id')
          .eq('user_id', order.tailor_id).maybeSingle()
          const provider = String(failedPayout.provider ?? '').toUpperCase()
          const previousDestination = provider === 'PAYSTACK'
          ? order.tailor_paystack_recipient_code_locked
          : provider === 'STRIPE' ? order.tailor_stripe_connect_account_id_locked : null
          const replacementDestination = provider === 'PAYSTACK'
          ? profile?.paystack_recipient_code
          : provider === 'STRIPE' ? profile?.stripe_connect_account_id : null
          if (
            profileError
            || !profile?.id
            || !profile.payout_account_verified
            || profile.payout_reverification_required
            || profile.payout_provider !== provider
            || profile.payout_currency !== failedPayout.currency
            || !replacementDestination
            || replacementDestination === previousDestination
          ) {
            return redirectWithMessage(
              request,
              redirectTo,
              'error',
              'payout-destination-recovery-unavailable',
              profileError?.message ?? 'The tailor must finish and verify a different payout destination before Ops can prepare this recovery.',
            )
          }
          amount = failedPayout.amount
          currency = failedPayout.currency
          amountUsdEquivalent = currency === 'USD' ? amount : null
          const previousDestinationFingerprint = payoutDestinationFingerprint(provider, previousDestination)
          const replacementDestinationFingerprint = payoutDestinationFingerprint(provider, replacementDestination)
          actionPayload = {
            orderId,
            failedPayoutId: failedPayout.id,
            provider,
            previousDestinationFingerprint,
            replacementDestinationFingerprint,
            note: readString(formData, 'reason'),
          }
          reviewedIdempotencyKey = `payout-destination:${failedPayout.id}:${replacementDestinationFingerprint}`
        }
      }

      const submittedMoneyRequest = await submitMoneyDeskRequest(client, session, grant, {
        actionType: actionTypeValue,
        targetType,
        targetId,
        orderId,
        caseId,
        amount,
        currency,
        amountUsdEquivalent,
        usdEquivalentSource: amountUsdEquivalent !== null ? readString(formData, 'usdEquivalentSource') || (currency === 'USD' ? 'NATIVE_USD' : null) : null,
        reason: readString(formData, 'reason'),
        actionPayload,
        idempotencyKey: reviewedIdempotencyKey,
      })
      if (actionTypeValue === 'CUSTOMER_REFUND' && targetType === 'REFUND_RESOLUTION') {
        const requestId = typeof submittedMoneyRequest.requestId === 'string' ? submittedMoneyRequest.requestId : null
        await client.from('order_refund_resolutions').update({ status: 'APPROVAL_PENDING', money_desk_request_id: requestId, updated_at: new Date().toISOString() }).eq('id', targetId).eq('status', 'MONEY_DESK_REQUIRED')
      }
      if (actionTypeValue === 'MATERIAL_ADVANCE_RELEASE' && targetType === 'ORDER_MATERIAL_ADVANCE') {
        const requestId = typeof submittedMoneyRequest.requestId === 'string' ? submittedMoneyRequest.requestId : null
        if (!requestId) throw new Error('Money Desk request was created without a request ID.')
        const { data: materialAdvance, error: materialAdvanceError } = await client.from('order_material_advances')
          .select('funding_source').eq('id', targetId).maybeSingle()
        if (materialAdvanceError || !materialAdvance) throw new Error(materialAdvanceError?.message ?? 'Material advance was not found.')
        if (materialAdvance.funding_source === 'FUNDED_FABRIC_ALLOWANCE') {
          const { error: linkError } = await client.rpc('link_funded_fabric_money_desk_request', {
            p_advance_id: targetId,
            p_money_desk_request_id: requestId,
          })
          if (linkError) throw new Error(linkError.message)
        }
      }
      return redirectWithMessage(request, redirectTo, 'notice', 'money-desk-requested')
    }

    if (kind === 'money-desk-decision') {
      const requestId = readString(formData, 'requestId')
      const decision = readString(formData, 'decision').toUpperCase()
      if (!requestId || (decision !== 'APPROVE' && decision !== 'REJECT')) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      const { data: moneyRequest, error: moneyRequestError } = await client
        .from('money_desk_requests')
        .select('action_type,target_type,target_id')
        .eq('id', requestId)
        .maybeSingle()
      if (moneyRequestError || !moneyRequest?.action_type || !isMoneyDeskActionType(moneyRequest.action_type)) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }
      const grant = await getActiveMoneyDeskGrant(client, session, moneyRequest.action_type)
      if (!grant) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')
      await decideMoneyDeskRequest(client, session, grant, {
        requestId,
        decision,
        reason: readString(formData, 'reason'),
      })
      if (decision === 'REJECT' && moneyRequest.action_type === 'MATERIAL_ADVANCE_RELEASE' && moneyRequest.target_type === 'ORDER_MATERIAL_ADVANCE') {
        const recorded = await triggerMaterialAdvanceOpsAction({
          action: 'record-release-rejection',
          advanceId: moneyRequest.target_id,
          moneyDeskRequestId: requestId,
          actorRef: session.email ?? session.subject,
          note: readString(formData, 'reason') || undefined,
        })
        if (!recorded.ok) return redirectWithMessage(request, redirectTo, 'error', 'conflict', recorded.error)
      }
      return redirectWithMessage(request, redirectTo, 'notice', decision === 'APPROVE' ? 'money-desk-approved' : 'money-desk-rejected')
    }

    if (kind === 'money-desk-execution') {
      const requestId = readString(formData, 'requestId')
      const { data: moneyRequest, error: moneyRequestError } = await client
        .from('money_desk_requests')
        .select('id, action_type, target_type, target_id, order_id, amount, currency, reason, action_payload')
        .eq('id', requestId)
        .maybeSingle()
      if (moneyRequestError || !moneyRequest?.id || !isMoneyDeskActionType(moneyRequest.action_type)) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }
      const grant = await getActiveMoneyDeskGrant(client, session, moneyRequest.action_type)
      if (!grant) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')
      const execution = await beginMoneyDeskExecution(
        client,
        session,
        grant,
        requestId,
        readString(formData, 'idempotencyKey') || `money-desk:${requestId}:${crypto.randomUUID()}`,
      )
      const attemptId = typeof execution.attemptId === 'string' ? execution.attemptId : null
      if (!attemptId) throw new Error('Money Desk execution attempt was not created.')
      const actionPayload = moneyRequest.action_payload && typeof moneyRequest.action_payload === 'object'
        ? moneyRequest.action_payload as Record<string, unknown>
        : {}
      let executionResult: { ok: boolean; pending?: boolean; error?: string; providerReference?: string | null }
      if (moneyRequest.action_type === 'PAYOUT_RELEASE') {
        const trancheId = typeof actionPayload.trancheId === 'string' && actionPayload.trancheId ? actionPayload.trancheId : null
        executionResult = moneyRequest.target_type === 'CONSULTATION_BOOKING'
          ? await triggerConsultationEarningRelease(moneyRequest.target_id)
          : trancheId
          ? await triggerSettlementTrancheRelease(trancheId)
          : await triggerOrderPayoutRelease(
            moneyRequest.order_id || moneyRequest.target_id,
            moneyRequest.target_type === 'ORDER_RESIDUAL_SETTLEMENT' ? moneyRequest.id : null,
          )
      } else if (moneyRequest.action_type === 'TIP_PAYOUT') {
        executionResult = await triggerTipPayout(moneyRequest.target_id)
      } else if (moneyRequest.action_type === 'MATERIAL_ADVANCE_RELEASE') {
        const advanceId = typeof actionPayload.advanceId === 'string' && actionPayload.advanceId ? actionPayload.advanceId : moneyRequest.target_id
        const note = typeof actionPayload.note === 'string' ? actionPayload.note : null
        executionResult = await triggerMaterialAdvanceRelease(advanceId, moneyRequest.id, note)
      } else if (moneyRequest.action_type === 'CUSTOMER_REFUND') {
        if (moneyRequest.target_type === 'CONSULTATION_BOOKING') {
          if (!moneyRequest.order_id || !moneyRequest.amount) {
            executionResult = { ok: false, error: 'The consultation refund is missing its approved order or amount snapshot.' }
          } else {
            const refund = await refundOrderPaymentsForReview(moneyRequest.order_id, {
              reason: typeof actionPayload.note === 'string' ? actionPayload.note : moneyRequest.reason,
              amount: moneyRequest.amount,
              allowedPhases: ['CONSULTATION'],
            })
            if (refund.ok && !refund.pending) {
              const { error: bookingUpdateError } = await client.from('consultation_bookings').update({
                payment_status: 'REFUNDED', settlement_status: 'REFUNDED', refunded_amount: moneyRequest.amount,
                settlement_outcome: 'CUSTOMER_REFUND_COMPLETED', settled_at: new Date().toISOString(),
                settlement_provider_reference: refund.providerReference, settlement_failure_reason: null,
              }).eq('id', moneyRequest.target_id).eq('settlement_status', 'REFUND_PENDING')
              executionResult = bookingUpdateError ? { ok: false, error: `Refund completed but consultation finalization failed: ${bookingUpdateError.message}` } : refund
            } else {
              executionResult = refund
            }
          }
        } else if (moneyRequest.target_type === 'ORDER_CANCELLATION') {
          const snapshot = await loadCancellationRefundSnapshot(client, moneyRequest.order_id || moneyRequest.target_id)
          const expectedSnapshotKey = typeof actionPayload.paymentSnapshotKey === 'string'
            ? actionPayload.paymentSnapshotKey
            : null
          const expectedClaims = Array.isArray(actionPayload.paymentClaims) ? actionPayload.paymentClaims : []
          const snapshotMatches = expectedSnapshotKey === snapshot.snapshotKey
            && expectedClaims.length === snapshot.claims.length
            && moneyRequest.amount === snapshot.totalAmount
            && moneyRequest.currency === snapshot.currency
          if (!snapshotMatches) {
            executionResult = {
              ok: false,
              error: 'The refundable payment exposure changed after approval. Prepare a new cancellation refund request.',
            }
          } else {
            const refund = await refundOrderPaymentsForReview(snapshot.order.id, {
              reason: typeof actionPayload.note === 'string' ? actionPayload.note : moneyRequest.reason,
              includeUnreleasedMaterialAdvances: snapshot.claims.some((claim) => claim.phase === 'MATERIAL_ADVANCE'),
            })
            if (!refund.ok) {
              executionResult = refund
            } else {
              const now = new Date().toISOString()
              const note = `Drapeon approved cancellation and refunded every captured, unreleased payment. ${typeof actionPayload.note === 'string' ? actionPayload.note : moneyRequest.reason}`
              const { error: terminalError } = await client.rpc('finalize_order_terminal', {
                p_order_id: snapshot.order.id,
                p_target_stage: 'REFUNDED',
                p_actor_id: null,
                p_actor_role: 'OPS',
                p_event: 'ops.order_cancellation_refund_completed',
                p_note: note,
                p_payload: {
                  money_desk_request_id: moneyRequest.id,
                  refunded_payment_count: snapshot.claims.length,
                  amount: snapshot.totalAmount,
                  currency: snapshot.currency,
                },
                p_expected_stages: ['IN_DISPUTE'],
                p_special_note: null,
                p_replace_special_note: false,
                p_clear_payment_session: true,
                p_reset_fulfillment_payment: true,
                p_release_ready_made_inventory: false,
              })
              if (terminalError) {
                const error = `Provider refunds completed but terminal finalization failed: ${terminalError.message}`
                await recordCancellationReconciliationFailure(client, {
                  orderId: snapshot.order.id,
                  orderReference: snapshot.order.reference ?? null,
                  moneyDeskRequestId: moneyRequest.id,
                  error,
                  performedBy: session.email ?? session.role,
                  performedRole: session.role.toUpperCase(),
                })
                executionResult = { ok: false, error }
              } else {
                const { error: disputeResolutionError } = await client.from('disputes').update({
                  status: 'RESOLVED_REFUNDED',
                  resolution: note,
                  resolved_at: now,
                  resolved_by: session.email,
                  updated_at: now,
                }).eq('id', snapshot.dispute.id).in('status', ['OPEN', 'UNDER_REVIEW'])
                if (disputeResolutionError) {
                  const error = `Order refund completed but dispute finalization failed: ${disputeResolutionError.message}`
                  await recordCancellationReconciliationFailure(client, {
                    orderId: snapshot.order.id,
                    orderReference: snapshot.order.reference ?? null,
                    moneyDeskRequestId: moneyRequest.id,
                    error,
                    performedBy: session.email ?? session.role,
                    performedRole: session.role.toUpperCase(),
                  })
                  executionResult = { ok: false, error }
                } else {
                  await resolveOrderLinkedOpsIssues({
                    client,
                    orderId: snapshot.order.id,
                    issueTypes: ['PRODUCTION_STALL', 'PAYOUT_BLOCKED', 'ORDER_REVIEW', 'REFUND_FAILED'],
                    performedBy: session.email ?? session.role,
                    performedRole: session.role.toUpperCase(),
                    actionTaken: 'ORDER_CANCELLATION_REFUND_COMPLETED',
                    reason: note,
                  })
                  executionResult = {
                    ok: true,
                    providerReference: refund.providerReference,
                  }
                }
              }
            }
          }
        } else if (moneyRequest.target_type === 'ORDER_MATERIAL_ADVANCE') {
          const { error: preparationError } = await client.rpc('prepare_material_unused_value_refund', {
            p_advance_id: moneyRequest.target_id,
            p_money_desk_request_id: moneyRequest.id,
            p_actor_email: session.email ?? session.subject,
          })
          if (preparationError || !moneyRequest.order_id || !moneyRequest.amount) {
            executionResult = { ok: false, error: preparationError?.message ?? 'The unused fabric value refund could not be prepared.' }
          } else {
            executionResult = await refundOrderPaymentsForReview(moneyRequest.order_id, {
              reason: typeof actionPayload.note === 'string' ? actionPayload.note : 'Refund unused approved fabric value',
              amount: moneyRequest.amount,
              materialAdvanceId: moneyRequest.target_id,
            })
          }
        } else {
          const refundResolutionId = typeof actionPayload.refundResolutionId === 'string' && actionPayload.refundResolutionId ? actionPayload.refundResolutionId : moneyRequest.target_id
          const { data: resolution, error: resolutionError } = await client.from('order_refund_resolutions')
            .select('id, order_id, amount, status').eq('id', refundResolutionId).maybeSingle()
          if (resolutionError || !resolution?.id || !resolution.order_id) {
            executionResult = { ok: false, error: 'The approved refund resolution could not be loaded.' }
          } else {
            await client.from('order_refund_resolutions').update({ status: 'APPROVED', money_desk_request_id: moneyRequest.id, updated_at: new Date().toISOString() }).eq('id', resolution.id).in('status', ['MONEY_DESK_REQUIRED','APPROVAL_PENDING','APPROVED','FAILED'])
            executionResult = await refundOrderPaymentsForReview(resolution.order_id, { reason: typeof actionPayload.note === 'string' ? actionPayload.note : 'Approved return resolution', amount: resolution.amount, refundResolutionId: resolution.id })
            if (!executionResult.ok) await client.from('order_refund_resolutions').update({ status: 'FAILED', failure_summary: executionResult.error ?? 'Refund adapter failed.', updated_at: new Date().toISOString() }).eq('id', resolution.id)
          }
        }
      } else if (moneyRequest.action_type === 'PAYOUT_DESTINATION_CHANGE') {
        if (moneyRequest.target_type === 'PAYOUT_CHANGE_REQUEST') {
          const { data: payoutChangeRequest, error: payoutChangeRequestError } = await client
            .from('payout_change_requests')
            .select('id,status,tailor_user_id,metadata')
            .eq('id', moneyRequest.target_id)
            .maybeSingle()
          if (payoutChangeRequestError || !payoutChangeRequest?.id || payoutChangeRequest.status !== 'PENDING') {
            executionResult = {
              ok: false,
              error: payoutChangeRequestError?.message ?? 'The payout destination request is no longer pending review.',
            }
          } else {
            const metadata = payoutChangeRequest.metadata && typeof payoutChangeRequest.metadata === 'object' && !Array.isArray(payoutChangeRequest.metadata)
              ? payoutChangeRequest.metadata as Record<string, unknown>
              : {}
            if (metadata.lifecycle_state !== 'OPS_REVIEW' || metadata.confirmation_status !== 'CONFIRMED') {
              executionResult = { ok: false, error: 'The tailor must confirm this payout request before Ops can activate it.' }
            } else {
            const { error: decisionError } = await client.rpc('ops_decide_payout_change_request', {
              p_request_id: payoutChangeRequest.id,
              p_decision: 'APPROVE',
              p_rejection_code: null,
              p_reason: moneyRequest.reason,
              p_reviewed_by: session.email ?? session.role,
            })
            if (decisionError) {
              executionResult = { ok: false, error: decisionError.message }
            } else {
              await syncEntityOpsIssue({
                client,
                issueType: 'PAYOUT_BLOCKED',
                relatedEntityType: 'payout_change_request',
                relatedEntityId: payoutChangeRequest.id,
                status: 'RESOLVED',
                performedBy: session.email ?? session.role,
                performedRole: session.role.toUpperCase(),
                actionTaken: 'PAYOUT_CHANGE_APPROVED_AFTER_INDEPENDENT_REVIEW',
                reason: moneyRequest.reason,
              })
              await enqueuePayoutChangePush(client, {
                requestId: payoutChangeRequest.id,
                tailorUserId: payoutChangeRequest.tailor_user_id,
                outcome: 'APPROVED',
              })
              executionResult = { ok: true }
            }
            }
          }
        } else if (moneyRequest.target_type !== 'ORDER_PAYOUT_FAILURE' || !moneyRequest.order_id) {
          executionResult = { ok: false, error: 'The approved request is not linked to an order payout failure.' }
        } else {
          const { data: correction, error: correctionError } = await client.rpc('apply_reviewed_payout_destination_correction', {
            p_money_desk_request_id: moneyRequest.id,
            p_actor_email: session.email ?? session.subject,
            p_actor_role: session.role.toUpperCase(),
          })
          const correctionData = correction && typeof correction === 'object' && !Array.isArray(correction)
            ? correction as Record<string, unknown>
            : null
          if (correctionError || typeof correctionData?.correctionId !== 'string') {
            executionResult = { ok: false, error: correctionError?.message ?? 'The reviewed payout destination correction could not be applied.' }
          } else {
            executionResult = await triggerOrderPayoutRelease(moneyRequest.order_id, moneyRequest.id)
            if (executionResult.ok) {
              await resolveOrderLinkedOpsIssues({
                client,
                orderId: moneyRequest.order_id,
                issueTypes: ['PAYOUT_FAILED'],
                performedBy: session.email ?? session.role,
                performedRole: session.role.toUpperCase(),
                actionTaken: 'PAYOUT_DESTINATION_CORRECTED_AND_RETRIED',
                reason: moneyRequest.reason,
              })
            }
          }
        }
      } else if (moneyRequest.action_type === 'POST_RELEASE_RECOVERY') {
        executionResult = moneyRequest.target_type === 'STRIPE_TRANSFER_REVERSAL'
          ? await triggerStripeTransferReversal(moneyRequest.id)
          : { ok: false, error: 'This post-release recovery is not linked to the Stripe transfer-reversal adapter.' }
      } else {
        executionResult = { ok: false, error: 'This action requires its dedicated reviewed execution adapter before money can move.' }
      }
      if (!executionResult.pending) {
        await completeMoneyDeskExecution(client, {
          attemptId,
          outcome: executionResult.ok ? 'SUCCEEDED' : ['PAYOUT_RELEASE','TIP_PAYOUT','MATERIAL_ADVANCE_RELEASE','CUSTOMER_REFUND','PAYOUT_DESTINATION_CHANGE','POST_RELEASE_RECOVERY'].includes(moneyRequest.action_type) ? 'FAILED' : 'BLOCKED',
          failureCode: executionResult.ok ? null : 'EXECUTION_ADAPTER_BLOCKED',
          failureSummary: executionResult.error ?? null,
          providerReference: executionResult.providerReference ?? null,
        })
        if (executionResult.ok && moneyRequest.action_type === 'CUSTOMER_REFUND' && moneyRequest.target_type === 'ORDER_MATERIAL_ADVANCE') {
          const finalization = await triggerMaterialAdvanceOpsAction({
            action: 'finalize-unused-refund',
            advanceId: moneyRequest.target_id,
            moneyDeskRequestId: moneyRequest.id,
            actorRef: session.email ?? session.subject,
          })
          if (!finalization.ok) throw new Error(`Refund succeeded but material reconciliation could not be finalized: ${finalization.error}`)
        }
      }
      if (!executionResult.ok) {
        console.error('money_desk_execution_failed', {
          requestId,
          attemptId,
          actionType: moneyRequest.action_type,
          error: executionResult.error,
        })
        return redirectWithMessage(request, redirectTo, 'error', 'money-desk-execution-failed', executionResult.error)
      }
      if (executionResult.pending) {
        return redirectWithMessage(request, redirectTo, 'notice', 'money-desk-processing')
      }
      return redirectWithMessage(request, redirectTo, 'notice', 'money-desk-executed')
    }

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

      const { data: changed, error } = await client
        .from('disputes')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', disputeId)
        .neq('status', status)
        .select('id')
        .maybeSingle()

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      if (changed?.id) {
        await client.from('audit_logs').insert({
          actor_role: 'OPS',
          event: 'ops.dispute_status_updated',
          severity: 'info',
          payload: { dispute_id: disputeId, status },
        })
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'dispute-saved')
    }

    if (kind === 'dispute-resolution') {
      const disputeId = readString(formData, 'disputeId')
      const outcome = readString(formData, 'outcome').toUpperCase()
      const resolution = readString(formData, 'resolution')

      if (!disputeId || !DISPUTE_OUTCOMES.has(outcome)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      void resolution
      return redirectWithMessage(request, redirectTo, 'error', 'money-desk-required')
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
      const rejectionCode = readString(formData, 'rejectionCode').toUpperCase()

      if (!tailorUserId || !VERIFICATION_DECISIONS.has(decision)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const result = await submitVerificationDecision({
        tailorUserId,
        decision,
        reason: reason.length > 0 ? reason : null,
        rejectionCode: rejectionCode.length > 0 ? rejectionCode : null,
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

    if (kind === 'profile-change-decision') {
      const requestId = readString(formData, 'requestId')
      const decision = readString(formData, 'decision').toUpperCase()
      const reason = readString(formData, 'reason') || readString(formData, 'note')
      const rejectionCode = readString(formData, 'rejectionCode').toUpperCase()

      if (!requestId || !VERIFICATION_DECISIONS.has(decision)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client.rpc('ops_decide_profile_change_request', {
        p_request_id: requestId,
        p_decision: decision,
        p_field_statuses: {},
        p_rejection_code: rejectionCode.length > 0 ? rejectionCode : null,
        p_reason: reason.length > 0 ? reason : null,
        p_reviewed_by: session.email ?? session.role,
      })

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', isConflictError(error) ? 'conflict' : 'save-failed', error.message)
      }

      return redirectWithMessage(request, redirectTo, 'notice', decision === 'APPROVE' ? 'profile-change-approved' : 'profile-change-rejected')
    }

    if (kind === 'payout-change-decision') {
      const requestId = readString(formData, 'requestId')
      const decision = readString(formData, 'decision').toUpperCase()
      const reason = readString(formData, 'reason') || readString(formData, 'note')
      const rejectionCode = readString(formData, 'rejectionCode').toUpperCase()

      if (!requestId || !VERIFICATION_DECISIONS.has(decision)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const performedBy = session.email ?? session.role
      const performedRole = session.role.toUpperCase()
      const { data: payoutRequest, error: payoutRequestError } = await client
        .from('payout_change_requests')
        .select('id, status, tailor_user_id, metadata')
        .eq('id', requestId)
        .maybeSingle()

      if (payoutRequestError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed', payoutRequestError.message)
      }

      if (!payoutRequest?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict', 'Payout change request was not found.')
      }

      if (payoutRequest.status !== 'PENDING') {
        await syncEntityOpsIssue({
          client,
          issueType: 'PAYOUT_BLOCKED',
          relatedEntityType: 'payout_change_request',
          relatedEntityId: requestId,
          status: 'RESOLVED',
          performedBy,
          performedRole,
          actionTaken: 'PAYOUT_CHANGE_ALREADY_DECIDED',
          reason: `Request status was already ${payoutRequest.status}.`,
        })
        return redirectWithMessage(request, redirectTo, 'notice', 'payout-change-already-decided')
      }
      const payoutMetadata = payoutRequest.metadata && typeof payoutRequest.metadata === 'object' && !Array.isArray(payoutRequest.metadata)
        ? payoutRequest.metadata as Record<string, unknown>
        : {}
      if (payoutMetadata.lifecycle_state !== 'OPS_REVIEW' || payoutMetadata.confirmation_status !== 'CONFIRMED') {
        return redirectWithMessage(request, redirectTo, 'error', 'payout-change-review-unavailable', 'The tailor must confirm this request before Ops can decide it.')
      }

      const { error } = await client.rpc('ops_decide_payout_change_request', {
        p_request_id: requestId,
        p_decision: decision,
        p_rejection_code: rejectionCode.length > 0 ? rejectionCode : null,
        p_reason: reason.length > 0 ? reason : null,
        p_reviewed_by: performedBy,
      })

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', isConflictError(error) ? 'conflict' : 'save-failed', error.message)
      }

      await syncEntityOpsIssue({
        client,
        issueType: 'PAYOUT_BLOCKED',
        relatedEntityType: 'payout_change_request',
        relatedEntityId: requestId,
        status: 'RESOLVED',
        performedBy,
        performedRole,
        actionTaken: decision === 'APPROVE' ? 'PAYOUT_CHANGE_APPROVED' : 'PAYOUT_CHANGE_REJECTED',
        reason: reason.length > 0 ? reason : null,
      })

      await enqueuePayoutChangePush(client, {
        requestId,
        tailorUserId: payoutRequest.tailor_user_id,
        outcome: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      })

      return redirectWithMessage(request, redirectTo, 'notice', decision === 'APPROVE' ? 'payout-change-approved' : 'payout-change-rejected')
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

      const reviewMeta = parseOrderSupportMeta(existingOrder.special_note)
      const review =
        reviewType === 'CANCELLATION'
          ? reviewMeta.cancellationReview
          : reviewMeta.deliveryReview

      if (review?.status !== 'OPEN') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const reviewPausedOrder =
        reviewType === 'CANCELLATION'
        || review.riskAction === 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED'
      if (reviewPausedOrder && existingOrder.stage !== 'IN_DISPUTE') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const now = new Date().toISOString()
      const restoreStage = reviewPausedOrder
        ? restoreStageForReview(
            reviewType === 'CANCELLATION' ? 'CANCELLATION' : 'DELIVERY',
            review.requestedFromStage,
          )
        : existingOrder.stage
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
        const stageNote = (
          reviewPausedOrder
            ? `Drapeon reviewed the ${reviewLabel}. The order will continue from ${restoreStage}.`
            : `Drapeon reviewed the ${reviewLabel}. The order remains ${restoreStage}.`
        ) + (resolution ? ` Note: ${resolution}` : '')

        const { error: updateError } = await client
          .from('orders')
          .update({
            ...(reviewPausedOrder ? { stage: nextStage, stage_updated_at: now } : {}),
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

        if (reviewPausedOrder) {
          const { error: settlementRefreshError } = await client.rpc('refresh_order_settlement', {
            p_order_id: orderId,
          })
          if (settlementRefreshError) {
            await client.from('ops_issues').upsert({
              issue_type: 'PAYOUT_BLOCKED',
              severity: 'HIGH',
              status: 'OPEN',
              source: 'ops-order-review-resolution',
              order_id: orderId,
              stage: restoreStage,
              title: 'Settlement did not resume after delivery review',
              description: `Settlement stayed frozen after the shipping or delivery review was resolved. ${settlementRefreshError.message}`,
              recommended_action: 'Inspect the settlement plan and open financial cases, then resume only the eligible unreleased tranches.',
              dedupe_key: `settlement-unfreeze:${orderId}`,
              metadata: {
                review_type: reviewType,
                restored_stage: restoreStage,
                error: settlementRefreshError.message,
              },
              resolved_at: null,
              last_seen_at: now,
            }, { onConflict: 'dedupe_key' })
            await client.from('audit_logs').insert({
              actor_role: 'OPS',
              order_id: orderId,
              event: 'ops.order_review_settlement_unfreeze_failed',
              severity: 'error',
              payload: {
                review_type: reviewType,
                restored_stage: restoreStage,
                error: settlementRefreshError.message,
              },
            })
          }
        }
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

    if (kind === 'reviewed-partial-refund-outcome') {
      if (!isNamedOpsWorkforceSession(session) || !session.email) {
        return redirectWithMessage(request, redirectTo, 'error', 'workforce-login-required')
      }

      const resolutionId = readString(formData, 'resolutionId')
      const issueId = readString(formData, 'issueId')
      const orderId = readString(formData, 'orderId')
      const outcome = readString(formData, 'outcome').toUpperCase()
      const reason = readString(formData, 'reason')
      if (!resolutionId || !issueId || !orderId || !['CONTINUE_ORDER', 'CLOSE_ORDER'].includes(outcome) || reason.trim().length < 12) {
        return redirectWithMessage(request, redirectTo, 'error', 'reviewed-partial-refund-outcome-invalid')
      }

      const { data: resolution, error: resolutionError } = await client
        .from('order_refund_resolutions')
        .select('id,order_id,status,amount,currency,provider_reference,order_outcome,outcome_applied_at,reviewed_order_outcome,reviewed_outcome_applied_at')
        .eq('id', resolutionId)
        .maybeSingle()
      if (resolutionError || !resolution?.id || resolution.order_id !== orderId) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict', resolutionError?.message)
      }

      const { data: order, error: orderError } = await client
        .from('orders')
        .select('id,reference,stage,customer_id,tailor_id,order_kind,garment_type,item_title,item_size,delivery_method,currency')
        .eq('id', orderId)
        .maybeSingle()
      if (orderError || !order?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict', orderError?.message)
      }

      const { data: outcomeData, error: outcomeError } = await client.rpc('apply_reviewed_post_refund_order_outcome', {
        p_resolution_id: resolutionId,
        p_order_outcome: outcome,
        p_reason: reason.trim(),
        p_actor_email: session.email,
        p_provider_reference: resolution.provider_reference,
      })
      if (outcomeError) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict', outcomeError.message)
      }

      const { data: linkedIssues, error: linkedIssuesError } = await client
        .from('ops_issues')
        .select('id')
        .eq('order_id', orderId)
        .contains('metadata', { refund_resolution_id: resolutionId })

      const linkedIssueIds = new Set<string>([
        issueId,
        ...((linkedIssues ?? [])
          .map((linkedIssue) => linkedIssue.id)
          .filter((linkedIssueId): linkedIssueId is string => typeof linkedIssueId === 'string' && linkedIssueId.length > 0)),
      ])
      for (const linkedIssueId of linkedIssueIds) {
        await syncOpsIssueById({
          client,
          issueId: linkedIssueId,
          status: 'RESOLVED',
          performedBy: session.email,
          performedRole: session.role.toUpperCase(),
          actionTaken: outcome === 'CLOSE_ORDER' ? 'PARTIAL_REFUND_ORDER_CLOSED' : 'PARTIAL_REFUND_ORDER_RESUMED',
          reason: reason.trim(),
        })
      }

      if (linkedIssuesError) {
        await client.from('audit_logs').insert({
          actor_role: 'OPS',
          order_id: orderId,
          event: 'ops.reviewed_partial_refund_issue_cleanup_incomplete',
          severity: 'warn',
          payload: {
            issue_id: issueId,
            refund_resolution_id: resolutionId,
            error: linkedIssuesError.message,
          },
        })
      }

      await client.from('audit_logs').insert({
        actor_role: session.role.toUpperCase(),
        order_id: orderId,
        event: outcome === 'CLOSE_ORDER'
          ? 'ops.reviewed_partial_refund_order_closed'
          : 'ops.reviewed_partial_refund_order_resumed',
        severity: 'info',
        payload: {
          actor_email: session.email,
          issue_id: issueId,
          linked_issue_ids: [...linkedIssueIds],
          refund_resolution_id: resolutionId,
          refund_amount: resolution.amount,
          currency: resolution.currency,
          provider_reference: resolution.provider_reference,
          reason: reason.trim(),
          outcome_result: readRpcRecord(outcomeData),
          additional_money_moved: false,
        },
      })

      const closed = outcome === 'CLOSE_ORDER'
      const eventType = closed ? 'order.partial_refund_closed' : 'order.partial_refund_resumed'
      const subject = closed ? 'Your order review is complete' : 'Your order is continuing'
      const headline = closed ? 'Order closed after partial refund' : 'Order resumed after partial refund'
      const body = closed
        ? `${formatMinorMoney(Number(resolution.amount), resolution.currency)} was refunded and remains final. Drapeon has now closed this order after review.`
        : `${formatMinorMoney(Number(resolution.amount), resolution.currency)} was refunded and remains final. Drapeon has returned this order to its active production stage.`
      const recipients = [
        order.customer_id ? { userId: order.customer_id, audience: 'CUSTOMER' } : null,
        order.tailor_id ? { userId: order.tailor_id, audience: 'TAILOR' } : null,
      ].filter((recipient): recipient is { userId: string; audience: string } => !!recipient)

      for (const recipient of recipients) {
        const { error: deliveryError } = await client.rpc('enqueue_domain_event', {
          p_event_type: eventType,
          p_aggregate_type: 'order',
          p_idempotency_key: `reviewed-partial-refund-outcome:${resolutionId}:${outcome}:${recipient.audience.toLowerCase()}`,
          p_payload: {
            userId: recipient.userId,
            recipientUserId: recipient.userId,
            audience: recipient.audience,
            order,
            subject,
            headline,
            body,
            ctaLabel: 'View order outcome',
            webPath: `/account/orders/${orderId}`,
            appUrl: `drape://orders/${orderId}`,
            details: [
              { label: 'Refund', value: formatMinorMoney(Number(resolution.amount), resolution.currency) },
              { label: 'Outcome', value: closed ? 'Order closed' : 'Order continuing' },
            ],
            notification: {
              title: headline,
              body,
              preferenceKey: 'orderUpdates',
              data: { destination: 'ORDER_DETAIL', orderId, refundResolutionId: resolutionId },
            },
          },
          p_aggregate_id: orderId,
          p_actor_id: null,
          p_actor_role: 'OPS',
          p_order_id: orderId,
          p_metadata: { issueId, resolutionId, reviewedOrderOutcome: outcome },
          p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'],
          p_priority: 30,
          p_max_attempts: 6,
          p_run_at: new Date().toISOString(),
        })
        if (deliveryError) {
          await client.from('audit_logs').insert({
            actor_role: 'OPS',
            order_id: orderId,
            event: 'ops.reviewed_partial_refund_notification_enqueue_failed',
            severity: 'error',
            payload: { issue_id: issueId, resolution_id: resolutionId, audience: recipient.audience, error: deliveryError.message },
          })
        }
      }

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        closed ? 'partial-refund-order-closed' : 'partial-refund-order-resumed',
      )
    }

    if (kind === 'order-partial-refund') {
      const issueId = readString(formData, 'issueId')
      const orderId = readString(formData, 'orderId')
      const reasonCode = readString(formData, 'reasonCode').toUpperCase()
      const decisionBasis = readString(formData, 'decisionBasis').toUpperCase()
      const summary = readString(formData, 'summary')
      const evidenceSource = readString(formData, 'evidenceSource').toUpperCase()
      const externalReference = readString(formData, 'externalReference')
      const evidenceVisibility = readString(formData, 'evidenceVisibility').toUpperCase() || 'OPS_ONLY'
      const orderOutcome = readString(formData, 'orderOutcome').toUpperCase()
      const sourceReceivedAtRaw = readString(formData, 'sourceReceivedAt')
      const sourceReceivedAt = sourceReceivedAtRaw ? new Date(sourceReceivedAtRaw) : new Date()
      const idempotencyKey = readString(formData, 'idempotencyKey') || `ops-partial-refund:${issueId}:${crypto.randomUUID()}`
      const evidenceFile = readOptionalFile(formData, 'evidenceFile')
      const amountMinor = parseMajorAmountToMinor(readString(formData, 'amount'))
      const restoration = {
        tailorWorkAmount: parseOptionalMajorAmountToMinor(readString(formData, 'tailorWorkAmount')),
        platformFeeAmount: parseOptionalMajorAmountToMinor(readString(formData, 'platformFeeAmount')),
        taxAmount: parseOptionalMajorAmountToMinor(readString(formData, 'taxAmount')),
        fulfillmentAmount: parseOptionalMajorAmountToMinor(readString(formData, 'fulfillmentAmount')),
        consultationAmount: parseOptionalMajorAmountToMinor(readString(formData, 'consultationAmount')),
        promotionAmount: parseOptionalMajorAmountToMinor(readString(formData, 'promotionAmount')),
        drapeonFundedAmount: parseOptionalMajorAmountToMinor(readString(formData, 'drapeonFundedAmount')),
        releasedTailorRecoveryAmount: parseOptionalMajorAmountToMinor(readString(formData, 'releasedTailorRecoveryAmount')),
      }
      const cashRestorationTotal = restoration.tailorWorkAmount
        + restoration.platformFeeAmount
        + restoration.taxAmount
        + restoration.fulfillmentAmount
        + restoration.consultationAmount

      if (
        !issueId
        || !orderId
        || !OPS_PARTIAL_REFUND_REASON_SET.has(reasonCode)
        || !OPS_PARTIAL_REFUND_DECISION_BASIS_SET.has(decisionBasis)
        || !OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_SET.has(evidenceSource)
        || !['OPS_ONLY', 'PARTIES'].includes(evidenceVisibility)
        || !OPS_PARTIAL_REFUND_ORDER_OUTCOME_SET.has(orderOutcome)
        || summary.length < 12
        || externalReference.length < 3
        || !Number.isFinite(sourceReceivedAt.getTime())
        || sourceReceivedAt.getTime() > Date.now() + 5 * 60 * 1000
        || !Number.isSafeInteger(amountMinor)
        || amountMinor <= 0
        || Object.values(restoration).some((value) => !Number.isSafeInteger(value) || value < 0)
        || cashRestorationTotal !== amountMinor
        || restoration.releasedTailorRecoveryAmount > restoration.drapeonFundedAmount
      ) {
        return redirectWithMessage(request, redirectTo, 'error', 'partial-refund-invalid')
      }

      const evidenceExtension = evidenceFile ? privateEvidenceExtension(evidenceFile.type) : null
      if (
        evidenceFile
        && (
          evidenceFile.size > 8 * 1024 * 1024
          || !OPS_PARTIAL_REFUND_EVIDENCE_MIME_TYPES.has(evidenceFile.type)
          || !evidenceExtension
        )
      ) {
        return redirectWithMessage(request, redirectTo, 'error', 'partial-refund-invalid')
      }

      const grant = await getActiveMoneyDeskGrant(client, session, 'CUSTOMER_REFUND')
      if (!grant) return redirectWithMessage(request, redirectTo, 'error', 'money-desk-elevation-required')

      const { data: order, error: orderError } = await client
        .from('orders')
        .select('id, reference, stage, customer_id, tailor_id, order_kind, garment_type, item_title, item_size, delivery_method, currency')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !order?.id || order.stage !== 'IN_DISPUTE') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      let storageBucket: string | null = null
      let storageObjectPath: string | null = null
      let storageMimeType: string | null = null
      const { data: existingCase, error: existingCaseError } = await client
        .from('financial_cases')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (existingCaseError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed', existingCaseError.message)
      }
      if (existingCase?.id) {
        const { data: existingEvidence, error: existingEvidenceError } = await client
          .from('financial_case_evidence')
          .select('storage_bucket, storage_object_path, mime_type')
          .eq('case_id', existingCase.id)
          .eq('evidence_type', 'OPS_PARTIAL_REFUND_BASIS')
          .maybeSingle()
        if (existingEvidenceError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed', existingEvidenceError.message)
        }
        storageBucket = existingEvidence?.storage_bucket ?? null
        storageObjectPath = existingEvidence?.storage_object_path ?? null
        storageMimeType = existingEvidence?.mime_type ?? null
      } else if (evidenceFile && evidenceExtension) {
        storageBucket = 'commercial-evidence'
        storageObjectPath = `${orderId}/ops-refunds/${crypto.randomUUID()}.${evidenceExtension}`
        const { error: uploadError } = await client.storage
          .from(storageBucket)
          .upload(storageObjectPath, new Uint8Array(await evidenceFile.arrayBuffer()), {
            contentType: evidenceFile.type,
            upsert: false,
          })
        if (uploadError) {
          return redirectWithMessage(request, redirectTo, 'error', 'save-failed', uploadError.message)
        }
        storageMimeType = evidenceFile.type
      }

      const { data: preparedData, error: preparationError } = await client.rpc('prepare_ops_partial_refund_resolution', {
        p_order_id: orderId,
        p_ops_issue_id: issueId,
        p_actor_email: session.email,
        p_reason_code: reasonCode,
        p_decision_basis: decisionBasis,
        p_summary: summary,
        p_amount: amountMinor,
        p_currency: order.currency,
        p_tailor_work: restoration.tailorWorkAmount,
        p_platform_fee: restoration.platformFeeAmount,
        p_tax: restoration.taxAmount,
        p_fulfillment: restoration.fulfillmentAmount,
        p_consultation: restoration.consultationAmount,
        p_promotion: restoration.promotionAmount,
        p_drapeon_funded: restoration.drapeonFundedAmount,
        p_released_tailor_recovery: restoration.releasedTailorRecoveryAmount,
        p_evidence_source: evidenceSource,
        p_external_reference: externalReference,
        p_source_received_at: sourceReceivedAt.toISOString(),
        p_evidence_visibility: evidenceVisibility,
        p_storage_bucket: storageBucket,
        p_storage_object_path: storageObjectPath,
        p_mime_type: storageMimeType,
        p_idempotency_key: idempotencyKey,
      })
      if (preparationError) {
        if (!existingCase?.id && storageBucket && storageObjectPath) await client.storage.from(storageBucket).remove([storageObjectPath])
        return redirectWithMessage(request, redirectTo, 'error', 'conflict', preparationError.message)
      }

      const prepared = readRpcRecord(preparedData)
      const caseId = typeof prepared.caseId === 'string' ? prepared.caseId : null
      const resolutionId = typeof prepared.resolutionId === 'string' ? prepared.resolutionId : null
      const preparedAmount = typeof prepared.amount === 'number' ? prepared.amount : amountMinor
      const preparedCurrency = typeof prepared.currency === 'string' ? prepared.currency : order.currency
      if (!caseId || !resolutionId || !preparedCurrency) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed', 'The reviewed refund case did not return its protected identifiers.')
      }

      const { data: outcomeData, error: outcomeError } = await client.rpc('set_ops_partial_refund_order_outcome', {
        p_resolution_id: resolutionId,
        p_order_outcome: orderOutcome,
      })
      if (outcomeError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed', outcomeError.message)
      }
      const protectedOutcome = readRpcRecord(outcomeData)

      const submitted = await submitMoneyDeskRequest(client, session, grant, {
        actionType: 'CUSTOMER_REFUND',
        targetType: 'REFUND_RESOLUTION',
        targetId: resolutionId,
        orderId,
        caseId,
        amount: preparedAmount,
        currency: preparedCurrency,
        amountUsdEquivalent: preparedCurrency === 'USD' ? preparedAmount : null,
        usdEquivalentSource: preparedCurrency === 'USD' ? 'NATIVE_USD' : null,
        reason: summary,
        actionPayload: {
          orderId,
          refundResolutionId: resolutionId,
          caseId,
          note: summary,
          evidenceSource,
          evidenceReference: externalReference,
          orderOutcome,
          resumeStage: typeof protectedOutcome.resumeStage === 'string' ? protectedOutcome.resumeStage : null,
        },
        idempotencyKey: `ops-partial-refund-money-desk:${resolutionId}`,
      })
      const moneyDeskRequestId = typeof submitted.requestId === 'string' ? submitted.requestId : null
      if (!moneyDeskRequestId) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed', 'Money Desk did not return a protected request ID.')
      }

      const { error: resolutionLinkError } = await client
        .from('order_refund_resolutions')
        .update({
          status: 'APPROVAL_PENDING',
          money_desk_request_id: moneyDeskRequestId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resolutionId)
        .eq('status', 'MONEY_DESK_REQUIRED')
      if (resolutionLinkError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed', resolutionLinkError.message)
      }

      await client.from('audit_logs').insert({
        actor_role: session.role.toUpperCase(),
        order_id: orderId,
        event: 'ops.partial_refund_sent_to_money_desk',
        severity: 'warn',
        payload: {
          actor_email: session.email,
          issue_id: issueId,
          financial_case_id: caseId,
          refund_resolution_id: resolutionId,
          money_desk_request_id: moneyDeskRequestId,
          amount: preparedAmount,
          currency: preparedCurrency,
          reason_code: reasonCode,
          decision_basis: decisionBasis,
          evidence_source: evidenceSource,
          evidence_visibility: evidenceVisibility,
          order_outcome: orderOutcome,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'partial-refund-review-prepared')
    }

    if (kind === 'payout-block-resolution') {
      const issueId = readString(formData, 'issueId')
      const orderId = readString(formData, 'orderId')
      const resolutionMode = readString(formData, 'resolutionMode').toUpperCase()
      const note = readString(formData, 'note')

      if (!orderId || !PAYOUT_RESOLUTION_MODES.has(resolutionMode) || note.length === 0) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      if (resolutionMode === 'REFUND_CUSTOMER') {
        return redirectWithMessage(request, redirectTo, 'error', 'money-desk-required')
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
        await client.from('audit_logs').insert({
          actor_role: 'OPS',
          order_id: orderId,
          event: 'ops.payout_block_resolution_failed',
          severity: 'warn',
          payload: {
            issue_id: issueId || null,
            resolution_mode: resolutionMode,
            note,
            locked_currency: lockedCurrency,
            locked_amount: lockedAmount,
            error: release.error,
          },
        })
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
        await client.from('audit_logs').insert({
          actor_role: 'OPS',
          order_id: orderId,
          event: 'ops.payout_release_failed',
          severity: 'warn',
          payload: {
            source: 'ops-dashboard',
            order_id: orderId,
            error: release.error,
          },
        })
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
      return redirectWithMessage(request, redirectTo, 'error', 'money-desk-required')
    }

    if (kind === 'material-overage-resolution') {
      const advanceId = readString(formData, 'advanceId')
      const note = readString(formData, 'note')
      if (!advanceId || note.length < 10 || !hasFreshOpsMfa(session)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      const resolution = await triggerMaterialAdvanceOpsAction({
        action: 'resolve-overage',
        advanceId,
        actorRef: session.email ?? session.subject,
        note,
      })
      if (!resolution.ok) return redirectWithMessage(request, redirectTo, 'error', 'conflict', resolution.error)
      return redirectWithMessage(request, redirectTo, 'notice', 'material-overage-resolved')
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

    if (kind === 'ops-issue-bulk-resolve') {
      const rawIds = readString(formData, 'issueIds')
      if (!rawIds) return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')

      const issueIds = rawIds.split(',').map(s => s.trim()).filter(Boolean)
      if (issueIds.length === 0 || issueIds.length > 200) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const note = readString(formData, 'note')
      const now = new Date().toISOString()

      const { data: openIssues, error: fetchError } = await client
        .from('ops_issues')
        .select('id, status, issue_type, source, assigned_to, resolved_at')
        .in('id', issueIds)
        .neq('status', 'RESOLVED')

      if (fetchError) return redirectWithMessage(request, redirectTo, 'error', 'workflow-issue-save-failed')

      const toResolve = openIssues ?? []
      if (toResolve.length === 0) {
        return redirectWithMessage(request, redirectTo, 'notice', 'workflow-issue-saved')
      }

      const resolvedIds = toResolve.map(i => i.id)
      const { error: updateError } = await client
        .from('ops_issues')
        .update({
          status: 'RESOLVED',
          assigned_to: session.email ?? session.role,
          resolved_at: now,
        })
        .in('id', resolvedIds)

      if (updateError) return redirectWithMessage(request, redirectTo, 'error', 'workflow-issue-save-failed')

      await client.from('ops_audit_logs').insert(
        toResolve.map(issue => ({
          issue_id: issue.id,
          action_taken: 'ISSUE_BULK_RESOLVED',
          performed_by: session.email ?? 'ops-session',
          performed_role: session.role.toUpperCase(),
          reason: note.length > 0 ? note : 'Bulk resolved from ops dashboard',
          before_state: {
            status: issue.status,
            assigned_to: issue.assigned_to ?? null,
            resolved_at: issue.resolved_at ?? null,
          },
          after_state: {
            status: 'RESOLVED',
            assigned_to: session.email ?? session.role,
            resolved_at: now,
          },
        }))
      )

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: 'info',
        event: 'ops.workflow_issues_bulk_resolved',
        payload: {
          resolved_count: resolvedIds.length,
          issue_ids: resolvedIds,
          note: note.length > 0 ? note : null,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'workflow-issues-bulk-resolved')
    }

    if (kind === 'support-thread-mark-read') {
      const rawIds = readString(formData, 'orderIds')
      if (!rawIds) return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')

      const orderIds = rawIds.split(',').map(s => s.trim()).filter(Boolean)
      if (orderIds.length === 0 || orderIds.length > 200) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const now = new Date().toISOString()
      const { error } = await client
        .from('messages')
        .update({ read_at: now })
        .in('order_id', orderIds)
        .is('read_at', null)

      if (error) return redirectWithMessage(request, redirectTo, 'error', 'save-failed')

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: 'info',
        event: 'ops.support_threads_marked_read',
        payload: {
          order_ids: orderIds,
          count: orderIds.length,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'support-threads-read')
    }

    if (kind === 'payout-bulk-release') {
      const rawIds = readString(formData, 'orderIds')
      if (!rawIds) return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')

      const orderIds = rawIds.split(',').map(s => s.trim()).filter(Boolean)
      if (orderIds.length === 0 || orderIds.length > 100) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      let successCount = 0
      let failCount = 0
      const releaseErrors: string[] = []

      for (const orderId of orderIds) {
        const release = await triggerOrderPayoutRelease(orderId)
        if (release.ok) {
          successCount++
        } else {
          failCount++
          releaseErrors.push(`${orderId}: ${release.error}`)
        }
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: failCount > 0 ? 'warn' : 'info',
        event: 'ops.payouts_bulk_released',
        payload: {
          order_ids: orderIds,
          success_count: successCount,
          fail_count: failCount,
          errors: releaseErrors.length > 0 ? releaseErrors : null,
        },
      })

      if (failCount > 0 && successCount === 0) {
        return redirectWithMessage(request, redirectTo, 'error', 'payout-release-failed')
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'payouts-bulk-released')
    }

    if (kind === 'bypass-bulk-review') {
      const rawIds = readString(formData, 'logIds')
      if (!rawIds) return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')

      const logIds = rawIds.split(',').map(s => s.trim()).filter(Boolean)
      if (logIds.length === 0 || logIds.length > 200) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const now = new Date().toISOString()
      const { error: reviewError } = await client
        .from('contact_bypass_logs')
        .update({
          reviewed: true,
          reviewed_at: now,
          reviewed_by: null,
        })
        .in('id', logIds)
        .eq('reviewed', false)

      if (reviewError) return redirectWithMessage(request, redirectTo, 'error', 'save-failed')

      const { data: linkedIssues } = await client
        .from('ops_issues')
        .select('id')
        .eq('issue_type', 'CONTACT_BYPASS')
        .eq('related_entity_type', 'contact_bypass_log')
        .in('related_entity_id', logIds)
        .neq('status', 'RESOLVED')

      if (linkedIssues && linkedIssues.length > 0) {
        const issueIds = linkedIssues.map(i => i.id)
        await client
          .from('ops_issues')
          .update({
            status: 'RESOLVED',
            assigned_to: session.email ?? session.role,
            resolved_at: now,
          })
          .in('id', issueIds)

        await client.from('ops_audit_logs').insert(
          issueIds.map(issueId => ({
            issue_id: issueId,
            action_taken: 'CONTACT_BYPASS_BULK_REVIEWED',
            performed_by: session.email ?? 'ops-session',
            performed_role: session.role.toUpperCase(),
            reason: 'Bulk reviewed from ops dashboard',
            before_state: { status: 'OPEN' },
            after_state: { status: 'RESOLVED', resolved_at: now },
          }))
        )
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: 'info',
        event: 'ops.contact_bypass_bulk_reviewed',
        payload: {
          log_ids: logIds,
          count: logIds.length,
          linked_issues_resolved: linkedIssues?.length ?? 0,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'bypass-bulk-reviewed')
    }

    if (kind === 'dispatch-quote') {
      const orderId = readString(formData, 'orderId')
      const providerName = readString(formData, 'providerName')
      const providerQuoteReference = readString(formData, 'providerQuoteReference')
      const actualProviderCostAmount = parseMajorAmountToMinor(readString(formData, 'actualProviderCost'))
      const shortfallTaxAmount = parseOptionalMajorAmountToMinor(readString(formData, 'shortfallTax'))
      const shortfallFeeAmount = parseOptionalMajorAmountToMinor(readString(formData, 'shortfallFee'))
      const customerNote = readString(formData, 'customerNote')
      const internalNote = readString(formData, 'internalNote')
      const evidenceFile = readOptionalFile(formData, 'quoteEvidence')
      const evidenceExtension = evidenceFile ? privateEvidenceExtension(evidenceFile.type) : null

      if (
        !orderId ||
        !providerName ||
        !Number.isFinite(actualProviderCostAmount) ||
        !Number.isFinite(shortfallTaxAmount) ||
        !Number.isFinite(shortfallFeeAmount) ||
        !evidenceFile ||
        !evidenceExtension ||
        evidenceFile.size > 8 * 1024 * 1024
      ) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const evidencePath = `${orderId}/dispatch-quotes/${crypto.randomUUID()}.${evidenceExtension}`
      const upload = await client.storage
        .from('commercial-evidence')
        .upload(evidencePath, evidenceFile, { contentType: evidenceFile.type, upsert: false })
      if (upload.error) return redirectWithMessage(request, redirectTo, 'error', 'save-failed')

      const idempotencyKey = `ops:dispatch-quote:${orderId}:${createHash('sha256')
        .update(`${providerName}|${providerQuoteReference}|${actualProviderCostAmount}|${evidenceFile.size}`)
        .digest('hex')
        .slice(0, 24)}`
      const evidence = [{
        storageBucket: 'commercial-evidence',
        storageObjectPath: evidencePath,
        mimeType: evidenceFile.type,
        mediaType: 'IMAGE',
      }]
      const { data, error } = await client.rpc('record_order_fulfillment_quote', {
        p_order_id: orderId,
        p_provider_name: providerName,
        p_provider_quote_reference: providerQuoteReference || null,
        p_actual_provider_cost_amount: actualProviderCostAmount,
        p_shortfall_tax_amount: shortfallTaxAmount,
        p_shortfall_fee_amount: shortfallFeeAmount,
        p_evidence_media: evidence,
        p_customer_note: customerNote || null,
        p_internal_note: internalNote || null,
        p_actor_id: null,
        p_idempotency_key: idempotencyKey,
      })
      if (error) {
        await client.storage.from('commercial-evidence').remove([evidencePath])
        return redirectWithMessage(request, redirectTo, 'error', error.message.includes('FULFILLMENT_TAX_ATTRIBUTION_REQUIRED') ? 'dispatch-tax-review-required' : 'save-failed')
      }

      const outcome = readRpcRecord(data)
      const runId = typeof outcome.runId === 'string' ? outcome.runId : null
      const refundTotal = typeof outcome.customerRefundTotalAmount === 'number' ? outcome.customerRefundTotalAmount : 0
      const customerDueAmount = typeof outcome.customerDueAmount === 'number' ? outcome.customerDueAmount : 0
      const { data: quotedRun } = runId
        ? await client
            .from('order_fulfillment_runs')
            .select('captured_allowance_amount')
            .eq('id', runId)
            .maybeSingle()
        : { data: null }
      const isAdditionalDeliveryPayment = Number(quotedRun?.captured_allowance_amount ?? 0) > 0
      const { data: order } = await client
        .from('orders')
        .select('id,reference,order_kind,item_title,garment_type,item_size,delivery_method,customer_id,tailor_id,currency,quoted_currency,quoted_amount,total_amount')
        .eq('id', orderId)
        .maybeSingle()

      if (runId && refundTotal > 0) {
        await client.rpc('enqueue_domain_event', {
          p_event_type: 'dispatch.refund_requested',
          p_aggregate_type: 'order_fulfillment_run',
          p_idempotency_key: `dispatch-refund:${runId}:queued`,
          p_payload: { runId, orderId },
          p_aggregate_id: runId,
          p_actor_id: null,
          p_actor_role: 'OPS',
          p_order_id: orderId,
          p_metadata: { source: 'ops-dispatch-quote' },
          p_jobs: ['PROCESS_DISPATCH_REFUND'],
          p_priority: 30,
          p_max_attempts: 8,
          p_run_at: new Date().toISOString(),
        })
      }

      if (order?.customer_id) {
        await client.rpc('enqueue_domain_event', {
          p_event_type: 'notification.dispatch_quote_recorded',
          p_aggregate_type: 'order',
          p_idempotency_key: `dispatch-quote:${runId ?? orderId}:customer-delivery`,
          p_payload: {
            userId: order.customer_id,
            recipientUserId: order.customer_id,
            audience: 'CUSTOMER',
            order,
            subject: outcome.status === 'AWAITING_CUSTOMER_DECISION' ? 'Your delivery price is ready' : 'Your delivery cost is confirmed',
            headline: outcome.status === 'AWAITING_CUSTOMER_DECISION'
              ? isAdditionalDeliveryPayment ? 'Review the additional delivery cost' : 'Review the delivery price'
              : 'Drapeon Dispatch is ready to book',
            body: outcome.status === 'AWAITING_CUSTOMER_DECISION'
              ? isAdditionalDeliveryPayment
                ? `The provider quote is above the protected delivery amount. ${formatMinorMoney(customerDueAmount, order.currency)} is due. Review the provider proof and exact breakdown before anything changes.`
                : `No delivery amount was paid at checkout. The confirmed provider price is ${formatMinorMoney(customerDueAmount, order.currency)}. Review the provider proof and exact breakdown before you pay or choose pickup.`
              : `The provider quote fits within your protected delivery amount. We are moving the parcel into dispatch.`,
            ctaLabel: 'Review delivery',
            webPath: `/account/orders/${orderId}`,
            appUrl: `drape://orders/${orderId}`,
            action: 'DISPATCH_QUOTE_RECORDED',
            evidenceImageUrl: evidencePath,
            evidenceStorageBucket: 'commercial-evidence',
            notification: {
              title: outcome.status === 'AWAITING_CUSTOMER_DECISION' ? 'Delivery decision needed' : 'Delivery cost confirmed',
              body: outcome.status === 'AWAITING_CUSTOMER_DECISION'
                ? isAdditionalDeliveryPayment
                  ? `${formatMinorMoney(customerDueAmount, order.currency)} is due. Review the provider proof, then pay the difference, use pickup, or request a cheaper option.`
                  : `${formatMinorMoney(customerDueAmount, order.currency)} is due for delivery. Review the provider proof, then pay, use pickup, or request a cheaper option.`
                : 'Drapeon Dispatch can now book the provider.',
              preferenceKey: 'orderUpdates',
              data: { destination: 'ORDER_DETAIL', orderId },
            },
          },
          p_aggregate_id: orderId,
          p_actor_id: null,
          p_actor_role: 'OPS',
          p_order_id: orderId,
          p_metadata: { runId, refundTotal },
          p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'],
          p_priority: 40,
          p_max_attempts: 6,
          p_run_at: new Date().toISOString(),
        })
        if (outcome.status === 'AWAITING_CUSTOMER_DECISION') {
          const smsBody = `Order ${order.reference}: ${formatMinorMoney(customerDueAmount, order.currency)} is due ${isAdditionalDeliveryPayment ? 'as an additional delivery payment' : 'for delivery'}. Open Drapeon to review the provider proof and pay, request a cheaper option, or switch to pickup.`
          await client.rpc('enqueue_domain_event', {
            p_event_type: 'notification.dispatch_quote_sms_requested',
            p_aggregate_type: 'order',
            p_idempotency_key: `dispatch-quote:${runId ?? orderId}:customer-sms`,
            p_payload: {
              userId: order.customer_id,
              audience: 'CUSTOMER',
              orderId,
              event: 'DISPATCH_DECISION_REQUIRED',
              body: smsBody,
            },
            p_aggregate_id: orderId,
            p_actor_id: null,
            p_actor_role: 'OPS',
            p_order_id: orderId,
            p_metadata: { runId },
            p_jobs: ['SEND_SMS'],
            p_priority: 20,
            p_max_attempts: 5,
            p_run_at: new Date().toISOString(),
          })
        }
      }

      if (order?.tailor_id) {
        const needsDecision = outcome.status === 'AWAITING_CUSTOMER_DECISION'
        await client.rpc('enqueue_domain_event', {
          p_event_type: 'notification.dispatch_quote_recorded_tailor',
          p_aggregate_type: 'order',
          p_idempotency_key: `dispatch-quote:${runId ?? orderId}:tailor-delivery`,
          p_payload: {
            userId: order.tailor_id,
            recipientUserId: order.tailor_id,
            audience: 'TAILOR',
            order,
            subject: needsDecision
              ? isAdditionalDeliveryPayment ? 'The customer is reviewing the delivery difference' : 'The customer is reviewing the delivery price'
              : 'Drapeon Dispatch is arranging collection',
            headline: needsDecision ? 'Delivery decision pending' : 'Delivery cost confirmed',
            body: needsDecision
              ? isAdditionalDeliveryPayment
                ? 'The provider quote is above the protected delivery amount. The customer can pay the exact difference, request a cheaper option, or switch to pickup.'
                : 'No delivery amount was paid at checkout. The customer can pay the confirmed provider price, request a cheaper option, or switch to pickup.'
              : 'The provider quote fits within the protected delivery amount. Drapeon is arranging the provider handoff.',
            ctaLabel: 'View order',
            webPath: `/account/orders/${orderId}`,
            appUrl: `drape://orders/${orderId}`,
            action: 'DISPATCH_QUOTE_RECORDED',
            evidenceImageUrl: evidencePath,
            evidenceStorageBucket: 'commercial-evidence',
            notification: {
              title: needsDecision ? 'Customer delivery decision pending' : 'Drapeon Dispatch is arranging collection',
              body: needsDecision
                ? isAdditionalDeliveryPayment
                  ? 'No action is needed from you while the customer reviews the exact difference.'
                  : 'No action is needed from you while the customer reviews the delivery price.'
                : 'Keep the parcel ready for the provider handoff.',
              preferenceKey: 'newOrders',
              data: { destination: 'ORDER_DETAIL', orderId },
            },
          },
          p_aggregate_id: orderId,
          p_actor_id: null,
          p_actor_role: 'OPS',
          p_order_id: orderId,
          p_metadata: { runId, refundTotal },
          p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'],
          p_priority: 45,
          p_max_attempts: 6,
          p_run_at: new Date().toISOString(),
        })
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        severity: 'info',
        event: 'ops.dispatch_quote_recorded',
        payload: { order_id: orderId, run_id: runId, provider: providerName, actual_cost_amount: actualProviderCostAmount, refund_total_amount: refundTotal },
      })
      if (runId) {
        await syncEntityOpsIssue({
          client,
          issueType: 'DELIVERY_REVIEW',
          relatedEntityType: 'ORDER_FULFILLMENT_RUN',
          relatedEntityId: runId,
          status: 'RESOLVED',
          performedBy: session.email ?? session.subject,
          performedRole: session.role.toUpperCase(),
          actionTaken: 'DISPATCH_PROVIDER_QUOTE_RECORDED',
          reason: 'The provider quote and private proof were recorded. The customer-facing funding or booking workflow is now authoritative.',
        })
      }
      return redirectWithMessage(request, redirectTo, 'notice', 'dispatch-quote-saved')
    }

    if (kind === 'dispatch-event') {
      const orderId = readString(formData, 'orderId')
      const eventType = readString(formData, 'eventType').toUpperCase()
      const providerName = readString(formData, 'providerName')
      const serviceLevel = readString(formData, 'serviceLevel').toUpperCase()
      const providerReference = readString(formData, 'providerReference')
      const trackingNumber = readString(formData, 'trackingNumber')
      const trackingUrl = readString(formData, 'trackingUrl')
      const contactName = readString(formData, 'contactName')
      const contactPhone = readString(formData, 'contactPhone')
      const customerNote = readString(formData, 'customerNote')
      const internalNote = readString(formData, 'internalNote')
      const etaAt = readString(formData, 'etaAt')
      const etaTimezone = readString(formData, 'etaTimezone')
      const locationLabel = readString(formData, 'locationLabel')
      const latitudeText = readString(formData, 'latitude')
      const longitudeText = readString(formData, 'longitude')
      const latitude = latitudeText ? Number(latitudeText) : null
      const longitude = longitudeText ? Number(longitudeText) : null
      const coordinatesIncomplete = (latitude == null) !== (longitude == null)
      const coordinatesInvalid = (latitude != null && !Number.isFinite(latitude)) || (longitude != null && !Number.isFinite(longitude))
      const etaDate = etaAt ? new Date(etaAt) : null
      const etaInvalid = !!etaDate && Number.isNaN(etaDate.getTime())
      const location = locationLabel || (latitude != null && longitude != null)
        ? { ...(locationLabel ? { label: locationLabel } : {}), ...(latitude != null ? { latitude } : {}), ...(longitude != null ? { longitude } : {}) }
        : null
      const evidenceFile = readOptionalFile(formData, 'eventEvidence')
      const evidenceExtension = evidenceFile ? privateEvidenceExtension(evidenceFile.type) : null
      const evidenceRequired = new Set(['CARRIER_ACCEPTED', 'COLLECTED', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP']).has(eventType)

      if (!orderId || !DISPATCH_EVENT_TYPES.has(eventType)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }
      if (coordinatesIncomplete || coordinatesInvalid) {
        return redirectWithMessage(request, redirectTo, 'error', 'dispatch-location-invalid', 'Use both latitude and longitude, or clear both fields and enter a location name.')
      }
      if (etaInvalid) {
        return redirectWithMessage(request, redirectTo, 'error', 'dispatch-eta-invalid', 'Choose a valid estimated arrival date and time.')
      }
      if (evidenceRequired && (!evidenceFile || !evidenceExtension)) {
        return redirectWithMessage(request, redirectTo, 'error', 'dispatch-photo-proof-required', eventType === 'DELIVERED'
          ? 'Add a clear delivery photo before marking this order delivered.'
          : 'Add a clear handoff photo before saving this custody update.')
      }
      if (evidenceFile && (!evidenceExtension || evidenceFile.size > 8 * 1024 * 1024)) {
        return redirectWithMessage(request, redirectTo, 'error', 'dispatch-proof-invalid', 'Use a JPG, PNG, or WebP image smaller than 8 MB.')
      }

      let evidencePath: string | null = null
      let evidence: Array<Record<string, string>> = []
      if (evidenceFile && evidenceExtension) {
        evidencePath = `${orderId}/dispatch-events/${crypto.randomUUID()}.${evidenceExtension}`
        const upload = await client.storage.from('commercial-evidence').upload(evidencePath, evidenceFile, {
          contentType: evidenceFile.type,
          upsert: false,
        })
        if (upload.error) return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
        evidence = [{ storageBucket: 'commercial-evidence', storageObjectPath: evidencePath, mimeType: evidenceFile.type, mediaType: 'IMAGE' }]
      }

      const idempotencyKey = `ops:dispatch-event:${orderId}:${eventType}:${createHash('sha256')
        .update(`${providerReference}|${trackingNumber}|${etaAt}|${locationLabel}|${latitudeText}|${longitudeText}|${customerNote}|${evidenceFile?.size ?? 0}`)
        .digest('hex')
        .slice(0, 24)}`
      const { data, error } = await client.rpc('record_order_fulfillment_event', {
        p_order_id: orderId,
        p_parcel_number: 1,
        p_event_type: eventType,
        p_source: 'OPS',
        p_actor_id: null,
        p_actor_role: 'OPS',
        p_provider_event_id: null,
        p_idempotency_key: idempotencyKey,
        p_provider_name: providerName || null,
        p_service_level: serviceLevel || null,
        p_provider_reference: providerReference || null,
        p_tracking_number: trackingNumber || null,
        p_tracking_url: trackingUrl || null,
        p_contact_name: contactName || null,
        p_contact_phone: contactPhone || null,
        p_customer_note: customerNote || null,
        p_internal_note: internalNote || null,
        p_evidence_media: evidence,
        p_location: location,
        p_eta_at: etaDate?.toISOString() ?? null,
        p_eta_timezone: etaTimezone || null,
        p_occurred_at: new Date().toISOString(),
        p_payload: {},
      })
      if (error) {
        if (evidencePath) await client.storage.from('commercial-evidence').remove([evidencePath])
        const feedback = dispatchEventErrorFeedback(error.message)
        return redirectWithMessage(request, redirectTo, 'error', feedback.code, feedback.detail)
      }

      const outcome = readRpcRecord(data)
      const runId = typeof outcome.runId === 'string' ? outcome.runId : null
      if (runId && ['DELIVERED', 'PICKED_UP'].includes(eventType)) {
        await client.rpc('enqueue_domain_event', {
          p_event_type: 'dispatch.reconciliation_requested',
          p_aggregate_type: 'order_fulfillment_run',
          p_idempotency_key: `dispatch-reconciliation-request:${runId}:ops:${String(outcome.eventId ?? idempotencyKey)}`,
          p_payload: { runId, sourceId: `ops:${String(outcome.eventId ?? idempotencyKey)}` },
          p_aggregate_id: runId,
          p_actor_id: null,
          p_actor_role: 'OPS',
          p_order_id: orderId,
          p_metadata: { eventType },
          p_jobs: ['RECONCILE_DISPATCH_RUN'],
          p_priority: 25,
          p_max_attempts: 8,
          p_run_at: new Date().toISOString(),
        })
      }
      const { data: order } = await client.from('orders')
        .select('id,reference,order_kind,item_title,garment_type,item_size,delivery_method,customer_id,tailor_id,currency,quoted_currency,quoted_amount,total_amount')
        .eq('id', orderId)
        .maybeSingle()
      const eventLabel = eventType.toLowerCase().replaceAll('_', ' ')
      for (const recipient of [
        { userId: order?.customer_id, audience: 'CUSTOMER' },
        { userId: order?.tailor_id, audience: 'TAILOR' },
      ].filter((item): item is { userId: string; audience: 'CUSTOMER' | 'TAILOR' } => Boolean(item.userId))) {
        const userId = recipient.userId
        await client.rpc('enqueue_domain_event', {
          p_event_type: 'notification.dispatch_event_recorded',
          p_aggregate_type: 'order',
          p_idempotency_key: `dispatch-event:${String(outcome.eventId ?? idempotencyKey)}:${userId}:delivery`,
          p_payload: {
            userId,
            recipientUserId: userId,
            audience: recipient.audience,
            order,
            subject: 'Drapeon Dispatch update',
            headline: `Delivery update: ${eventLabel}`,
            body: customerNote || `Your order is now ${eventLabel}.`,
            ctaLabel: 'Track order',
            webPath: `/account/orders/${orderId}`,
            appUrl: `drape://orders/${orderId}`,
            action: `DISPATCH_${eventType}`,
            evidenceImageUrl: evidencePath,
            evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null,
            notification: {
              title: 'Drapeon Dispatch update',
              body: customerNote || `Your order is now ${eventLabel}.`,
              preferenceKey: 'orderUpdates',
              data: { destination: 'ORDER_DETAIL', orderId },
            },
          },
          p_aggregate_id: orderId,
          p_actor_id: null,
          p_actor_role: 'OPS',
          p_order_id: orderId,
          p_metadata: { eventType, eventId: outcome.eventId ?? null },
          p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'],
          p_priority: 45,
          p_max_attempts: 6,
          p_run_at: new Date().toISOString(),
        })
        if (['OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP'].includes(eventType)) {
          const smsBody = customerNote || `Order ${order?.reference ?? ''}: ${eventLabel}. Open Drapeon for the latest Drapeon Dispatch details.`
          await client.rpc('enqueue_domain_event', {
            p_event_type: 'notification.dispatch_event_sms_requested',
            p_aggregate_type: 'order',
            p_idempotency_key: `dispatch-event:${String(outcome.eventId ?? idempotencyKey)}:${userId}:sms`,
            p_payload: {
              userId,
              audience: recipient.audience,
              orderId,
              event: `DISPATCH_${eventType}`,
              body: smsBody,
            },
            p_aggregate_id: orderId,
            p_actor_id: null,
            p_actor_role: 'OPS',
            p_order_id: orderId,
            p_metadata: { eventType, eventId: outcome.eventId ?? null },
            p_jobs: ['SEND_SMS'],
            p_priority: 20,
            p_max_attempts: 5,
            p_run_at: new Date().toISOString(),
          })
        }
      }
      await client.from('audit_logs').insert({ actor_role: 'OPS', severity: 'info', event: 'ops.dispatch_event_recorded', payload: { order_id: orderId, event_type: eventType, event_id: outcome.eventId ?? null } })
      return redirectWithMessage(request, redirectTo, 'notice', 'dispatch-event-saved')
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

      const { error: settlementEvidenceError } = await client.rpc('record_order_settlement_evidence', {
        p_order_id: orderId,
        p_evidence_kind: 'DRAPEON_CUSTODY',
        p_source: 'DRAPEON_OPS',
        p_occurred_at: now,
        p_external_reference: trackingNumber || reference || null,
        p_recorded_by: null,
        p_metadata: { provider, target_stage: targetStage, service_level: normalizedServiceLevel },
      })
      if (settlementEvidenceError && !settlementEvidenceError.message.includes('ledger-recorded initial payment')) {
        console.error('ops_dispatch_settlement_evidence_failed', { orderId, targetStage, error: settlementEvidenceError.message })
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown control-plane error.'
    console.error('ops_action_failed', { kind, actor: session.email ?? session.subject, detail })
    return redirectWithMessage(
      request,
      redirectTo,
      'error',
      kind.startsWith('money-desk-') ? 'money-desk-action-failed' : 'save-failed',
      detail,
    )
  }
}
