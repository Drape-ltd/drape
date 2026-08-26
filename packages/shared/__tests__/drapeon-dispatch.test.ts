import {
  canRequestDispatchMethodChange,
  canTransitionDispatchStatus,
  deriveDispatchCustomerChargePresentation,
  deriveDispatchFulfillmentPresentation,
  deriveFulfillmentAwareHistoryLabel,
  deriveFulfillmentAwareOrderStagePresentation,
  dispatchBlockerCopy,
  isCompletedOrderStage,
  resolveDispatchFunding,
} from '../src/drapeon-dispatch'

describe('Drapeon Dispatch customer charge language', () => {
  it('presents a zero allowance as the first delivery payment', () => {
    expect(deriveDispatchCustomerChargePresentation(0)).toMatchObject({
      kind: 'INITIAL',
      isTopUp: false,
      paymentStatusTitle: 'Delivery payment needed',
      actionSuffix: 'for delivery',
    })
  })

  it('reserves difference language for a genuine top-up', () => {
    expect(deriveDispatchCustomerChargePresentation(25_000)).toMatchObject({
      kind: 'TOP_UP',
      isTopUp: true,
      paymentStatusTitle: 'Extra delivery payment needed',
      actionSuffix: 'difference',
    })
  })
})

describe('Drapeon Dispatch terminal gates', () => {
  it('allows a fulfilment change before handoff', () => {
    expect(canRequestDispatchMethodChange('READY_FOR_COLLECTION')).toBe(true)
  })

  it.each(['COLLECTED', 'DELIVERED', 'COMPLETE', 'REFUNDED'])(
    'blocks a stale fulfilment change at %s',
    (stage) => expect(canRequestDispatchMethodChange(stage)).toBe(false),
  )

  it.each(['DELIVERED', 'COLLECTED', 'COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'])(
    'treats the terminal outcome %s as completed',
    (stage) => expect(isCompletedOrderStage(stage)).toBe(true),
  )

  it('does not treat a planned pickup as completed', () => {
    expect(isCompletedOrderStage('READY_FOR_COLLECTION')).toBe(false)
  })

  it('retires pickup as soon as a delivery replacement is requested', () => {
    expect(deriveDispatchFulfillmentPresentation({
      orderMethod: 'LOCAL_DELIVERY',
      orderStage: 'READY_FOR_COLLECTION',
      runMethod: 'LOCAL_DELIVERY',
      runStatus: 'QUOTE_REQUIRED',
    })).toEqual({
      effectiveMethod: 'LOCAL_DELIVERY',
      pickupCredentialActive: false,
      replacementPending: true,
    })
  })

  it('keeps a collection code active only for an actual pickup handoff', () => {
    expect(deriveDispatchFulfillmentPresentation({
      orderMethod: 'LOCAL_COLLECTION',
      orderStage: 'READY_FOR_COLLECTION',
      runMethod: 'LOCAL_COLLECTION',
      runStatus: 'PICKUP_READY',
    }).pickupCredentialActive).toBe(true)
  })

  it('stops a completed delivery replacement from overriding restored pickup', () => {
    expect(deriveDispatchFulfillmentPresentation({
      orderMethod: 'LOCAL_COLLECTION',
      orderStage: 'READY_FOR_COLLECTION',
      runMethod: 'LOCAL_DELIVERY',
      runStatus: 'PICKUP_READY',
    })).toEqual({
      effectiveMethod: 'LOCAL_COLLECTION',
      pickupCredentialActive: true,
      replacementPending: false,
    })
  })

  it('does not label a replacement delivery as ready for collection', () => {
    expect(deriveFulfillmentAwareOrderStagePresentation({
      orderStage: 'READY_FOR_COLLECTION',
      effectiveMethod: 'LOCAL_DELIVERY',
    })).toEqual({ stage: 'READY_FOR_DRAPE_DISPATCH', label: 'Delivery requested' })

    expect(deriveFulfillmentAwareOrderStagePresentation({
      orderStage: 'READY_FOR_COLLECTION',
      effectiveMethod: 'LOCAL_COLLECTION',
    })).toEqual({ stage: 'READY_FOR_COLLECTION', label: null })
  })

  it('does not present a superseded pickup milestone as the current action', () => {
    expect(deriveFulfillmentAwareHistoryLabel({
      eventStage: 'READY_FOR_COLLECTION',
      effectiveMethod: 'LOCAL_DELIVERY',
      defaultLabel: 'Ready for Collection',
      isLatest: true,
    })).toBe('Delivery requested')

    expect(deriveFulfillmentAwareHistoryLabel({
      eventStage: 'READY_FOR_COLLECTION',
      effectiveMethod: 'SHIPPING',
      defaultLabel: 'Ready for Collection',
    })).toBe('Pickup step replaced by shipping')
  })
})

describe('Drapeon Dispatch funding', () => {
  it('uses an exact captured allowance without asking the customer to pay again', () => {
    expect(resolveDispatchFunding({
      currency: 'ngn', capturedAllowanceAmount: 23_700,
      customerFundedAllowanceAmount: 23_700, drapeonSubsidyAmount: 0,
      actualProviderCostAmount: 23_700,
    })).toMatchObject({
      currency: 'NGN', status: 'WITHIN_ALLOWANCE', customerDueAmount: 0,
      unusedAllowanceAmount: 0, customerRefundAmount: 0,
    })
  })

  it('refunds unused customer-funded allowance and restores subsidy separately', () => {
    expect(resolveDispatchFunding({
      currency: 'NGN', capturedAllowanceAmount: 23_700,
      customerFundedAllowanceAmount: 20_000, drapeonSubsidyAmount: 3_700,
      actualProviderCostAmount: 18_000, refundableTaxAmount: 500,
    })).toMatchObject({
      status: 'WITHIN_ALLOWANCE', customerDueAmount: 0,
      unusedAllowanceAmount: 5_700, customerRefundAmount: 6_200,
      subsidyRestoredAmount: 0,
    })
  })

  it('discloses only the pre-tax shortfall plus separate tax and fees', () => {
    expect(resolveDispatchFunding({
      currency: 'NGN', capturedAllowanceAmount: 23_700,
      customerFundedAllowanceAmount: 23_700, drapeonSubsidyAmount: 0,
      actualProviderCostAmount: 30_000, shortfallTaxAmount: 945,
      shortfallFeeAmount: 100,
    })).toMatchObject({
      status: 'SHORTFALL_DUE', materialShortfallAmount: 6_300,
      shortfallTaxAmount: 945, shortfallFeeAmount: 100,
      customerDueAmount: 7_345,
    })
  })

  it('rejects invalid funding snapshots', () => {
    expect(() => resolveDispatchFunding({
      currency: 'NGN', capturedAllowanceAmount: 10_000,
      customerFundedAllowanceAmount: 9_000, drapeonSubsidyAmount: 0,
      actualProviderCostAmount: 5_000,
    })).toThrow('must equal the captured allowance')
  })
})

describe('Drapeon Dispatch state and recovery', () => {
  it('allows the normal delivery path and blocks skipping custody', () => {
    expect(canTransitionDispatchStatus('READY_TO_BOOK', 'BOOKED')).toBe(true)
    expect(canTransitionDispatchStatus('BOOKED', 'IN_TRANSIT')).toBe(true)
    expect(canTransitionDispatchStatus('BOOKED', 'DELIVERED')).toBe(false)
  })

  it('provides a concrete recovery action for every blocker', () => {
    expect(dispatchBlockerCopy('SHORTFALL_PAYMENT_REQUIRED')).toEqual({
      title: 'Delivery payment needed',
      action: 'Ask the customer to pay the disclosed delivery amount.',
    })
    expect(dispatchBlockerCopy('FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED')).toEqual({
      title: 'Drapeon review needed',
      action: 'This dispatch already has a booking or money record. Drapeon must preserve it while confirming the requested change.',
    })
    expect(dispatchBlockerCopy('CUSTODY_PROOF_REQUIRED')).toEqual({
      title: 'Handoff photo missing',
      action: 'Add provider acceptance or parcel collection proof. If tracking already says in transit, it stays in transit.',
    })
  })
})
