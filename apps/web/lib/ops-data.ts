import 'server-only'

import { formatOpsIssueNumber, normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '@drape/shared'

import { createServiceRoleClient } from './server-supabase'

type DisputeRow = {
  id: string
  order_id: string
  reason: string
  description: string
  evidence_urls: string[] | null
  status: string
  resolution: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

type ContactBypassRow = {
  id: string
  user_id: string
  surface: string
  content: string
  attempt: number
  reviewed: boolean
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
}

type TailorApplicationRow = {
  id: string
  business_name: string
  display_name: string
  email: string
  location: string
  specialty: string
  portfolio_url: string | null
  instagram_url: string | null
  notes: string
  source: string
  status: string
  created_at: string
}

type TailorVerificationRow = {
  id: string
  user_id: string
  display_name: string
  location: string
  specialty_tags: string[] | null
  id_document_url: string | null
  id_verification_status: string
  payout_account_verified?: boolean | null
  payout_provider?: string | null
  payout_currency?: string | null
  created_at: string
  updated_at: string
}

function derivePayoutProvider(currency: string | null | undefined) {
  const normalized = normalizeAccountCurrency(currency)
  return normalized ? resolvePaymentProviderForCurrency(normalized) : null
}

type AccountDeletionRequestRow = {
  id: string
  user_id: string
  email: string | null
  role: string
  status: string
  reason: string | null
  requested_at: string
  acknowledged_at: string | null
  processed_at: string | null
  metadata: Record<string, unknown> | null
}

type ReviewRow = {
  id: string
  order_id: string
  rating: number
  body: string | null
  tags: string[] | null
  reviewer_name: string | null
  tailor_response: string | null
  published_at: string | null
  flagged: boolean
  created_at: string
}

type PayoutRow = {
  id: string
  tailor_profile_id: string
  amount: number
  currency: string
  provider: string
  status: string
  provider_payout_id: string | null
  blocked_reason: string | null
  order_id: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  processed_at: string
}

type OrderPaymentContextRow = {
  id: string
  order_id: string
  phase: string
  amount: number
  currency: string | null
  status: string
  refunded_amount: number | null
}

type AuditLogRow = {
  id: string
  created_at: string
  actor_id: string | null
  actor_role: string | null
  event: string
  severity: string
  order_id: string | null
  payload: Record<string, unknown> | null
}

type OpsIssueLedgerRow = {
  id: string
  issue_number: number
  issue_type: string
  severity: string
  status: string
  source: string | null
  actor_id: string | null
  actor_role: string | null
  order_id: string | null
  user_id: string | null
  tailor_profile_id: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  provider: string | null
  stage: string | null
  title: string
  description: string
  recommended_action: string
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type OpsAuditLogRow = {
  id: string
  issue_id: string
  action_taken: string
  performed_by: string | null
  performed_role: string | null
  reason: string | null
  created_at: string
}

type TailorProfileContextRow = {
  id: string
  user_id: string
  display_name: string
  location?: string | null
}

type CustomerProfileContextRow = {
  user_id: string
  display_name: string
}

type OrderRow = {
  id: string
  reference: string
  order_kind?: string | null
  garment_type?: string | null
  item_title?: string | null
  stage: string
  stage_updated_at?: string | null
  special_note?: string | null
  quoted_amount: number | null
  total_amount?: number | null
  currency?: string | null
  quoted_currency: string | null
  delivery_method: string | null
  fulfillment_option: string | null
  delivery_address?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  fulfillment_provider?: string | null
  fulfillment_reference?: string | null
  fulfillment_contact_name?: string | null
  fulfillment_contact_phone?: string | null
  tracking_number?: string | null
  carrier?: string | null
  customer_id: string
  tailor_id: string
}

type UserRow = {
  id: string
  email: string | null
  display_name: string
  role: string | null
}

type EscrowOrderSummaryRow = {
  id: string
  currency: string | null
  total_amount: number | null
  quoted_amount: number | null
}

export type OpsDispute = {
  id: string
  orderId: string
  orderReference: string | null
  orderStage: string | null
  amount: number | null
  currency: string | null
  deliveryMethod: string | null
  fulfillmentOption: string | null
  customerName: string
  customerEmail: string | null
  tailorName: string
  tailorEmail: string | null
  reason: string
  description: string
  evidenceUrls: string[]
  status: string
  resolution: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OpsBypassLog = {
  id: string
  displayId: string
  issueId: string | null
  userId: string
  userName: string
  userEmail: string | null
  userRole: string | null
  surface: string
  content: string
  attempt: number
  reviewed: boolean
  reviewedAt: string | null
  createdAt: string
  history: OpsIssueHistoryEntry[]
}

export type OpsTailorApplication = {
  id: string
  displayId: string
  issueId: string | null
  businessName: string
  displayName: string
  email: string
  location: string
  specialty: string
  portfolioUrl: string | null
  instagramUrl: string | null
  notes: string
  source: string
  status: string
  createdAt: string
  history: OpsIssueHistoryEntry[]
}

export type OpsIssueHistoryEntry = {
  id: string
  actionTaken: string
  performedBy: string | null
  performedRole: string | null
  reason: string | null
  createdAt: string
}

export type OpsVerification = {
  displayId: string
  issueId: string | null
  profileId: string
  userId: string
  displayName: string
  email: string | null
  location: string
  specialtyTags: string[]
  idDocumentUrl: string | null
  status: string
  payoutAccountVerified: boolean
  payoutProvider: string | null
  payoutCurrency: string | null
  createdAt: string
  updatedAt: string
  history: OpsIssueHistoryEntry[]
}

export type OpsAccountDeletionRequest = {
  id: string
  displayId: string
  issueId: string | null
  userId: string
  displayName: string
  email: string | null
  role: string
  status: string
  reason: string | null
  requestedAt: string
  acknowledgedAt: string | null
  processedAt: string | null
  source: string | null
  history: OpsIssueHistoryEntry[]
}

export type OpsPayout = {
  id: string
  tailorProfileId: string
  tailorDisplayName: string
  tailorEmail: string | null
  amount: number
  currency: string
  provider: string
  status: string
  providerPayoutId: string | null
  blockedReason: string | null
  orderId: string | null
  orderReference: string | null
  initiatedAt: string | null
  completedAt: string | null
  failedAt: string | null
  processedAt: string
}

export type OpsReviewQueueItem = {
  id: string
  displayId: string
  issueId: string | null
  orderId: string
  orderReference: string | null
  orderStage: string | null
  customerName: string
  customerEmail: string | null
  tailorName: string
  tailorEmail: string | null
  reviewerName: string
  rating: number
  body: string | null
  tags: string[]
  response: string | null
  createdAt: string
  publishedAt: string | null
  flagged: boolean
  history: OpsIssueHistoryEntry[]
}

export type OpsWorkflowIssue = {
  id: string
  displayId: string
  event: string
  issueType: string
  severity: string
  status: string
  source: string | null
  actorName: string
  actorEmail: string | null
  actorRole: string | null
  orderId: string | null
  orderReference: string | null
  orderStage: string | null
  summary: string
  reason: string | null
  blockedReasonCode: string | null
  provider: string | null
  payoutCurrency: string | null
  lockedPayoutCurrency: string | null
  orderTotalAmount: number | null
  orderCurrency: string | null
  alreadyRefundedAmount: number
  maxRefundableAmount: number
  trackingNumber: string | null
  paymentStatus: string | null
  recommendedAction: string
  createdAt: string
  history: OpsIssueHistoryEntry[]
}

export type OpsDispatchItem = {
  orderId: string
  orderReference: string
  orderKind: string | null
  garmentType: string
  itemTitle: string | null
  stage: string
  stageUpdatedAt: string | null
  amount: number | null
  currency: string | null
  deliveryMethod: string | null
  customerName: string
  customerEmail: string | null
  tailorName: string
  tailorEmail: string | null
  tailorLocation: string | null
  deliveryAddress: string | null
  recipientName: string | null
  recipientPhone: string | null
  provider: string | null
  reference: string | null
  contactName: string | null
  contactPhone: string | null
  trackingNumber: string | null
  carrier: string | null
}

export type OpsOrderReviewItem = {
  id: string
  orderId: string
  orderReference: string | null
  orderKind: string | null
  orderStage: string | null
  reviewType: 'CANCELLATION' | 'DELIVERY'
  requestedBy: string
  requestedByRole: 'CUSTOMER' | 'TAILOR' | null
  customerName: string
  customerEmail: string | null
  tailorName: string
  tailorEmail: string | null
  reasonLabel: string
  note: string | null
  requestedAt: string | null
  requestedFromStage: string | null
}

export type OpsDashboardData = {
  summary: {
    openDisputes: number
    openWorkflowIssues: number
    pendingOrderReviews: number
    unreviewedBypassLogs: number
    recentSafetyReports: number
    pendingApplications: number
    pendingVerifications: number
    pendingDeletionRequests: number
    pendingReviewVisibility: number
    pendingDispatch: number
    ordersInEscrowCount: number
    ordersInEscrowValueLabel: string
    pendingPayoutCount: number
    pendingPayoutValueLabel: string
    flaggedContentCount: number
  }
  disputes: OpsDispute[]
  bypassLogs: OpsBypassLog[]
  applications: OpsTailorApplication[]
  pendingVerifications: OpsVerification[]
  deletionRequests: OpsAccountDeletionRequest[]
  reviewQueue: OpsReviewQueueItem[]
  payouts: OpsPayout[]
  orderReviews: OpsOrderReviewItem[]
  workflowIssues: OpsWorkflowIssue[]
  dispatchQueue: OpsDispatchItem[]
  issues: string[]
}

function formatIssue(label: string, error: unknown) {
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : 'Unknown error'

  return `${label}: ${message}`
}

function emptySummary() {
  return {
    openDisputes: 0,
    openWorkflowIssues: 0,
    pendingOrderReviews: 0,
    unreviewedBypassLogs: 0,
    recentSafetyReports: 0,
    pendingApplications: 0,
    pendingVerifications: 0,
    pendingDeletionRequests: 0,
    pendingReviewVisibility: 0,
    pendingDispatch: 0,
    ordersInEscrowCount: 0,
    ordersInEscrowValueLabel: '—',
    pendingPayoutCount: 0,
    pendingPayoutValueLabel: '—',
    flaggedContentCount: 0,
  }
}

function metadataStringValue(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const LEGACY_WORKFLOW_ISSUE_EVENTS = [
  'conversation.blocked',
  'privacy.data_access_requested',
  'shipping.handoff_blocked',
  'shipping.webhook_skipped',
  'shipping.delivery_order_missing',
  'shipping.delivery_skipped_wrong_stage',
  'shipping.delivery_update_failed',
] as const

const ESCROW_ACTIVE_STAGES = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COLLECTED',
] as const

const OPEN_PAYOUT_STATUSES = ['PENDING', 'PROCESSING', 'BLOCKED', 'FAILED'] as const
const DEDICATED_SECTION_ISSUE_TYPES = new Set([
  'TAILOR_VERIFICATION',
  'TAILOR_APPLICATION',
  'ACCOUNT_DELETION_REQUEST',
  'CONTACT_BYPASS',
  'CONTENT_FLAG',
])

function payloadStringValue(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

type OpenOrderReviewMeta = {
  type: 'CANCELLATION' | 'DELIVERY'
  requestedBy: 'CUSTOMER' | 'TAILOR' | null
  reasonLabel: string
  note: string | null
  requestedAt: string | null
  requestedFromStage: string | null
}

function parseOpenOrderReviews(raw: string | null | undefined): OpenOrderReviewMeta[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const reviews: OpenOrderReviewMeta[] = []

    const cancellationReview = parsed.cancellationReview as Record<string, unknown> | undefined
    if (cancellationReview?.status === 'OPEN') {
      reviews.push({
        type: 'CANCELLATION',
        requestedBy:
          cancellationReview.requestedBy === 'CUSTOMER' || cancellationReview.requestedBy === 'TAILOR'
            ? cancellationReview.requestedBy
            : null,
        reasonLabel:
          typeof cancellationReview.reasonLabel === 'string' && cancellationReview.reasonLabel.trim().length > 0
            ? cancellationReview.reasonLabel.trim()
            : 'Cancellation review',
        note:
          typeof cancellationReview.note === 'string' && cancellationReview.note.trim().length > 0
            ? cancellationReview.note.trim()
            : null,
        requestedAt:
          typeof cancellationReview.requestedAt === 'string' && cancellationReview.requestedAt.trim().length > 0
            ? cancellationReview.requestedAt
            : null,
        requestedFromStage:
          typeof cancellationReview.requestedFromStage === 'string' && cancellationReview.requestedFromStage.trim().length > 0
            ? cancellationReview.requestedFromStage
            : null,
      })
    }

    const deliveryReview = parsed.deliveryReview as Record<string, unknown> | undefined
    if (deliveryReview?.status === 'OPEN') {
      reviews.push({
        type: 'DELIVERY',
        requestedBy:
          deliveryReview.requestedBy === 'CUSTOMER' || deliveryReview.requestedBy === 'TAILOR'
            ? deliveryReview.requestedBy
            : null,
        reasonLabel:
          typeof deliveryReview.reasonLabel === 'string' && deliveryReview.reasonLabel.trim().length > 0
            ? deliveryReview.reasonLabel.trim()
            : 'Delivery review',
        note:
          typeof deliveryReview.note === 'string' && deliveryReview.note.trim().length > 0
            ? deliveryReview.note.trim()
            : null,
        requestedAt:
          typeof deliveryReview.requestedAt === 'string' && deliveryReview.requestedAt.trim().length > 0
            ? deliveryReview.requestedAt
            : null,
        requestedFromStage:
          typeof deliveryReview.requestedFromStage === 'string' && deliveryReview.requestedFromStage.trim().length > 0
            ? deliveryReview.requestedFromStage
            : null,
      })
    }

    return reviews
  } catch {
    return []
  }
}

function formatWorkflowSummary(event: string, payload: Record<string, unknown> | null) {
  const category = payloadStringValue(payload, 'category')
  const reason = payloadStringValue(payload, 'reason')
  const provider = payloadStringValue(payload, 'provider')
  const orderStage = payloadStringValue(payload, 'order_stage')
  const stage = payloadStringValue(payload, 'stage')
  const paymentStatus = payloadStringValue(payload, 'payment_status')
  const requestCategory = payloadStringValue(payload, 'request_category')
  const readinessCode = payloadStringValue(payload, 'readiness_code')
  const accountEmail = payloadStringValue(payload, 'account_email')
  const surface = payloadStringValue(payload, 'surface')
  const trackingNumber = payloadStringValue(payload, 'tracking_number')
  const error = payloadStringValue(payload, 'error')

  if (event === 'conversation.safety_reported') {
    return [
      category ? category.replace(/_/g, ' ') : 'Conversation safety report',
      surface ? `from ${surface}` : null,
      orderStage ? `at ${orderStage}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'conversation.blocked') {
    return [
      reason ? `${reason.replace(/_/g, ' ')} triggered a chat pause` : 'Conversation paused for safety review',
      surface ? `from ${surface}` : null,
      orderStage ? `at ${orderStage}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'payment.blocked') {
    return [
      reason ? reason.replace(/_/g, ' ') : 'Payment blocked',
      provider ? `via ${provider}` : null,
      paymentStatus ? `status ${paymentStatus}` : null,
      stage ? `at ${stage}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'PAYMENT_BLOCKED') {
    return [
      'Customer payment is blocked',
      provider ? `via ${provider}` : null,
      reason ? reason.replace(/_/g, ' ') : null,
      stage ? `at ${stage}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'PAYOUT_BLOCKED') {
    return [
      'Payout release is blocked',
      reason ? reason.replace(/_/g, ' ') : null,
      provider ? `via ${provider}` : null,
      stage ? `at ${stage}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'PAYOUT_FAILED') {
    return [
      'Payout release failed',
      provider ? `via ${provider}` : null,
      error,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'privacy.data_access_requested') {
    return [
      'In-app data access request',
      accountEmail ? `for ${accountEmail}` : null,
      reason,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'seller.access_review_requested') {
    return [
      'Seller access review request',
      requestCategory ? requestCategory.replace(/_/g, ' ') : readinessCode ? readinessCode.replace(/_/g, ' ') : null,
      reason,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'SELLER_ACCESS_REVIEW') {
    return [
      'Seller access review request',
      requestCategory ? requestCategory.replace(/_/g, ' ') : readinessCode ? readinessCode.replace(/_/g, ' ') : null,
      reason,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'order.aftercare_requested') {
    return [
      'Aftercare support requested',
      payloadStringValue(payload, 'aftercare_label'),
      payloadStringValue(payload, 'from_stage') ? `from ${payloadStringValue(payload, 'from_stage')}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'ORDER_REVIEW') {
    return [
      'Cancellation review requested',
      payloadStringValue(payload, 'requested_by'),
      payloadStringValue(payload, 'from_stage') ? `from ${payloadStringValue(payload, 'from_stage')}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'DELIVERY_REVIEW') {
    return [
      'Delivery review requested',
      payloadStringValue(payload, 'requested_by'),
      payloadStringValue(payload, 'from_stage') ? `from ${payloadStringValue(payload, 'from_stage')}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'AFTERCARE_REQUEST') {
    return [
      'Aftercare support requested',
      payloadStringValue(payload, 'aftercare_label'),
      payloadStringValue(payload, 'from_stage') ? `from ${payloadStringValue(payload, 'from_stage')}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'CONVERSATION_SAFETY') {
    return [
      category ? category.replace(/_/g, ' ') : 'Conversation safety report',
      surface ? `from ${surface}` : null,
      orderStage ? `at ${orderStage}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'shipping.handoff_blocked') {
    return [
      reason ? reason.replace(/_/g, ' ') : 'Shipping handoff blocked',
      stage ? `at ${stage}` : null,
      provider ? `provider ${provider}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'shipping.delivery_update_failed') {
    return [
      'Delivery webhook could not update the order',
      provider ? `via ${provider}` : null,
      trackingNumber ? `tracking ${trackingNumber}` : null,
      error,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'shipping.delivery_order_missing') {
    return [
      'Delivery webhook could not match an order',
      provider ? `via ${provider}` : null,
      trackingNumber ? `tracking ${trackingNumber}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'shipping.delivery_skipped_wrong_stage') {
    return [
      'Delivery webhook skipped an order in the wrong stage',
      stage ? `stage ${stage}` : null,
      trackingNumber ? `tracking ${trackingNumber}` : null,
    ].filter(Boolean).join(' · ')
  }

  if (event === 'shipping.webhook_skipped') {
    return [
      'Delivery webhook was skipped',
      reason ? reason.replace(/_/g, ' ') : null,
      trackingNumber ? `tracking ${trackingNumber}` : null,
    ].filter(Boolean).join(' · ')
  }

  return event.replace(/\./g, ' ')
}

function workflowRecommendedAction(event: string, payload: Record<string, unknown> | null) {
  const reason = payloadStringValue(payload, 'reason')

  switch (event) {
    case 'PAYMENT_BLOCKED':
      return 'Verify the provider payment status, then either confirm the order, ask the customer to retry, or trigger the refund path.'
    case 'PAYOUT_BLOCKED':
      return 'Check delivery confirmation, settled payment, and payout account readiness before retrying payout release.'
    case 'PAYOUT_FAILED':
      return 'Review the provider response, confirm the destination account details, and retry only after the failure cause is understood.'
    case 'conversation.safety_reported':
    case 'CONVERSATION_SAFETY':
      return 'Review the report, decide whether the order chat should stay paused, and leave an internal trust note.'
    case 'conversation.blocked':
      return 'Confirm whether the block should stand or the conversation can reopen safely inside Drape.'
    case 'payment.blocked':
      return reason === 'confirm_status_not_success'
        ? 'Verify the provider payment status, then either confirm the order or trigger a refund path.'
        : 'Check the payment attempt, provider response, and order stage before taking manual action.'
    case 'privacy.data_access_requested':
      return 'Acknowledge the privacy request and coordinate the data export response.'
    case 'seller.access_review_requested':
    case 'SELLER_ACCESS_REVIEW':
      return 'Review trust blockers, identity state, and payout readiness before approving seller access.'
    case 'order.cancellation_review_requested':
    case 'ORDER_REVIEW':
      return 'Review the timeline, evidence, and refund implications before ruling on the cancellation.'
    case 'order.delivery_review_requested':
    case 'DELIVERY_REVIEW':
      return 'Check dispatch evidence and customer contact attempts, then decide the next delivery step.'
    case 'order.aftercare_requested':
    case 'AFTERCARE_REQUEST':
      return 'Review the note, request evidence if needed, and decide whether support or refund review is required.'
    case 'shipping.handoff_blocked':
      return 'Resolve the missing dispatch detail or courier handoff issue blocking Drape-managed delivery.'
    case 'shipping.webhook_skipped':
    case 'shipping.delivery_order_missing':
    case 'shipping.delivery_skipped_wrong_stage':
    case 'shipping.delivery_update_failed':
      return 'Review the webhook payload, repair the order mapping or stage mismatch, and retry only after the root cause is clear.'
    default:
      return 'Review the audit context and take the next ops action from the related order or user record.'
  }
}

function issueDisplayId(prefix: string, id: string) {
  return `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

function workflowSeverityRank(value: string) {
  const normalized = value.trim().toUpperCase()
  switch (normalized) {
    case 'CRITICAL':
    case 'ERROR':
      return 0
    case 'HIGH':
    case 'WARN':
      return 1
    case 'MEDIUM':
    case 'INFO':
      return 2
    case 'LOW':
      return 3
    default:
      return 4
  }
}

function formatGroupedCurrencyTotals(values: Array<{ amount: number | null | undefined; currency: string | null | undefined }>) {
  const totals = new Map<string, number>()

  for (const value of values) {
    if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0) continue
    const currency = typeof value.currency === 'string' && value.currency.trim().length > 0 ? value.currency.trim().toUpperCase() : null
    if (!currency) continue
    totals.set(currency, (totals.get(currency) ?? 0) + value.amount)
  }

  if (totals.size === 0) return '—'

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => {
      const major = amount / 100
      const formatted = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(major)
      return `${currency} ${formatted}`
    })
    .join(' + ')
}

function orderPaymentRefundedAmount(payment: OrderPaymentContextRow) {
  if (payment.status === 'REFUNDED') return Math.max(payment.amount, 0)
  if (typeof payment.refunded_amount === 'number') return Math.max(Math.min(payment.refunded_amount, payment.amount), 0)
  return 0
}

export async function loadOpsDashboardData(): Promise<OpsDashboardData | null> {
  const client = createServiceRoleClient()
  if (!client) return null

  const issues: string[] = []

  const [
    disputesResult,
    orderReviewsResult,
    bypassResult,
    safetyReportCountResult,
    dispatchQueueResult,
    applicationsResult,
    verificationsResult,
    deletionRequestsResult,
    reviewQueueResult,
    payoutsResult,
    opsIssuesResult,
    legacyWorkflowIssuesResult,
    escrowOrdersResult,
    disputeCountResult,
    bypassCountResult,
    dispatchCountResult,
    applicationCountResult,
    verificationCountResult,
    deletionCountResult,
    reviewQueueCountResult,
  ] = await Promise.allSettled([
    client
      .from('disputes')
      .select('id, order_id, reason, description, evidence_urls, status, resolution, resolved_at, resolved_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(24),
    client
      .from('orders')
      .select('id, reference, order_kind, stage, stage_updated_at, special_note, customer_id, tailor_id')
      .eq('stage', 'IN_DISPUTE')
      .not('special_note', 'is', null)
      .order('stage_updated_at', { ascending: false })
      .limit(40),
    client
      .from('contact_bypass_logs')
      .select('id, user_id, surface, content, attempt, reviewed, reviewed_at, reviewed_by, created_at')
      .order('created_at', { ascending: false })
      .limit(40),
    client
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('event', 'conversation.safety_reported')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    client
      .from('orders')
      .select('id, reference, order_kind, garment_type, item_title, stage, stage_updated_at, quoted_amount, currency, quoted_currency, delivery_method, fulfillment_option, delivery_address, recipient_name, recipient_phone, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, tracking_number, carrier, customer_id, tailor_id')
      .eq('stage', 'READY_FOR_DRAPE_DISPATCH')
      .in('delivery_method', ['LOCAL_DELIVERY', 'SHIPPING'])
      .order('stage_updated_at', { ascending: true })
      .limit(40),
    client
      .from('tailor_applications')
      .select('id, business_name, display_name, email, location, specialty, portfolio_url, instagram_url, notes, source, status, created_at')
      .order('created_at', { ascending: false })
      .limit(24),
    client
      .from('tailor_profiles')
      .select('id, user_id, display_name, location, specialty_tags, id_document_url, id_verification_status, payout_account_verified, payout_provider, payout_currency, created_at, updated_at')
      .eq('id_verification_status', 'PENDING')
      .order('updated_at', { ascending: false })
      .limit(24),
    client
      .from('account_deletion_requests')
      .select('id, user_id, email, role, status, reason, requested_at, acknowledged_at, processed_at, metadata')
      .order('requested_at', { ascending: false })
      .limit(24),
    client
      .from('reviews')
      .select('id, order_id, rating, body, tags, reviewer_name, tailor_response, published_at, flagged, created_at')
      .or('flagged.eq.true,published_at.is.null')
      .order('created_at', { ascending: false })
      .limit(24),
    client
      .from('payouts')
      .select('id, tailor_profile_id, amount, currency, provider, status, provider_payout_id, blocked_reason, order_id, initiated_at, completed_at, failed_at, processed_at')
      .order('processed_at', { ascending: false })
      .limit(24),
    client
      .from('ops_issues')
      .select('id, issue_number, issue_type, severity, status, source, actor_id, actor_role, order_id, user_id, tailor_profile_id, related_entity_type, related_entity_id, provider, stage, title, description, recommended_action, metadata, created_at, updated_at')
      .in('status', ['OPEN', 'IN_REVIEW', 'ESCALATED'])
      .order('created_at', { ascending: false })
      .limit(48),
    client
      .from('audit_logs')
      .select('id, created_at, actor_id, actor_role, event, severity, order_id, payload')
      .in('event', [...LEGACY_WORKFLOW_ISSUE_EVENTS])
      .order('created_at', { ascending: false })
      .limit(32),
    client
      .from('orders')
      .select('id, currency, total_amount, quoted_amount')
      .in('stage', [...ESCROW_ACTIVE_STAGES]),
    client
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['OPEN', 'UNDER_REVIEW']),
    client
      .from('contact_bypass_logs')
      .select('id', { count: 'exact', head: true })
      .eq('reviewed', false),
    client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'READY_FOR_DRAPE_DISPATCH')
      .in('delivery_method', ['LOCAL_DELIVERY', 'SHIPPING']),
    client
      .from('tailor_applications')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING'),
    client
      .from('tailor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('id_verification_status', 'PENDING'),
    client
      .from('account_deletion_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING'),
    client
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .or('flagged.eq.true,published_at.is.null'),
  ])

  const disputes =
    disputesResult.status === 'fulfilled' && !disputesResult.value.error
      ? ((disputesResult.value.data ?? []) as DisputeRow[])
      : []
  const orderReviewRows =
    orderReviewsResult.status === 'fulfilled' && !orderReviewsResult.value.error
      ? ((orderReviewsResult.value.data ?? []) as OrderRow[])
      : []
  const bypassLogs =
    bypassResult.status === 'fulfilled' && !bypassResult.value.error
      ? ((bypassResult.value.data ?? []) as ContactBypassRow[])
      : []
  const dispatchQueue =
    dispatchQueueResult.status === 'fulfilled' && !dispatchQueueResult.value.error
      ? ((dispatchQueueResult.value.data ?? []) as OrderRow[])
      : []
  const applications =
    applicationsResult.status === 'fulfilled' && !applicationsResult.value.error
      ? ((applicationsResult.value.data ?? []) as TailorApplicationRow[])
      : []
  const pendingVerifications =
    verificationsResult.status === 'fulfilled' && !verificationsResult.value.error
      ? ((verificationsResult.value.data ?? []) as TailorVerificationRow[])
      : []
  const deletionRequests =
    deletionRequestsResult.status === 'fulfilled' && !deletionRequestsResult.value.error
      ? ((deletionRequestsResult.value.data ?? []) as AccountDeletionRequestRow[])
      : []
  const reviewQueue =
    reviewQueueResult.status === 'fulfilled' && !reviewQueueResult.value.error
      ? ((reviewQueueResult.value.data ?? []) as ReviewRow[])
      : []
  const payouts =
    payoutsResult.status === 'fulfilled' && !payoutsResult.value.error
      ? ((payoutsResult.value.data ?? []) as PayoutRow[])
      : []
  const opsIssues =
    opsIssuesResult.status === 'fulfilled' && !opsIssuesResult.value.error
      ? ((opsIssuesResult.value.data ?? []) as OpsIssueLedgerRow[])
      : []
  const legacyWorkflowIssues =
    legacyWorkflowIssuesResult.status === 'fulfilled' && !legacyWorkflowIssuesResult.value.error
      ? ((legacyWorkflowIssuesResult.value.data ?? []) as AuditLogRow[])
      : []
  const escrowOrders =
    escrowOrdersResult.status === 'fulfilled' && !escrowOrdersResult.value.error
      ? ((escrowOrdersResult.value.data ?? []) as EscrowOrderSummaryRow[])
      : []

  const issueHistoryByIssueId = new Map<string, OpsIssueHistoryEntry[]>()
  const openIssueIds = [...new Set(opsIssues.map((issue) => issue.id))]
  if (openIssueIds.length > 0) {
    const { data: issueHistoryRows, error: issueHistoryError } = await client
      .from('ops_audit_logs')
      .select('id, issue_id, action_taken, performed_by, performed_role, reason, created_at')
      .in('issue_id', openIssueIds)
      .order('created_at', { ascending: false })

    if (issueHistoryError) {
      issues.push(formatIssue('Ops issue history', issueHistoryError))
    } else {
      for (const row of (issueHistoryRows ?? []) as OpsAuditLogRow[]) {
        const history = issueHistoryByIssueId.get(row.issue_id) ?? []
        history.push({
          id: row.id,
          actionTaken: row.action_taken,
          performedBy: row.performed_by,
          performedRole: row.performed_role,
          reason: row.reason,
          createdAt: row.created_at,
        })
        issueHistoryByIssueId.set(row.issue_id, history)
      }
    }
  }

  if (disputesResult.status === 'rejected') issues.push(formatIssue('Disputes', disputesResult.reason))
  if (disputesResult.status === 'fulfilled' && disputesResult.value.error) {
    issues.push(formatIssue('Disputes', disputesResult.value.error))
  }
  if (orderReviewsResult.status === 'rejected') issues.push(formatIssue('Order reviews', orderReviewsResult.reason))
  if (orderReviewsResult.status === 'fulfilled' && orderReviewsResult.value.error) {
    issues.push(formatIssue('Order reviews', orderReviewsResult.value.error))
  }
  if (bypassResult.status === 'rejected') issues.push(formatIssue('Bypass logs', bypassResult.reason))
  if (bypassResult.status === 'fulfilled' && bypassResult.value.error) {
    issues.push(formatIssue('Bypass logs', bypassResult.value.error))
  }
  if (dispatchQueueResult.status === 'rejected') issues.push(formatIssue('Dispatch queue', dispatchQueueResult.reason))
  if (dispatchQueueResult.status === 'fulfilled' && dispatchQueueResult.value.error) {
    issues.push(formatIssue('Dispatch queue', dispatchQueueResult.value.error))
  }
  if (applicationsResult.status === 'rejected') issues.push(formatIssue('Applications', applicationsResult.reason))
  if (applicationsResult.status === 'fulfilled' && applicationsResult.value.error) {
    issues.push(formatIssue('Applications', applicationsResult.value.error))
  }
  if (verificationsResult.status === 'rejected') issues.push(formatIssue('Pending verifications', verificationsResult.reason))
  if (verificationsResult.status === 'fulfilled' && verificationsResult.value.error) {
    issues.push(formatIssue('Pending verifications', verificationsResult.value.error))
  }
  if (deletionRequestsResult.status === 'rejected') issues.push(formatIssue('Deletion requests', deletionRequestsResult.reason))
  if (deletionRequestsResult.status === 'fulfilled' && deletionRequestsResult.value.error) {
    issues.push(formatIssue('Deletion requests', deletionRequestsResult.value.error))
  }
  if (reviewQueueResult.status === 'rejected') issues.push(formatIssue('Review moderation queue', reviewQueueResult.reason))
  if (reviewQueueResult.status === 'fulfilled' && reviewQueueResult.value.error) {
    issues.push(formatIssue('Review moderation queue', reviewQueueResult.value.error))
  }
  if (payoutsResult.status === 'rejected') issues.push(formatIssue('Payouts', payoutsResult.reason))
  if (payoutsResult.status === 'fulfilled' && payoutsResult.value.error) {
    issues.push(formatIssue('Payouts', payoutsResult.value.error))
  }
  if (opsIssuesResult.status === 'rejected') issues.push(formatIssue('Ops issues', opsIssuesResult.reason))
  if (opsIssuesResult.status === 'fulfilled' && opsIssuesResult.value.error) {
    issues.push(formatIssue('Ops issues', opsIssuesResult.value.error))
  }
  if (legacyWorkflowIssuesResult.status === 'rejected') issues.push(formatIssue('Legacy workflow issues', legacyWorkflowIssuesResult.reason))
  if (legacyWorkflowIssuesResult.status === 'fulfilled' && legacyWorkflowIssuesResult.value.error) {
    issues.push(formatIssue('Legacy workflow issues', legacyWorkflowIssuesResult.value.error))
  }
  if (escrowOrdersResult.status === 'rejected') issues.push(formatIssue('Escrow orders', escrowOrdersResult.reason))
  if (escrowOrdersResult.status === 'fulfilled' && escrowOrdersResult.value.error) {
    issues.push(formatIssue('Escrow orders', escrowOrdersResult.value.error))
  }

  const summary = emptySummary()
  if (disputeCountResult.status === 'fulfilled' && !disputeCountResult.value.error) {
    summary.openDisputes = disputeCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Open dispute count', disputeCountResult.status === 'fulfilled' ? disputeCountResult.value.error : disputeCountResult.reason))
  }
  if (bypassCountResult.status === 'fulfilled' && !bypassCountResult.value.error) {
    summary.unreviewedBypassLogs = bypassCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Bypass review count', bypassCountResult.status === 'fulfilled' ? bypassCountResult.value.error : bypassCountResult.reason))
  }
  if (dispatchCountResult.status === 'fulfilled' && !dispatchCountResult.value.error) {
    summary.pendingDispatch = dispatchCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Pending dispatch count', dispatchCountResult.status === 'fulfilled' ? dispatchCountResult.value.error : dispatchCountResult.reason))
  }
  if (safetyReportCountResult.status === 'fulfilled' && !safetyReportCountResult.value.error) {
    summary.recentSafetyReports = safetyReportCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Safety report count', safetyReportCountResult.status === 'fulfilled' ? safetyReportCountResult.value.error : safetyReportCountResult.reason))
  }
  if (applicationCountResult.status === 'fulfilled' && !applicationCountResult.value.error) {
    summary.pendingApplications = applicationCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Pending application count', applicationCountResult.status === 'fulfilled' ? applicationCountResult.value.error : applicationCountResult.reason))
  }
  if (verificationCountResult.status === 'fulfilled' && !verificationCountResult.value.error) {
    summary.pendingVerifications = verificationCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Pending verification count', verificationCountResult.status === 'fulfilled' ? verificationCountResult.value.error : verificationCountResult.reason))
  }
  if (deletionCountResult.status === 'fulfilled' && !deletionCountResult.value.error) {
    summary.pendingDeletionRequests = deletionCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Pending deletion count', deletionCountResult.status === 'fulfilled' ? deletionCountResult.value.error : deletionCountResult.reason))
  }
  if (reviewQueueCountResult.status === 'fulfilled' && !reviewQueueCountResult.value.error) {
    summary.pendingReviewVisibility = reviewQueueCountResult.value.count ?? 0
  } else {
    issues.push(formatIssue('Pending review visibility count', reviewQueueCountResult.status === 'fulfilled' ? reviewQueueCountResult.value.error : reviewQueueCountResult.reason))
  }
  const workflowOpsIssues = opsIssues.filter((issue) => !DEDICATED_SECTION_ISSUE_TYPES.has(issue.issue_type))
  summary.openWorkflowIssues = workflowOpsIssues.length + legacyWorkflowIssues.length
  summary.ordersInEscrowCount = escrowOrders.length
  summary.ordersInEscrowValueLabel = formatGroupedCurrencyTotals(
    escrowOrders.map((order) => ({
      amount: order.total_amount ?? order.quoted_amount,
      currency: order.currency,
    })),
  )
  const openPayouts = payouts.filter((payout) => OPEN_PAYOUT_STATUSES.includes(payout.status as (typeof OPEN_PAYOUT_STATUSES)[number]))
  summary.pendingPayoutCount = openPayouts.length
  summary.pendingPayoutValueLabel = formatGroupedCurrencyTotals(
    openPayouts.map((payout) => ({
      amount: payout.amount,
      currency: payout.currency,
    })),
  )
  summary.flaggedContentCount =
    summary.unreviewedBypassLogs
    + reviewQueue.filter((review) => review.flagged).length
    + summary.recentSafetyReports

  const openOrderReviews = orderReviewRows.flatMap((row) =>
    parseOpenOrderReviews(row.special_note).map((review, index) => ({
      id: `${row.id}:${review.type}:${index}`,
      orderId: row.id,
      orderReference: row.reference ?? null,
      orderKind: row.order_kind ?? null,
      orderStage: row.stage ?? null,
      reviewType: review.type,
      requestedBy: review.requestedBy ?? 'Drape',
      requestedByRole: review.requestedBy,
      customerId: row.customer_id,
      tailorId: row.tailor_id,
      reasonLabel: review.reasonLabel,
      note: review.note,
      requestedAt: review.requestedAt,
      requestedFromStage: review.requestedFromStage,
    }))
  )
  summary.pendingOrderReviews = openOrderReviews.length

  const verificationIssuesByUserId = new Map<string, OpsIssueLedgerRow>()
  for (const issue of opsIssues) {
    if (issue.issue_type !== 'TAILOR_VERIFICATION') continue
    const userId = issue.user_id ?? issue.actor_id
    if (!userId) continue
    const existing = verificationIssuesByUserId.get(userId)
    if (!existing || Date.parse(issue.created_at) > Date.parse(existing.created_at)) {
      verificationIssuesByUserId.set(userId, issue)
    }
  }

  const applicationIssuesById = new Map<string, OpsIssueLedgerRow>()
  const deletionIssuesById = new Map<string, OpsIssueLedgerRow>()
  const bypassIssuesById = new Map<string, OpsIssueLedgerRow>()
  const reviewIssuesById = new Map<string, OpsIssueLedgerRow>()
  for (const issue of opsIssues) {
    if (!issue.related_entity_id) continue
    if (issue.issue_type === 'TAILOR_APPLICATION') applicationIssuesById.set(issue.related_entity_id, issue)
    if (issue.issue_type === 'ACCOUNT_DELETION_REQUEST') deletionIssuesById.set(issue.related_entity_id, issue)
    if (issue.issue_type === 'CONTACT_BYPASS') bypassIssuesById.set(issue.related_entity_id, issue)
    if (issue.issue_type === 'CONTENT_FLAG') reviewIssuesById.set(issue.related_entity_id, issue)
  }

  const orderIds = [...new Set([
    ...disputes.map((dispute) => dispute.order_id),
    ...openOrderReviews.map((review) => review.orderId),
    ...reviewQueue.map((review) => review.order_id),
    ...payouts.map((payout) => payout.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
    ...workflowOpsIssues.map((issue) => issue.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
    ...legacyWorkflowIssues.map((issue) => issue.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
  ])]
  const userIds = new Set<string>()
  const tailorProfileIds = new Set<string>()
  const dispatchTailorIds = new Set<string>()

  const ordersById = new Map<string, OrderRow>()
  const orderPaymentContextByOrderId = new Map<string, {
    alreadyRefundedAmount: number
    maxRefundableAmount: number
  }>()
  if (orderIds.length > 0) {
    const { data, error } = await client
      .from('orders')
      .select('id, reference, stage, quoted_amount, total_amount, currency, quoted_currency, delivery_method, fulfillment_option, customer_id, tailor_id')
      .in('id', orderIds)

    if (error) {
      issues.push(formatIssue('Order context', error))
    } else {
      for (const row of (data ?? []) as OrderRow[]) {
        ordersById.set(row.id, row)
        userIds.add(row.customer_id)
        userIds.add(row.tailor_id)
      }
    }

    const { data: orderPaymentsData, error: orderPaymentsError } = await client
      .from('order_payments')
      .select('id, order_id, phase, amount, currency, status, refunded_amount')
      .in('order_id', orderIds)

    if (orderPaymentsError) {
      issues.push(formatIssue('Order payment context', orderPaymentsError))
    } else {
      const paymentRows = (orderPaymentsData ?? []) as OrderPaymentContextRow[]
      for (const orderId of orderIds) {
        const payments = paymentRows.filter((row) => row.order_id === orderId)
        const capturedAmount = payments
          .filter((row) => ['SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED'].includes(row.status))
          .reduce((sum, row) => sum + Math.max(row.amount, 0), 0)
        const alreadyRefundedAmount = payments.reduce((sum, row) => sum + orderPaymentRefundedAmount(row), 0)
        orderPaymentContextByOrderId.set(orderId, {
          alreadyRefundedAmount,
          maxRefundableAmount: Math.max(capturedAmount - alreadyRefundedAmount, 0),
        })
      }
    }
  }

  for (const dispatchOrder of dispatchQueue) {
    userIds.add(dispatchOrder.customer_id)
    userIds.add(dispatchOrder.tailor_id)
    dispatchTailorIds.add(dispatchOrder.tailor_id)
  }

  for (const log of bypassLogs) {
    userIds.add(log.user_id)
  }

  for (const verification of pendingVerifications) {
    userIds.add(verification.user_id)
  }

  for (const deletionRequest of deletionRequests) {
    userIds.add(deletionRequest.user_id)
  }

  for (const payout of payouts) {
    tailorProfileIds.add(payout.tailor_profile_id)
  }

  for (const workflowIssue of workflowOpsIssues) {
    if (workflowIssue.actor_id) userIds.add(workflowIssue.actor_id)
    if (workflowIssue.user_id) userIds.add(workflowIssue.user_id)
    if (workflowIssue.tailor_profile_id) tailorProfileIds.add(workflowIssue.tailor_profile_id)
  }
  for (const workflowIssue of legacyWorkflowIssues) {
    if (workflowIssue.actor_id) userIds.add(workflowIssue.actor_id)
  }
  for (const review of openOrderReviews) {
    if (review.customerId) userIds.add(review.customerId)
    if (review.tailorId) userIds.add(review.tailorId)
  }

  const tailorProfilesById = new Map<string, TailorProfileContextRow>()
  if (tailorProfileIds.size > 0) {
    const { data, error } = await client
      .from('tailor_profiles')
      .select('id, user_id, display_name')
      .in('id', [...tailorProfileIds])

    if (error) {
      issues.push(formatIssue('Tailor payout context', error))
    } else {
      for (const row of (data ?? []) as TailorProfileContextRow[]) {
        tailorProfilesById.set(row.id, row)
        userIds.add(row.user_id)
      }
    }
  }

  const tailorProfilesByUserId = new Map<string, TailorProfileContextRow>()
  const tailorContextUserIds = new Set<string>([...dispatchTailorIds, ...userIds])
  if (tailorContextUserIds.size > 0) {
    const { data, error } = await client
      .from('tailor_profiles')
      .select('id, user_id, display_name, location')
      .in('user_id', [...tailorContextUserIds])

    if (error) {
      issues.push(formatIssue('Dispatch tailor context', error))
    } else {
      for (const row of (data ?? []) as TailorProfileContextRow[]) {
        tailorProfilesByUserId.set(row.user_id, row)
      }
    }
  }

  const customerProfilesByUserId = new Map<string, CustomerProfileContextRow>()
  if (userIds.size > 0) {
    const { data, error } = await client
      .from('customer_profiles')
      .select('user_id, display_name')
      .in('user_id', [...userIds])

    if (error) {
      issues.push(formatIssue('Customer context', error))
    } else {
      for (const row of (data ?? []) as CustomerProfileContextRow[]) {
        customerProfilesByUserId.set(row.user_id, row)
      }
    }
  }

  const usersById = new Map<string, UserRow>()

  for (const [userId, profile] of customerProfilesByUserId) {
    const existing = usersById.get(userId)
    usersById.set(userId, {
      id: userId,
      email: existing?.email ?? null,
      display_name: existing?.display_name?.trim() || profile.display_name || 'Customer',
      role: existing?.role ?? 'CUSTOMER',
    })
  }

  for (const [userId, profile] of tailorProfilesByUserId) {
    const existing = usersById.get(userId)
    usersById.set(userId, {
      id: userId,
      email: existing?.email ?? null,
      display_name: existing?.display_name?.trim() || profile.display_name || 'Tailor',
      role: existing?.role ?? 'TAILOR',
    })
  }

  return {
    summary,
    disputes: disputes.map((dispute) => {
      const order = ordersById.get(dispute.order_id)
      const customer = order ? usersById.get(order.customer_id) : null
      const tailor = order ? usersById.get(order.tailor_id) : null

      return {
        id: dispute.id,
        orderId: dispute.order_id,
        orderReference: order?.reference ?? null,
        orderStage: order?.stage ?? null,
        amount: order?.quoted_amount ?? null,
        currency: order?.currency ?? order?.quoted_currency ?? null,
        deliveryMethod: order?.delivery_method ?? null,
        fulfillmentOption: order?.fulfillment_option ?? null,
        customerName: customer?.display_name ?? 'Customer',
        customerEmail: customer?.email ?? null,
        tailorName: tailor?.display_name ?? 'Tailor',
        tailorEmail: tailor?.email ?? null,
        reason: dispute.reason,
        description: dispute.description,
        evidenceUrls: dispute.evidence_urls ?? [],
        status: dispute.status,
        resolution: dispute.resolution,
        resolvedAt: dispute.resolved_at,
        createdAt: dispute.created_at,
        updatedAt: dispute.updated_at,
      }
    }),
    bypassLogs: bypassLogs.map((log) => {
      const user = usersById.get(log.user_id)
      const issue = bypassIssuesById.get(log.id)

      return {
        id: log.id,
        displayId: issue?.issue_number ? formatOpsIssueNumber(issue.issue_number) : issueDisplayId('BYP', log.id),
        issueId: issue?.id ?? null,
        userId: log.user_id,
        userName: user?.display_name ?? 'Unknown user',
        userEmail: user?.email ?? null,
        userRole: user?.role ?? null,
        surface: log.surface,
        content: log.content,
        attempt: log.attempt,
        reviewed: log.reviewed,
        reviewedAt: log.reviewed_at,
        createdAt: log.created_at,
        history: issue?.id ? (issueHistoryByIssueId.get(issue.id) ?? []) : [],
      }
    }),
    applications: applications.map((application) => ({
      id: application.id,
      displayId: applicationIssuesById.get(application.id)?.issue_number
        ? formatOpsIssueNumber(applicationIssuesById.get(application.id)?.issue_number)
        : issueDisplayId('APP', application.id),
      issueId: applicationIssuesById.get(application.id)?.id ?? null,
      businessName: application.business_name,
      displayName: application.display_name,
      email: application.email,
      location: application.location,
      specialty: application.specialty,
      portfolioUrl: application.portfolio_url,
      instagramUrl: application.instagram_url,
      notes: application.notes,
      source: application.source,
      status: application.status,
      createdAt: application.created_at,
      history: applicationIssuesById.get(application.id)?.id
        ? (issueHistoryByIssueId.get(applicationIssuesById.get(application.id)!.id) ?? [])
        : [],
    })),
    pendingVerifications: pendingVerifications.map((profile) => {
      const user = usersById.get(profile.user_id)
      const verificationIssue = verificationIssuesByUserId.get(profile.user_id)

      return {
        displayId: verificationIssue?.issue_number ? formatOpsIssueNumber(verificationIssue.issue_number) : issueDisplayId('TAI', profile.id),
        issueId: verificationIssue?.id ?? null,
        profileId: profile.id,
        userId: profile.user_id,
        displayName: profile.display_name,
        email: user?.email ?? null,
        location: profile.location,
        specialtyTags: profile.specialty_tags ?? [],
        idDocumentUrl: profile.id_document_url,
        status: profile.id_verification_status,
        payoutAccountVerified: profile.payout_account_verified === true,
        payoutProvider: derivePayoutProvider(profile.payout_currency),
        payoutCurrency: profile.payout_currency ?? null,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
        history: verificationIssue?.id ? (issueHistoryByIssueId.get(verificationIssue.id) ?? []) : [],
      }
    }),
    deletionRequests: deletionRequests.map((deletionRequest) => {
      const user = usersById.get(deletionRequest.user_id)
      const issue = deletionIssuesById.get(deletionRequest.id)

      return {
        id: deletionRequest.id,
        displayId: issue?.issue_number ? formatOpsIssueNumber(issue.issue_number) : issueDisplayId('DEL', deletionRequest.id),
        issueId: issue?.id ?? null,
        userId: deletionRequest.user_id,
        displayName: user?.display_name ?? deletionRequest.email ?? 'Unknown user',
        email: user?.email ?? deletionRequest.email,
        role: deletionRequest.role,
        status: deletionRequest.status,
        reason: deletionRequest.reason,
        requestedAt: deletionRequest.requested_at,
        acknowledgedAt: deletionRequest.acknowledged_at,
        processedAt: deletionRequest.processed_at,
        source: metadataStringValue(deletionRequest.metadata, 'source'),
        history: issue?.id ? (issueHistoryByIssueId.get(issue.id) ?? []) : [],
      }
    }),
    reviewQueue: reviewQueue.map((review) => {
      const order = ordersById.get(review.order_id)
      const customer = order ? usersById.get(order.customer_id) : null
      const tailor = order ? usersById.get(order.tailor_id) : null
      const issue = reviewIssuesById.get(review.id)

      return {
        id: review.id,
        displayId: issue?.issue_number ? formatOpsIssueNumber(issue.issue_number) : issueDisplayId('REV', review.id),
        issueId: issue?.id ?? null,
        orderId: review.order_id,
        orderReference: order?.reference ?? null,
        orderStage: order?.stage ?? null,
        customerName: customer?.display_name ?? 'Customer',
        customerEmail: customer?.email ?? null,
        tailorName: tailor?.display_name ?? 'Tailor',
        tailorEmail: tailor?.email ?? null,
        reviewerName: review.reviewer_name ?? 'Customer',
        rating: review.rating,
        body: review.body,
        tags: review.tags ?? [],
        response: review.tailor_response,
        createdAt: review.created_at,
        publishedAt: review.published_at,
        flagged: review.flagged,
        history: issue?.id ? (issueHistoryByIssueId.get(issue.id) ?? []) : [],
      }
    }),
    payouts: payouts.map((payout) => {
      const tailorProfile = tailorProfilesById.get(payout.tailor_profile_id)
      const order = payout.order_id ? ordersById.get(payout.order_id) : null
      const tailorUser = tailorProfile ? usersById.get(tailorProfile.user_id) : order ? usersById.get(order.tailor_id) : null

      return {
        id: payout.id,
        tailorProfileId: payout.tailor_profile_id,
        tailorDisplayName: tailorProfile?.display_name ?? tailorUser?.display_name ?? 'Tailor',
        tailorEmail: tailorUser?.email ?? null,
        amount: payout.amount,
        currency: payout.currency,
        provider: payout.provider,
        status: payout.status,
        providerPayoutId: payout.provider_payout_id,
        blockedReason: payout.blocked_reason,
        orderId: payout.order_id,
        orderReference: order?.reference ?? null,
        initiatedAt: payout.initiated_at,
        completedAt: payout.completed_at,
        failedAt: payout.failed_at,
        processedAt: payout.processed_at,
      }
    }),
    orderReviews: openOrderReviews.map((review) => {
      const customer = review.customerId ? usersById.get(review.customerId) : null
      const tailor = review.tailorId ? usersById.get(review.tailorId) : null

      return {
        id: review.id,
        orderId: review.orderId,
        orderReference: review.orderReference,
        orderKind: review.orderKind,
        orderStage: review.orderStage,
        reviewType: review.reviewType,
        requestedBy:
          review.requestedByRole === 'CUSTOMER'
            ? customer?.display_name ?? 'Customer'
            : review.requestedByRole === 'TAILOR'
              ? tailor?.display_name ?? 'Tailor'
              : review.requestedBy,
        requestedByRole: review.requestedByRole,
        customerName: customer?.display_name ?? 'Customer',
        customerEmail: customer?.email ?? null,
        tailorName: tailor?.display_name ?? 'Tailor',
        tailorEmail: tailor?.email ?? null,
        reasonLabel: review.reasonLabel,
        note: review.note,
        requestedAt: review.requestedAt,
        requestedFromStage: review.requestedFromStage,
      }
    }),
    workflowIssues: [
      ...workflowOpsIssues.map((workflowIssue) => {
        const actorId = workflowIssue.actor_id ?? workflowIssue.user_id
        const actor = actorId ? usersById.get(actorId) : null
        const order = workflowIssue.order_id ? ordersById.get(workflowIssue.order_id) : null

        return {
          id: workflowIssue.id,
          displayId: formatOpsIssueNumber(workflowIssue.issue_number),
          event: workflowIssue.issue_type,
          issueType: workflowIssue.issue_type,
          severity: workflowIssue.severity,
          status: workflowIssue.status,
          source: workflowIssue.source,
          actorName: actor?.display_name ?? workflowIssue.actor_role ?? 'System',
          actorEmail: actor?.email ?? null,
          actorRole: workflowIssue.actor_role,
          orderId: workflowIssue.order_id,
          orderReference: order?.reference ?? null,
          orderStage: order?.stage ?? workflowIssue.stage ?? null,
          summary: workflowIssue.description,
          reason:
            payloadStringValue(workflowIssue.metadata, 'reason')
            ?? payloadStringValue(workflowIssue.metadata, 'blocked_reason'),
          blockedReasonCode: payloadStringValue(workflowIssue.metadata, 'blocked_reason'),
          provider: workflowIssue.provider ?? payloadStringValue(workflowIssue.metadata, 'provider'),
          payoutCurrency: payloadStringValue(workflowIssue.metadata, 'payout_currency'),
          lockedPayoutCurrency:
            payloadStringValue(workflowIssue.metadata, 'locked_payout_currency')
            ?? payloadStringValue(workflowIssue.metadata, 'source_currency'),
          orderTotalAmount: order?.total_amount ?? order?.quoted_amount ?? null,
          orderCurrency: order?.currency ?? order?.quoted_currency ?? null,
          alreadyRefundedAmount: workflowIssue.order_id
            ? (orderPaymentContextByOrderId.get(workflowIssue.order_id)?.alreadyRefundedAmount ?? 0)
            : 0,
          maxRefundableAmount: workflowIssue.order_id
            ? (orderPaymentContextByOrderId.get(workflowIssue.order_id)?.maxRefundableAmount ?? 0)
            : 0,
          trackingNumber: payloadStringValue(workflowIssue.metadata, 'tracking_number'),
          paymentStatus: payloadStringValue(workflowIssue.metadata, 'payment_status'),
          recommendedAction: workflowIssue.recommended_action,
          createdAt: workflowIssue.created_at,
          history: issueHistoryByIssueId.get(workflowIssue.id) ?? [],
        }
      }),
      ...legacyWorkflowIssues.map((workflowIssue) => {
        const actor = workflowIssue.actor_id ? usersById.get(workflowIssue.actor_id) : null
        const order = workflowIssue.order_id ? ordersById.get(workflowIssue.order_id) : null

        return {
          id: workflowIssue.id,
          displayId: issueDisplayId('ISS', workflowIssue.id),
          event: workflowIssue.event,
          issueType: workflowIssue.event,
          severity: workflowIssue.severity,
          status: 'OPEN',
          source: 'audit_logs',
          actorName: actor?.display_name ?? workflowIssue.actor_role ?? 'System',
          actorEmail: actor?.email ?? null,
          actorRole: workflowIssue.actor_role,
          orderId: workflowIssue.order_id,
          orderReference: order?.reference ?? null,
          orderStage: order?.stage ?? null,
          summary: formatWorkflowSummary(workflowIssue.event, workflowIssue.payload),
          reason: payloadStringValue(workflowIssue.payload, 'reason'),
          blockedReasonCode: payloadStringValue(workflowIssue.payload, 'blocked_reason'),
          provider: payloadStringValue(workflowIssue.payload, 'provider'),
          payoutCurrency: payloadStringValue(workflowIssue.payload, 'payout_currency'),
          lockedPayoutCurrency:
            payloadStringValue(workflowIssue.payload, 'locked_payout_currency')
            ?? payloadStringValue(workflowIssue.payload, 'source_currency'),
          orderTotalAmount: order?.total_amount ?? order?.quoted_amount ?? null,
          orderCurrency: order?.currency ?? order?.quoted_currency ?? null,
          alreadyRefundedAmount: workflowIssue.order_id
            ? (orderPaymentContextByOrderId.get(workflowIssue.order_id)?.alreadyRefundedAmount ?? 0)
            : 0,
          maxRefundableAmount: workflowIssue.order_id
            ? (orderPaymentContextByOrderId.get(workflowIssue.order_id)?.maxRefundableAmount ?? 0)
            : 0,
          trackingNumber: payloadStringValue(workflowIssue.payload, 'tracking_number'),
          paymentStatus: payloadStringValue(workflowIssue.payload, 'payment_status'),
          recommendedAction: workflowRecommendedAction(workflowIssue.event, workflowIssue.payload),
          createdAt: workflowIssue.created_at,
          history: [],
        }
      }),
    ].sort((left, right) => {
      const severityDiff = workflowSeverityRank(left.severity) - workflowSeverityRank(right.severity)
      if (severityDiff !== 0) return severityDiff
      return Date.parse(right.createdAt) - Date.parse(left.createdAt)
    }),
    dispatchQueue: dispatchQueue.map((order) => {
      const customer = usersById.get(order.customer_id)
      const tailor = usersById.get(order.tailor_id)
      const tailorProfile = tailorProfilesByUserId.get(order.tailor_id)

      return {
        orderId: order.id,
        orderReference: order.reference,
        orderKind: order.order_kind ?? null,
        garmentType: order.garment_type ?? 'Order',
        itemTitle: order.item_title ?? null,
        stage: order.stage,
        stageUpdatedAt: order.stage_updated_at ?? null,
        amount: order.quoted_amount ?? null,
        currency: order.currency ?? order.quoted_currency ?? null,
        deliveryMethod: order.delivery_method ?? null,
        customerName: customer?.display_name ?? 'Customer',
        customerEmail: customer?.email ?? null,
        tailorName: tailorProfile?.display_name ?? tailor?.display_name ?? 'Tailor',
        tailorEmail: tailor?.email ?? null,
        tailorLocation: tailorProfile?.location ?? null,
        deliveryAddress: order.delivery_address ?? null,
        recipientName: order.recipient_name ?? null,
        recipientPhone: order.recipient_phone ?? null,
        provider: order.fulfillment_provider ?? null,
        reference: order.fulfillment_reference ?? null,
        contactName: order.fulfillment_contact_name ?? null,
        contactPhone: order.fulfillment_contact_phone ?? null,
        trackingNumber: order.tracking_number ?? null,
        carrier: order.carrier ?? null,
      }
    }),
    issues,
  }
}
