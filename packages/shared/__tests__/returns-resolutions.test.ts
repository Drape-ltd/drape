import { evaluateReturnEligibility, remedyRequiresReturn, validateRefundRestoration } from '../src/returns-resolutions'

describe('returns and resolutions', () => {
  const deliveredAt = '2026-07-25T12:00:00.000Z'
  const nowMs = Date.parse('2026-07-31T12:00:00.000Z')
  it('rejects custom change-of-mind by policy without overriding applicable law', () => expect(evaluateReturnEligibility({ orderKind: 'CUSTOM', reason: 'CHANGE_OF_MIND', deliveredAt, nowMs }).status).toBe('INELIGIBLE'))
  it('allows an in-window ready-made fault request into review', () => expect(evaluateReturnEligibility({ orderKind: 'READY_MADE', reason: 'WRONG_ITEM', deliveredAt, nowMs })).toMatchObject({ status: 'ELIGIBLE', returnRequired: true }))
  it('keeps missing delivery in ops review without requiring an impossible return', () => expect(evaluateReturnEligibility({ orderKind: 'READY_MADE', reason: 'NOT_RECEIVED', deliveredAt: null, nowMs })).toMatchObject({ status: 'OPS_REVIEW', returnRequired: false }))
  it('requires exact cash restoration while retaining non-cash funding context', () => expect(validateRefundRestoration({ tailorWorkAmount: 7000, platformFeeAmount: 500, taxAmount: 750, fulfillmentAmount: 1000, consultationAmount: 0, promotionAmount: 200, drapeonFundedAmount: 500 }, 9250)).toEqual(expect.objectContaining({ providerCashTotal: 9250, promotionAmount: 200, drapeonFundedAmount: 500 })))
  it('rejects unbalanced restoration', () => expect(() => validateRefundRestoration({ tailorWorkAmount: 1, platformFeeAmount: 0, taxAmount: 0, fulfillmentAmount: 0, consultationAmount: 0, promotionAmount: 0, drapeonFundedAmount: 0 }, 2)).toThrow())
  it('does not demand a physical return for a missing item', () => expect(remedyRequiresReturn('FULL_REFUND', 'NOT_RECEIVED')).toBe(false))
})
