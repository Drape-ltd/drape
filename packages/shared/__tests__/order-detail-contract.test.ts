import {
  deriveOrderDetailActions,
  fulfillmentIssueImpact,
  orderHistorySummary,
} from '../src/order-detail-contract'

const kinds = (role: 'CUSTOMER' | 'TAILOR', stage: string, paid = true, open = false) =>
  deriveOrderDetailActions({ role, stage, initialPaymentPaid: paid, hasOpenResolution: open }).map((item) => item.kind)

describe('order detail contract', () => {
  it('keeps delivery help after payment including completed orders', () => {
    expect(kinds('CUSTOMER', 'CONFIRMED')).toContain('SHIPPING_DELIVERY_HELP')
    expect(kinds('CUSTOMER', 'COMPLETE')).toContain('SHIPPING_DELIVERY_HELP')
    expect(kinds('TAILOR', 'COMPLETE')).toContain('SHIPPING_DELIVERY_HELP')
    expect(kinds('CUSTOMER', 'PAYMENT_PENDING', false)).not.toContain('SHIPPING_DELIVERY_HELP')
  })

  it('keeps exception actions behind current-work actions', () => {
    const activeKinds = kinds('TAILOR', 'SEWING')
    expect(activeKinds.indexOf('REQUEST_EXTENSION')).toBeLessThan(activeKinds.indexOf('SHIPPING_DELIVERY_HELP'))
    expect(activeKinds.indexOf('PROPOSE_ORDER_CHANGE')).toBeLessThan(activeKinds.indexOf('REQUEST_CANCELLATION'))
    expect(activeKinds.indexOf('SHIPPING_DELIVERY_HELP')).toBeLessThan(activeKinds.indexOf('REQUEST_CANCELLATION'))
  })

  it('shows a standalone extension only to the tailor on paid active work', () => {
    expect(kinds('TAILOR', 'SEWING')).toContain('REQUEST_EXTENSION')
    expect(kinds('CUSTOMER', 'SEWING')).not.toContain('REQUEST_EXTENSION')
    expect(kinds('TAILOR', 'COMPLETE')).not.toContain('REQUEST_EXTENSION')
  })

  it('never gives the tailor a generic resolution launcher', () => {
    expect(kinds('TAILOR', 'DELIVERED')).not.toContain('REQUEST_RESOLUTION')
    expect(kinds('CUSTOMER', 'DELIVERED')).toContain('REQUEST_RESOLUTION')
    expect(kinds('TAILOR', 'DELIVERED', true, true)).toContain('RESPOND_TO_RESOLUTION')
  })

  it('derives fulfillment risk without rewriting lifecycle status', () => {
    expect(fulfillmentIssueImpact('NOT_RECEIVED')).toEqual({ priority: 'HIGH', freezeUnreleasedSettlement: true })
    expect(fulfillmentIssueImpact('TRACKING_STALLED')).toEqual({ priority: 'NORMAL', freezeUnreleasedSettlement: false })
  })

  it('builds compact order-history disclosure copy', () => {
    expect(orderHistorySummary({ updateCount: 8, lastUpdatedLabel: 'Jul 31 at 10:14 AM CDT' }))
      .toBe('8 updates · Last updated Jul 31 at 10:14 AM CDT')
  })
})
