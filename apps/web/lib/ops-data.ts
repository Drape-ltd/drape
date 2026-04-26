import 'server-only'

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
  created_at: string
  updated_at: string
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
  provider_payout_id: string | null
  order_id: string | null
  processed_at: string
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
}

export type OpsTailorApplication = {
  id: string
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
}

export type OpsVerification = {
  profileId: string
  userId: string
  displayName: string
  email: string | null
  location: string
  specialtyTags: string[]
  idDocumentUrl: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type OpsAccountDeletionRequest = {
  id: string
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
}

export type OpsPayout = {
  id: string
  tailorProfileId: string
  tailorDisplayName: string
  tailorEmail: string | null
  amount: number
  currency: string
  provider: string
  providerPayoutId: string | null
  orderId: string | null
  orderReference: string | null
  processedAt: string
}

export type OpsReviewQueueItem = {
  id: string
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
}

export type OpsWorkflowIssue = {
  id: string
  event: string
  severity: string
  actorName: string
  actorEmail: string | null
  actorRole: string | null
  orderId: string | null
  orderReference: string | null
  orderStage: string | null
  summary: string
  reason: string | null
  provider: string | null
  trackingNumber: string | null
  paymentStatus: string | null
  createdAt: string
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
    pendingOrderReviews: number
    unreviewedBypassLogs: number
    recentSafetyReports: number
    pendingApplications: number
    pendingVerifications: number
    pendingDeletionRequests: number
    pendingReviewVisibility: number
    pendingDispatch: number
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
    pendingOrderReviews: 0,
    unreviewedBypassLogs: 0,
    recentSafetyReports: 0,
    pendingApplications: 0,
    pendingVerifications: 0,
    pendingDeletionRequests: 0,
    pendingReviewVisibility: 0,
    pendingDispatch: 0,
  }
}

function metadataStringValue(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const WORKFLOW_ISSUE_EVENTS = [
  'conversation.safety_reported',
  'conversation.blocked',
  'payment.blocked',
  'privacy.data_access_requested',
  'seller.access_review_requested',
  'order.cancellation_review_requested',
  'order.delivery_review_requested',
  'shipping.handoff_blocked',
  'shipping.webhook_skipped',
  'shipping.delivery_order_missing',
  'shipping.delivery_skipped_wrong_stage',
  'shipping.delivery_update_failed',
] as const

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
    workflowIssuesResult,
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
      .select('id, reference, order_kind, garment_type, item_title, stage, stage_updated_at, quoted_amount, quoted_currency, delivery_method, fulfillment_option, delivery_address, recipient_name, recipient_phone, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, tracking_number, carrier, customer_id, tailor_id')
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
      .select('id, user_id, display_name, location, specialty_tags, id_document_url, id_verification_status, created_at, updated_at')
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
      .select('id, tailor_profile_id, amount, currency, provider, provider_payout_id, order_id, processed_at')
      .order('processed_at', { ascending: false })
      .limit(24),
    client
      .from('audit_logs')
      .select('id, created_at, actor_id, actor_role, event, severity, order_id, payload')
      .in('event', [...WORKFLOW_ISSUE_EVENTS])
      .order('created_at', { ascending: false })
      .limit(32),
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
  const workflowIssues =
    workflowIssuesResult.status === 'fulfilled' && !workflowIssuesResult.value.error
      ? ((workflowIssuesResult.value.data ?? []) as AuditLogRow[])
      : []

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
  if (workflowIssuesResult.status === 'rejected') issues.push(formatIssue('Workflow issues', workflowIssuesResult.reason))
  if (workflowIssuesResult.status === 'fulfilled' && workflowIssuesResult.value.error) {
    issues.push(formatIssue('Workflow issues', workflowIssuesResult.value.error))
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

  const orderIds = [...new Set([
    ...disputes.map((dispute) => dispute.order_id),
    ...openOrderReviews.map((review) => review.orderId),
    ...reviewQueue.map((review) => review.order_id),
    ...payouts.map((payout) => payout.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
    ...workflowIssues.map((issue) => issue.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
  ])]
  const userIds = new Set<string>()
  const tailorProfileIds = new Set<string>()
  const dispatchTailorIds = new Set<string>()

  const ordersById = new Map<string, OrderRow>()
  if (orderIds.length > 0) {
    const { data, error } = await client
      .from('orders')
      .select('id, reference, stage, quoted_amount, quoted_currency, delivery_method, fulfillment_option, customer_id, tailor_id')
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

  for (const workflowIssue of workflowIssues) {
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
        currency: order?.quoted_currency ?? null,
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

      return {
        id: log.id,
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
      }
    }),
    applications: applications.map((application) => ({
      id: application.id,
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
    })),
    pendingVerifications: pendingVerifications.map((profile) => {
      const user = usersById.get(profile.user_id)

      return {
        profileId: profile.id,
        userId: profile.user_id,
        displayName: profile.display_name,
        email: user?.email ?? null,
        location: profile.location,
        specialtyTags: profile.specialty_tags ?? [],
        idDocumentUrl: profile.id_document_url,
        status: profile.id_verification_status,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      }
    }),
    deletionRequests: deletionRequests.map((deletionRequest) => {
      const user = usersById.get(deletionRequest.user_id)

      return {
        id: deletionRequest.id,
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
      }
    }),
    reviewQueue: reviewQueue.map((review) => {
      const order = ordersById.get(review.order_id)
      const customer = order ? usersById.get(order.customer_id) : null
      const tailor = order ? usersById.get(order.tailor_id) : null

      return {
        id: review.id,
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
        providerPayoutId: payout.provider_payout_id,
        orderId: payout.order_id,
        orderReference: order?.reference ?? null,
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
    workflowIssues: workflowIssues.map((workflowIssue) => {
      const actor = workflowIssue.actor_id ? usersById.get(workflowIssue.actor_id) : null
      const order = workflowIssue.order_id ? ordersById.get(workflowIssue.order_id) : null

      return {
        id: workflowIssue.id,
        event: workflowIssue.event,
        severity: workflowIssue.severity,
        actorName: actor?.display_name ?? workflowIssue.actor_role ?? 'System',
        actorEmail: actor?.email ?? null,
        actorRole: workflowIssue.actor_role,
        orderId: workflowIssue.order_id,
        orderReference: order?.reference ?? null,
        orderStage: order?.stage ?? null,
        summary: formatWorkflowSummary(workflowIssue.event, workflowIssue.payload),
        reason: payloadStringValue(workflowIssue.payload, 'reason'),
        provider: payloadStringValue(workflowIssue.payload, 'provider'),
        trackingNumber: payloadStringValue(workflowIssue.payload, 'tracking_number'),
        paymentStatus: payloadStringValue(workflowIssue.payload, 'payment_status'),
        createdAt: workflowIssue.created_at,
      }
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
        currency: order.quoted_currency ?? null,
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
