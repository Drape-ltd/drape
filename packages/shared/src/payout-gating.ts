type AccountCurrencyCode = 'NGN' | 'GHS' | 'KES' | 'USD' | 'GBP' | 'EUR' | 'CAD'

function normalizeAccountCurrency(value: string | null | undefined): AccountCurrencyCode | null {
  const normalized = value?.trim().toUpperCase() ?? ''
  switch (normalized) {
    case 'NGN':
    case 'GHS':
    case 'KES':
    case 'USD':
    case 'GBP':
    case 'EUR':
    case 'CAD':
      return normalized
    default:
      return null
  }
}

function resolvePaymentProviderForCurrency(currency: AccountCurrencyCode): 'PAYSTACK' | 'STRIPE' {
  switch (currency) {
    case 'NGN':
    case 'GHS':
    case 'KES':
      return 'PAYSTACK'
    case 'USD':
    case 'GBP':
    case 'EUR':
    case 'CAD':
      return 'STRIPE'
  }
}

export const PAYOUT_BLOCKED_REASONS = {
  ORDER_NOT_FINAL: 'ORDER_NOT_FINAL',
  HANDOFF_NOT_COMPLETED: 'HANDOFF_NOT_COMPLETED',
  CUSTOMER_CONFIRMATION_REQUIRED: 'CUSTOMER_CONFIRMATION_REQUIRED',
  DISPUTE_WINDOW_OPEN: 'DISPUTE_WINDOW_OPEN',
  OPEN_DISPUTE: 'OPEN_DISPUTE',
  PAYOUT_ACCOUNT_UNVERIFIED: 'PAYOUT_ACCOUNT_UNVERIFIED',
  PAYOUT_ACCOUNT_MISSING: 'PAYOUT_ACCOUNT_MISSING',
  PAYOUT_DESTINATION_HOLD: 'PAYOUT_DESTINATION_HOLD',
  PAYOUT_CURRENCY_MISMATCH: 'PAYOUT_CURRENCY_MISMATCH',
  NO_SETTLED_PAYMENT: 'NO_SETTLED_PAYMENT',
  PAYOUT_ALREADY_TRIGGERED: 'PAYOUT_ALREADY_TRIGGERED',
  PAYOUT_AMOUNT_INVALID: 'PAYOUT_AMOUNT_INVALID',
  PAYOUT_CURRENCY_INVALID: 'PAYOUT_CURRENCY_INVALID',
  PAYMENT_ALREADY_REFUNDED: 'PAYMENT_ALREADY_REFUNDED',
  PAYOUT_PROVIDER_UNAVAILABLE: 'PAYOUT_PROVIDER_UNAVAILABLE',
  PAYOUT_CHANGE_PENDING: 'PAYOUT_CHANGE_PENDING',
} as const

export type PayoutBlockedReason = typeof PAYOUT_BLOCKED_REASONS[keyof typeof PAYOUT_BLOCKED_REASONS]

export type PayoutOrderMoneyShape = {
  currency?: string | null
  source_currency?: string | null
  source_amount?: number | null
  subtotal_amount?: number | null
}

export type PayoutProfileMoneyShape = {
  payout_currency?: string | null
  payout_provider?: 'STRIPE' | 'PAYSTACK' | null
}

export type ResolvedPayoutMoney = {
  amount: number
  currency: AccountCurrencyCode
  provider: 'STRIPE' | 'PAYSTACK'
}

export function normalizePayoutCurrency(value: string | null | undefined): AccountCurrencyCode | null {
  return normalizeAccountCurrency(value)
}

export function isOrderInFinalHandoffState(stage: string) {
  return ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(stage)
}

export function payoutBlockReasonMessage(reason: PayoutBlockedReason) {
  switch (reason) {
    case PAYOUT_BLOCKED_REASONS.ORDER_NOT_FINAL:
      return 'Order has not reached a final delivered or collected state yet.'
    case PAYOUT_BLOCKED_REASONS.HANDOFF_NOT_COMPLETED:
      return 'The order handoff has not been completed yet.'
    case PAYOUT_BLOCKED_REASONS.CUSTOMER_CONFIRMATION_REQUIRED:
      return 'Customer has not explicitly confirmed the handoff yet.'
    case PAYOUT_BLOCKED_REASONS.DISPUTE_WINDOW_OPEN:
      return 'The 72-hour dispute window is still open.'
    case PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE:
      return 'An open dispute or review is blocking payout release.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_UNVERIFIED:
      return 'Tailor payout account is not verified yet.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_MISSING:
      return 'Tailor payout account details are incomplete for the selected provider.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_DESTINATION_HOLD:
      return 'Tailor payout destination was recently changed and is in the safety hold window.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH:
      return 'Tailor payout currency no longer matches the locked order earnings currency.'
    case PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT:
      return 'There is no settled customer payment to release for this order.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_ALREADY_TRIGGERED:
      return 'A payout has already been triggered for this order.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID:
      return 'The locked payout amount is invalid for release.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID:
      return 'The locked payout currency is invalid for release.'
    case PAYOUT_BLOCKED_REASONS.PAYMENT_ALREADY_REFUNDED:
      return 'Some or all customer funds were already refunded, so payout needs manual ops review.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_PROVIDER_UNAVAILABLE:
      return 'The payout provider is degraded right now, so payout release needs ops review before retry.'
    case PAYOUT_BLOCKED_REASONS.PAYOUT_CHANGE_PENDING:
      return 'A payout destination change is pending ops review, so earnings release is paused for account safety.'
  }
}

export function resolvePayoutMoney(
  order: PayoutOrderMoneyShape,
  tailorProfile: PayoutProfileMoneyShape,
): ResolvedPayoutMoney | { blockedReason: PayoutBlockedReason } {
  const payoutCurrency = normalizePayoutCurrency(order.source_currency ?? order.currency)
  if (!payoutCurrency) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID }
  }

  const payoutAmount = typeof order.source_amount === 'number' && order.source_amount > 0
    ? order.source_amount
    : typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0
      ? order.subtotal_amount
      : 0

  if (payoutAmount <= 0) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID }
  }

  const profileCurrency = normalizePayoutCurrency(tailorProfile.payout_currency)
  if (!profileCurrency || profileCurrency !== payoutCurrency) {
    return { blockedReason: PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH }
  }

  const provider = resolvePaymentProviderForCurrency(payoutCurrency)

  return {
    amount: payoutAmount,
    currency: payoutCurrency,
    provider,
  }
}
