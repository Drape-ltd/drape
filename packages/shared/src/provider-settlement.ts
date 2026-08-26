export type PaymentProvider = 'PAYSTACK' | 'STRIPE'

export type ProviderTransferStatus =
  | 'NOT_STARTED'
  | 'PROCESSING'
  | 'AVAILABLE_IN_PROVIDER_BALANCE'
  | 'PAID_TO_BANK'
  | 'FAILED'
  | 'REVERSED'

export type BankSettlementStatus =
  | 'NOT_APPLICABLE'
  | 'PENDING'
  | 'IN_TRANSIT'
  | 'PAID'
  | 'FAILED'
  | 'CANCELED'
  | 'UNKNOWN'

export type PayoutDeliveryState =
  | 'PENDING_RELEASE'
  | 'RELEASE_PROCESSING'
  | 'IN_PROVIDER_BALANCE'
  | 'BANK_PAYOUT_PENDING'
  | 'PAID_TO_BANK'
  | 'BLOCKED'
  | 'FAILED'
  | 'REVERSED'
  | 'CANCELED'

export type ProviderSettlementRecord = {
  provider?: string | null
  status?: string | null
  providerTransferStatus?: string | null
  bankSettlementStatus?: string | null
}

function upper(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? ''
}

export function derivePayoutDeliveryState(input: ProviderSettlementRecord): PayoutDeliveryState {
  const provider = upper(input.provider)
  const status = upper(input.status)
  const providerTransfer = upper(input.providerTransferStatus)
  const bank = upper(input.bankSettlementStatus)

  if (status === 'BLOCKED') return 'BLOCKED'
  if (status === 'REVERSED' || providerTransfer === 'REVERSED') return 'REVERSED'
  if (status === 'CANCELED' || bank === 'CANCELED') return 'CANCELED'
  if (status === 'FAILED' || providerTransfer === 'FAILED' || bank === 'FAILED') return 'FAILED'
  if (bank === 'PAID' || providerTransfer === 'PAID_TO_BANK') return 'PAID_TO_BANK'

  // Paystack's transfer terminal is the bank transfer. Stripe's transfer terminal is
  // only the connected-account balance, so it must not be labelled as bank-paid.
  if (provider === 'PAYSTACK' && status === 'PAID') return 'PAID_TO_BANK'
  if (provider === 'STRIPE' && bank === 'IN_TRANSIT') return 'BANK_PAYOUT_PENDING'
  if (provider === 'STRIPE' && (
    providerTransfer === 'AVAILABLE_IN_PROVIDER_BALANCE'
    || status === 'PAID'
  )) return 'IN_PROVIDER_BALANCE'
  if (provider === 'STRIPE' && bank === 'PENDING') return 'BANK_PAYOUT_PENDING'
  if (status === 'PROCESSING' || providerTransfer === 'PROCESSING') return 'RELEASE_PROCESSING'
  return 'PENDING_RELEASE'
}

export function payoutDeliveryLabel(state: PayoutDeliveryState) {
  switch (state) {
    case 'PENDING_RELEASE': return 'Pending release'
    case 'RELEASE_PROCESSING': return 'Release processing'
    case 'IN_PROVIDER_BALANCE': return 'In Stripe balance'
    case 'BANK_PAYOUT_PENDING': return 'Bank payout in transit'
    case 'PAID_TO_BANK': return 'Paid to bank'
    case 'BLOCKED': return 'Blocked'
    case 'FAILED': return 'Failed'
    case 'REVERSED': return 'Reversed'
    case 'CANCELED': return 'Canceled'
  }
}

export function payoutDeliveryExplanation(state: PayoutDeliveryState, provider?: string | null) {
  switch (state) {
    case 'IN_PROVIDER_BALANCE':
      return 'Drapeon released these earnings to Stripe. Stripe has not yet confirmed arrival at your bank.'
    case 'BANK_PAYOUT_PENDING':
      return 'Stripe is sending these earnings to your bank. The arrival estimate may change if the bank delays processing.'
    case 'PAID_TO_BANK':
      return `${upper(provider) === 'STRIPE' ? 'Stripe' : 'The payout provider'} confirmed that these earnings reached the bank payout destination.`
    case 'RELEASE_PROCESSING':
      return 'The payout provider accepted the release and is still processing it.'
    case 'BLOCKED':
      return 'This payout cannot move until the stated requirement is resolved.'
    case 'FAILED':
      return 'The payout did not complete. Follow the recovery step or wait for Drapeon Ops if no action is requested.'
    case 'REVERSED':
      return 'The provider reversed this payout after release. Drapeon Ops is reconciling it before another attempt.'
    case 'CANCELED':
      return 'This payout was canceled before completion.'
    default:
      return 'These earnings have not been released to the payout provider yet.'
  }
}

export function payoutDeliveryIsBankPaid(input: ProviderSettlementRecord) {
  return derivePayoutDeliveryState(input) === 'PAID_TO_BANK'
}
