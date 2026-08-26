export const COMMERCIAL_BENEFITS_POLICY_VERSION = 'benefits-2026-08-01-v1' as const

export const BENEFIT_KINDS = [
  'PERCENT_DISCOUNT',
  'FIXED_DISCOUNT',
  'FREE_SHIPPING',
  'CAPPED_SHIPPING',
  'ACCOUNT_GRANT',
  'COMPLIMENTARY_ORDER',
  'GOODWILL_GRANT',
  'CREATOR_CODE',
] as const
export type BenefitKind = (typeof BENEFIT_KINDS)[number]

export const BENEFIT_FUNDING_SOURCES = ['DRAPEON', 'TAILOR', 'PARTNER'] as const
export type BenefitFundingSource = (typeof BENEFIT_FUNDING_SOURCES)[number]

export const BENEFIT_RESERVATION_STATUSES = [
  'RESERVED',
  'CONSUMED',
  'RELEASED',
  'EXPIRED',
  'REVOKED',
  'REVERSED',
  'FRAUD_HELD',
] as const
export type BenefitReservationStatus = (typeof BENEFIT_RESERVATION_STATUSES)[number]

export const TIP_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'PAYOUT_PENDING',
  'PAID_OUT',
  'FAILED',
  'REFUNDED',
  'DISPUTED',
  'HELD',
] as const
export type TipStatus = (typeof TIP_STATUSES)[number]

export const BENEFIT_FEATURE_FLAGS = {
  controlledCore: true,
  rewardedReferrals: false,
  tailorMilestones: false,
  commissionWaivers: false,
  affiliatePayouts: false,
  sweepstakes: false,
  purchasedCredits: false,
  transferableBalances: false,
  giftCards: false,
} as const

export type BenefitApplicationInput = {
  kind: BenefitKind
  value: number
  maximumAmount?: number | null
  subtotalAmount: number
  shippingAmount: number
}

function units(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be non-negative minor units.`)
  return value
}

export function calculateBenefitApplication(input: BenefitApplicationInput) {
  const subtotal = units(input.subtotalAmount, 'subtotalAmount')
  const shipping = units(input.shippingAmount, 'shippingAmount')
  const value = units(input.value, 'value')
  const maximum = input.maximumAmount == null ? null : units(input.maximumAmount, 'maximumAmount')
  let orderDiscountAmount = 0
  let shippingDiscountAmount = 0

  if (input.kind === 'PERCENT_DISCOUNT' || input.kind === 'CREATOR_CODE') {
    if (value > 10_000) throw new Error('Percentage benefits cannot exceed 100%.')
    orderDiscountAmount = Math.floor((subtotal * value) / 10_000)
  } else if (['FIXED_DISCOUNT', 'ACCOUNT_GRANT', 'GOODWILL_GRANT'].includes(input.kind)) {
    orderDiscountAmount = Math.min(value, subtotal)
  } else if (input.kind === 'COMPLIMENTARY_ORDER') {
    orderDiscountAmount = subtotal
    shippingDiscountAmount = shipping
  } else if (input.kind === 'FREE_SHIPPING') {
    shippingDiscountAmount = shipping
  } else if (input.kind === 'CAPPED_SHIPPING') {
    shippingDiscountAmount = Math.min(value, shipping)
  }
  if (maximum != null) orderDiscountAmount = Math.min(orderDiscountAmount, maximum)

  return {
    orderDiscountAmount,
    shippingDiscountAmount,
    totalBenefitAmount: orderDiscountAmount + shippingDiscountAmount,
    remainingSubtotalAmount: subtotal - orderDiscountAmount,
    remainingShippingAmount: shipping - shippingDiscountAmount,
  }
}

export function validateTip(input: { amount: number; currency: string; orderComplete: boolean; existingTip: boolean }) {
  const amount = units(input.amount, 'amount')
  const currency = input.currency.trim().toUpperCase()
  if (!input.orderComplete) throw new Error('Tips become available after order completion.')
  if (input.existingTip) throw new Error('This order already has a tip.')
  if (amount <= 0) throw new Error('Tip amount must be greater than zero.')
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('currency must be a three-letter code.')
  return { amount, currency, platformFeeAmount: 0, tailorEntitlementAmount: amount }
}

export function benefitReservationExpired(expiresAt: string, nowMs = Date.now()) {
  const expires = Date.parse(expiresAt)
  return !Number.isFinite(expires) || expires <= nowMs
}
