import { CUSTOM_ORDER_RESUMABLE_STAGES, isResumableCustomOrderStage } from '../src/custom-order-flow'

describe('isResumableCustomOrderStage', () => {
  it('allows active custom-order stages to resume', () => {
    expect(isResumableCustomOrderStage('PENDING_QUOTE')).toBe(true)
    expect(isResumableCustomOrderStage('CONSULTATION')).toBe(true)
    expect(isResumableCustomOrderStage('QUOTE_SENT')).toBe(true)
    expect(isResumableCustomOrderStage('PAYMENT_FAILED')).toBe(true)
    expect(isResumableCustomOrderStage('FINISHING')).toBe(true)
    expect(isResumableCustomOrderStage('SHIPPED')).toBe(true)
  })

  it('never resumes terminal or cancelled states', () => {
    expect(isResumableCustomOrderStage('CANCELLED')).toBe(false)
    expect(isResumableCustomOrderStage('DECLINED')).toBe(false)
    expect(isResumableCustomOrderStage('REFUNDED')).toBe(false)
    expect(isResumableCustomOrderStage('COMPLETE')).toBe(false)
    expect(isResumableCustomOrderStage('EXPIRED')).toBe(false)
    expect(isResumableCustomOrderStage('DELIVERED')).toBe(false)
  })

  it('keeps the resumable stage list free of cancelled orders', () => {
    expect(CUSTOM_ORDER_RESUMABLE_STAGES).not.toContain('CANCELLED')
  })
})
