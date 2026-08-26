import {
  canSubmitTailorFabricApproval,
} from '../src/quote-review'
import {
  CUSTOM_ORDER_DRAFT_VERSION,
  isMeaningfulCustomOrderDraft,
} from '../src/custom-order-draft'
import {
  QUOTE_ORDER_REVIEW_VERSION,
  validateQuoteOrderReviewAttestation,
} from '../src/quote-review'

describe('quote review and draft contracts', () => {
  it('requires an explicit versioned review acknowledgement', () => {
    expect(validateQuoteOrderReviewAttestation({ acknowledged: true, version: QUOTE_ORDER_REVIEW_VERSION })).toEqual({ acknowledged: true, version: QUOTE_ORDER_REVIEW_VERSION })
    expect(() => validateQuoteOrderReviewAttestation(undefined)).toThrow(/review/i)
  })

  it('only enables tailor fabric proof after initial payment stages', () => {
    expect(canSubmitTailorFabricApproval({ orderKind: 'CUSTOM', fabricSource: 'TAILOR_SOURCES', stage: 'PENDING_QUOTE' })).toBe(false)
    expect(canSubmitTailorFabricApproval({ orderKind: 'CUSTOM', fabricSource: 'TAILOR_SOURCES', stage: 'PAYMENT_PENDING' })).toBe(false)
    expect(canSubmitTailorFabricApproval({ orderKind: 'CUSTOM', fabricSource: 'TAILOR_SOURCES', stage: 'CONFIRMED' })).toBe(true)
  })

  it('recognizes meaningful resumable input', () => {
    expect(CUSTOM_ORDER_DRAFT_VERSION).toMatch(/draft/)
    expect(isMeaningfulCustomOrderDraft({ description: '' })).toBe(false)
    expect(isMeaningfulCustomOrderDraft({ description: 'A fitted agbada' })).toBe(true)
  })
})
