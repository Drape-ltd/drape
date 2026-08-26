import { BENEFIT_FEATURE_FLAGS, benefitReservationExpired, calculateBenefitApplication, validateTip } from '../src/commercial-benefits'

describe('commercial benefits', () => {
  it('caps a percentage benefit without reducing the source subtotal', () => {
    expect(calculateBenefitApplication({ kind: 'PERCENT_DISCOUNT', value: 2500, maximumAmount: 2000, subtotalAmount: 10_000, shippingAmount: 1_000 })).toEqual({ orderDiscountAmount: 2000, shippingDiscountAmount: 0, totalBenefitAmount: 2000, remainingSubtotalAmount: 8000, remainingShippingAmount: 1000 })
  })
  it('covers only shipping for free shipping', () => {
    expect(calculateBenefitApplication({ kind: 'FREE_SHIPPING', value: 0, subtotalAmount: 10_000, shippingAmount: 1_200 })).toEqual(expect.objectContaining({ orderDiscountAmount: 0, shippingDiscountAmount: 1200 }))
  })
  it('caps a fixed discount at the order subtotal without silently covering shipping', () => {
    expect(calculateBenefitApplication({ kind: 'FIXED_DISCOUNT', value: 25_000, subtotalAmount: 10_000, shippingAmount: 1_200 })).toEqual({ orderDiscountAmount: 10_000, shippingDiscountAmount: 0, totalBenefitAmount: 10_000, remainingSubtotalAmount: 0, remainingShippingAmount: 1_200 })
  })
  it('caps shipping coverage at the actual shipping charge', () => {
    expect(calculateBenefitApplication({ kind: 'CAPPED_SHIPPING', value: 2_000, subtotalAmount: 10_000, shippingAmount: 1_200 }).shippingDiscountAmount).toBe(1_200)
  })
  it('covers a complimentary order without changing tailor value', () => {
    expect(calculateBenefitApplication({ kind: 'COMPLIMENTARY_ORDER', value: 0, subtotalAmount: 10_000, shippingAmount: 1_200 }).totalBenefitAmount).toBe(11_200)
  })
  it('makes the entire tip tailor entitlement with no Drapeon commission', () => {
    expect(validateTip({ amount: 2500, currency: 'usd', orderComplete: true, existingTip: false })).toEqual({ amount: 2500, currency: 'USD', platformFeeAmount: 0, tailorEntitlementAmount: 2500 })
  })
  it('rejects duplicate and premature tips', () => {
    expect(() => validateTip({ amount: 100, currency: 'USD', orderComplete: false, existingTip: false })).toThrow()
    expect(() => validateTip({ amount: 100, currency: 'USD', orderComplete: true, existingTip: true })).toThrow()
  })
  it('keeps legally and economically gated programs disabled', () => {
    expect(BENEFIT_FEATURE_FLAGS).toMatchObject({ rewardedReferrals: false, sweepstakes: false, purchasedCredits: false, transferableBalances: false })
  })
  it('rejects invalid percentages and treats invalid or elapsed reservations as expired', () => {
    expect(() => calculateBenefitApplication({ kind: 'PERCENT_DISCOUNT', value: 10_001, subtotalAmount: 10_000, shippingAmount: 0 })).toThrow()
    expect(benefitReservationExpired('not-a-date')).toBe(true)
    expect(benefitReservationExpired('2026-08-22T11:59:59.000Z', Date.parse('2026-08-22T12:00:00.000Z'))).toBe(true)
    expect(benefitReservationExpired('2026-08-22T12:00:01.000Z', Date.parse('2026-08-22T12:00:00.000Z'))).toBe(false)
  })
})
