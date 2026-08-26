import { validateCommercialPricingBreakdown, type CommercialPricingBreakdown } from './commercial-pricing'
import { formatTaxRate, taxLinesForReceiptSnapshot } from './tax'

export const INITIAL_ORDER_RECEIPT_VERSION = 1 as const

export type InitialOrderReceiptStatus = 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED'

export type InitialOrderReceipt = {
  receiptNumber: string
  orderId: string
  orderReference: string
  paymentId: string
  provider: 'STRIPE' | 'PAYSTACK' | 'COVERAGE'
  providerReference: string
  status: InitialOrderReceiptStatus
  paidAt: string
  pricingVersion: number
  policyVersion: string
  correlationId: string
  breakdown: CommercialPricingBreakdown
  consultationCreditAmount: number
  promotionAmount: number
  refundedAmount: number
}

function requireMinorUnits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer in minor units.`)
  }
  return value
}

export function validateInitialOrderReceipt(receipt: InitialOrderReceipt): InitialOrderReceipt {
  if (!/^DRP-[A-Z0-9-]+$/u.test(receipt.receiptNumber)) {
    throw new Error('receiptNumber must be a Drapeon receipt reference.')
  }
  if (!receipt.orderId || !receipt.paymentId || !receipt.providerReference) {
    throw new Error('The receipt must identify its order, payment, and provider transaction.')
  }
  if (!Number.isSafeInteger(receipt.pricingVersion) || receipt.pricingVersion < 1) {
    throw new Error('pricingVersion must be a positive integer.')
  }
  if (!receipt.policyVersion.trim() || !receipt.correlationId.trim()) {
    throw new Error('The receipt must retain its policy and correlation identifiers.')
  }
  if (!Number.isFinite(Date.parse(receipt.paidAt))) {
    throw new Error('paidAt must be a valid timestamp.')
  }

  const breakdown = validateCommercialPricingBreakdown(receipt.breakdown)
  const consultationCreditAmount = requireMinorUnits(receipt.consultationCreditAmount, 'consultationCreditAmount')
  const promotionAmount = requireMinorUnits(receipt.promotionAmount, 'promotionAmount')
  const refundedAmount = requireMinorUnits(receipt.refundedAmount, 'refundedAmount')
  if (promotionAmount > breakdown.subtotalAmount + breakdown.platformFeeAmount + breakdown.taxAmount + breakdown.shippingAmount) {
    throw new Error('Promotion cannot exceed the locked checkout value.')
  }
  if (refundedAmount > breakdown.totalAmount) {
    throw new Error('Refunded value cannot exceed the captured total.')
  }

  return {
    ...receipt,
    breakdown,
    consultationCreditAmount,
    promotionAmount,
    refundedAmount,
  }
}

export function receiptStatusForRefund(input: { totalAmount: number; refundedAmount: number }): InitialOrderReceiptStatus {
  const totalAmount = requireMinorUnits(input.totalAmount, 'totalAmount')
  const refundedAmount = requireMinorUnits(input.refundedAmount, 'refundedAmount')
  if (refundedAmount <= 0) return 'PAID'
  if (refundedAmount >= totalAmount) return 'REFUNDED'
  return 'PARTIALLY_REFUNDED'
}

export function initialOrderReceiptLines(receipt: Pick<InitialOrderReceipt, 'breakdown' | 'consultationCreditAmount' | 'promotionAmount'>) {
  const fundedFabric = receipt.breakdown.fabricFundingPolicyVersion != null
    && receipt.breakdown.tailoringAmount != null
    && receipt.breakdown.fabricAllowanceAmount != null
  const lines = fundedFabric
    ? [
        {
          key: 'tailoring',
          label: 'Tailoring and construction',
          amount: receipt.breakdown.tailoringAmount! + receipt.consultationCreditAmount,
        },
        {
          key: 'fabric-allowance',
          label: 'Protected fabric allowance',
          amount: receipt.breakdown.fabricAllowanceAmount!,
        },
      ]
    : [
        {
          key: 'subtotal',
          label: 'Tailor work and included materials',
          amount: receipt.breakdown.subtotalAmount + receipt.consultationCreditAmount,
        },
      ]
  if (receipt.consultationCreditAmount > 0) {
    lines.push({ key: 'consultation-credit', label: 'Consultation fee credit', amount: -receipt.consultationCreditAmount })
  }
  if (receipt.promotionAmount > 0) {
    lines.push({ key: 'promotion', label: 'Drapeon-funded benefit', amount: -receipt.promotionAmount })
  }
  if (receipt.breakdown.platformFeeAmount > 0) {
    lines.push({ key: 'platform-fee', label: 'Drapeon service fee', amount: receipt.breakdown.platformFeeAmount })
  }
  if (receipt.breakdown.shippingAmount > 0) {
    lines.push({ key: 'fulfillment', label: 'Fulfillment', amount: receipt.breakdown.shippingAmount })
  }
  lines.push(...taxLinesForReceiptSnapshot({
    taxJurisdiction: receipt.breakdown.taxJurisdiction,
    taxAmount: receipt.breakdown.taxAmount,
  }).map((line) => ({
    key: line.key,
    label: line.rateBps > 0 ? `${line.label} (${formatTaxRate(line.rateBps)})` : line.label,
    amount: line.amount,
  })))
  lines.push({ key: 'total', label: 'Total paid', amount: receipt.breakdown.totalAmount })
  return lines
}
