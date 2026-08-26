import {
  COMMERCIAL_ARCHITECTURE_POLICY_VERSION,
  COMMERCIAL_TRANSACTION_PURPOSES,
  formatOrderPaymentPhase,
  formatPayoutPurpose,
  isOrderEarningPayoutPurpose,
  isOrderPaymentPhase,
  isTerminalCommercialOutcome,
  ORDER_PAYMENT_PHASES,
  PAYOUT_PURPOSES,
} from '../src/commercial-contracts'

describe('commercial contracts', () => {
  it('keeps every currently persisted payment phase in the shared contract', () => {
    expect(ORDER_PAYMENT_PHASES).toEqual([
      'INITIAL_ORDER',
      'CONSULTATION',
      'FULFILLMENT',
      'MATERIAL_ADVANCE',
      'ADJUSTMENT',
      'TIP',
    ])
  })

  it('keeps future commercial purposes separate from persisted payment phases', () => {
    expect(COMMERCIAL_TRANSACTION_PURPOSES).toEqual(expect.arrayContaining(ORDER_PAYMENT_PHASES))
    expect(COMMERCIAL_TRANSACTION_PURPOSES).toContain('ORDER_ADJUSTMENT')
    expect(COMMERCIAL_TRANSACTION_PURPOSES).toContain('OTHER_REVIEWED')
    expect(isOrderPaymentPhase('ORDER_ADJUSTMENT')).toBe(false)
  })

  it('formats phases without exposing raw database values', () => {
    expect(formatOrderPaymentPhase('MATERIAL_ADVANCE')).toBe('Material advance')
    expect(formatOrderPaymentPhase('UNKNOWN')).toBe('Payment')
  })

  it('separates order earnings from scoped commercial releases', () => {
    expect(PAYOUT_PURPOSES).toEqual([
      'ORDER_EARNING',
      'SETTLEMENT_TRANCHE',
      'FABRIC_RELEASE',
      'MATERIAL_ADVANCE',
      'CONSULTATION_EARNING',
      'TIP',
    ])
    expect(formatPayoutPurpose('FABRIC_RELEASE')).toBe('Fabric funding release')
    expect(formatPayoutPurpose('TIP')).toBe('Customer tip')
    expect(isOrderEarningPayoutPurpose('ORDER_EARNING')).toBe(true)
    expect(isOrderEarningPayoutPurpose('SETTLEMENT_TRANCHE')).toBe(true)
    expect(isOrderEarningPayoutPurpose('TIP')).toBe(false)
  })

  it('distinguishes retryable work from recorded terminal outcomes', () => {
    expect(isTerminalCommercialOutcome('QUEUED')).toBe(false)
    expect(isTerminalCommercialOutcome('PROCESSING')).toBe(false)
    expect(isTerminalCommercialOutcome('SUCCEEDED')).toBe(true)
    expect(isTerminalCommercialOutcome('FAILED')).toBe(true)
    expect(isTerminalCommercialOutcome('BLOCKED')).toBe(true)
  })

  it('publishes an explicit architecture policy version', () => {
    expect(COMMERCIAL_ARCHITECTURE_POLICY_VERSION).toBe('commercial-2026-07-31-v1')
  })
})
