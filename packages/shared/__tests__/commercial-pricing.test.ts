import {
  buildCaptureLedgerInstructions,
  buildPayoutReleaseLedgerInstructions,
  buildRefundLedgerInstructions,
  isCommercialPricingReservationExpired,
  validateCommercialPricingBreakdown,
  type CommercialPricingBreakdown,
} from '../src/commercial-pricing'
import { FABRIC_FUNDING_POLICY_VERSION } from '../src/fabric-funding'
import { FABRIC_FUNDING_POLICY_V2_VERSION } from '../src/fabric-funding'

const pricing: CommercialPricingBreakdown = {
  currency: 'USD',
  subtotalAmount: 10_000,
  platformFeeAmount: 500,
  taxAmount: 800,
  shippingAmount: 1_200,
  promotionAmount: 0,
  totalAmount: 12_500,
  taxJurisdiction: 'Illinois',
  taxSource: 'ZIPTAX',
  taxFallback: false,
}

describe('commercial pricing', () => {
  it('accepts an exact locked pricing equation', () => {
    expect(validateCommercialPricingBreakdown(pricing)).toEqual(pricing)
  })

  it('rejects mismatched or non-integer money', () => {
    expect(() => validateCommercialPricingBreakdown({ ...pricing, totalAmount: 12_499 })).toThrow(/locked components/u)
    expect(() => validateCommercialPricingBreakdown({ ...pricing, taxAmount: 8.5 })).toThrow(/minor units/u)
  })

  it('rejects fallback tax reservations', () => {
    expect(() => validateCommercialPricingBreakdown({
      ...pricing,
      taxAmount: 0,
      totalAmount: 11_700,
      taxFallback: true,
    })).toThrow(/fallback tax/u)
  })

  it('builds a balanced initial-order capture', () => {
    const entries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: pricing.totalAmount,
      pricing,
    })
    const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0)
    const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0)

    expect(debit).toBe(12_500)
    expect(credit).toBe(12_500)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAX_LIABILITY', accountScope: 'Illinois', amount: 800 }),
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', amount: 10_000 }),
    ]))
  })

  it('keeps domestic tax, import tax, and duty in separate liabilities', () => {
    const international: CommercialPricingBreakdown = {
      ...pricing,
      taxAmount: 1_500,
      importTaxAmount: 500,
      dutyAmount: 200,
      importTaxLiabilityAccount: 'IMPORT_TAX:GB',
      dutyLiabilityAccount: 'DUTY:GB',
      totalAmount: 13_200,
    }
    const entries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: international.totalAmount,
      pricing: international,
    })
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAX_LIABILITY', amount: 800 }),
      expect.objectContaining({ accountCode: 'IMPORT_TAX_LIABILITY', accountScope: 'IMPORT_TAX:GB', amount: 500 }),
      expect.objectContaining({ accountCode: 'DUTY_LIABILITY', accountScope: 'DUTY:GB', amount: 200 }),
    ]))
    expect(entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0)).toBe(13_200)
  })

  it('isolates a funded fabric allowance from tailor settlement at initial capture', () => {
    const allocated: CommercialPricingBreakdown = {
      ...pricing,
      fabricFundingPolicyVersion: FABRIC_FUNDING_POLICY_VERSION,
      fabricSource: 'TAILOR_SOURCES',
      tailoringAmount: 7_500,
      fabricAllowanceAmount: 2_500,
      fabricAllowanceCoverage: ['FABRIC', 'LINING'],
      fabricSourcingAssumptions: 'Six yards of cotton with a matching lining.',
    }
    const entries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: allocated.totalAmount,
      pricing: allocated,
    })
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', amount: 7_500 }),
      expect.objectContaining({ accountCode: 'MATERIAL_ADVANCE_LIABILITY', accountScope: 'order-fabric-allowance', amount: 2_500 }),
    ]))
    expect(entries).not.toContainEqual(expect.objectContaining({
      accountCode: 'TAILOR_ENTITLEMENT',
      amount: 10_000,
    }))
  })

  it('keeps policy v2 fabric protected outside the tailor production entitlement', () => {
    const allocated: CommercialPricingBreakdown = {
      ...pricing,
      fabricFundingPolicyVersion: FABRIC_FUNDING_POLICY_V2_VERSION,
      fabricSource: 'TAILOR_SOURCES',
      tailoringAmount: 7_500,
      fabricAllowanceAmount: 2_500,
      fabricAllowanceCoverage: ['FABRIC', 'TRIMS'],
      fabricSourcingAssumptions: 'Exact fabric and trim candidates require customer approval.',
    }
    const entries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: allocated.totalAmount,
      pricing: allocated,
    })
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', amount: 7_500 }),
      expect.objectContaining({ accountCode: 'MATERIAL_ADVANCE_LIABILITY', amount: 2_500 }),
    ]))
    expect(entries).not.toContainEqual(expect.objectContaining({
      accountCode: 'TAILOR_ENTITLEMENT',
      amount: 10_000,
    }))
  })

  it('keeps legacy initial-order captures on their original settlement allocation', () => {
    const entries = buildCaptureLedgerInstructions({
      phase: 'INITIAL_ORDER',
      paymentAmount: pricing.totalAmount,
      pricing,
    })
    expect(entries).toContainEqual(expect.objectContaining({
      accountCode: 'TAILOR_ENTITLEMENT',
      amount: pricing.subtotalAmount,
    }))
    expect(entries).not.toContainEqual(expect.objectContaining({
      accountCode: 'MATERIAL_ADVANCE_LIABILITY',
    }))
  })

  it.each([
    ['CONSULTATION', 'CONSULTATION_ENTITLEMENT'],
    ['FULFILLMENT', 'FULFILLMENT_LIABILITY'],
    ['MATERIAL_ADVANCE', 'MATERIAL_ADVANCE_LIABILITY'],
  ] as const)('isolates %s capture value in its own liability', (phase, accountCode) => {
    const phasePricing = { ...pricing, subtotalAmount: 5_000, platformFeeAmount: 0, taxAmount: 0, shippingAmount: 0, totalAmount: 5_000 }
    const entries = buildCaptureLedgerInstructions({ phase, paymentAmount: 5_000, pricing: phasePricing })
    expect(entries).toContainEqual(expect.objectContaining({ accountCode, direction: 'CREDIT', amount: 5_000 }))
  })

  it('splits an adjustment total into the correct commercial liabilities', () => {
    const workAdjustment: CommercialPricingBreakdown = {
      currency: 'USD', subtotalAmount: 9_300, platformFeeAmount: 0,
      taxAmount: 700, shippingAmount: 0, totalAmount: 10_000,
      taxJurisdiction: 'Illinois', taxSource: 'LOCKED_ORDER', taxFallback: false,
    }
    expect(buildCaptureLedgerInstructions({ phase: 'ADJUSTMENT', paymentAmount: 10_000, pricing: workAdjustment })).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', amount: 9_300 }),
      expect.objectContaining({ accountCode: 'TAX_LIABILITY', amount: 700 }),
    ]))
    const fulfillmentAdjustment: CommercialPricingBreakdown = {
      ...workAdjustment, subtotalAmount: 0, taxAmount: 0, shippingAmount: 10_000,
      taxJurisdiction: null, taxSource: 'NOT_APPLICABLE',
    }
    expect(buildCaptureLedgerInstructions({ phase: 'ADJUSTMENT', paymentAmount: 10_000, pricing: fulfillmentAdjustment })).toContainEqual(expect.objectContaining({ accountCode: 'FULFILLMENT_LIABILITY', amount: 10_000 }))
  })

  it('treats invalid and elapsed reservations as expired', () => {
    expect(isCommercialPricingReservationExpired('not-a-date')).toBe(true)
    expect(isCommercialPricingReservationExpired('2026-07-31T12:00:00.000Z', Date.parse('2026-07-31T12:00:00.000Z'))).toBe(true)
    expect(isCommercialPricingReservationExpired('2026-07-31T12:00:01.000Z', Date.parse('2026-07-31T12:00:00.000Z'))).toBe(false)
  })

  it('reverses a full capture into its original liability accounts', () => {
    const captureEntries = buildCaptureLedgerInstructions({ phase: 'INITIAL_ORDER', paymentAmount: 12_500, pricing })
    const refundEntries = buildRefundLedgerInstructions({ refundAmount: 12_500, captureEntries })
    expect(refundEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: 'TAILOR_ENTITLEMENT', direction: 'DEBIT', amount: 10_000 }),
      expect.objectContaining({ accountCode: 'TAX_LIABILITY', direction: 'DEBIT', amount: 800 }),
      expect.objectContaining({ accountCode: 'PROVIDER_CLEARING', direction: 'CREDIT', amount: 12_500 }),
    ]))
  })

  it('allocates partial refunds deterministically without exceeding the capture', () => {
    const captureEntries = buildCaptureLedgerInstructions({ phase: 'INITIAL_ORDER', paymentAmount: 12_500, pricing })
    const first = buildRefundLedgerInstructions({ refundAmount: 5_000, captureEntries })
    const second = buildRefundLedgerInstructions({
      refundAmount: 7_500,
      captureEntries,
      previousRefundEntries: first,
    })
    const debit = [...first, ...second]
      .filter((entry) => entry.direction === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amount, 0)
    expect(debit).toBe(12_500)
    expect(() => buildRefundLedgerInstructions({
      refundAmount: 7_501,
      captureEntries,
      previousRefundEntries: first,
    })).toThrow(/exceeds/u)
  })

  it('keeps proportional refund math exact when intermediate products exceed safe integers', () => {
    const captureEntries = [
      { accountCode: 'PROVIDER_CLEARING', accountScope: 'provider', direction: 'DEBIT', amount: 2_000_000_000, currency: 'USD' },
      { accountCode: 'TAILOR_ENTITLEMENT', accountScope: 'order', direction: 'CREDIT', amount: 1_500_000_000, currency: 'USD' },
      { accountCode: 'TAX_LIABILITY', accountScope: 'jurisdiction', direction: 'CREDIT', amount: 500_000_000, currency: 'USD' },
    ] as const
    const refundEntries = buildRefundLedgerInstructions({
      refundAmount: 1_000_000_001,
      captureEntries: [...captureEntries],
    })
    const debits = refundEntries
      .filter((entry) => entry.direction === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amount, 0)
    expect(debits).toBe(1_000_000_001)
  })

  it('moves a terminal legacy payout from entitlement to released', () => {
    expect(buildPayoutReleaseLedgerInstructions({
      amount: 100_000,
      currency: 'ngn',
      orderId: 'order-123',
    })).toEqual([
      { accountCode: 'TAILOR_ENTITLEMENT', accountScope: 'order-123', direction: 'DEBIT', amount: 100_000, currency: 'NGN' },
      { accountCode: 'TAILOR_RELEASED', accountScope: 'order-123', direction: 'CREDIT', amount: 100_000, currency: 'NGN' },
    ])
  })

  it('rejects empty or fractional payout releases', () => {
    expect(() => buildPayoutReleaseLedgerInstructions({ amount: 0, currency: 'NGN', orderId: 'order-123' })).toThrow(/greater than zero/u)
    expect(() => buildPayoutReleaseLedgerInstructions({ amount: 10.5, currency: 'NGN', orderId: 'order-123' })).toThrow(/minor units/u)
  })
})
