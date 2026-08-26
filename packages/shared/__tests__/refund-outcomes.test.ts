import {
  OPS_PARTIAL_REFUND_ORDER_OUTCOMES,
  refundProviderTimingCopy,
} from '../src/financial-cases'

describe('partial refund outcomes and timing', () => {
  it('requires one of three explicit order outcomes', () => {
    expect(OPS_PARTIAL_REFUND_ORDER_OUTCOMES).toEqual(['CONTINUE_ORDER', 'CLOSE_ORDER', 'KEEP_UNDER_REVIEW'])
  })

  it('keeps customer refund and tailor payout language separate', () => {
    expect(refundProviderTimingCopy({ provider: 'stripe', audience: 'TAILOR' }).detail)
      .toContain("customer's original payment method")
    expect(refundProviderTimingCopy({ provider: 'paystack', audience: 'CUSTOMER' }).detail)
      .toContain('3–10 working days')
  })
})
