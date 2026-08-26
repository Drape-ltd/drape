export const MATERIAL_ADVANCE_DECLINE_REASONS = [
  'FIND_CHEAPER_OPTION',
  'CONTINUE_WITHOUT_MATERIAL',
  'AMOUNT_TOO_HIGH',
  'PROOF_OR_DETAILS_UNCLEAR',
  'WRONG_ITEM_OR_SCOPE',
  'OTHER',
] as const

export type MaterialAdvanceDeclineReason = (typeof MATERIAL_ADVANCE_DECLINE_REASONS)[number]

export const MATERIAL_ADVANCE_DECLINE_REASON_LABELS: Readonly<Record<MaterialAdvanceDeclineReason, string>> = {
  FIND_CHEAPER_OPTION: 'Find a cheaper option',
  CONTINUE_WITHOUT_MATERIAL: 'Continue without this material',
  AMOUNT_TOO_HIGH: 'The amount is too high',
  PROOF_OR_DETAILS_UNCLEAR: 'The proof or details are unclear',
  WRONG_ITEM_OR_SCOPE: 'This is not what we agreed',
  OTHER: 'Something else',
}

export function isMaterialAdvanceDeclineReason(value: unknown): value is MaterialAdvanceDeclineReason {
  return typeof value === 'string' && MATERIAL_ADVANCE_DECLINE_REASONS.includes(value as MaterialAdvanceDeclineReason)
}

export function materialAdvanceDeclineReasonLabel(value: unknown) {
  return isMaterialAdvanceDeclineReason(value)
    ? MATERIAL_ADVANCE_DECLINE_REASON_LABELS[value]
    : null
}

export type MaterialAdvanceCustomerDecision = 'APPROVED' | 'DECLINED'

export const MATERIAL_ADVANCE_FUNDING_SOURCES = [
  'LEGACY_SEPARATE_PAYMENT',
  'FUNDED_FABRIC_ALLOWANCE',
] as const

export type MaterialAdvanceFundingSource = (typeof MATERIAL_ADVANCE_FUNDING_SOURCES)[number]

export const MATERIAL_FUNDING_EVENTS = [
  'RELEASE_REQUESTED',
  'CUSTOMER_APPROVED',
  'CUSTOMER_DECLINED',
  'RELEASE_CONFIRMED',
  'RELEASE_FAILED',
  'RECEIPT_REMINDER',
  'RECEIPT_OVERDUE',
  'RECONCILED_EXACT',
  'RECONCILIATION_UNUSED_VALUE',
  'RECONCILIATION_OVERAGE',
  'CUSTOMER_REFUND_COMPLETED',
  'OVERAGE_RESOLVED',
] as const

export type MaterialFundingEvent = (typeof MATERIAL_FUNDING_EVENTS)[number]
export type MaterialFundingAudience = 'CUSTOMER' | 'TAILOR' | 'OPS'

export type MaterialFundingEventPolicy = {
  importance: 'INFORMATIONAL' | 'ACTION_REQUIRED' | 'TIME_SENSITIVE'
  audiences: readonly MaterialFundingAudience[]
  channels: readonly ('IN_APP' | 'PUSH' | 'EMAIL' | 'OPS_ALERT')[]
  destination: 'ORDER_MATERIAL_ADVANCE'
  smsFallback: false
}

/**
 * Shared delivery contract for protected fabric money events. In-app state is
 * authoritative; push and email mirror decisions or time-sensitive outcomes.
 * SMS is intentionally excluded because none of these events requires an
 * emergency fallback.
 */
export const MATERIAL_FUNDING_EVENT_POLICIES: Readonly<Record<MaterialFundingEvent, MaterialFundingEventPolicy>> = {
  RELEASE_REQUESTED: { importance: 'ACTION_REQUIRED', audiences: ['CUSTOMER'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  CUSTOMER_APPROVED: { importance: 'ACTION_REQUIRED', audiences: ['TAILOR', 'OPS'], channels: ['IN_APP', 'PUSH', 'EMAIL', 'OPS_ALERT'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  CUSTOMER_DECLINED: { importance: 'ACTION_REQUIRED', audiences: ['TAILOR'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RELEASE_CONFIRMED: { importance: 'ACTION_REQUIRED', audiences: ['CUSTOMER', 'TAILOR'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RELEASE_FAILED: { importance: 'TIME_SENSITIVE', audiences: ['CUSTOMER', 'TAILOR', 'OPS'], channels: ['IN_APP', 'PUSH', 'EMAIL', 'OPS_ALERT'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RECEIPT_REMINDER: { importance: 'ACTION_REQUIRED', audiences: ['TAILOR'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RECEIPT_OVERDUE: { importance: 'TIME_SENSITIVE', audiences: ['CUSTOMER', 'TAILOR', 'OPS'], channels: ['IN_APP', 'PUSH', 'EMAIL', 'OPS_ALERT'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RECONCILED_EXACT: { importance: 'INFORMATIONAL', audiences: ['CUSTOMER', 'TAILOR'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RECONCILIATION_UNUSED_VALUE: { importance: 'ACTION_REQUIRED', audiences: ['CUSTOMER', 'TAILOR', 'OPS'], channels: ['IN_APP', 'PUSH', 'EMAIL', 'OPS_ALERT'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  RECONCILIATION_OVERAGE: { importance: 'ACTION_REQUIRED', audiences: ['CUSTOMER', 'TAILOR', 'OPS'], channels: ['IN_APP', 'PUSH', 'EMAIL', 'OPS_ALERT'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  CUSTOMER_REFUND_COMPLETED: { importance: 'ACTION_REQUIRED', audiences: ['CUSTOMER', 'TAILOR'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
  OVERAGE_RESOLVED: { importance: 'ACTION_REQUIRED', audiences: ['CUSTOMER', 'TAILOR'], channels: ['IN_APP', 'PUSH', 'EMAIL'], destination: 'ORDER_MATERIAL_ADVANCE', smsFallback: false },
}

export function materialFundingDestinationData(orderId: string, advanceId: string, event: MaterialFundingEvent) {
  if (!orderId.trim() || !advanceId.trim()) throw new Error('orderId and advanceId are required')
  return {
    destination: 'ORDER',
    orderId: orderId.trim(),
    advanceId: advanceId.trim(),
    action: event,
  }
}

export type FabricAllowanceBalance = {
  fundedAmount: number
  releasedAmount: number
  refundedAmount: number
}

export function remainingFundedFabricAllowance(balance: FabricAllowanceBalance) {
  return Math.max(balance.fundedAmount - balance.releasedAmount - balance.refundedAmount, 0)
}

export function validateFundedFabricReleaseAmount(
  amount: number,
  balance: FabricAllowanceBalance,
): { ok: true; remainingAmount: number } | { ok: false; remainingAmount: number; code: string } {
  const remainingAmount = remainingFundedFabricAllowance(balance)
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, remainingAmount, code: 'FABRIC_RELEASE_AMOUNT_INVALID' }
  }
  if (amount > remainingAmount) {
    return { ok: false, remainingAmount, code: 'FABRIC_RELEASE_EXCEEDS_ALLOWANCE' }
  }
  return { ok: true, remainingAmount }
}

export function materialAdvanceRequiresSeparatePayment(fundingSource: MaterialAdvanceFundingSource) {
  return fundingSource === 'LEGACY_SEPARATE_PAYMENT'
}

export function materialAdvanceCustomerDecisionFromNote(
  note: string | null | undefined,
): MaterialAdvanceCustomerDecision | null {
  const normalized = note?.trim().toLowerCase() ?? ''
  if (normalized.startsWith('customer approved the material advance for ')) return 'APPROVED'
  if (normalized.startsWith('customer declined the material advance for ')) return 'DECLINED'
  return null
}

export const MATERIAL_RECONCILIATION_OUTCOMES = ['EXACT', 'UNUSED_VALUE', 'OVERAGE'] as const
export type MaterialReconciliationOutcome = typeof MATERIAL_RECONCILIATION_OUTCOMES[number]
export type MaterialReconciliationResolution = 'EXACT' | 'CUSTOMER_REFUNDED' | 'TAILOR_ABSORBS' | 'CUSTOMER_ADJUSTMENT_PAID'

export function materialReconciliationCopy(input: {
  outcome?: string | null
  resolution?: string | null
  customerRefundAmount?: number | null
  unapprovedOverageAmount?: number | null
  actorRole: 'CUSTOMER' | 'TAILOR'
}) {
  if (input.resolution === 'CUSTOMER_REFUNDED') return {
    tone: 'success' as const,
    title: 'Unused fabric value refunded',
    body: input.actorRole === 'CUSTOMER'
      ? 'The unused approved amount was returned through the original payment route.'
      : 'Drapeon returned the unused approved amount to the customer and recorded the settlement deduction.',
  }
  if (input.resolution === 'TAILOR_ABSORBS') return {
    tone: 'neutral' as const,
    title: 'Supplier overage resolved',
    body: input.actorRole === 'CUSTOMER'
      ? 'You were not charged for the amount above your approval.'
      : 'The amount above customer approval is your responsibility and will not be charged to the customer.',
  }
  if (input.outcome === 'EXACT') return {
    tone: 'success' as const,
    title: 'Fabric purchase reconciled',
    body: 'The final receipt matches the approved and released amount.',
  }
  if (input.outcome === 'UNUSED_VALUE') return {
    tone: 'warning' as const,
    title: 'Unused fabric value under review',
    body: input.actorRole === 'CUSTOMER'
      ? 'Drapeon is reviewing the unused approved amount for a recorded refund.'
      : 'Drapeon is reviewing the unused amount. It remains unresolved until the customer refund reaches a terminal outcome.',
  }
  if (input.outcome === 'OVERAGE') return {
    tone: 'warning' as const,
    title: 'Supplier overage under review',
    body: input.actorRole === 'CUSTOMER'
      ? 'You will not be charged for an amount you did not approve.'
      : 'The customer is not charged. Drapeon must record whether you absorb it or a separate proposed change is approved and paid.',
  }
  return null
}

export function deriveMaterialReconciliation(input: { approvedAmount: number; actualSpentAmount: number; protectedUnusedAmount?: number }) {
  if (!Number.isSafeInteger(input.approvedAmount) || input.approvedAmount <= 0) throw new Error('approvedAmount must be a positive integer in minor units.')
  if (!Number.isSafeInteger(input.actualSpentAmount) || input.actualSpentAmount < 0) throw new Error('actualSpentAmount must be a non-negative integer in minor units.')
  const protectedUnusedAmount = input.protectedUnusedAmount ?? 0
  if (!Number.isSafeInteger(protectedUnusedAmount) || protectedUnusedAmount < 0) throw new Error('protectedUnusedAmount must be a non-negative integer in minor units.')
  const deltaAmount = input.actualSpentAmount - input.approvedAmount
  const settlementRecoveryAmount = deltaAmount < 0 ? -deltaAmount : 0
  const customerRefundAmount = deltaAmount > 0 ? 0 : settlementRecoveryAmount + protectedUnusedAmount
  const outcome: MaterialReconciliationOutcome = deltaAmount > 0 ? 'OVERAGE' : customerRefundAmount > 0 ? 'UNUSED_VALUE' : 'EXACT'
  return {
    approvedAmount: input.approvedAmount,
    actualSpentAmount: input.actualSpentAmount,
    deltaAmount,
    outcome,
    customerRefundAmount,
    protectedAllowanceRefundAmount: deltaAmount > 0 ? 0 : protectedUnusedAmount,
    settlementRecoveryAmount,
    unapprovedOverageAmount: Math.max(deltaAmount, 0),
    requiresOpsReview: outcome !== 'EXACT',
  }
}
