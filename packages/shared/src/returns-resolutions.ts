export const RETURNS_RESOLUTION_POLICY_VERSION = 'returns-2026-08-01-v1' as const

export const RETURN_REASONS = ['CHANGE_OF_MIND','NOT_AS_DESCRIBED','DAMAGED_IN_TRANSIT','WRONG_ITEM','QUALITY_WORKMANSHIP','FIT_MEASUREMENT','LATE_DELIVERY','NOT_RECEIVED'] as const
export type ReturnReason = typeof RETURN_REASONS[number]
export const RESOLUTION_REMEDIES = ['EXPLANATION','ALTERATION','REMAKE','PARTIAL_REFUND','FULL_REFUND','RETURN_AND_REFUND','REJECTED'] as const
export type ResolutionRemedy = typeof RESOLUTION_REMEDIES[number]
export type ReturnEligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'OPS_REVIEW'

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  CHANGE_OF_MIND: 'Changed my mind', NOT_AS_DESCRIBED: 'Not as described', DAMAGED_IN_TRANSIT: 'Damaged in transit', WRONG_ITEM: 'Wrong item', QUALITY_WORKMANSHIP: 'Quality or workmanship', FIT_MEASUREMENT: 'Fit or measurement', LATE_DELIVERY: 'Arrived too late', NOT_RECEIVED: 'Not received',
}

export type ReturnEligibilityInput = {
  orderKind: 'CUSTOM' | 'READY_MADE'
  reason: ReturnReason
  deliveredAt: string | null
  destinationCountryCode?: string | null
  nowMs?: number
}

export function evaluateReturnEligibility(input: ReturnEligibilityInput): { status: ReturnEligibility; returnRequired: boolean; reason: string } {
  if (input.reason === 'NOT_RECEIVED') return { status: 'OPS_REVIEW', returnRequired: false, reason: 'Delivery evidence must be reconciled before a refund decision.' }
  if (input.orderKind === 'CUSTOM' && input.reason === 'CHANGE_OF_MIND') return { status: 'INELIGIBLE', returnRequired: false, reason: 'Made-to-order work is not eligible for a change-of-mind return unless applicable law requires it.' }
  if (!input.deliveredAt || !Number.isFinite(Date.parse(input.deliveredAt))) return { status: 'OPS_REVIEW', returnRequired: input.reason !== 'FIT_MEASUREMENT', reason: 'Verified delivery or handoff time is required.' }
  const ageDays = ((input.nowMs ?? Date.now()) - Date.parse(input.deliveredAt)) / 86_400_000
  if (ageDays < 0) return { status: 'OPS_REVIEW', returnRequired: true, reason: 'The delivery timestamp needs review.' }
  if (ageDays > 14) return { status: 'OPS_REVIEW', returnRequired: true, reason: 'The standard protection window passed; applicable law and evidence still require review.' }
  if (input.reason === 'FIT_MEASUREMENT') return { status: 'OPS_REVIEW', returnRequired: false, reason: 'Fit responsibility and alteration feasibility require evidence review.' }
  return { status: 'ELIGIBLE', returnRequired: true, reason: 'The request is inside the protection window and requires evidence and counterpart review.' }
}

export type RefundRestoration = {
  tailorWorkAmount: number
  platformFeeAmount: number
  taxAmount: number
  fulfillmentAmount: number
  consultationAmount: number
  promotionAmount: number
  drapeonFundedAmount: number
}

export function validateRefundRestoration(input: RefundRestoration, refundAmount: number) {
  if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) throw new Error('Refund amount must be a positive integer in minor units.')
  const normalized = Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer in minor units.`)
    return [key, value]
  })) as RefundRestoration
  // A promotion restoration is a non-cash benefit. Drapeon funding explains
  // who absorbs loss; it is not a second provider refund. Only cash line items
  // may be sent to Stripe or Paystack.
  const providerCashTotal = normalized.tailorWorkAmount + normalized.platformFeeAmount
    + normalized.taxAmount + normalized.fulfillmentAmount + normalized.consultationAmount
  if (providerCashTotal !== refundAmount) throw new Error('Cash restoration components must equal the provider refund amount.')
  return { ...normalized, providerCashTotal }
}

export function remedyRequiresReturn(remedy: ResolutionRemedy, reason: ReturnReason) {
  if (reason === 'NOT_RECEIVED') return false
  return remedy === 'RETURN_AND_REFUND' || remedy === 'FULL_REFUND'
}
