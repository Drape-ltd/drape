import { calculateLockedOrderAmounts, resolveTaxBreakdown } from '../src/tax'

describe('tax helpers', () => {
  it('applies nigeria vat for NGN customers', () => {
    expect(resolveTaxBreakdown({ regionCode: 'ng', currency: 'NGN' })).toEqual({
      label: 'Tax (Nigeria VAT)',
      jurisdiction: 'Nigeria VAT',
      rateBps: 750,
      amount: 0,
      inclusive: false,
      fallback: false,
      fallbackReason: null,
    })
  })

  it('applies ghana vat for GHS customers', () => {
    expect(resolveTaxBreakdown({ countryCode: 'GH', currency: 'GHS' }).rateBps).toBe(1500)
  })

  it('applies kenya vat for KES customers', () => {
    expect(resolveTaxBreakdown({ countryCode: 'KE', currency: 'KES' }).rateBps).toBe(1600)
  })

  it('applies uk vat for GBP customers', () => {
    expect(resolveTaxBreakdown({ regionCode: 'GB', currency: 'GBP' }).rateBps).toBe(2000)
  })

  it('marks usd as requiring server lookup', () => {
    expect(resolveTaxBreakdown({ regionCode: 'US', currency: 'USD' })).toMatchObject({
      rateBps: 0,
      fallback: true,
      fallbackReason: 'SERVER_LOOKUP_REQUIRED',
    })
  })

  it('marks cad as requiring server lookup', () => {
    expect(resolveTaxBreakdown({ regionCode: 'CA', currency: 'CAD' })).toMatchObject({
      rateBps: 0,
      fallback: true,
      fallbackReason: 'SERVER_LOOKUP_REQUIRED',
    })
  })

  it('calculates locked totals from line items', () => {
    expect(calculateLockedOrderAmounts({
      subtotalAmount: 100_00,
      platformFeeAmount: 0,
      shippingAmount: 10_00,
      taxRateBps: 750,
    })).toEqual({
      subtotalAmount: 100_00,
      platformFeeAmount: 0,
      taxAmount: 7_50,
      taxRateBps: 750,
      shippingAmount: 10_00,
      totalAmount: 117_50,
    })
  })
})
