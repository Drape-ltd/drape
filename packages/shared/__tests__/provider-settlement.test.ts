import { derivePayoutDeliveryState, payoutDeliveryLabel } from '../src/provider-settlement'

describe('provider settlement state', () => {
  it('does not call a Stripe transfer bank-paid', () => {
    const state = derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'PROCESSING',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'PENDING',
    })
    expect(state).toBe('IN_PROVIDER_BALANCE')
    expect(payoutDeliveryLabel(state)).toBe('In Stripe balance')
  })

  it('uses in-transit only after Stripe reports an actual bank payout movement', () => {
    expect(derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'PROCESSING',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'IN_TRANSIT',
    })).toBe('BANK_PAYOUT_PENDING')
  })

  it('marks Stripe paid only from bank settlement evidence', () => {
    expect(derivePayoutDeliveryState({
      provider: 'STRIPE',
      status: 'PAID',
      providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
      bankSettlementStatus: 'PAID',
    })).toBe('PAID_TO_BANK')
  })

  it('preserves Paystack terminal transfer semantics', () => {
    expect(derivePayoutDeliveryState({ provider: 'PAYSTACK', status: 'PAID' })).toBe('PAID_TO_BANK')
  })

  it('keeps failures and reversals terminal', () => {
    expect(derivePayoutDeliveryState({ provider: 'STRIPE', status: 'PROCESSING', bankSettlementStatus: 'FAILED' })).toBe('FAILED')
    expect(derivePayoutDeliveryState({ provider: 'STRIPE', status: 'PAID', providerTransferStatus: 'REVERSED' })).toBe('REVERSED')
  })
})
