import 'server-only'

import {
  buildOpsVerificationEvidenceSummary,
  formatOpsIssueNumber,
  normalizeAccountCurrency,
  payoutBlockReasonMessage,
  payoutWindowClosesAt,
  resolvePaymentProviderForCurrency,
  validateUuid,
  type OpsVerificationEvidenceSummary,
  type OpsVerificationProofItemEvidence,
  type PayoutBlockedReason,
} from '@drape/shared'

import { createServiceRoleClient } from './server-supabase'

const OPS_DASHBOARD_CACHE_TTL_MS = 15_000

let opsDashboardDataCache: {
  data: OpsDashboardData
  expiresAt: number
} | null = null

export function invalidateOpsDashboardDataCache() {
  opsDashboardDataCache = null
}

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
  trust_verification_video_path: string | null
  trust_verification_challenge_id: string | null
  trust_verification_challenge_text: string | null
  avatar_url: string | null
  portfolio_photo_urls: string[] | null
  portfolio_video_urls: string[] | null
  id_verification_status: string
  id_verification_submitted_at?: string | null
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
  provider_transfer_status: string | null
  bank_settlement_status: string | null
  provider_bank_payout_id: string | null
  bank_settlement_expected_at: string | null
  bank_settlement_completed_at: string | null
  bank_settlement_failed_at: string | null
  bank_settlement_failure_code: string | null
  blocked_reason: string | null
  order_id: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  processed_at: string
}

type MoneyDeskRequestRow = {
  id: string
  reference: string
  action_type: string
  status: string
  target_type: string
  target_id: string
  order_id: string | null
  case_id: string | null
  amount: number | null
  currency: string | null
  amount_usd_equivalent: number | null
  usd_equivalent_source: string | null
  reason: string
  action_payload: Record<string, unknown> | null
  requester_email: string
  requester_role: string
  risk_level: string
  risk_reasons: string[] | null
  required_approval_count: number
  approval_count: number
  correlation_id: string
  execution_outcome: string | null
  provider_reference: string | null
  approved_at: string | null
  terminal_at: string | null
  created_at: string
  updated_at: string
}

type MoneyDeskDecisionRow = {
  request_id: string
  decision: 'APPROVE' | 'REJECT'
  approver_email: string
  approver_role: string
  created_at: string
}

type FinancialCaseReviewRow = {
  id: string
  reference: string
  reason_code: string
  summary: string
  claim_details: Record<string, unknown> | null
}

type FinancialCaseEvidenceReviewRow = {
  id: string
  case_id: string
  evidence_type: string
  source: string
  verification_status: string
  visibility: string
  storage_bucket: string | null
  storage_object_path: string | null
  external_reference: string | null
  mime_type: string | null
  captured_at: string
}

type OrderPaymentContextRow = {
  id: string
  order_id: string
  phase: string
  provider: string
  amount: number
  currency: string | null
  status: string
  refunded_amount: number | null
  confirmed_at?: string | null
  failed_at?: string | null
  created_at?: string | null
}

type SellerItemRow = {
  id: string
  tailor_profile_id: string
  title: string
  description: string | null
  category: string | null
  sizes: string[] | null
  price_amount: number | null
  currency: string
  photo_urls: string[] | null
  is_live: boolean
  stock_status: string
  inventory_quantity?: number | null
  size_inventory?: Record<string, unknown> | null
  pickup_available: boolean
  delivery_available: boolean
  shipping_available: boolean
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  order_id: string
  sender_id: string
  sender_role: string | null
  sender_name: string | null
  type: string | null
  body: string | null
  photo_url: string | null
  voice_url: string | null
  read_at: string | null
  created_at: string
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

type ConversationAccessLogRow = {
  id: string
  created_at: string
  actor_id: string | null
  actor_role: string | null
  event: string
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

type PayoutChangeReviewRow = {
  id: string
  status: string
  current_destination: Record<string, unknown> | null
  requested_destination: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  submitted_at: string | null
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
  source_amount?: number | null
  source_currency?: string | null
  subtotal_amount?: number | null
  platform_fee_amount?: number | null
  tax_amount?: number | null
  shipping_amount?: number | null
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
  handoff_completed_at?: string | null
  customer_handoff_confirmed_at?: string | null
  handoff_confirmation_source?: string | null
  escrow_released?: boolean | null
  escrow_released_at?: string | null
  customer_id: string
  tailor_id: string
}

type FulfillmentRunRow = {
  id: string
  order_id: string
  status: string
  funding_status: string
  currency: string
  captured_allowance_amount: number
  customer_funded_allowance_amount: number
  drapeon_subsidy_amount: number
  actual_provider_cost_amount: number | null
  shortfall_subtotal_amount: number
  shortfall_tax_amount: number
  shortfall_fee_amount: number
  shortfall_total_amount: number
  unused_allowance_amount: number
  customer_refund_amount: number
  customer_refund_tax_amount: number
  customer_refund_status: string
  subsidy_restored_amount: number
  provider_name: string | null
  provider_quote_reference: string | null
  provider_quote_evidence: unknown[] | null
  customer_decision: string | null
  custody_accepted_at: string | null
}

type FulfillmentParcelRow = {
  id: string
  order_id: string
  parcel_number: number
  status: string
  provider_name: string | null
  service_level: string | null
  provider_reference: string | null
  tracking_number: string | null
  tracking_url: string | null
  eta_at: string | null
  eta_timezone: string | null
  last_location: Record<string, unknown> | null
  last_status_at: string | null
}

type FulfillmentEventRow = {
  id: string
  order_id: string
  event_type: string
  source: string
  customer_note: string | null
  occurred_at: string
  evidence_media: unknown[] | null
  eta_at: string | null
  eta_timezone: string | null
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
  capturedAmount: number
  alreadyRefundedAmount: number
  refundableAmount: number
  unreleasedMaterialAmount: number
  refundablePaymentCount: number
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
  trustVideoUrl: string | null
  trustChallengeId: string | null
  trustChallengeText: string | null
  avatarUrl: string | null
  portfolioPhotoUrls: string[]
  portfolioVideoUrls: string[]
  proofItems: OpsVerificationProofItemEvidence[]
  evidenceSummary: OpsVerificationEvidenceSummary
  status: string
  idVerificationSubmittedAt: string | null
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
  providerTransferStatus: string | null
  bankSettlementStatus: string | null
  providerBankPayoutId: string | null
  bankSettlementExpectedAt: string | null
  bankSettlementCompletedAt: string | null
  bankSettlementFailedAt: string | null
  bankSettlementFailureCode: string | null
  blockedReason: string | null
  blockedReasonMessage: string | null
  orderId: string | null
  orderReference: string | null
  orderStage: string | null
  orderKind: string | null
  orderTotalAmount: number | null
  orderCurrency: string | null
  sourceAmount: number | null
  sourceCurrency: string | null
  platformFeeAmount: number | null
  taxAmount: number | null
  shippingAmount: number | null
  handoffCompletedAt: string | null
  customerHandoffConfirmedAt: string | null
  handoffConfirmationSource: string | null
  payoutReadyAt: string | null
  escrowReleased: boolean
  escrowReleasedAt: string | null
  paymentStatus: string | null
  paymentProvider: string | null
  capturedAmount: number
  alreadyRefundedAmount: number
  maxRefundableAmount: number
  initiatedAt: string | null
  completedAt: string | null
  failedAt: string | null
  processedAt: string
}

export type OpsSettlementTranche = {
  id: string
  orderId: string
  code: string
  sequence: number
  amount: number
  currency: string
  status: string
  eligibleAt: string | null
  waitingHours: number
  planStatus: string
  frozenReason: string | null
}

export type OpsShopItem = {
  id: string
  title: string
  category: string | null
  tailorProfileId: string
  tailorDisplayName: string
  tailorEmail: string | null
  priceAmount: number | null
  currency: string
  photoUrls: string[]
  isLive: boolean
  stockStatus: string
  inventoryQuantity: number
  sizeInventoryLabel: string
  sizes: string[]
  fulfillment: string[]
  createdAt: string
  updatedAt: string
  riskLabels: string[]
}

export type OpsSupportThread = {
  orderId: string
  orderReference: string | null
  orderStage: string | null
  orderKind: string | null
  deliveryMethod: string | null
  paymentStatus: string | null
  paymentProvider: string | null
  customerName: string
  customerEmail: string | null
  tailorName: string
  tailorEmail: string | null
  latestSenderName: string
  latestSenderRole: string
  latestMessagePreview: string
  latestMessageType: string
  latestMessageAt: string
  unreadCount: number
  messageCount: number
  mediaCount: number
  blockedMessageCount: number
  conversationBlocked: boolean
  blockedAt: string | null
  blockedByRole: string | null
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
  relatedEntityType: string | null
  relatedEntityId: string | null
  financialCaseId: string | null
  refundResolutionId: string | null
  refundResolution: {
    id: string
    status: string
    amount: number
    currency: string
    providerReference: string | null
    orderOutcome: string
    outcomeAppliedAt: string | null
    reviewedOrderOutcome: string | null
    reviewedOutcomeReason: string | null
    reviewedOutcomeAppliedAt: string | null
  } | null
  materialAdvanceId: string | null
  materialAdvanceAmount: number | null
  materialAdvanceCurrency: string | null
  materialReconciliationOutcome: string | null
  materialReconciliationDelta: number | null
  materialCustomerRefundAmount: number
  materialUnapprovedOverageAmount: number
  summary: string
  reason: string | null
  blockedReasonCode: string | null
  provider: string | null
  payoutId: string | null
  payoutError: string | null
  payoutCurrency: string | null
  lockedPayoutCurrency: string | null
  orderTotalAmount: number | null
  orderCurrency: string | null
  alreadyRefundedAmount: number
  maxRefundableAmount: number
  trackingNumber: string | null
  paymentStatus: string | null
  consultationAttendance: {
    reviewId: string
    bookingId: string
    reviewStatus: string
    reportedByRole: string
    reportedReason: string
    counterpartyResponseCode: string | null
    counterpartyResponse: string | null
    evidenceOutcome: string
    providerEvidenceComplete: boolean
    customerVerifiedSeconds: number
    tailorVerifiedSeconds: number
    verifiedOverlapSeconds: number
    feeAmount: number | null
    feeCurrency: string | null
    paymentStatus: string
    settlementStatus: string
  } | null
  payoutChangeReview: {
    requestId: string
    status: string
    submittedAt: string | null
    currentDestination: {
      provider: string | null
      currency: string | null
      bankName: string | null
      accountName: string | null
      accountMasked: string | null
      countryCode: string | null
      accountVerified: boolean
    } | null
    requestedDestination: {
      provider: string | null
      currency: string | null
      bankName: string | null
      accountName: string | null
      accountMasked: string | null
      countryCode: string | null
      accountVerified: boolean
    } | null
    accountHolderMatch: boolean | null
    riskSignals: string[]
    lifecycleState: string | null
    confirmationStatus: string | null
    confirmedAt: string | null
  } | null
  fabricReview: {
    candidateId: string
    componentCode: string
    status: string
    supplierCostAmount: number
    currency: string
    providerStatus: string | null
    providerReference: string | null
    reconciliationStatus: string | null
    correlationId: string
    estimateUrl: string | null
    receiptUrl: string | null
    customerMediaUrls: string[]
    acquiredMediaUrls: string[]
    ledgerEntries: Array<{ accountCode: string; direction: string; amount: number; currency: string }>
  } | null
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
  checkoutFulfillmentAmount: number
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
  fulfillmentRun: {
    id: string
    status: string
    fundingStatus: string
    currency: string
    capturedAllowanceAmount: number
    customerFundedAllowanceAmount: number
    drapeonSubsidyAmount: number
    actualProviderCostAmount: number | null
    shortfallSubtotalAmount: number
    shortfallTaxAmount: number
    shortfallFeeAmount: number
    shortfallTotalAmount: number
    unusedAllowanceAmount: number
    customerRefundAmount: number
    customerRefundTaxAmount: number
    customerRefundStatus: string
    subsidyRestoredAmount: number
    providerName: string | null
    providerQuoteReference: string | null
    providerQuoteEvidenceCount: number
    providerQuoteEvidence: Array<{ url: string; mimeType: string | null }>
    customerDecision: string | null
    custodyAcceptedAt: string | null
  } | null
  parcels: Array<{
    id: string
    parcelNumber: number
    status: string
    providerName: string | null
    serviceLevel: string | null
    providerReference: string | null
    trackingNumber: string | null
    trackingUrl: string | null
    etaAt: string | null
    etaTimezone: string | null
    lastLocation: Record<string, unknown> | null
    lastStatusAt: string | null
  }>
  fulfillmentEvents: Array<{
    id: string
    eventType: string
    source: string
    customerNote: string | null
    occurredAt: string
    evidenceCount: number
    evidence: Array<{ url: string; mimeType: string | null }>
    etaAt: string | null
    etaTimezone: string | null
  }>
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
  riskAction: 'OPS_FOLLOW_UP' | 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED' | null
}

export type OpsMoneyDeskRequest = {
  id: string
  reference: string
  actionType: string
  status: string
  targetType: string
  targetId: string
  orderId: string | null
  caseId: string | null
  amount: number | null
  currency: string | null
  amountUsdEquivalent: number | null
  usdEquivalentSource: string | null
  reason: string
  requesterEmail: string
  requesterRole: string
  riskLevel: string
  riskReasons: string[]
  requiredApprovalCount: number
  approvalCount: number
  correlationId: string
  executionOutcome: string | null
  providerReference: string | null
  approvedAt: string | null
  terminalAt: string | null
  createdAt: string
  updatedAt: string
  originIssue: {
    id: string
    displayId: string
    title: string
    summary: string
    recommendedAction: string
    severity: string
    status: string
  } | null
  payoutChangeReview: OpsWorkflowIssue['payoutChangeReview']
  decisions: Array<{
    decision: 'APPROVE' | 'REJECT'
    approverEmail: string
    approverRole: string
    createdAt: string
  }>
  evidenceCase: {
    reference: string
    reasonCode: string
    summary: string
    decisionBasis: string | null
    orderOutcome: string | null
    resumeStage: string | null
    evidence: Array<{
      id: string
      evidenceType: string
      source: string
      verificationStatus: string
      visibility: string
      externalReference: string | null
      mimeType: string | null
      capturedAt: string
      signedUrl: string | null
    }>
  } | null
}

export type OpsReturnResolution = {
  id: string
  reference: string
  orderId: string
  financialCaseId: string
  reasonCode: string
  requestedRemedy: string
  summary: string
  eligibilityStatus: string
  eligibilityReason: string
  returnRequired: boolean
  status: string
  responseDueAt: string
  correlationId: string
  proposalId: string | null
  proposalRemedy: string | null
  proposalAmount: number | null
  proposalCurrency: string | null
  proposalStatus: string | null
  refundResolutionId: string | null
  refundAmount: number | null
  refundCurrency: string | null
  refundStatus: string | null
  recoveryAmount: number
  createdAt: string
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
    deadJobs: number
    retryableJobs: number
    providersDegraded: number
    shopInventoryAlerts: number
    activeSupportThreads: number
    pendingMoneyDeskApprovals: number
    activeCommunicationCampaigns: number
  }
  systemHealth: {
    jobQueue: {
      pending: number
      retryable: number
      processing: number
      dead: number
      oldestPendingAt: string | null
      oldestProcessingAt: string | null
    }
    providers: Array<{
      provider: string
      operation: string
      status: string
      failureCount: number
      circuitOpenUntil: string | null
      lastError: string | null
      updatedAt: string | null
    }>
  }
  disputes: OpsDispute[]
  bypassLogs: OpsBypassLog[]
  applications: OpsTailorApplication[]
  pendingVerifications: OpsVerification[]
  deletionRequests: OpsAccountDeletionRequest[]
  reviewQueue: OpsReviewQueueItem[]
  payouts: OpsPayout[]
  settlementTranches: OpsSettlementTranche[]
  moneyDeskRequests: OpsMoneyDeskRequest[]
  returnResolutions: OpsReturnResolution[]
  benefitCampaigns: Array<{campaignId:string;benefitId:string|null;name:string;status:string;fundingSource:string;currency:string|null;budgetAmount:number|null;reservedAmount:number;consumedAmount:number;redemptionCount:number;redeemedAmount:number;reversalCount:number}>
  tips: Array<{id:string;orderId:string;amount:number;currency:string;status:string;provider:string|null;providerReference:string|null;correlationId:string;createdAt:string}>
  commercialDeliveryOutcomes: Array<{source:string;jobType:string;status:string;outcomeCount:number;oldestCreatedAt:string|null;latestUpdatedAt:string|null}>
  communicationCampaigns: Array<{
    id:string;name:string;kind:string;category:string;purpose:string;severity:string;status:string;
    templateVersionId:string|null;commercialCampaignId:string|null;audienceDefinition:Record<string,unknown>;
    channelPolicy:Record<string,unknown>;destination:Record<string,unknown>;acknowledgementRequired:boolean;
    riskLevel:string;scheduledAt:string|null;expiresAt:string|null;createdBy:string|null;createdByEmail:string|null;
    approvedAt:string|null;startedAt:string|null;completedAt:string|null;correlationId:string;createdAt:string;
    updatedAt:string;requiredApprovals:number;lastError:string|null;recipientCount:number;deliveredCount:number;
    failedCount:number;skippedCount:number;approvals:Array<{reviewerId:string|null;reviewerEmail:string|null;decision:string;reason:string;createdAt:string}>;
  }>
  communicationRecipients: Array<{
    id:string;campaignId:string;userId:string;status:string;channels:string[];channelOutcomes:Record<string,unknown>;
    queuedAt:string|null;completedAt:string|null;createdAt:string;updatedAt:string;
  }>
  serviceIncidents: Array<{
    id:string;incidentKey:string;title:string;summary:string;severity:string;status:string;affectedServices:string[];
    publicVisible:boolean;acknowledgementRequired:boolean;destination:Record<string,unknown>;source:string;
    sourceReference:string|null;startedAt:string;resolvedAt:string|null;updatedAt:string;communicationCampaignId:string|null;
  }>
  taxControls: Array<{
    activationId:string; environment:string; policyVersion:string; status:string;
    jurisdictionCountryCode:string; originCountryCode:string|null; destinationCountryCode:string|null;
    transactionType:string; fulfillmentClassification:string; reviewedAt:string; reviewDueAt:string;
    healthStatus:string; affectedOpenReservations:number; snapshotCount:number; correlationId:string; sourceUrls:string[];
  }>
  taxDecisions: Array<{
    snapshotId:string; orderId:string|null; policyVersion:string; transactionType:string;
    fulfillmentClassification:string; jurisdictionCountryCode:string; corridorKey:string|null;
    supplyCharacterization:string; responsibleParty:string; registrationDecision:string;
    lineClassifications:unknown[]; collectionMode:string; currency:string; subtotalAmount:number;
    shippingAmount:number; taxAmount:number; importTaxAmount:number; dutyAmount:number;
    calculationProvider:string; filingLiabilityAccount:string; importTaxLiabilityAccount:string|null;
    dutyLiabilityAccount:string|null; requiredExportEvidence:string[]; requiredCustomsFields:string[]; sourceUrls:string[];
    reviewDueAt:string; correlationId:string; createdAt:string;
  }>
  shopItems: OpsShopItem[]
  supportThreads: OpsSupportThread[]
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
    deadJobs: 0,
    retryableJobs: 0,
    providersDegraded: 0,
    shopInventoryAlerts: 0,
    activeSupportThreads: 0,
    pendingMoneyDeskApprovals: 0,
    activeCommunicationCampaigns: 0,
  }
}

function numberPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function metadataStringValue(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function trustVideoStoragePath(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null

  let path = trimmed
  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const decodedPath = decodeURIComponent(url.pathname)
      const match = decodedPath.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?trust-verification\/(.+)$/u)
      if (!match?.[1]) return null
      path = match[1]
    } catch {
      return null
    }
  }

  path = path.replace(/^\/+/u, '').replace(/^trust-verification\//u, '')
  if (!path.startsWith('verification-video/')) return null
  return path
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

function payoutDestinationReviewValue(destination: Record<string, unknown> | null) {
  if (!destination) return null
  return {
    provider: payloadStringValue(destination, 'payout_provider'),
    currency: payloadStringValue(destination, 'payout_currency'),
    bankName: payloadStringValue(destination, 'payout_bank_name'),
    accountName: payloadStringValue(destination, 'payout_account_name'),
    accountMasked: payloadStringValue(destination, 'payout_account_masked'),
    countryCode: payloadStringValue(destination, 'payout_country_code'),
    accountVerified: destination.payout_account_verified === true,
  }
}

function normalizedPayoutName(value: string | null) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

function buildPayoutChangeReview(row: PayoutChangeReviewRow): NonNullable<OpsWorkflowIssue['payoutChangeReview']> {
  const currentDestination = payoutDestinationReviewValue(row.current_destination)
  const requestedDestination = payoutDestinationReviewValue(row.requested_destination)
  const currentName = normalizedPayoutName(currentDestination?.accountName ?? null)
  const requestedName = normalizedPayoutName(requestedDestination?.accountName ?? null)
  const accountHolderMatch = currentName && requestedName ? currentName === requestedName : null
  const riskSignals: string[] = []
  if (currentDestination?.provider !== requestedDestination?.provider) riskSignals.push('Provider changed')
  if (currentDestination?.currency !== requestedDestination?.currency) riskSignals.push('Currency changed')
  if (currentDestination?.bankName !== requestedDestination?.bankName) riskSignals.push('Bank changed')
  if (currentDestination?.accountMasked !== requestedDestination?.accountMasked) riskSignals.push('Account changed')
  if (accountHolderMatch === false) riskSignals.push('Account holder name changed')
  if (requestedDestination?.accountVerified !== true) riskSignals.push('Provider verification incomplete')
  const metadata = row.metadata ?? {}

  return {
    requestId: row.id,
    status: row.status,
    submittedAt: row.submitted_at ?? row.updated_at,
    currentDestination,
    requestedDestination,
    accountHolderMatch,
    riskSignals,
    lifecycleState: payloadStringValue(metadata, 'lifecycle_state'),
    confirmationStatus: payloadStringValue(metadata, 'confirmation_status'),
    confirmedAt: payloadStringValue(metadata, 'confirmed_at'),
  }
}

type OpenOrderReviewMeta = {
  type: 'CANCELLATION' | 'DELIVERY'
  requestedBy: 'CUSTOMER' | 'TAILOR' | null
  reasonLabel: string
  note: string | null
  requestedAt: string | null
  requestedFromStage: string | null
  riskAction: 'OPS_FOLLOW_UP' | 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED' | null
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
        riskAction: 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED',
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
        riskAction:
          deliveryReview.riskAction === 'ORDER_AND_UNRELEASED_SETTLEMENT_PAUSED'
            ? deliveryReview.riskAction
            : deliveryReview.riskAction === 'OPS_FOLLOW_UP'
              ? deliveryReview.riskAction
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
      return 'Confirm whether the block should stand or the conversation can reopen safely inside Drapeon.'
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
      return 'Resolve the missing dispatch detail or courier handoff issue blocking Drapeon-managed delivery.'
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

function formatSizeInventory(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== 'object') return '—'

  const entries = Object.entries(value)
    .map(([size, count]) => [size, typeof count === 'number' ? count : Number.parseInt(String(count), 10)] as const)
    .filter(([, count]) => Number.isFinite(count))

  if (entries.length === 0) return '—'

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([size, count]) => `${size}: ${count}`)
    .join(' · ')
}

function sellerItemRiskLabels(item: SellerItemRow) {
  const labels: string[] = []
  const inventory = typeof item.inventory_quantity === 'number' ? item.inventory_quantity : 0
  const photos = item.photo_urls ?? []
  const fulfillmentReady = item.pickup_available || item.delivery_available || item.shipping_available

  if (!item.is_live || item.stock_status === 'HIDDEN') labels.push('Hidden from buyers')
  if (item.stock_status === 'SOLD_OUT' || inventory <= 0) labels.push('Sold out')
  if (item.stock_status === 'LOW_STOCK' || inventory === 1) labels.push('Low stock')
  if (photos.length === 0) labels.push('Missing photos')
  if (!fulfillmentReady) labels.push('No fulfillment option')

  return labels
}

function cleanMediaUrls(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return []
  return value
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter((url) => url.length > 0)
}

function isVerificationProofItem(item: SellerItemRow) {
  return item.is_live === false || item.stock_status === 'HIDDEN'
}

function mapVerificationProofItem(item: SellerItemRow): OpsVerificationProofItemEvidence {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    description: item.description,
    mediaUrls: cleanMediaUrls(item.photo_urls),
    isLive: item.is_live,
    stockStatus: item.stock_status,
    inventoryQuantity: typeof item.inventory_quantity === 'number' ? item.inventory_quantity : 0,
    sizes: item.sizes ?? [],
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

function orderPaymentRefundedAmount(payment: OrderPaymentContextRow) {
  if (payment.status === 'REFUNDED') return Math.max(payment.amount, 0)
  if (typeof payment.refunded_amount === 'number') return Math.max(Math.min(payment.refunded_amount, payment.amount), 0)
  return 0
}

function payoutBlockedReasonCopy(reason: string | null) {
  if (!reason) return null

  try {
    return payoutBlockReasonMessage(reason as PayoutBlockedReason)
  } catch {
    return reason.replace(/_/g, ' ').toLowerCase()
  }
}

function messagePreview(message: MessageRow) {
  const type = (message.type ?? 'TEXT').toUpperCase()
  const content = message.body?.trim()
  if (content) return content.length > 180 ? `${content.slice(0, 177)}...` : content
  if (type === 'IMAGE' || type === 'PHOTO' || message.photo_url) return 'Photo message'
  if (type === 'AUDIO' || type === 'VOICE' || message.voice_url) return 'Voice note'
  return 'Message'
}

function messageMediaCount(messages: MessageRow[]) {
  return messages.filter((message) => {
    const type = (message.type ?? '').toUpperCase()
    return !!message.photo_url || !!message.voice_url || ['IMAGE', 'PHOTO', 'AUDIO', 'VOICE'].includes(type)
  }).length
}

async function loadOpsDashboardDataFresh(): Promise<OpsDashboardData | null> {
  const client = createServiceRoleClient()
  if (!client) return null

  const issues: string[] = []

  const [
    disputesResult,
    orderReviewsResult,
    bypassResult,
    messagesResult,
    conversationAccessLogsResult,
    safetyReportCountResult,
    dispatchQueueResult,
    applicationsResult,
    verificationsResult,
    deletionRequestsResult,
    reviewQueueResult,
    sellerItemsResult,
    payoutsResult,
    settlementTranchesResult,
    moneyDeskRequestsResult,
    returnResolutionsResult,
    benefitCampaignsResult,
    tipsResult,
    commercialDeliveryOutcomesResult,
    communicationCampaignsResult,
    communicationApprovalsResult,
    communicationRecipientsResult,
    serviceIncidentsResult,
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
    jobQueueHealthResult,
    providerHealthResult,
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
      .from('messages')
      .select('id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(160),
    client
      .from('audit_logs')
      .select('id, created_at, actor_id, actor_role, event, order_id, payload')
      .in('event', ['conversation.blocked', 'conversation.unblocked'])
      .order('created_at', { ascending: false })
      .limit(120),
    client
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('event', 'conversation.safety_reported')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    client
      .from('orders')
      .select('id, reference, order_kind, garment_type, item_title, stage, stage_updated_at, quoted_amount, shipping_amount, currency, quoted_currency, delivery_method, fulfillment_option, delivery_address, recipient_name, recipient_phone, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, tracking_number, carrier, customer_id, tailor_id')
      .in('stage', ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED'])
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
      .select('id, user_id, display_name, location, specialty_tags, trust_verification_video_path, trust_verification_challenge_id, trust_verification_challenge_text, avatar_url, portfolio_photo_urls, portfolio_video_urls, id_verification_status, id_verification_submitted_at, payout_account_verified, payout_provider, payout_currency, created_at, updated_at')
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
      .from('seller_items')
      .select('id, tailor_profile_id, title, description, category, sizes, price_amount, currency, photo_urls, is_live, stock_status, inventory_quantity, size_inventory, pickup_available, delivery_available, shipping_available, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(48),
    client
      .from('payouts')
      .select('id, tailor_profile_id, amount, currency, provider, status, provider_payout_id, provider_transfer_status, bank_settlement_status, provider_bank_payout_id, bank_settlement_expected_at, bank_settlement_completed_at, bank_settlement_failed_at, bank_settlement_failure_code, blocked_reason, order_id, initiated_at, completed_at, failed_at, processed_at')
      .order('processed_at', { ascending: false })
      .limit(24),
    client
      .from('order_settlement_tranches')
      .select('id, order_id, code, sequence, amount, currency, status, eligible_at, order_settlement_plans!inner(status, frozen_reason)')
      .in('status', ['ELIGIBLE', 'RELEASE_REQUESTED', 'BLOCKED'])
      .order('eligible_at', { ascending: true, nullsFirst: false })
      .limit(100),
    client
      .from('money_desk_requests')
      .select('id, reference, action_type, status, target_type, target_id, order_id, case_id, amount, currency, amount_usd_equivalent, usd_equivalent_source, reason, action_payload, requester_email, requester_role, risk_level, risk_reasons, required_approval_count, approval_count, correlation_id, execution_outcome, provider_reference, approved_at, terminal_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(100),
    client
      .from('order_return_requests')
      .select('id, reference, order_id, financial_case_id, reason_code, requested_remedy, summary, eligibility_status, eligibility_reason, return_required, status, response_due_at, correlation_id, created_at, order_resolution_proposals(id, version, remedy, amount, currency, status), order_refund_resolutions(id, amount, currency, status, released_tailor_recovery_amount)')
      .not('status', 'in', '(RESOLVED,CANCELLED)')
      .order('created_at', { ascending: true })
      .limit(100),
    client.from('commercial_benefit_reporting').select('campaign_id, benefit_id, name, status, funding_source, currency, budget_amount, reserved_amount, consumed_amount, redemption_count, redeemed_amount, reversal_count').order('name').limit(100),
    client.from('order_tips').select('id, order_id, amount, currency, status, provider, provider_reference, correlation_id, created_at').order('created_at', { ascending: false }).limit(100),
    client.from('commercial_delivery_outcome_reporting').select('source, job_type, status, outcome_count, oldest_created_at, latest_updated_at').limit(100),
    client.from('communication_campaigns').select('id,name,kind,category,purpose,severity,status,template_version_id,commercial_campaign_id,audience_definition,channel_policy,destination,acknowledgement_required,risk_level,scheduled_at,expires_at,created_by,created_by_email,approved_at,started_at,completed_at,correlation_id,created_at,updated_at,required_approvals,last_error,recipient_count,delivered_count,failed_count,skipped_count').order('created_at', { ascending: false }).limit(100),
    client.from('communication_campaign_approvals').select('campaign_id,reviewer_id,reviewer_email,decision,reason,created_at').order('created_at', { ascending: false }).limit(300),
    client.from('communication_campaign_recipients').select('id,campaign_id,user_id,status,channel_outcomes,channels,queued_at,completed_at,created_at,updated_at').order('created_at', { ascending: false }).limit(300),
    client.from('service_incidents').select('id,incident_key,title,summary,severity,status,affected_services,public_visible,acknowledgement_required,destination,source,source_reference,started_at,resolved_at,updated_at,communication_campaign_id').order('updated_at', { ascending: false }).limit(100),
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
      .in('status', ['PENDING', 'ACKNOWLEDGED', 'BLOCKED', 'READY_FOR_FINALIZATION']),
    client
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .or('flagged.eq.true,published_at.is.null'),
    client.rpc('get_job_queue_health'),
    client.rpc('get_provider_health'),
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
  const messages =
    messagesResult.status === 'fulfilled' && !messagesResult.value.error
      ? ((messagesResult.value.data ?? []) as MessageRow[])
      : []
  const conversationAccessLogs =
    conversationAccessLogsResult.status === 'fulfilled' && !conversationAccessLogsResult.value.error
      ? ((conversationAccessLogsResult.value.data ?? []) as ConversationAccessLogRow[])
      : []
  const dispatchQueue =
    dispatchQueueResult.status === 'fulfilled' && !dispatchQueueResult.value.error
      ? ((dispatchQueueResult.value.data ?? []) as OrderRow[])
      : []
  const dispatchOrderIds = dispatchQueue.map((order) => order.id)
  let fulfillmentRuns: FulfillmentRunRow[] = []
  let fulfillmentParcels: FulfillmentParcelRow[] = []
  let fulfillmentEvents: FulfillmentEventRow[] = []
  if (dispatchOrderIds.length > 0) {
    const [runsResult, parcelsResult, eventsResult] = await Promise.all([
      client
        .from('order_fulfillment_runs')
        .select('id,order_id,status,funding_status,currency,captured_allowance_amount,customer_funded_allowance_amount,drapeon_subsidy_amount,actual_provider_cost_amount,shortfall_subtotal_amount,shortfall_tax_amount,shortfall_fee_amount,shortfall_total_amount,unused_allowance_amount,customer_refund_amount,customer_refund_tax_amount,customer_refund_status,subsidy_restored_amount,provider_name,provider_quote_reference,provider_quote_evidence,customer_decision,custody_accepted_at')
        .in('order_id', dispatchOrderIds),
      client
        .from('order_fulfillment_parcels')
        .select('id,order_id,parcel_number,status,provider_name,service_level,provider_reference,tracking_number,tracking_url,eta_at,eta_timezone,last_location,last_status_at')
        .in('order_id', dispatchOrderIds)
        .order('parcel_number', { ascending: true }),
      client
        .from('order_fulfillment_events')
        .select('id,order_id,event_type,source,customer_note,occurred_at,evidence_media,eta_at,eta_timezone')
        .in('order_id', dispatchOrderIds)
        .order('occurred_at', { ascending: false })
        .limit(240),
    ])
    if (runsResult.error) issues.push(formatIssue('Dispatch funding', runsResult.error))
    else fulfillmentRuns = (runsResult.data ?? []) as FulfillmentRunRow[]
    if (parcelsResult.error) issues.push(formatIssue('Dispatch parcels', parcelsResult.error))
    else fulfillmentParcels = (parcelsResult.data ?? []) as FulfillmentParcelRow[]
    if (eventsResult.error) issues.push(formatIssue('Dispatch events', eventsResult.error))
    else fulfillmentEvents = (eventsResult.data ?? []) as FulfillmentEventRow[]
  }
  const fulfillmentRunByOrderId = new Map(fulfillmentRuns.map((run) => [run.order_id, run]))
  const fulfillmentParcelsByOrderId = new Map<string, FulfillmentParcelRow[]>()
  const fulfillmentEventsByOrderId = new Map<string, FulfillmentEventRow[]>()
  for (const parcel of fulfillmentParcels) {
    fulfillmentParcelsByOrderId.set(parcel.order_id, [...(fulfillmentParcelsByOrderId.get(parcel.order_id) ?? []), parcel])
  }
  for (const event of fulfillmentEvents) {
    fulfillmentEventsByOrderId.set(event.order_id, [...(fulfillmentEventsByOrderId.get(event.order_id) ?? []), event])
  }
  const signDispatchEvidence = async (value: unknown) => {
    if (!Array.isArray(value)) return []
    return (await Promise.all(value.map(async (artifact) => {
      const item = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {}
      const bucket = typeof item.storageBucket === 'string'
        ? item.storageBucket
        : typeof item.storage_bucket === 'string'
          ? item.storage_bucket
          : null
      const path = typeof item.storageObjectPath === 'string'
        ? item.storageObjectPath
        : typeof item.storage_object_path === 'string'
          ? item.storage_object_path
          : null
      if (!bucket || !path) return null
      const signed = await client.storage.from(bucket).createSignedUrl(path, 10 * 60)
      if (signed.error || !signed.data?.signedUrl) return null
      const mimeType = typeof item.mimeType === 'string'
        ? item.mimeType
        : typeof item.mime_type === 'string'
          ? item.mime_type
          : null
      return { url: signed.data.signedUrl, mimeType }
    }))).filter((item): item is { url: string; mimeType: string | null } => item !== null)
  }
  const dispatchRunEvidenceById = new Map(await Promise.all(fulfillmentRuns.map(async (run) => [run.id, await signDispatchEvidence(run.provider_quote_evidence)] as const)))
  const dispatchEventEvidenceById = new Map(await Promise.all(fulfillmentEvents.map(async (event) => [event.id, await signDispatchEvidence(event.evidence_media)] as const)))
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
  const sellerItems =
    sellerItemsResult.status === 'fulfilled' && !sellerItemsResult.value.error
      ? ((sellerItemsResult.value.data ?? []) as SellerItemRow[])
      : []
  const payouts =
    payoutsResult.status === 'fulfilled' && !payoutsResult.value.error
      ? ((payoutsResult.value.data ?? []) as PayoutRow[])
      : []
  const settlementTranches =
    settlementTranchesResult.status === 'fulfilled' && !settlementTranchesResult.value.error
      ? ((settlementTranchesResult.value.data ?? []) as Array<{ id: string; order_id: string; code: string; sequence: number; amount: number; currency: string; status: string; eligible_at: string | null; order_settlement_plans: { status: string; frozen_reason: string | null } | Array<{ status: string; frozen_reason: string | null }> }>)
      : []
  const moneyDeskRequests =
    moneyDeskRequestsResult.status === 'fulfilled' && !moneyDeskRequestsResult.value.error
      ? ((moneyDeskRequestsResult.value.data ?? []) as MoneyDeskRequestRow[])
      : []
  let moneyDeskDecisions: MoneyDeskDecisionRow[] = []
  let moneyDeskFinancialCases: FinancialCaseReviewRow[] = []
  let moneyDeskCaseEvidence: Array<FinancialCaseEvidenceReviewRow & { signed_url: string | null }> = []
  if (moneyDeskRequests.length > 0) {
    const { data, error } = await client
      .from('money_desk_decisions')
      .select('request_id, decision, approver_email, approver_role, created_at')
      .in('request_id', moneyDeskRequests.map((request) => request.id))
      .order('created_at', { ascending: true })

    if (error) {
      issues.push(formatIssue('Money Desk decisions', error))
    } else {
      moneyDeskDecisions = (data ?? []) as MoneyDeskDecisionRow[]
    }

    const caseIds = [...new Set(moneyDeskRequests.map((request) => request.case_id).filter((caseId): caseId is string => !!caseId))]
    if (caseIds.length > 0) {
      const [{ data: caseData, error: caseError }, { data: evidenceData, error: evidenceError }] = await Promise.all([
        client
          .from('financial_cases')
          .select('id, reference, reason_code, summary, claim_details')
          .in('id', caseIds),
        client
          .from('financial_case_evidence')
          .select('id, case_id, evidence_type, source, verification_status, visibility, storage_bucket, storage_object_path, external_reference, mime_type, captured_at')
          .in('case_id', caseIds)
          .order('captured_at', { ascending: true }),
      ])

      if (caseError) issues.push(formatIssue('Money Desk financial cases', caseError))
      else moneyDeskFinancialCases = (caseData ?? []) as FinancialCaseReviewRow[]

      if (evidenceError) {
        issues.push(formatIssue('Money Desk case evidence', evidenceError))
      } else {
        moneyDeskCaseEvidence = await Promise.all(((evidenceData ?? []) as FinancialCaseEvidenceReviewRow[]).map(async (evidence) => {
          if (!evidence.storage_bucket || !evidence.storage_object_path) return { ...evidence, signed_url: null }
          const { data: signedData, error: signedError } = await client.storage
            .from(evidence.storage_bucket)
            .createSignedUrl(evidence.storage_object_path, 10 * 60)
          if (signedError) issues.push(formatIssue(`Evidence ${evidence.id}`, signedError))
          return { ...evidence, signed_url: signedData?.signedUrl ?? null }
        }))
      }
    }
  }
  const returnResolutions =
    returnResolutionsResult.status === 'fulfilled' && !returnResolutionsResult.value.error
      ? ((returnResolutionsResult.value.data ?? []) as Array<Record<string, unknown>>)
      : []
  const benefitCampaigns = benefitCampaignsResult.status === 'fulfilled' && !benefitCampaignsResult.value.error ? ((benefitCampaignsResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const tips = tipsResult.status === 'fulfilled' && !tipsResult.value.error ? ((tipsResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const commercialDeliveryOutcomes = commercialDeliveryOutcomesResult.status === 'fulfilled' && !commercialDeliveryOutcomesResult.value.error ? ((commercialDeliveryOutcomesResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const communicationCampaigns = communicationCampaignsResult.status === 'fulfilled' && !communicationCampaignsResult.value.error ? ((communicationCampaignsResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const communicationApprovals = communicationApprovalsResult.status === 'fulfilled' && !communicationApprovalsResult.value.error ? ((communicationApprovalsResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const communicationRecipients = communicationRecipientsResult.status === 'fulfilled' && !communicationRecipientsResult.value.error ? ((communicationRecipientsResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const serviceIncidents = serviceIncidentsResult.status === 'fulfilled' && !serviceIncidentsResult.value.error ? ((serviceIncidentsResult.value.data ?? []) as Array<Record<string, unknown>>) : []
  const communicationApprovalsByCampaign = new Map<string, Array<Record<string, unknown>>>()
  for (const approval of communicationApprovals) {
    const campaignId = String(approval.campaign_id)
    communicationApprovalsByCampaign.set(campaignId, [...(communicationApprovalsByCampaign.get(campaignId) ?? []), approval])
  }
  const opsIssues =
    opsIssuesResult.status === 'fulfilled' && !opsIssuesResult.value.error
      ? ((opsIssuesResult.value.data ?? []) as OpsIssueLedgerRow[])
      : []
  const refundResolutionIds = [...new Set(opsIssues
    .map((issue) => payloadStringValue(issue.metadata, 'refund_resolution_id'))
    .filter((id): id is string => !!id))]
  const refundResolutionById = new Map<string, NonNullable<OpsWorkflowIssue['refundResolution']>>()
  if (refundResolutionIds.length > 0) {
    const { data: rows, error: refundResolutionError } = await client
      .from('order_refund_resolutions')
      .select('id,status,amount,currency,provider_reference,order_outcome,outcome_applied_at,reviewed_order_outcome,reviewed_outcome_reason,reviewed_outcome_applied_at')
      .in('id', refundResolutionIds)
    if (refundResolutionError) issues.push(formatIssue('Refund order outcomes', refundResolutionError))
    else for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
      refundResolutionById.set(String(row.id), {
        id: String(row.id),
        status: String(row.status),
        amount: Number(row.amount),
        currency: String(row.currency),
        providerReference: typeof row.provider_reference === 'string' ? row.provider_reference : null,
        orderOutcome: String(row.order_outcome),
        outcomeAppliedAt: typeof row.outcome_applied_at === 'string' ? row.outcome_applied_at : null,
        reviewedOrderOutcome: typeof row.reviewed_order_outcome === 'string' ? row.reviewed_order_outcome : null,
        reviewedOutcomeReason: typeof row.reviewed_outcome_reason === 'string' ? row.reviewed_outcome_reason : null,
        reviewedOutcomeAppliedAt: typeof row.reviewed_outcome_applied_at === 'string' ? row.reviewed_outcome_applied_at : null,
      })
    }
  }
  const fabricCandidateIds = [...new Set(opsIssues
    .filter((issue) => issue.related_entity_type?.toUpperCase() === 'FABRIC_CANDIDATE' && !!issue.related_entity_id)
    .map((issue) => issue.related_entity_id!))]
  const fabricReviewById = new Map<string, NonNullable<OpsWorkflowIssue['fabricReview']>>()
  if (fabricCandidateIds.length > 0) {
    const { data: rows, error: fabricError } = await client
      .from('order_fabric_candidates')
      .select('id,component_code,status,supplier_cost_amount,currency,provider_status,provider_reference,reconciliation_status,correlation_id,estimate_storage_bucket,estimate_storage_path,receipt_storage_bucket,receipt_storage_path,customer_media,acquired_media')
      .in('id', fabricCandidateIds)
    if (fabricError) issues.push(formatIssue('Fabric exception candidates', fabricError))
    else {
      for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
        const sign = async (bucket: unknown, path: unknown) => {
          if (typeof bucket !== 'string' || typeof path !== 'string' || path.length < 3) return null
          const result = await client.storage.from(bucket).createSignedUrl(path, 10 * 60)
          return result.error ? null : result.data?.signedUrl ?? null
        }
        const signArtifacts = async (value: unknown) => {
          if (!Array.isArray(value)) return []
          const urls = await Promise.all(value.map((artifact) => {
            const item = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {}
            const path = item.mediaType === 'VIDEO'
              ? item.posterStoragePath ?? item.originalStoragePath
              : item.displayStoragePath ?? item.originalStoragePath
            return sign('commercial-evidence', path)
          }))
          return urls.filter((url): url is string => !!url)
        }
        const id = String(row.id)
        const { data: transactionRows } = await client.from('commercial_ledger_transactions').select('id').contains('metadata', { candidateId: id }).limit(5)
        const transactionIds = (transactionRows ?? []).map((transaction) => String(transaction.id))
        const ledgerEntries = transactionIds.length > 0
          ? ((await client.from('commercial_ledger_entries').select('account_code,direction,amount,currency').in('transaction_id', transactionIds)).data ?? [])
          : []
        fabricReviewById.set(id, {
          candidateId: id,
          componentCode: String(row.component_code),
          status: String(row.status),
          supplierCostAmount: Number(row.supplier_cost_amount),
          currency: String(row.currency),
          providerStatus: typeof row.provider_status === 'string' ? row.provider_status : null,
          providerReference: typeof row.provider_reference === 'string' ? row.provider_reference : null,
          reconciliationStatus: typeof row.reconciliation_status === 'string' ? row.reconciliation_status : null,
          correlationId: String(row.correlation_id),
          estimateUrl: await sign(row.estimate_storage_bucket, row.estimate_storage_path),
          receiptUrl: await sign(row.receipt_storage_bucket, row.receipt_storage_path),
          customerMediaUrls: await signArtifacts(row.customer_media),
          acquiredMediaUrls: await signArtifacts(row.acquired_media),
          ledgerEntries: (ledgerEntries as Array<Record<string, unknown>>).map((entry) => ({
            accountCode: String(entry.account_code), direction: String(entry.direction),
            amount: Number(entry.amount), currency: String(entry.currency),
          })),
        })
      }
    }
  }
  const payoutChangeRequestIds = [...new Set(opsIssues
    .filter((issue) => issue.related_entity_type === 'payout_change_request' && !!issue.related_entity_id)
    .map((issue) => issue.related_entity_id!))]
  const payoutChangeReviewById = new Map<string, NonNullable<OpsWorkflowIssue['payoutChangeReview']>>()
  if (payoutChangeRequestIds.length > 0) {
    const { data: payoutChangeRows, error: payoutChangeError } = await client
      .from('payout_change_requests')
      .select('id,status,current_destination,requested_destination,metadata,submitted_at,updated_at')
      .in('id', payoutChangeRequestIds)
    if (payoutChangeError) {
      issues.push(formatIssue('Payout destination reviews', payoutChangeError))
    } else {
      for (const row of (payoutChangeRows ?? []) as PayoutChangeReviewRow[]) {
        payoutChangeReviewById.set(row.id, buildPayoutChangeReview(row))
      }
    }
  }
  const consultationBookingIds = [...new Set(opsIssues
    .filter((issue) => issue.related_entity_type === 'CONSULTATION_BOOKING' && !!issue.related_entity_id)
    .map((issue) => issue.related_entity_id!))]
  const consultationAttendanceByBookingId = new Map<string, OpsWorkflowIssue['consultationAttendance']>()
  if (consultationBookingIds.length > 0) {
    const [reviewResult, evidenceResult, bookingResult] = await Promise.all([
      client.from('consultation_attendance_reviews')
        .select('id,booking_id,status,reported_by_role,reported_reason,counterparty_response_code,counterparty_response,evidence_outcome_at_report')
        .in('booking_id', consultationBookingIds),
      client.from('consultation_attendance_evidence')
        .select('booking_id,provider_evidence_complete,customer_verified_seconds,tailor_verified_seconds,verified_overlap_seconds')
        .in('booking_id', consultationBookingIds),
      client.from('consultation_bookings')
        .select('id,fee_amount,fee_currency,payment_status,settlement_status')
        .in('id', consultationBookingIds),
    ])
    if (reviewResult.error) issues.push(formatIssue('Consultation attendance reviews', reviewResult.error))
    if (evidenceResult.error) issues.push(formatIssue('Consultation attendance evidence', evidenceResult.error))
    if (bookingResult.error) issues.push(formatIssue('Consultation booking settlement', bookingResult.error))
    const evidenceByBookingId = new Map((evidenceResult.data ?? []).map((row) => [row.booking_id, row]))
    const bookingById = new Map((bookingResult.data ?? []).map((row) => [row.id, row]))
    for (const row of reviewResult.data ?? []) {
      const evidence = evidenceByBookingId.get(row.booking_id)
      const booking = bookingById.get(row.booking_id)
      consultationAttendanceByBookingId.set(row.booking_id, {
        reviewId: row.id,
        bookingId: row.booking_id,
        reviewStatus: row.status,
        reportedByRole: row.reported_by_role,
        reportedReason: row.reported_reason,
        counterpartyResponseCode: row.counterparty_response_code ?? null,
        counterpartyResponse: row.counterparty_response ?? null,
        evidenceOutcome: row.evidence_outcome_at_report,
        providerEvidenceComplete: evidence?.provider_evidence_complete === true,
        customerVerifiedSeconds: evidence?.customer_verified_seconds ?? 0,
        tailorVerifiedSeconds: evidence?.tailor_verified_seconds ?? 0,
        verifiedOverlapSeconds: evidence?.verified_overlap_seconds ?? 0,
        feeAmount: booking?.fee_amount ?? null,
        feeCurrency: booking?.fee_currency ?? null,
        paymentStatus: booking?.payment_status ?? 'UNKNOWN',
        settlementStatus: booking?.settlement_status ?? 'UNKNOWN',
      })
    }
  }
  const legacyWorkflowIssues =
    legacyWorkflowIssuesResult.status === 'fulfilled' && !legacyWorkflowIssuesResult.value.error
      ? ((legacyWorkflowIssuesResult.value.data ?? []) as AuditLogRow[])
      : []
  const escrowOrders =
    escrowOrdersResult.status === 'fulfilled' && !escrowOrdersResult.value.error
      ? ((escrowOrdersResult.value.data ?? []) as EscrowOrderSummaryRow[])
      : []
  const jobQueuePayload =
    jobQueueHealthResult.status === 'fulfilled' && !jobQueueHealthResult.value.error && jobQueueHealthResult.value.data
      ? (jobQueueHealthResult.value.data as Record<string, unknown>)
      : {}
  const statusCounts = jobQueuePayload.statusCounts && typeof jobQueuePayload.statusCounts === 'object'
    ? (jobQueuePayload.statusCounts as Record<string, unknown>)
    : {}
  const providerHealth =
    providerHealthResult.status === 'fulfilled' && !providerHealthResult.value.error && Array.isArray(providerHealthResult.value.data)
      ? (providerHealthResult.value.data as Array<Record<string, unknown>>)
      : []
  const systemHealth = {
    jobQueue: {
      pending: numberPayloadValue(statusCounts, 'PENDING'),
      retryable: numberPayloadValue(jobQueuePayload, 'retryableCount'),
      processing: numberPayloadValue(statusCounts, 'PROCESSING'),
      dead: numberPayloadValue(jobQueuePayload, 'deadCount'),
      oldestPendingAt: stringPayloadValue(jobQueuePayload, 'oldestPendingAt'),
      oldestProcessingAt: stringPayloadValue(jobQueuePayload, 'oldestProcessingAt'),
    },
    providers: providerHealth.map((row) => ({
      provider: stringPayloadValue(row, 'provider') ?? 'UNKNOWN',
      operation: stringPayloadValue(row, 'operation') ?? 'GENERAL',
      status: stringPayloadValue(row, 'status') ?? 'UNKNOWN',
      failureCount: numberPayloadValue(row, 'failureCount'),
      circuitOpenUntil: stringPayloadValue(row, 'circuitOpenUntil'),
      lastError: stringPayloadValue(row, 'lastError'),
      updatedAt: stringPayloadValue(row, 'updatedAt'),
    })),
  }

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
  if (messagesResult.status === 'rejected') issues.push(formatIssue('Support messages', messagesResult.reason))
  if (messagesResult.status === 'fulfilled' && messagesResult.value.error) {
    issues.push(formatIssue('Support messages', messagesResult.value.error))
  }
  if (conversationAccessLogsResult.status === 'rejected') issues.push(formatIssue('Conversation access logs', conversationAccessLogsResult.reason))
  if (conversationAccessLogsResult.status === 'fulfilled' && conversationAccessLogsResult.value.error) {
    issues.push(formatIssue('Conversation access logs', conversationAccessLogsResult.value.error))
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
  if (sellerItemsResult.status === 'rejected') issues.push(formatIssue('Shop inventory', sellerItemsResult.reason))
  if (sellerItemsResult.status === 'fulfilled' && sellerItemsResult.value.error) {
    issues.push(formatIssue('Shop inventory', sellerItemsResult.value.error))
  }
  let verificationProofItems: SellerItemRow[] = []
  if (pendingVerifications.length > 0) {
    const { data, error } = await client
      .from('seller_items')
      .select('id, tailor_profile_id, title, description, category, sizes, price_amount, currency, photo_urls, is_live, stock_status, inventory_quantity, size_inventory, pickup_available, delivery_available, shipping_available, created_at, updated_at')
      .in('tailor_profile_id', pendingVerifications.map((profile) => profile.id))
      .order('updated_at', { ascending: false })
      .limit(Math.max(24, pendingVerifications.length * 4))

    if (error) {
      issues.push(formatIssue('Verification proof items', error))
    } else {
      verificationProofItems = ((data ?? []) as SellerItemRow[]).filter(isVerificationProofItem)
    }
  }

  if (payoutsResult.status === 'rejected') issues.push(formatIssue('Payouts', payoutsResult.reason))
  if (payoutsResult.status === 'fulfilled' && payoutsResult.value.error) {
    issues.push(formatIssue('Payouts', payoutsResult.value.error))
  }
  if (moneyDeskRequestsResult.status === 'rejected') issues.push(formatIssue('Money Desk', moneyDeskRequestsResult.reason))
  if (moneyDeskRequestsResult.status === 'fulfilled' && moneyDeskRequestsResult.value.error) {
    issues.push(formatIssue('Money Desk', moneyDeskRequestsResult.value.error))
  }
  if (returnResolutionsResult.status === 'rejected') issues.push(formatIssue('Return resolutions', returnResolutionsResult.reason))
  if (returnResolutionsResult.status === 'fulfilled' && returnResolutionsResult.value.error) issues.push(formatIssue('Return resolutions', returnResolutionsResult.value.error))
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
  if (jobQueueHealthResult.status === 'rejected') issues.push(formatIssue('Job queue health', jobQueueHealthResult.reason))
  if (jobQueueHealthResult.status === 'fulfilled' && jobQueueHealthResult.value.error) {
    issues.push(formatIssue('Job queue health', jobQueueHealthResult.value.error))
  }
  if (providerHealthResult.status === 'rejected') issues.push(formatIssue('Provider health', providerHealthResult.reason))
  if (providerHealthResult.status === 'fulfilled' && providerHealthResult.value.error) {
    issues.push(formatIssue('Provider health', providerHealthResult.value.error))
  }

  const messagesByOrderId = new Map<string, MessageRow[]>()
  for (const message of messages) {
    const thread = messagesByOrderId.get(message.order_id) ?? []
    thread.push(message)
    messagesByOrderId.set(message.order_id, thread)
  }
  for (const thread of messagesByOrderId.values()) {
    thread.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
  }
  const supportThreadOrderIds = [...messagesByOrderId.keys()]

  const latestConversationAccessByOrderId = new Map<string, ConversationAccessLogRow>()
  for (const log of conversationAccessLogs) {
    if (!log.order_id || latestConversationAccessByOrderId.has(log.order_id)) continue
    latestConversationAccessByOrderId.set(log.order_id, log)
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
  summary.pendingMoneyDeskApprovals = moneyDeskRequests.filter((request) => request.status === 'PENDING_APPROVAL').length
  summary.activeCommunicationCampaigns = communicationCampaigns.filter((campaign) => !['COMPLETED', 'CANCELLED'].includes(String(campaign.status))).length
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
  summary.shopInventoryAlerts = sellerItems.filter((item) => sellerItemRiskLabels(item).length > 0).length
  summary.activeSupportThreads = supportThreadOrderIds.length
  summary.deadJobs = systemHealth.jobQueue.dead
  summary.retryableJobs = systemHealth.jobQueue.retryable
  summary.providersDegraded = systemHealth.providers.filter((provider) => provider.status !== 'OK').length

  const openOrderReviews = orderReviewRows.flatMap((row) =>
    parseOpenOrderReviews(row.special_note).map((review, index) => ({
      id: `${row.id}:${review.type}:${index}`,
      orderId: row.id,
      orderReference: row.reference ?? null,
      orderKind: row.order_kind ?? null,
      orderStage: row.stage ?? null,
      reviewType: review.type,
      requestedBy: review.requestedBy ?? 'Drapeon',
      requestedByRole: review.requestedBy,
      customerId: row.customer_id,
      tailorId: row.tailor_id,
      reasonLabel: review.reasonLabel,
      note: review.note,
      requestedAt: review.requestedAt,
      requestedFromStage: review.requestedFromStage,
      riskAction: review.riskAction,
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
    ...supportThreadOrderIds,
    ...workflowOpsIssues.map((issue) => issue.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
    ...legacyWorkflowIssues.map((issue) => issue.order_id).filter((value): value is string => typeof value === 'string' && value.length > 0),
  ])]
  const userIds = new Set<string>()
  const tailorProfileIds = new Set<string>()
  const dispatchTailorIds = new Set<string>()

  const ordersById = new Map<string, OrderRow>()
  const orderPaymentContextByOrderId = new Map<string, {
    capturedAmount: number
    alreadyRefundedAmount: number
    maxRefundableAmount: number
    unreleasedMaterialAmount: number
    refundablePaymentCount: number
    paymentStatus: string | null
    paymentProvider: string | null
  }>()
  if (orderIds.length > 0) {
    const { data, error } = await client
      .from('orders')
      .select('id, reference, order_kind, garment_type, item_title, stage, quoted_amount, total_amount, source_amount, source_currency, subtotal_amount, platform_fee_amount, tax_amount, shipping_amount, currency, quoted_currency, delivery_method, fulfillment_option, customer_id, tailor_id, handoff_completed_at, customer_handoff_confirmed_at, handoff_confirmation_source, escrow_released, escrow_released_at')
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
      .select('id, order_id, phase, provider, amount, currency, status, refunded_amount, confirmed_at, failed_at, created_at')
      .in('order_id', orderIds)

    if (orderPaymentsError) {
      issues.push(formatIssue('Order payment context', orderPaymentsError))
    } else {
      const paymentRows = (orderPaymentsData ?? []) as OrderPaymentContextRow[]
      const { data: materialAdvanceRows, error: materialAdvanceError } = await client
        .from('order_material_advances')
        .select('order_id,payment_id,release_status,provider_release_status,released_at,paid_at')
        .in('order_id', orderIds)
      if (materialAdvanceError) issues.push(formatIssue('Material cancellation exposure', materialAdvanceError))
      const safelyUnreleasedPaymentIds = new Set(
        (materialAdvanceRows ?? [])
          .filter((advance) =>
            advance.payment_id
            && advance.paid_at
            && !advance.released_at
            && advance.release_status !== 'RELEASED'
            && ['NOT_REQUESTED', 'BLOCKED'].includes(advance.provider_release_status ?? 'NOT_REQUESTED')
          )
          .map((advance) => advance.payment_id as string),
      )
      for (const orderId of orderIds) {
        const payments = paymentRows
          .filter((row) => row.order_id === orderId)
          .sort((left, right) => Date.parse(right.created_at ?? '') - Date.parse(left.created_at ?? ''))
        const latestPayment = payments[0] ?? null
        const capturedAmount = payments
          .filter((row) => ['SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED'].includes(row.status))
          .reduce((sum, row) => sum + Math.max(row.amount, 0), 0)
        const alreadyRefundedAmount = payments.reduce((sum, row) => sum + orderPaymentRefundedAmount(row), 0)
        const refundablePayments = payments.filter((row) =>
          ['INITIAL_ORDER', 'CONSULTATION', 'FULFILLMENT', 'MATERIAL_ADVANCE'].includes(row.phase)
          && ['SUCCEEDED', 'PARTIAL_REFUND'].includes(row.status)
          && Math.max(row.amount - orderPaymentRefundedAmount(row), 0) > 0
          && (row.phase !== 'MATERIAL_ADVANCE' || safelyUnreleasedPaymentIds.has(row.id))
        )
        const unreleasedMaterialAmount = refundablePayments
          .filter((row) => row.phase === 'MATERIAL_ADVANCE' && safelyUnreleasedPaymentIds.has(row.id))
          .reduce((sum, row) => sum + Math.max(row.amount - orderPaymentRefundedAmount(row), 0), 0)
        orderPaymentContextByOrderId.set(orderId, {
          capturedAmount,
          alreadyRefundedAmount,
          maxRefundableAmount: refundablePayments.reduce(
            (sum, row) => sum + Math.max(row.amount - orderPaymentRefundedAmount(row), 0),
            0,
          ),
          unreleasedMaterialAmount,
          refundablePaymentCount: refundablePayments.length,
          paymentStatus: latestPayment?.status ?? null,
          paymentProvider: latestPayment?.provider ?? null,
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

  for (const message of messages) {
    userIds.add(message.sender_id)
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

  for (const item of sellerItems) {
    tailorProfileIds.add(item.tailor_profile_id)
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
  const tailorContextUserIds = new Set<string>(
    [...dispatchTailorIds, ...userIds].filter(validateUuid),
  )
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

  const accountUserIds = [...userIds].filter(validateUuid)
  const customerProfilesByUserId = new Map<string, CustomerProfileContextRow>()
  if (accountUserIds.length > 0) {
    const { data, error } = await client
      .from('customer_profiles')
      .select('user_id, display_name')
      .in('user_id', accountUserIds)

    if (error) {
      issues.push(formatIssue('Customer context', error))
    } else {
      for (const row of (data ?? []) as CustomerProfileContextRow[]) {
        customerProfilesByUserId.set(row.user_id, row)
      }
    }
  }

  const usersById = new Map<string, UserRow>()
  if (accountUserIds.length > 0) {
    const { data, error } = await client
      .from('users')
      .select('id, email, display_name, role')
      .in('id', accountUserIds)

    if (error) {
      issues.push(formatIssue('User account context', error))
    } else {
      for (const row of (data ?? []) as UserRow[]) {
        usersById.set(row.id, {
          id: row.id,
          email: row.email,
          display_name: row.display_name || (row.role === 'TAILOR' ? 'Tailor' : 'Customer'),
          role: row.role,
        })
      }
    }
  }

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

  const trustVideoUrlsByProfileId = new Map<string, string | null>()
  for (const profile of pendingVerifications) {
    const verificationVideoPath = trustVideoStoragePath(profile.trust_verification_video_path)
    trustVideoUrlsByProfileId.set(
      profile.id,
      verificationVideoPath
        ? `/ops/identity-document/${encodeURIComponent(profile.id)}`
        : null,
    )
  }

  const verificationProofItemsByProfileId = new Map<string, OpsVerificationProofItemEvidence[]>()
  for (const item of verificationProofItems) {
    const current = verificationProofItemsByProfileId.get(item.tailor_profile_id) ?? []
    current.push(mapVerificationProofItem(item))
    verificationProofItemsByProfileId.set(item.tailor_profile_id, current)
  }

  const { data: taxControlRows, error: taxControlError } = await client
    .from('tax_control_health')
    .select('activation_id,environment,policy_version,status,jurisdiction_country_code,origin_country_code,destination_country_code,tax_transaction_type,fulfillment_classification,reviewed_at,review_due_at,health_status,affected_open_reservations,snapshot_count,correlation_id,source_urls')
    .order('review_due_at', { ascending: true })
  if (taxControlError) issues.push(formatIssue('Activated tax controls', taxControlError))

  const { data: taxDecisionRows, error: taxDecisionError } = await client
    .from('tax_decision_ops')
    .select('snapshot_id,order_id,policy_version,tax_transaction_type,fulfillment_classification,jurisdiction_country_code,corridor_key,tax_supply_characterization,responsible_party,registration_decision,line_classifications,collection_mode,currency,subtotal_amount,shipping_amount,tax_amount,import_tax_amount,duty_amount,calculation_provider,filing_liability_account,import_tax_liability_account,duty_liability_account,required_export_evidence,required_customs_fields,source_urls,review_due_at,correlation_id,created_at')
    .order('created_at', { ascending: false })
    .limit(25)
  if (taxDecisionError) issues.push(formatIssue('Tax decision evidence', taxDecisionError))

  return {
    summary,
    systemHealth,
    taxControls: (taxControlRows ?? []).map((row) => ({
      activationId: row.activation_id,
      environment: row.environment,
      policyVersion: row.policy_version,
      status: row.status,
      jurisdictionCountryCode: row.jurisdiction_country_code,
      originCountryCode: row.origin_country_code,
      destinationCountryCode: row.destination_country_code,
      transactionType: row.tax_transaction_type,
      fulfillmentClassification: row.fulfillment_classification,
      reviewedAt: row.reviewed_at,
      reviewDueAt: row.review_due_at,
      healthStatus: row.health_status,
      affectedOpenReservations: Number(row.affected_open_reservations ?? 0),
      snapshotCount: Number(row.snapshot_count ?? 0),
      correlationId: row.correlation_id,
      sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
    })),
    taxDecisions: (taxDecisionRows ?? []).map((row) => ({
      snapshotId: row.snapshot_id,
      orderId: row.order_id,
      policyVersion: row.policy_version,
      transactionType: row.tax_transaction_type,
      fulfillmentClassification: row.fulfillment_classification,
      jurisdictionCountryCode: row.jurisdiction_country_code,
      corridorKey: row.corridor_key,
      supplyCharacterization: row.tax_supply_characterization,
      responsibleParty: row.responsible_party,
      registrationDecision: row.registration_decision,
      lineClassifications: Array.isArray(row.line_classifications) ? row.line_classifications : [],
      collectionMode: row.collection_mode,
      currency: row.currency,
      subtotalAmount: Number(row.subtotal_amount ?? 0),
      shippingAmount: Number(row.shipping_amount ?? 0),
      taxAmount: Number(row.tax_amount ?? 0),
      importTaxAmount: Number(row.import_tax_amount ?? 0),
      dutyAmount: Number(row.duty_amount ?? 0),
      calculationProvider: row.calculation_provider,
      filingLiabilityAccount: row.filing_liability_account,
      importTaxLiabilityAccount: row.import_tax_liability_account,
      dutyLiabilityAccount: row.duty_liability_account,
      requiredExportEvidence: Array.isArray(row.required_export_evidence) ? row.required_export_evidence : [],
      requiredCustomsFields: Array.isArray(row.required_customs_fields) ? row.required_customs_fields : [],
      sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
      reviewDueAt: row.review_due_at,
      correlationId: row.correlation_id,
      createdAt: row.created_at,
    })),
    disputes: disputes.map((dispute) => {
      const order = ordersById.get(dispute.order_id)
      const customer = order ? usersById.get(order.customer_id) : null
      const tailor = order ? usersById.get(order.tailor_id) : null
      const paymentContext = orderPaymentContextByOrderId.get(dispute.order_id)

      return {
        id: dispute.id,
        orderId: dispute.order_id,
        orderReference: order?.reference ?? null,
        orderStage: order?.stage ?? null,
        amount: order?.quoted_amount ?? null,
        currency: order?.currency ?? order?.quoted_currency ?? null,
        capturedAmount: paymentContext?.capturedAmount ?? 0,
        alreadyRefundedAmount: paymentContext?.alreadyRefundedAmount ?? 0,
        refundableAmount: paymentContext?.maxRefundableAmount ?? 0,
        unreleasedMaterialAmount: paymentContext?.unreleasedMaterialAmount ?? 0,
        refundablePaymentCount: paymentContext?.refundablePaymentCount ?? 0,
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
      const trustVideoUrl = trustVideoUrlsByProfileId.get(profile.id) ?? null
      const portfolioPhotoUrls = cleanMediaUrls(profile.portfolio_photo_urls)
      const portfolioVideoUrls = cleanMediaUrls(profile.portfolio_video_urls)
      const proofItems = verificationProofItemsByProfileId.get(profile.id) ?? []
      const evidenceSummary = buildOpsVerificationEvidenceSummary({
        avatarUrl: profile.avatar_url,
        trustVideoUrl,
        portfolioPhotoUrls,
        portfolioVideoUrls,
        proofItems,
      })

      return {
        displayId: verificationIssue?.issue_number ? formatOpsIssueNumber(verificationIssue.issue_number) : issueDisplayId('TAI', profile.id),
        issueId: verificationIssue?.id ?? null,
        profileId: profile.id,
        userId: profile.user_id,
        displayName: profile.display_name,
        email: user?.email ?? null,
        location: profile.location,
        specialtyTags: profile.specialty_tags ?? [],
        trustVideoUrl,
        trustChallengeId: profile.trust_verification_challenge_id?.trim() || null,
        trustChallengeText: profile.trust_verification_challenge_text?.trim() || null,
        avatarUrl: profile.avatar_url ?? null,
        portfolioPhotoUrls,
        portfolioVideoUrls,
        proofItems,
        evidenceSummary,
        status: profile.id_verification_status,
        idVerificationSubmittedAt: profile.id_verification_submitted_at ?? null,
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
      const paymentContext = payout.order_id ? orderPaymentContextByOrderId.get(payout.order_id) : null

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
        providerTransferStatus: payout.provider_transfer_status,
        bankSettlementStatus: payout.bank_settlement_status,
        providerBankPayoutId: payout.provider_bank_payout_id,
        bankSettlementExpectedAt: payout.bank_settlement_expected_at,
        bankSettlementCompletedAt: payout.bank_settlement_completed_at,
        bankSettlementFailedAt: payout.bank_settlement_failed_at,
        bankSettlementFailureCode: payout.bank_settlement_failure_code,
        blockedReason: payout.blocked_reason,
        blockedReasonMessage: payoutBlockedReasonCopy(payout.blocked_reason),
        orderId: payout.order_id,
        orderReference: order?.reference ?? null,
        orderStage: order?.stage ?? null,
        orderKind: order?.order_kind ?? null,
        orderTotalAmount: order?.total_amount ?? order?.quoted_amount ?? null,
        orderCurrency: order?.currency ?? order?.quoted_currency ?? null,
        sourceAmount: order?.source_amount ?? order?.subtotal_amount ?? null,
        sourceCurrency: order?.source_currency ?? order?.currency ?? order?.quoted_currency ?? null,
        platformFeeAmount: order?.platform_fee_amount ?? null,
        taxAmount: order?.tax_amount ?? null,
        shippingAmount: order?.shipping_amount ?? null,
        handoffCompletedAt: order?.handoff_completed_at ?? null,
        customerHandoffConfirmedAt: order?.customer_handoff_confirmed_at ?? null,
        handoffConfirmationSource: order?.handoff_confirmation_source ?? null,
        payoutReadyAt: order?.customer_handoff_confirmed_at ? payoutWindowClosesAt(order.customer_handoff_confirmed_at) : null,
        escrowReleased: order?.escrow_released === true,
        escrowReleasedAt: order?.escrow_released_at ?? null,
        paymentStatus: paymentContext?.paymentStatus ?? null,
        paymentProvider: paymentContext?.paymentProvider ?? null,
        capturedAmount: paymentContext?.capturedAmount ?? 0,
        alreadyRefundedAmount: paymentContext?.alreadyRefundedAmount ?? 0,
        maxRefundableAmount: paymentContext?.maxRefundableAmount ?? 0,
        initiatedAt: payout.initiated_at,
        completedAt: payout.completed_at,
        failedAt: payout.failed_at,
        processedAt: payout.processed_at,
      }
    }),
    settlementTranches: settlementTranches.map((tranche) => {
      const plan = Array.isArray(tranche.order_settlement_plans) ? tranche.order_settlement_plans[0] : tranche.order_settlement_plans
      return {
        id: tranche.id,
        orderId: tranche.order_id,
        code: tranche.code,
        sequence: tranche.sequence,
        amount: tranche.amount,
        currency: tranche.currency,
        status: tranche.status,
        eligibleAt: tranche.eligible_at,
        waitingHours: tranche.eligible_at ? Math.max(0, Math.floor((Date.now() - Date.parse(tranche.eligible_at)) / 3_600_000)) : 0,
        planStatus: plan?.status ?? 'UNKNOWN',
        frozenReason: plan?.frozen_reason ?? null,
      }
    }),
    moneyDeskRequests: moneyDeskRequests.map((request) => {
      const originIssue = opsIssues.find((issue) =>
        issue.related_entity_id === request.target_id
        && (
          issue.related_entity_type?.toUpperCase() === request.target_type.toUpperCase()
          || (request.target_type === 'PAYOUT_CHANGE_REQUEST' && issue.related_entity_type === 'payout_change_request')
        )) ?? null
      return {
      id: request.id,
      reference: request.reference,
      actionType: request.action_type,
      status: request.status,
      targetType: request.target_type,
      targetId: request.target_id,
      orderId: request.order_id,
      caseId: request.case_id,
      amount: request.amount,
      currency: request.currency,
      amountUsdEquivalent: request.amount_usd_equivalent,
      usdEquivalentSource: request.usd_equivalent_source,
      reason: request.reason,
      requesterEmail: request.requester_email,
      requesterRole: request.requester_role,
      riskLevel: request.risk_level,
      riskReasons: request.risk_reasons ?? [],
      requiredApprovalCount: request.required_approval_count,
      approvalCount: request.approval_count,
      correlationId: request.correlation_id,
      executionOutcome: request.execution_outcome,
      providerReference: request.provider_reference,
      approvedAt: request.approved_at,
      terminalAt: request.terminal_at,
      createdAt: request.created_at,
      updatedAt: request.updated_at,
      originIssue: originIssue ? {
        id: originIssue.id,
        displayId: formatOpsIssueNumber(originIssue.issue_number),
        title: originIssue.title,
        summary: originIssue.description,
        recommendedAction: originIssue.recommended_action,
        severity: originIssue.severity,
        status: originIssue.status,
      } : null,
      payoutChangeReview: request.target_type === 'PAYOUT_CHANGE_REQUEST'
        ? payoutChangeReviewById.get(request.target_id) ?? null
        : null,
      decisions: moneyDeskDecisions
        .filter((decision) => decision.request_id === request.id)
        .map((decision) => ({
          decision: decision.decision,
          approverEmail: decision.approver_email,
          approverRole: decision.approver_role,
          createdAt: decision.created_at,
        })),
      evidenceCase: (() => {
        if (!request.case_id) return null
        const financialCase = moneyDeskFinancialCases.find((candidate) => candidate.id === request.case_id)
        if (!financialCase) return null
        const claimDetails = financialCase.claim_details && typeof financialCase.claim_details === 'object'
          ? financialCase.claim_details
          : {}
        return {
          reference: financialCase.reference,
          reasonCode: financialCase.reason_code,
          summary: financialCase.summary,
          decisionBasis: typeof claimDetails.decisionBasis === 'string' ? claimDetails.decisionBasis : null,
          orderOutcome: typeof request.action_payload?.orderOutcome === 'string' ? request.action_payload.orderOutcome : null,
          resumeStage: typeof request.action_payload?.resumeStage === 'string' ? request.action_payload.resumeStage : null,
          evidence: moneyDeskCaseEvidence
            .filter((evidence) => evidence.case_id === request.case_id)
            .map((evidence) => ({
              id: evidence.id,
              evidenceType: evidence.evidence_type,
              source: evidence.source,
              verificationStatus: evidence.verification_status,
              visibility: evidence.visibility,
              externalReference: evidence.external_reference,
              mimeType: evidence.mime_type,
              capturedAt: evidence.captured_at,
              signedUrl: evidence.signed_url,
            })),
        }
      })(),
    }}),
    returnResolutions: returnResolutions.map((row) => {
      const proposals = Array.isArray(row.order_resolution_proposals) ? row.order_resolution_proposals as Array<Record<string, unknown>> : []
      const proposal = [...proposals].sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0]
      const refundRows = Array.isArray(row.order_refund_resolutions) ? row.order_refund_resolutions as Array<Record<string, unknown>> : []
      const refund = refundRows[0]
      return {
        id: String(row.id), reference: String(row.reference), orderId: String(row.order_id), financialCaseId: String(row.financial_case_id),
        reasonCode: String(row.reason_code), requestedRemedy: String(row.requested_remedy), summary: String(row.summary),
        eligibilityStatus: String(row.eligibility_status), eligibilityReason: String(row.eligibility_reason), returnRequired: row.return_required === true,
        status: String(row.status), responseDueAt: String(row.response_due_at), correlationId: String(row.correlation_id),
        proposalId: proposal?.id ? String(proposal.id) : null, proposalRemedy: proposal?.remedy ? String(proposal.remedy) : null,
        proposalAmount: typeof proposal?.amount === 'number' ? proposal.amount : null, proposalCurrency: proposal?.currency ? String(proposal.currency) : null,
        proposalStatus: proposal?.status ? String(proposal.status) : null,
        refundResolutionId: refund?.id ? String(refund.id) : null, refundAmount: typeof refund?.amount === 'number' ? refund.amount : null,
        refundCurrency: refund?.currency ? String(refund.currency) : null, refundStatus: refund?.status ? String(refund.status) : null,
        recoveryAmount: typeof refund?.released_tailor_recovery_amount === 'number' ? refund.released_tailor_recovery_amount : 0,
        createdAt: String(row.created_at),
      }
    }),
    benefitCampaigns: benefitCampaigns.map(row=>({campaignId:String(row.campaign_id),benefitId:typeof row.benefit_id==='string'?row.benefit_id:null,name:String(row.name),status:String(row.status),fundingSource:String(row.funding_source),currency:typeof row.currency==='string'?row.currency:null,budgetAmount:typeof row.budget_amount==='number'?row.budget_amount:null,reservedAmount:Number(row.reserved_amount??0),consumedAmount:Number(row.consumed_amount??0),redemptionCount:Number(row.redemption_count??0),redeemedAmount:Number(row.redeemed_amount??0),reversalCount:Number(row.reversal_count??0)})),
    tips: tips.map(row=>({id:String(row.id),orderId:String(row.order_id),amount:Number(row.amount),currency:String(row.currency),status:String(row.status),provider:typeof row.provider==='string'?row.provider:null,providerReference:typeof row.provider_reference==='string'?row.provider_reference:null,correlationId:String(row.correlation_id),createdAt:String(row.created_at)})),
    commercialDeliveryOutcomes: commercialDeliveryOutcomes.map(row=>({source:String(row.source),jobType:String(row.job_type),status:String(row.status),outcomeCount:Number(row.outcome_count??0),oldestCreatedAt:typeof row.oldest_created_at==='string'?row.oldest_created_at:null,latestUpdatedAt:typeof row.latest_updated_at==='string'?row.latest_updated_at:null})),
    communicationCampaigns: communicationCampaigns.map((row) => ({
      id:String(row.id),name:String(row.name),kind:String(row.kind),category:String(row.category),purpose:String(row.purpose),severity:String(row.severity),status:String(row.status),
      templateVersionId:typeof row.template_version_id==='string'?row.template_version_id:null,commercialCampaignId:typeof row.commercial_campaign_id==='string'?row.commercial_campaign_id:null,
      audienceDefinition:row.audience_definition && typeof row.audience_definition==='object'?row.audience_definition as Record<string,unknown>:{},
      channelPolicy:row.channel_policy && typeof row.channel_policy==='object'?row.channel_policy as Record<string,unknown>:{},destination:row.destination && typeof row.destination==='object'?row.destination as Record<string,unknown>:{},
      acknowledgementRequired:row.acknowledgement_required===true,riskLevel:String(row.risk_level),scheduledAt:typeof row.scheduled_at==='string'?row.scheduled_at:null,expiresAt:typeof row.expires_at==='string'?row.expires_at:null,
      createdBy:typeof row.created_by==='string'?row.created_by:null,createdByEmail:typeof row.created_by_email==='string'?row.created_by_email:null,approvedAt:typeof row.approved_at==='string'?row.approved_at:null,
      startedAt:typeof row.started_at==='string'?row.started_at:null,completedAt:typeof row.completed_at==='string'?row.completed_at:null,correlationId:String(row.correlation_id),createdAt:String(row.created_at),updatedAt:String(row.updated_at),
      requiredApprovals:Number(row.required_approvals??1),lastError:typeof row.last_error==='string'?row.last_error:null,recipientCount:Number(row.recipient_count??0),deliveredCount:Number(row.delivered_count??0),failedCount:Number(row.failed_count??0),skippedCount:Number(row.skipped_count??0),
      approvals:(communicationApprovalsByCampaign.get(String(row.id))??[]).map((approval)=>({reviewerId:typeof approval.reviewer_id==='string'?approval.reviewer_id:null,reviewerEmail:typeof approval.reviewer_email==='string'?approval.reviewer_email:null,decision:String(approval.decision),reason:String(approval.reason),createdAt:String(approval.created_at)})),
    })),
    communicationRecipients: communicationRecipients.map((row)=>({id:String(row.id),campaignId:String(row.campaign_id),userId:String(row.user_id),status:String(row.status),channels:Array.isArray(row.channels)?row.channels.map(String):[],channelOutcomes:row.channel_outcomes&&typeof row.channel_outcomes==='object'?row.channel_outcomes as Record<string,unknown>:{},queuedAt:typeof row.queued_at==='string'?row.queued_at:null,completedAt:typeof row.completed_at==='string'?row.completed_at:null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)})),
    serviceIncidents: serviceIncidents.map((row)=>({id:String(row.id),incidentKey:String(row.incident_key),title:String(row.title),summary:String(row.summary),severity:String(row.severity),status:String(row.status),affectedServices:Array.isArray(row.affected_services)?row.affected_services.map(String):[],publicVisible:row.public_visible===true,acknowledgementRequired:row.acknowledgement_required===true,destination:row.destination&&typeof row.destination==='object'?row.destination as Record<string,unknown>:{},source:String(row.source),sourceReference:typeof row.source_reference==='string'?row.source_reference:null,startedAt:String(row.started_at),resolvedAt:typeof row.resolved_at==='string'?row.resolved_at:null,updatedAt:String(row.updated_at),communicationCampaignId:typeof row.communication_campaign_id==='string'?row.communication_campaign_id:null})),
    shopItems: sellerItems.map((item) => {
      const tailorProfile = tailorProfilesById.get(item.tailor_profile_id)
      const tailorUser = tailorProfile ? usersById.get(tailorProfile.user_id) : null
      const fulfillment = [
        item.pickup_available ? 'Pickup' : null,
        item.delivery_available ? 'Delivery' : null,
        item.shipping_available ? 'Shipping' : null,
      ].filter((value): value is string => typeof value === 'string')

      return {
        id: item.id,
        title: item.title,
        category: item.category,
        tailorProfileId: item.tailor_profile_id,
        tailorDisplayName: tailorProfile?.display_name ?? tailorUser?.display_name ?? 'Tailor',
        tailorEmail: tailorUser?.email ?? null,
        priceAmount: item.price_amount,
        currency: item.currency,
        photoUrls: item.photo_urls ?? [],
        isLive: item.is_live,
        stockStatus: item.stock_status,
        inventoryQuantity: typeof item.inventory_quantity === 'number' ? item.inventory_quantity : 0,
        sizeInventoryLabel: formatSizeInventory(item.size_inventory),
        sizes: item.sizes ?? [],
        fulfillment,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        riskLabels: sellerItemRiskLabels(item),
      }
    }),
    supportThreads: supportThreadOrderIds.map((orderId) => {
      const thread = messagesByOrderId.get(orderId) ?? []
      const latestMessage = thread[0]
      const order = ordersById.get(orderId)
      const customer = order ? usersById.get(order.customer_id) : null
      const tailor = order ? usersById.get(order.tailor_id) : null
      const sender = latestMessage ? usersById.get(latestMessage.sender_id) : null
      const paymentContext = orderPaymentContextByOrderId.get(orderId)
      const accessLog = latestConversationAccessByOrderId.get(orderId)
      const conversationBlocked = accessLog?.event === 'conversation.blocked'

      return {
        orderId,
        orderReference: order?.reference ?? null,
        orderStage: order?.stage ?? null,
        orderKind: order?.order_kind ?? null,
        deliveryMethod: order?.delivery_method ?? null,
        paymentStatus: paymentContext?.paymentStatus ?? null,
        paymentProvider: paymentContext?.paymentProvider ?? null,
        customerName: customer?.display_name ?? 'Customer',
        customerEmail: customer?.email ?? null,
        tailorName: tailor?.display_name ?? 'Tailor',
        tailorEmail: tailor?.email ?? null,
        latestSenderName: latestMessage?.sender_name ?? sender?.display_name ?? 'Unknown sender',
        latestSenderRole: latestMessage?.sender_role ?? sender?.role ?? 'Unknown',
        latestMessagePreview: latestMessage ? messagePreview(latestMessage) : 'No message preview available',
        latestMessageType: latestMessage?.type ?? 'TEXT',
        latestMessageAt: latestMessage?.created_at ?? new Date(0).toISOString(),
        unreadCount: thread.filter((message) => !message.read_at).length,
        messageCount: thread.length,
        mediaCount: messageMediaCount(thread),
        blockedMessageCount: 0,
        conversationBlocked,
        blockedAt: conversationBlocked ? accessLog?.created_at ?? null : null,
        blockedByRole: conversationBlocked ? accessLog?.actor_role ?? null : null,
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
        riskAction: review.riskAction,
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
          relatedEntityType: workflowIssue.related_entity_type,
          relatedEntityId: workflowIssue.related_entity_id,
          financialCaseId: payloadStringValue(workflowIssue.metadata, 'financial_case_id'),
          refundResolutionId: payloadStringValue(workflowIssue.metadata, 'refund_resolution_id'),
          refundResolution: refundResolutionById.get(payloadStringValue(workflowIssue.metadata, 'refund_resolution_id') ?? '') ?? null,
          materialAdvanceId:
            workflowIssue.related_entity_type === 'order_material_advance'
              ? workflowIssue.related_entity_id
              : payloadStringValue(workflowIssue.metadata, 'advance_id')
                ?? payloadStringValue(workflowIssue.metadata, 'material_advance_id'),
          materialAdvanceAmount: numberPayloadValue(workflowIssue.metadata ?? {}, 'amount'),
          materialAdvanceCurrency: payloadStringValue(workflowIssue.metadata, 'currency'),
          materialReconciliationOutcome: payloadStringValue(workflowIssue.metadata, 'reconciliation_outcome'),
          materialReconciliationDelta: numberPayloadValue(workflowIssue.metadata ?? {}, 'reconciliation_delta'),
          materialCustomerRefundAmount: numberPayloadValue(workflowIssue.metadata ?? {}, 'customer_refund_amount') ?? 0,
          materialUnapprovedOverageAmount: numberPayloadValue(workflowIssue.metadata ?? {}, 'unapproved_overage_amount') ?? 0,
          summary: workflowIssue.description,
          reason:
            payloadStringValue(workflowIssue.metadata, 'reason')
            ?? payloadStringValue(workflowIssue.metadata, 'blocked_reason'),
          blockedReasonCode: payloadStringValue(workflowIssue.metadata, 'blocked_reason'),
          provider: workflowIssue.provider ?? payloadStringValue(workflowIssue.metadata, 'provider'),
          payoutId: payloadStringValue(workflowIssue.metadata, 'payout_id'),
          payoutError: payloadStringValue(workflowIssue.metadata, 'error'),
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
          consultationAttendance: workflowIssue.related_entity_type === 'CONSULTATION_BOOKING' && workflowIssue.related_entity_id
            ? consultationAttendanceByBookingId.get(workflowIssue.related_entity_id) ?? null
            : null,
          payoutChangeReview: workflowIssue.related_entity_type === 'payout_change_request' && workflowIssue.related_entity_id
            ? payoutChangeReviewById.get(workflowIssue.related_entity_id) ?? null
            : null,
          fabricReview: workflowIssue.related_entity_type?.toUpperCase() === 'FABRIC_CANDIDATE' && workflowIssue.related_entity_id
            ? fabricReviewById.get(workflowIssue.related_entity_id) ?? null
            : null,
          recommendedAction: workflowIssue.recommended_action,
          createdAt: workflowIssue.related_entity_type === 'payout_change_request' && workflowIssue.related_entity_id
            ? payoutChangeReviewById.get(workflowIssue.related_entity_id)?.submittedAt ?? workflowIssue.created_at
            : workflowIssue.created_at,
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
          relatedEntityType: null,
          relatedEntityId: null,
          financialCaseId: payloadStringValue(workflowIssue.payload, 'financial_case_id'),
          refundResolutionId: payloadStringValue(workflowIssue.payload, 'refund_resolution_id'),
          refundResolution: refundResolutionById.get(payloadStringValue(workflowIssue.payload, 'refund_resolution_id') ?? '') ?? null,
          materialAdvanceId:
            payloadStringValue(workflowIssue.payload, 'advance_id')
            ?? payloadStringValue(workflowIssue.payload, 'material_advance_id'),
          materialAdvanceAmount: numberPayloadValue(workflowIssue.payload ?? {}, 'amount'),
          materialAdvanceCurrency: payloadStringValue(workflowIssue.payload, 'currency'),
          materialReconciliationOutcome: payloadStringValue(workflowIssue.payload, 'reconciliation_outcome'),
          materialReconciliationDelta: numberPayloadValue(workflowIssue.payload ?? {}, 'reconciliation_delta'),
          materialCustomerRefundAmount: numberPayloadValue(workflowIssue.payload ?? {}, 'customer_refund_amount') ?? 0,
          materialUnapprovedOverageAmount: numberPayloadValue(workflowIssue.payload ?? {}, 'unapproved_overage_amount') ?? 0,
          summary: formatWorkflowSummary(workflowIssue.event, workflowIssue.payload),
          reason: payloadStringValue(workflowIssue.payload, 'reason'),
          blockedReasonCode: payloadStringValue(workflowIssue.payload, 'blocked_reason'),
          provider: payloadStringValue(workflowIssue.payload, 'provider'),
          payoutId: payloadStringValue(workflowIssue.payload, 'payout_id'),
          payoutError: payloadStringValue(workflowIssue.payload, 'error'),
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
          consultationAttendance: null,
          payoutChangeReview: null,
          fabricReview: null,
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
      const fulfillmentRun = fulfillmentRunByOrderId.get(order.id) ?? null

      return {
        orderId: order.id,
        orderReference: order.reference,
        orderKind: order.order_kind ?? null,
        garmentType: order.garment_type ?? 'Order',
        itemTitle: order.item_title ?? null,
        stage: order.stage,
        stageUpdatedAt: order.stage_updated_at ?? null,
        amount: order.quoted_amount ?? null,
        checkoutFulfillmentAmount: order.shipping_amount ?? 0,
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
        fulfillmentRun: fulfillmentRun
          ? {
              id: fulfillmentRun.id,
              status: fulfillmentRun.status,
              fundingStatus: fulfillmentRun.funding_status,
              currency: fulfillmentRun.currency,
              capturedAllowanceAmount: fulfillmentRun.captured_allowance_amount,
              customerFundedAllowanceAmount: fulfillmentRun.customer_funded_allowance_amount,
              drapeonSubsidyAmount: fulfillmentRun.drapeon_subsidy_amount,
              actualProviderCostAmount: fulfillmentRun.actual_provider_cost_amount,
              shortfallSubtotalAmount: fulfillmentRun.shortfall_subtotal_amount,
              shortfallTaxAmount: fulfillmentRun.shortfall_tax_amount,
              shortfallFeeAmount: fulfillmentRun.shortfall_fee_amount,
              shortfallTotalAmount: fulfillmentRun.shortfall_total_amount,
              unusedAllowanceAmount: fulfillmentRun.unused_allowance_amount,
              customerRefundAmount: fulfillmentRun.customer_refund_amount,
              customerRefundTaxAmount: fulfillmentRun.customer_refund_tax_amount,
              customerRefundStatus: fulfillmentRun.customer_refund_status,
              subsidyRestoredAmount: fulfillmentRun.subsidy_restored_amount,
              providerName: fulfillmentRun.provider_name,
              providerQuoteReference: fulfillmentRun.provider_quote_reference,
              providerQuoteEvidenceCount: Array.isArray(fulfillmentRun.provider_quote_evidence)
                ? fulfillmentRun.provider_quote_evidence.length
                : 0,
              providerQuoteEvidence: dispatchRunEvidenceById.get(fulfillmentRun.id) ?? [],
              customerDecision: fulfillmentRun.customer_decision,
              custodyAcceptedAt: fulfillmentRun.custody_accepted_at,
            }
          : null,
        parcels: (fulfillmentParcelsByOrderId.get(order.id) ?? []).map((parcel) => ({
          id: parcel.id,
          parcelNumber: parcel.parcel_number,
          status: parcel.status,
          providerName: parcel.provider_name,
          serviceLevel: parcel.service_level,
          providerReference: parcel.provider_reference,
          trackingNumber: parcel.tracking_number,
          trackingUrl: parcel.tracking_url,
          etaAt: parcel.eta_at,
          etaTimezone: parcel.eta_timezone,
          lastLocation: parcel.last_location,
          lastStatusAt: parcel.last_status_at,
        })),
        fulfillmentEvents: (fulfillmentEventsByOrderId.get(order.id) ?? []).map((event) => ({
          id: event.id,
          eventType: event.event_type,
          source: event.source,
          customerNote: event.customer_note,
          occurredAt: event.occurred_at,
          evidenceCount: Array.isArray(event.evidence_media) ? event.evidence_media.length : 0,
          evidence: dispatchEventEvidenceById.get(event.id) ?? [],
          etaAt: event.eta_at,
          etaTimezone: event.eta_timezone,
        })),
      }
    }),
    issues,
  }
}

export async function loadOpsDashboardData(options: { bypassCache?: boolean } = {}): Promise<OpsDashboardData | null> {
  const now = Date.now()
  if (!options.bypassCache && opsDashboardDataCache && opsDashboardDataCache.expiresAt > now) {
    return opsDashboardDataCache.data
  }

  const data = await loadOpsDashboardDataFresh()
  if (data) {
    opsDashboardDataCache = {
      data,
      expiresAt: now + OPS_DASHBOARD_CACHE_TTL_MS,
    }
  }

  return data
}
