import {
  initialOrderReceiptLines,
  receiptStatusForRefund,
  validateInitialOrderReceipt,
  type InitialOrderReceipt,
} from '../src/checkout-receipts'

const receipt: InitialOrderReceipt = {
  receiptNumber: 'DRP-2026-000001',
  orderId: 'order-1',
  orderReference: 'DRP2BBQUE',
  paymentId: 'payment-1',
  provider: 'STRIPE',
  providerReference: 'pi_123',
  status: 'PAID',
  paidAt: '2026-07-31T12:00:00.000Z',
  pricingVersion: 1,
  policyVersion: 'commercial-2026-07-31-v1',
  correlationId: 'correlation-1',
  breakdown: {
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
  },
  consultationCreditAmount: 0,
  promotionAmount: 0,
  refundedAmount: 0,
}

describe('initial-order receipts', () => {
  it('validates an immutable exact-money receipt', () => {
    expect(validateInitialOrderReceipt(receipt)).toEqual(receipt)
  })

  it('rejects reconstructed or over-refunded receipts', () => {
    expect(() => validateInitialOrderReceipt({ ...receipt, receiptNumber: '123' })).toThrow(/Drapeon receipt/u)
    expect(() => validateInitialOrderReceipt({ ...receipt, refundedAmount: 12_501 })).toThrow(/captured total/u)
  })

  it('derives refund status from captured and refunded values', () => {
    expect(receiptStatusForRefund({ totalAmount: 12_500, refundedAmount: 0 })).toBe('PAID')
    expect(receiptStatusForRefund({ totalAmount: 12_500, refundedAmount: 500 })).toBe('PARTIALLY_REFUNDED')
    expect(receiptStatusForRefund({ totalAmount: 12_500, refundedAmount: 12_500 })).toBe('REFUNDED')
  })

  it('renders the authoritative customer-facing allocation', () => {
    expect(initialOrderReceiptLines(receipt)).toEqual(expect.arrayContaining([
      { key: 'subtotal', label: 'Tailor work and included materials', amount: 10_000 },
      { key: 'tax', label: 'Tax · Illinois', amount: 800 },
      { key: 'total', label: 'Total paid', amount: 12_500 },
    ]))
  })

  it('shows gross work value before subtracting a credited consultation', () => {
    const lines = initialOrderReceiptLines({
      breakdown: receipt.breakdown,
      consultationCreditAmount: 1_500,
      promotionAmount: 500,
    })
    expect(lines).toEqual(expect.arrayContaining([
      { key: 'subtotal', label: 'Tailor work and included materials', amount: 11_500 },
      { key: 'consultation-credit', label: 'Consultation fee credit', amount: -1_500 },
      { key: 'promotion', label: 'Drapeon-funded benefit', amount: -500 },
    ]))
  })

  it('keeps tailoring and protected fabric separate on funded-policy receipts', () => {
    const lines = initialOrderReceiptLines({
      breakdown: {
        ...receipt.breakdown,
        fabricFundingPolicyVersion: 'fabric-funding-2026-08-01-v1',
        fabricSource: 'TAILOR_SOURCES',
        tailoringAmount: 7_500,
        fabricAllowanceAmount: 2_500,
        fabricAllowanceCoverage: ['FABRIC', 'LINING'],
        fabricSourcingAssumptions: 'Six yards of cotton and a matching lining.',
      },
      consultationCreditAmount: 1_500,
      promotionAmount: 0,
    })
    expect(lines).toEqual(expect.arrayContaining([
      { key: 'tailoring', label: 'Tailoring and construction', amount: 9_000 },
      { key: 'fabric-allowance', label: 'Protected fabric allowance', amount: 2_500 },
      { key: 'consultation-credit', label: 'Consultation fee credit', amount: -1_500 },
    ]))
  })
})
