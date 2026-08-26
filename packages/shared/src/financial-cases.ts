import type { CommercialEvidenceTier, FinancialClaimStatus } from './commercial-contracts.ts'

export const FINANCIAL_CASE_TYPES = [
  'CONSULTATION_ATTENDANCE',
  'MATERIAL_REQUEST',
  'FULFILLMENT_RECONCILIATION',
  'TIMELINE_AMENDMENT',
  'QUALITY_CONCERN',
  'RETURN',
  'REFUND',
  'PAYMENT_FAILURE',
  'PAYOUT_FAILURE',
  'SAFETY_FRAUD',
  'REVIEWED_EXCEPTION',
] as const

export type FinancialCaseType = (typeof FINANCIAL_CASE_TYPES)[number]

export const FINANCIAL_CASE_REQUESTED_OUTCOMES = [
  'EXPLANATION_OR_UPDATE',
  'ALTERATION_OR_FIX',
  'REMAKE',
  'PARTIAL_REFUND',
  'FULL_REFUND',
  'OPS_HELP',
] as const

export type FinancialCaseRequestedOutcome = (typeof FINANCIAL_CASE_REQUESTED_OUTCOMES)[number]

export const FINANCIAL_CASE_EVENT_TYPES = [
  'CASE_OPENED',
  'EVIDENCE_ADDED',
  'COUNTERPARTY_RESPONSE_ADDED',
  'STATUS_CHANGED',
  'ELIGIBILITY_RECORDED',
  'OPS_NOTE_ADDED',
  'CASE_RESOLVED',
  'CASE_CANCELLED',
] as const

export type FinancialCaseEventType = (typeof FINANCIAL_CASE_EVENT_TYPES)[number]

export const FINANCIAL_CASE_EVIDENCE_SOURCES = [
  'PLATFORM_ORDER',
  'PLATFORM_TIMELINE',
  'PLATFORM_MESSAGE',
  'PAYMENT_PROVIDER',
  'CALL_PROVIDER',
  'FULFILLMENT_PROVIDER',
  'USER_UPLOAD',
  'EMAIL_INGEST',
  'WHATSAPP_SUMMARY',
  'OPS_NOTE',
] as const

export type FinancialCaseEvidenceSource = (typeof FINANCIAL_CASE_EVIDENCE_SOURCES)[number]

export const FINANCIAL_CASE_EVIDENCE_VERIFICATION_STATUSES = [
  'CLAIMED',
  'CORROBORATED',
  'VERIFIED',
  'REJECTED',
] as const

export type FinancialCaseEvidenceVerificationStatus =
  (typeof FINANCIAL_CASE_EVIDENCE_VERIFICATION_STATUSES)[number]

export const FINANCIAL_CASE_VISIBILITIES = ['PARTIES', 'OPS_ONLY'] as const
export type FinancialCaseVisibility = (typeof FINANCIAL_CASE_VISIBILITIES)[number]

export const OPS_PARTIAL_REFUND_REASON_CODES = [
  'TAILOR_INACTIVITY',
  'QUALITY_ADJUSTMENT',
  'LATE_DELIVERY',
  'FULFILLMENT_ISSUE',
  'BILLING_CORRECTION',
  'GOODWILL',
  'OTHER_REVIEWED',
] as const

export type OpsPartialRefundReasonCode = (typeof OPS_PARTIAL_REFUND_REASON_CODES)[number]

export const OPS_PARTIAL_REFUND_REASON_LABELS: Readonly<Record<OpsPartialRefundReasonCode, string>> = {
  TAILOR_INACTIVITY: 'Tailor inactivity',
  QUALITY_ADJUSTMENT: 'Quality adjustment',
  LATE_DELIVERY: 'Late delivery',
  FULFILLMENT_ISSUE: 'Shipping or delivery issue',
  BILLING_CORRECTION: 'Billing correction',
  GOODWILL: 'Drapeon goodwill',
  OTHER_REVIEWED: 'Other reviewed outcome',
}

export const OPS_PARTIAL_REFUND_DECISION_BASES = [
  'MUTUAL_AGREEMENT',
  'POLICY_ENTITLEMENT',
  'SERVICE_RECOVERY',
  'OPS_EXCEPTION',
] as const

export type OpsPartialRefundDecisionBasis = (typeof OPS_PARTIAL_REFUND_DECISION_BASES)[number]

export const OPS_PARTIAL_REFUND_DECISION_BASIS_LABELS: Readonly<Record<OpsPartialRefundDecisionBasis, string>> = {
  MUTUAL_AGREEMENT: 'Both parties agreed',
  POLICY_ENTITLEMENT: 'Drapeon policy entitlement',
  SERVICE_RECOVERY: 'Service recovery',
  OPS_EXCEPTION: 'Reviewed Ops exception',
}

export const OPS_PARTIAL_REFUND_EVIDENCE_SOURCES = [
  'EMAIL_INGEST',
  'WHATSAPP_SUMMARY',
  'PLATFORM_MESSAGE',
  'CALL_PROVIDER',
  'OPS_NOTE',
] as const satisfies readonly FinancialCaseEvidenceSource[]

export type OpsPartialRefundEvidenceSource = (typeof OPS_PARTIAL_REFUND_EVIDENCE_SOURCES)[number]

export const OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_LABELS: Readonly<Record<OpsPartialRefundEvidenceSource, string>> = {
  EMAIL_INGEST: 'Email thread',
  WHATSAPP_SUMMARY: 'WhatsApp conversation',
  PLATFORM_MESSAGE: 'Drapeon order chat',
  CALL_PROVIDER: 'Drapeon call record',
  OPS_NOTE: 'Ops review note',
}

export const OPS_PARTIAL_REFUND_ORDER_OUTCOMES = [
  'CONTINUE_ORDER',
  'CLOSE_ORDER',
  'KEEP_UNDER_REVIEW',
] as const

export type OpsPartialRefundOrderOutcome = (typeof OPS_PARTIAL_REFUND_ORDER_OUTCOMES)[number]

export const OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY: Readonly<Record<OpsPartialRefundOrderOutcome, {
  label: string
  description: string
}>> = {
  CONTINUE_ORDER: {
    label: 'Continue order after refund',
    description: 'Return the order to its production stage after the refund succeeds.',
  },
  CLOSE_ORDER: {
    label: 'Close order as partially refunded',
    description: 'Close the order after the refund succeeds and recalculate any remaining approved settlement.',
  },
  KEEP_UNDER_REVIEW: {
    label: 'Keep under review after refund',
    description: 'Send the refund but keep the order with Drapeon Ops for a separate decision.',
  },
}

export type RefundProvider = 'STRIPE' | 'PAYSTACK' | 'UNKNOWN'

export function normalizeRefundProvider(value: unknown): RefundProvider {
  const provider = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (provider === 'STRIPE') return 'STRIPE'
  if (provider === 'PAYSTACK') return 'PAYSTACK'
  return 'UNKNOWN'
}

export function refundProviderTimingCopy(input: {
  provider: unknown
  audience: 'CUSTOMER' | 'TAILOR'
  expectedAt?: string | null
}): { provider: RefundProvider; label: string; detail: string } {
  const provider = normalizeRefundProvider(input.provider)
  const destination = input.audience === 'CUSTOMER' ? 'your original payment method' : "the customer's original payment method"
  const expectedDate = input.expectedAt
    ? new Date(input.expectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null
  if (provider === 'STRIPE') {
    return { provider, label: 'Refund via Stripe', detail: `The refund returns to ${destination}, usually within 5–10 business days. The bank controls the final display time.` }
  }
  if (provider === 'PAYSTACK') {
    return {
      provider,
      label: 'Refund via Paystack',
      detail: expectedDate
        ? `Paystack expects to process this by ${expectedDate}. It returns to ${destination}; the bank may take up to 10 business days to display it after processing.`
        : `The refund returns to ${destination}. Paystack refunds generally take 3–10 working days, and the bank controls the final display time.`,
    }
  }
  return { provider, label: 'Refund processing', detail: `The refund returns to ${destination}. The payment provider and bank control when it appears.` }
}

export const CUSTOMER_CONCERN_REASONS = [
  'NOT_RECEIVED',
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'FIT_OR_MEASUREMENT_ISSUE',
  'TAILOR_UNRESPONSIVE',
  'WRONG_ITEM',
  'OFF_PLATFORM_OR_TRUST_ISSUE',
  'OTHER',
] as const

export type CustomerConcernReason = (typeof CUSTOMER_CONCERN_REASONS)[number]

export const CUSTOMER_CONCERN_REASON_LABELS: Readonly<Record<CustomerConcernReason, string>> = {
  NOT_RECEIVED: 'Item was not received',
  NOT_AS_DESCRIBED: 'Quality or workmanship issue',
  DAMAGED: 'Damaged item received',
  FIT_OR_MEASUREMENT_ISSUE: 'Fit or measurement issue',
  TAILOR_UNRESPONSIVE: 'Tailor unresponsive',
  WRONG_ITEM: 'Wrong item or details',
  OFF_PLATFORM_OR_TRUST_ISSUE: 'Off-platform or trust issue',
  OTHER: 'Other',
}

export const FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS: Readonly<Record<FinancialCaseRequestedOutcome, string>> = {
  EXPLANATION_OR_UPDATE: 'Explanation or update',
  ALTERATION_OR_FIX: 'Alteration or fix',
  REMAKE: 'Remake',
  PARTIAL_REFUND: 'Partial refund',
  FULL_REFUND: 'Full refund',
  OPS_HELP: 'Help deciding the next step',
}

const LEGACY_CONCERN_REASON_ALIASES: Readonly<Record<string, CustomerConcernReason>> = {
  'garment not as described': 'NOT_AS_DESCRIBED',
  'quality or workmanship issue': 'NOT_AS_DESCRIBED',
  'wrong measurements / poor fit': 'FIT_OR_MEASUREMENT_ISSUE',
  'fit or measurement issue': 'FIT_OR_MEASUREMENT_ISSUE',
  'order not delivered': 'NOT_RECEIVED',
  'item was not received': 'NOT_RECEIVED',
  'delivery or pickup problem': 'NOT_RECEIVED',
  'damaged item received': 'DAMAGED',
  'tailor unresponsive': 'TAILOR_UNRESPONSIVE',
  'wrong item or details': 'WRONG_ITEM',
  'off-platform or trust issue': 'OFF_PLATFORM_OR_TRUST_ISSUE',
  'timeline changed': 'OTHER',
  other: 'OTHER',
}

export type FinancialCaseEvidencePrompt = {
  id: string
  label: string
  required: boolean
}

export function normalizeCustomerConcernReason(value: unknown): CustomerConcernReason | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if ((CUSTOMER_CONCERN_REASONS as readonly string[]).includes(trimmed)) {
    return trimmed as CustomerConcernReason
  }
  return LEGACY_CONCERN_REASON_ALIASES[trimmed.toLowerCase()] ?? null
}

export function financialCaseTypeForConcern(reason: CustomerConcernReason): FinancialCaseType {
  if (reason === 'NOT_RECEIVED') return 'FULFILLMENT_RECONCILIATION'
  if (reason === 'OFF_PLATFORM_OR_TRUST_ISSUE') return 'SAFETY_FRAUD'
  return 'QUALITY_CONCERN'
}

export function evidencePromptsForConcern(reason: CustomerConcernReason): FinancialCaseEvidencePrompt[] {
  if (reason === 'NOT_RECEIVED') {
    return [
      { id: 'tracking', label: 'Tracking, delivery estimate, or handoff details', required: false },
    ]
  }
  if (reason === 'NOT_AS_DESCRIBED' || reason === 'WRONG_ITEM' || reason === 'DAMAGED') {
    return [
      { id: 'item_photos', label: 'Clear item photos', required: false },
      { id: 'packaging_photos', label: 'Packaging or handoff photos', required: false },
    ]
  }
  if (reason === 'FIT_OR_MEASUREMENT_ISSUE') {
    return [
      { id: 'fit_area', label: 'Name whether the issue is size, balance, or workmanship', required: true },
      { id: 'fit_photos', label: 'Fit photos, only if you are comfortable', required: false },
    ]
  }
  if (reason === 'OFF_PLATFORM_OR_TRUST_ISSUE') {
    return [
      { id: 'off_platform_context', label: 'Screenshots or a summary of what moved off-platform', required: false },
    ]
  }
  return []
}

export function validateFinancialCaseDraft(input: {
  reason: unknown
  requestedOutcome: unknown
  description: unknown
}) {
  const reason = normalizeCustomerConcernReason(input.reason)
  if (!reason) throw new Error('Choose a valid concern reason.')
  if (
    typeof input.requestedOutcome !== 'string'
    || !(FINANCIAL_CASE_REQUESTED_OUTCOMES as readonly string[]).includes(input.requestedOutcome)
  ) {
    throw new Error('Choose the outcome you are seeking.')
  }
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length < 10 || description.length > 2_000) {
    throw new Error('Describe what happened in 10 to 2,000 characters.')
  }
  return {
    reason,
    requestedOutcome: input.requestedOutcome as FinancialCaseRequestedOutcome,
    description,
    caseType: financialCaseTypeForConcern(reason),
  }
}

export type FinancialCaseSummary = {
  id: string
  reference: string
  orderId: string
  type: FinancialCaseType
  status: FinancialClaimStatus
  requestedOutcome: FinancialCaseRequestedOutcome | null
  policyVersion: string
  correlationId: string
  openedAt: string
}

export type FinancialCaseEvidenceDescriptor = {
  source: FinancialCaseEvidenceSource
  tier: CommercialEvidenceTier | null
  verificationStatus: FinancialCaseEvidenceVerificationStatus
  visibility: FinancialCaseVisibility
}
