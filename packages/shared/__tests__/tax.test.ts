import {
  calculateLockedOrderAmounts,
  GHANA_EFFECTIVE_TAX_RATE_BPS,
  resolveOrderTaxJurisdiction,
  resolveTaxBreakdown,
  taxLinesForSnapshot,
  taxLinesForReceiptSnapshot,
  taxSnapshotNeedsRefresh,
} from '../src/tax'

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

  it('does not use charge currency to override destination tax', () => {
    expect(resolveTaxBreakdown({ countryCode: 'NG', currency: 'USD' }).rateBps).toBe(750)
    expect(resolveTaxBreakdown({ countryCode: 'GB', currency: 'USD' }).rateBps).toBe(2000)
  })

  it('applies ghana vat for GHS customers', () => {
    expect(resolveTaxBreakdown({ countryCode: 'GH', currency: 'GHS' })).toMatchObject({
      jurisdiction: 'Ghana VAT + NHIL + GETFund',
      rateBps: GHANA_EFFECTIVE_TAX_RATE_BPS,
      components: [
        { key: 'ghana-vat', label: 'Ghana VAT', rateBps: 1500 },
        { key: 'ghana-nhil', label: 'NHIL', rateBps: 250 },
        { key: 'ghana-getfund', label: 'GETFund levy', rateBps: 250 },
      ],
    })
  })

  it('splits a locked ghana tax total without changing the amount due', () => {
    const lines = taxLinesForSnapshot({
      taxRegion: 'Ghana VAT + NHIL + GETFund',
      taxRateBps: 2000,
      taxAmount: 39_000,
    })
    expect(lines).toEqual([
      { key: 'ghana-vat', label: 'Ghana VAT', rateBps: 1500, amount: 29_250 },
      { key: 'ghana-nhil', label: 'NHIL', rateBps: 250, amount: 4_875 },
      { key: 'ghana-getfund', label: 'GETFund levy', rateBps: 250, amount: 4_875 },
    ])
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(39_000)
  })

  it('requires an active legacy ghana tax snapshot to be refreshed', () => {
    expect(taxSnapshotNeedsRefresh({ taxRegion: 'Ghana VAT', taxRateBps: 1500, taxFallback: false })).toBe(true)
    expect(taxSnapshotNeedsRefresh({ taxRegion: 'Ghana VAT + NHIL + GETFund', taxRateBps: 2000, taxFallback: false })).toBe(false)
    expect(taxSnapshotNeedsRefresh({ taxRegion: 'Nigeria VAT', taxRateBps: 750, taxFallback: false })).toBe(false)
  })

  it('expands only receipts that stored the current ghana statutory bundle', () => {
    expect(taxLinesForReceiptSnapshot({
      taxJurisdiction: 'Ghana VAT + NHIL + GETFund',
      taxAmount: 39_000,
    })).toHaveLength(3)
    expect(taxLinesForReceiptSnapshot({
      taxJurisdiction: 'Ghana VAT',
      taxAmount: 29_250,
    })).toEqual([
      { key: 'tax', label: 'Tax · Ghana VAT', rateBps: 0, amount: 29_250 },
    ])
  })

  it('applies kenya vat for KES customers', () => {
    expect(resolveTaxBreakdown({ countryCode: 'KE', currency: 'KES' }).rateBps).toBe(1600)
  })

  it('applies uk vat for GBP customers', () => {
    expect(resolveTaxBreakdown({ regionCode: 'GB', currency: 'GBP' }).rateBps).toBe(2000)
  })

  it('does not apply a flat VAT rate across euro-area destinations', () => {
    expect(resolveTaxBreakdown({ countryCode: 'DE', currency: 'EUR' })).toMatchObject({
      jurisdiction: 'DE VAT',
      rateBps: 0,
      fallback: true,
      fallbackReason: 'COUNTRY_SPECIFIC_TAX_PROVIDER_REQUIRED',
    })
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

  it('marks unsupported jurisdictions as unresolved instead of silently returning zero tax', () => {
    expect(resolveTaxBreakdown({ countryCode: 'BR', currency: 'USD' })).toMatchObject({
      rateBps: 0,
      fallback: true,
      fallbackReason: 'UNSUPPORTED_TAX_JURISDICTION',
    })
  })

  it('uses the seller pickup location instead of the customer account region for local collection', () => {
    expect(resolveOrderTaxJurisdiction({
      fulfillment: 'LOCAL_COLLECTION',
      sellerLocation: 'Lagos, Nigeria',
      sellerPickupAddress: '12 Allen Avenue, Ikeja, Lagos, Nigeria',
      customerRegionCode: 'US',
    })).toEqual({
      countryCode: 'NG',
      address: '12 Allen Avenue, Ikeja, Lagos, Nigeria',
      source: 'PICKUP_LOCATION',
    })
  })

  it('uses the delivery destination for shipped orders', () => {
    expect(resolveOrderTaxJurisdiction({
      fulfillment: 'SHIPPING',
      deliveryCountryCode: 'CA',
      deliveryAddress: '123 King Street, Toronto, ON M5V 1J2',
      sellerLocation: 'Lagos, Nigeria',
      customerRegionCode: 'US',
    })).toEqual({
      countryCode: 'CA',
      address: '123 King Street, Toronto, ON M5V 1J2',
      source: 'DELIVERY_DESTINATION',
    })
  })

  it('does not substitute customer account region for an unresolved explicit shipping destination', () => {
    expect(resolveOrderTaxJurisdiction({
      fulfillment: 'SHIPPING',
      customerRegionCode: 'US',
    })).toEqual({
      countryCode: null,
      address: null,
      source: 'UNRESOLVED',
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
