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

export type PayoutRecoveryDestination = 'ORDER' | 'EARNINGS' | 'PAYOUT_SETUP' | 'OPS_REVIEW'

export type PayoutBlockRecovery = {
  headline: string
  reason: string
  nextStep: string
  ctaLabel: string
  destination: PayoutRecoveryDestination
  userActionRequired: boolean
}

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

export function payoutBlockRecovery(reason: PayoutBlockedReason): PayoutBlockRecovery {
  switch (reason) {
    case PAYOUT_BLOCKED_REASONS.ORDER_NOT_FINAL:
      return {
        headline: 'Order still in progress',
        reason: 'This order has not reached delivery or collection yet.',
        nextStep: 'No payout-account change is needed. Drapeon will check the payout again after the order is completed.',
        ctaLabel: 'Review order',
        destination: 'ORDER',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.HANDOFF_NOT_COMPLETED:
      return {
        headline: 'Handoff confirmation needed',
        reason: 'Drapeon has not recorded delivery or collection for this order yet.',
        nextStep: 'Open the order and complete the delivery or collection confirmation. Payout will be checked again afterward.',
        ctaLabel: 'Complete handoff',
        destination: 'ORDER',
        userActionRequired: true,
      }
    case PAYOUT_BLOCKED_REASONS.CUSTOMER_CONFIRMATION_REQUIRED:
      return {
        headline: 'Waiting for customer confirmation',
        reason: 'The handoff was recorded, but the customer has not confirmed receipt yet.',
        nextStep: 'No payout-account change is needed. The customer can confirm receipt from the order, then Drapeon will check payout again.',
        ctaLabel: 'Review order',
        destination: 'ORDER',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.DISPUTE_WINDOW_OPEN:
      return {
        headline: 'Payment protection window is open',
        reason: 'Customer confirmation was recorded and the payment protection window has not ended yet.',
        nextStep: 'No action is needed. Drapeon will retry automatically when the window closes unless an order issue is reported.',
        ctaLabel: 'View earnings',
        destination: 'EARNINGS',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.OPEN_DISPUTE:
      return {
        headline: 'Order review in progress',
        reason: 'An open order review is holding the remaining protected balance.',
        nextStep: 'Add any requested evidence in the order. Drapeon will notify you when a settlement decision is recorded.',
        ctaLabel: 'Review order',
        destination: 'ORDER',
        userActionRequired: true,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_UNVERIFIED:
      return {
        headline: 'Verify your payout account',
        reason: 'Your payout account has not been verified yet.',
        nextStep: 'Open Payout setup and finish provider verification. Drapeon will retry eligible payouts after verification.',
        ctaLabel: 'Open payout setup',
        destination: 'PAYOUT_SETUP',
        userActionRequired: true,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_ACCOUNT_MISSING:
      return {
        headline: 'Payout details incomplete',
        reason: 'Your verified payout destination is missing details required by the selected provider.',
        nextStep: 'Open Payout setup and complete the missing details. Drapeon will retry eligible payouts afterward.',
        ctaLabel: 'Open payout setup',
        destination: 'PAYOUT_SETUP',
        userActionRequired: true,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_DESTINATION_HOLD:
      return {
        headline: 'Payout setup needs refreshing',
        reason: 'A legacy hold remains on this payout destination.',
        nextStep: 'Open Payout setup and refresh the verified destination. Current policy does not add a release delay.',
        ctaLabel: 'Refresh payout setup',
        destination: 'PAYOUT_SETUP',
        userActionRequired: true,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_MISMATCH:
      return {
        headline: 'Payout currency review required',
        reason: 'Your current payout currency does not match the currency locked to this order.',
        nextStep: 'Do not create a second payout. Drapeon Ops must settle the order in its locked currency or approve a reviewed conversion.',
        ctaLabel: 'View earnings',
        destination: 'OPS_REVIEW',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.NO_SETTLED_PAYMENT:
      return {
        headline: 'Customer payment not settled',
        reason: 'Drapeon cannot find a settled customer payment available for this payout.',
        nextStep: 'Do not ask the customer to pay again. Drapeon is checking the provider record and will notify you of the outcome.',
        ctaLabel: 'View earnings',
        destination: 'OPS_REVIEW',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_ALREADY_TRIGGERED:
      return {
        headline: 'Payout already processing',
        reason: 'A payout has already been started for this order.',
        nextStep: 'No duplicate action is needed. Drapeon is waiting for the provider outcome and will update Earnings.',
        ctaLabel: 'View earnings',
        destination: 'EARNINGS',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_AMOUNT_INVALID:
      return {
        headline: 'Payout amount needs review',
        reason: 'The protected payout amount could not be validated for release.',
        nextStep: 'Do not submit another payout. Drapeon Ops is reviewing the order allocation and ledger before retrying.',
        ctaLabel: 'View earnings',
        destination: 'OPS_REVIEW',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_CURRENCY_INVALID:
      return {
        headline: 'Payout currency needs review',
        reason: 'The currency locked to this payout could not be validated for release.',
        nextStep: 'Do not submit another payout. Drapeon Ops is reviewing the order currency and ledger before retrying.',
        ctaLabel: 'View earnings',
        destination: 'OPS_REVIEW',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.PAYMENT_ALREADY_REFUNDED:
      return {
        headline: 'Order settlement decision needed',
        reason: 'A customer refund has already been processed, so the remaining protected balance cannot use the normal payout path.',
        nextStep: 'No handoff or payout-account change is required. Drapeon must record whether this order continues, closes partially refunded, or remains under review before settling the remaining balance.',
        ctaLabel: 'Review order',
        destination: 'OPS_REVIEW',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_PROVIDER_UNAVAILABLE:
      return {
        headline: 'Payout provider temporarily unavailable',
        reason: 'The payout provider could not safely accept this release right now.',
        nextStep: 'Do not change your bank details or create another payout. Drapeon will retry safely and notify you of the provider outcome.',
        ctaLabel: 'View earnings',
        destination: 'EARNINGS',
        userActionRequired: false,
      }
    case PAYOUT_BLOCKED_REASONS.PAYOUT_CHANGE_PENDING:
      return {
        headline: 'Payout change under review',
        reason: 'Your replacement payout destination is still under account-safety review.',
        nextStep: 'Your current verified destination remains active. Open Payout setup to review or cancel the pending replacement.',
        ctaLabel: 'Review payout setup',
        destination: 'PAYOUT_SETUP',
        userActionRequired: true,
      }
  }
}

export function payoutBlockReasonMessage(reason: PayoutBlockedReason) {
  return payoutBlockRecovery(reason).reason
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
