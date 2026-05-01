import { deriveCancellationPolicy } from '../src/cancellation-policy'

describe('deriveCancellationPolicy', () => {
  it('lets ready-made customers request review before dispatch begins', () => {
    const policy = deriveCancellationPolicy({
      orderKind: 'READY_MADE',
      stage: 'FINISHING',
      deliveryMethod: 'LOCAL_DELIVERY',
      fulfillmentFee: 1000,
    })

    expect(policy.customerCanRequestReview).toBe(true)
    expect(policy.customerCanSelfCancel).toBe(false)
    expect(policy.refundableNow).toEqual(expect.arrayContaining(['ORDER_AMOUNT', 'STANDARD_FULFILLMENT_FEE']))
  })

  it('closes standard ready-made cancellation once the order is ready for dispatch', () => {
    const policy = deriveCancellationPolicy({
      orderKind: 'READY_MADE',
      stage: 'READY_FOR_DRAPE_DISPATCH',
      deliveryMethod: 'LOCAL_DELIVERY',
      fulfillmentFee: 1000,
    })

    expect(policy.customerCanRequestReview).toBe(false)
    expect(policy.customerCanSelfCancel).toBe(false)
    expect(policy.tailorCanRequestReview).toBe(true)
  })

  it('lets custom customers self-cancel before paid production starts', () => {
    const policy = deriveCancellationPolicy({
      orderKind: 'CUSTOM',
      stage: 'CONSULTATION',
      consultationFee: 5000,
      consultationPaidAt: '2026-04-28T00:00:00.000Z',
      consultationFeeCreditable: false,
    })

    expect(policy.customerCanSelfCancel).toBe(true)
    expect(policy.nonRefundableNow).toContain('CONSULTATION_FEE')
  })

  it('lets customers self-cancel after a failed payment before production starts', () => {
    const policy = deriveCancellationPolicy({
      orderKind: 'CUSTOM',
      stage: 'PAYMENT_FAILED',
      consultationFee: 5000,
      consultationPaidAt: '2026-04-28T00:00:00.000Z',
      consultationFeeCreditable: false,
    })

    expect(policy.customerCanSelfCancel).toBe(true)
    expect(policy.customerCanRequestReview).toBe(false)
    expect(policy.conditionalRefunds).toContain('CONSULTATION_FEE')
  })

  it('pushes custom cancellations into review before cutting starts', () => {
    const policy = deriveCancellationPolicy({
      orderKind: 'CUSTOM',
      stage: 'SOURCING',
      deliveryMethod: 'SHIPPING',
      fulfillmentFee: 3000,
      consultationFee: 4000,
      consultationPaidAt: '2026-04-28T00:00:00.000Z',
      consultationFeeCreditable: true,
    })

    expect(policy.customerCanRequestReview).toBe(true)
    expect(policy.tailorCanRequestReview).toBe(true)
    expect(policy.refundableNow).toContain('ORDER_AMOUNT')
    expect(policy.conditionalRefunds).toContain('CONSULTATION_FEE')
  })

  it('closes standard customer cancellation after irreversible custom work starts', () => {
    const policy = deriveCancellationPolicy({
      orderKind: 'CUSTOM',
      stage: 'CUTTING',
      deliveryMethod: 'SHIPPING',
      fulfillmentFee: 3000,
    })

    expect(policy.customerCanRequestReview).toBe(false)
    expect(policy.customerCanSelfCancel).toBe(false)
    expect(policy.tailorCanRequestReview).toBe(true)
    expect(policy.conditionalRefunds).toContain('ORDER_AMOUNT')
  })
})
