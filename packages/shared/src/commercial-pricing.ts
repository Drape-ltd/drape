import type { OrderPaymentPhase } from './commercial-contracts.ts'
import type { FabricAllowanceCoverageCode } from './fabric-funding.ts'
import type { CustomOrderFabricSource } from './custom-order-fabric.ts'

export const COMMERCIAL_PRICING_VERSION = 1 as const
export const COMMERCIAL_PRICING_RESERVATION_TTL_MINUTES = 15 as const
const FUNDED_FABRIC_POLICY_VERSION = 'fabric-funding-2026-08-01-v1' as const
const FUNDED_FABRIC_POLICY_V2_VERSION = 'fabric-funding-2026-08-21-v2' as const
const FUNDED_FABRIC_POLICY_VERSIONS = new Set<string>([
  FUNDED_FABRIC_POLICY_VERSION,
  FUNDED_FABRIC_POLICY_V2_VERSION,
])
const FABRIC_COVERAGE_CODES = new Set<FabricAllowanceCoverageCode>(['FABRIC','LINING','EMBROIDERY','TRIMS','NOTIONS','OTHER_AGREED_MATERIAL'])

export type CommercialPricingBreakdown = {
  currency: string
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  /** Portions of taxAmount held in distinct import liabilities. */
  importTaxAmount?: number
  dutyAmount?: number
  importTaxLiabilityAccount?: string | null
  dutyLiabilityAccount?: string | null
  shippingAmount: number
  promotionAmount?: number
  benefitReservationToken?: string | null
  totalAmount: number
  taxJurisdiction: string | null
  taxSource: string
  taxFallback: boolean
  taxDecisionSnapshotId?: string | null
  taxResponsibleParty?: 'TAILOR' | 'DRAPEON_MARKETPLACE_FACILITATOR' | 'CUSTOMER_IMPORTER' | null
  taxCollectionMode?: 'COLLECTED_AT_CHECKOUT' | 'PAYABLE_ON_IMPORT' | 'BLOCKED' | null
  fabricFundingPolicyVersion?: string | null
  fabricSource?: CustomOrderFabricSource | null
  tailoringAmount?: number | null
  fabricAllowanceAmount?: number | null
  fabricAllowanceCoverage?: FabricAllowanceCoverageCode[] | null
  fabricSourcingAssumptions?: string | null
  /** Keeps post-checkout money in the correct protected liability bucket. */
  adjustmentAllocation?: 'TAILOR' | 'FULFILLMENT' | 'MATERIAL' | null
}

export type CommercialLedgerDirection = 'DEBIT' | 'CREDIT'
export type CommercialLedgerAccountCode =
  | 'CUSTOMER_RECEIVABLE'
  | 'PROVIDER_CLEARING'
  | 'PROVIDER_FEE_EXPENSE'
  | 'TAILOR_ENTITLEMENT'
  | 'TAILOR_ELIGIBLE'
  | 'TAILOR_RELEASED'
  | 'CONSULTATION_ENTITLEMENT'
  | 'MATERIAL_ADVANCE_LIABILITY'
  | 'FULFILLMENT_LIABILITY'
  | 'TAX_LIABILITY'
  | 'IMPORT_TAX_LIABILITY'
  | 'DUTY_LIABILITY'
  | 'TIP_LIABILITY'
  | 'DRAPEON_SUBSIDY_EXPENSE'
  | 'DRAPEON_REVENUE'

export type CommercialLedgerInstruction = {
  accountCode: CommercialLedgerAccountCode
  accountScope: string
  direction: CommercialLedgerDirection
  amount: number
  currency: string
}

export type CommercialLedgerBalanceEntry = CommercialLedgerInstruction & { id?: string }

function requireMinorUnits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer in minor units.`)
  }
  return value
}

export function validateCommercialPricingBreakdown(
  input: CommercialPricingBreakdown,
): CommercialPricingBreakdown {
  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('currency must be an ISO-style three-letter code.')

  const subtotalAmount = requireMinorUnits(input.subtotalAmount, 'subtotalAmount')
  const platformFeeAmount = requireMinorUnits(input.platformFeeAmount, 'platformFeeAmount')
  const taxAmount = requireMinorUnits(input.taxAmount, 'taxAmount')
  const importTaxAmount = requireMinorUnits(input.importTaxAmount ?? 0, 'importTaxAmount')
  const dutyAmount = requireMinorUnits(input.dutyAmount ?? 0, 'dutyAmount')
  if (importTaxAmount + dutyAmount > taxAmount) {
    throw new Error('Import tax and duty cannot exceed the total tax amount.')
  }
  const shippingAmount = requireMinorUnits(input.shippingAmount, 'shippingAmount')
  const totalAmount = requireMinorUnits(input.totalAmount, 'totalAmount')
  const promotionAmount = requireMinorUnits(input.promotionAmount ?? 0, 'promotionAmount')
  const grossTotal = subtotalAmount + platformFeeAmount + taxAmount + shippingAmount
  if (promotionAmount > grossTotal) throw new Error('promotionAmount cannot exceed the gross charge.')
  const expectedTotal = grossTotal - promotionAmount

  if (totalAmount !== expectedTotal) {
    throw new Error(`totalAmount must equal the locked components (${expectedTotal}).`)
  }

  if (input.taxFallback) {
    throw new Error('A fallback tax result cannot be reserved for checkout.')
  }

  const hasFabricAllocation = [
    input.fabricSource,
    input.tailoringAmount,
    input.fabricAllowanceAmount,
    input.fabricAllowanceCoverage,
    input.fabricSourcingAssumptions,
  ].some((value) => value !== null && value !== undefined)
  if (FUNDED_FABRIC_POLICY_VERSIONS.has(input.fabricFundingPolicyVersion ?? '') || hasFabricAllocation) {
    if (!FUNDED_FABRIC_POLICY_VERSIONS.has(input.fabricFundingPolicyVersion ?? '')) {
      throw new Error('A fabric allocation requires the funded fabric policy version.')
    }
    const tailoringAmount = requireMinorUnits(input.tailoringAmount as number, 'tailoringAmount')
    const fabricAllowanceAmount = requireMinorUnits(input.fabricAllowanceAmount as number, 'fabricAllowanceAmount')
    const fabricSource = input.fabricSource as CustomOrderFabricSource
    const coverage = [...new Set(input.fabricAllowanceCoverage ?? [])]
    if (coverage.some((code) => !FABRIC_COVERAGE_CODES.has(code))) throw new Error('Fabric allowance coverage contains an unsupported category.')
    const fabricSourcingAssumptions = input.fabricSourcingAssumptions?.trim() ?? ''
    if (tailoringAmount + fabricAllowanceAmount !== subtotalAmount) throw new Error('tailoringAmount plus fabricAllowanceAmount must equal subtotalAmount.')
    if (fabricSource === 'CUSTOMER_SUPPLIES') {
      if (fabricAllowanceAmount !== 0 || coverage.length > 0) throw new Error('Customer-supplied fabric must have a zero fabric allowance.')
    } else if (fabricSource === 'TAILOR_SOURCES') {
      if (fabricAllowanceAmount <= 0 || coverage.length === 0 || fabricSourcingAssumptions.length < 8) throw new Error('Tailor-sourced fabric requires a funded allowance, coverage, and sourcing assumptions.')
    } else {
      throw new Error('fabricSource must be CUSTOMER_SUPPLIES or TAILOR_SOURCES.')
    }
    return {
      ...input,
      currency,
      subtotalAmount,
      platformFeeAmount,
      taxAmount,
      ...(input.importTaxAmount !== undefined ? { importTaxAmount } : {}),
      ...(input.dutyAmount !== undefined ? { dutyAmount } : {}),
      shippingAmount,
      promotionAmount,
      totalAmount,
      fabricFundingPolicyVersion: input.fabricFundingPolicyVersion,
      fabricSource,
      tailoringAmount,
      fabricAllowanceAmount,
      fabricAllowanceCoverage: coverage,
      fabricSourcingAssumptions,
    }
  }

  return {
    ...input,
    currency,
    subtotalAmount,
    platformFeeAmount,
    taxAmount,
    ...(input.importTaxAmount !== undefined ? { importTaxAmount } : {}),
    ...(input.dutyAmount !== undefined ? { dutyAmount } : {}),
    shippingAmount,
    promotionAmount,
    totalAmount,
  }
}

export function isCommercialPricingReservationExpired(expiresAt: string, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt)
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs
}

export function buildCaptureLedgerInstructions(input: {
  phase: OrderPaymentPhase
  paymentAmount: number
  pricing: CommercialPricingBreakdown
}): CommercialLedgerInstruction[] {
  const pricing = validateCommercialPricingBreakdown(input.pricing)
  const paymentAmount = requireMinorUnits(input.paymentAmount, 'paymentAmount')
  if (paymentAmount !== pricing.totalAmount) {
    throw new Error('Payment amount does not match the locked pricing total.')
  }

  const entries: CommercialLedgerInstruction[] = []
  if (paymentAmount > 0) entries.push({ accountCode: 'PROVIDER_CLEARING', accountScope: 'provider', direction: 'DEBIT', amount: paymentAmount, currency: pricing.currency })
  if ((pricing.promotionAmount ?? 0) > 0) entries.push({ accountCode: 'DRAPEON_SUBSIDY_EXPENSE', accountScope: 'benefits', direction: 'DEBIT', amount: pricing.promotionAmount!, currency: pricing.currency })

  const credit = (
    accountCode: CommercialLedgerAccountCode,
    accountScope: string,
    amount: number,
  ) => {
    if (amount <= 0) return
    entries.push({
      accountCode,
      accountScope,
      direction: 'CREDIT',
      amount,
      currency: pricing.currency,
    })
  }

  if (input.phase === 'INITIAL_ORDER') {
    if (FUNDED_FABRIC_POLICY_VERSIONS.has(pricing.fabricFundingPolicyVersion ?? '')) {
      credit('TAILOR_ENTITLEMENT', 'order', pricing.tailoringAmount ?? 0)
      credit('MATERIAL_ADVANCE_LIABILITY', 'order-fabric-allowance', pricing.fabricAllowanceAmount ?? 0)
    } else {
      credit('TAILOR_ENTITLEMENT', 'order', pricing.subtotalAmount)
    }
    credit('DRAPEON_REVENUE', 'platform', pricing.platformFeeAmount)
    credit('TAX_LIABILITY', pricing.taxJurisdiction ?? 'UNRESOLVED', pricing.taxAmount - (pricing.importTaxAmount ?? 0) - (pricing.dutyAmount ?? 0))
    credit('IMPORT_TAX_LIABILITY', pricing.importTaxLiabilityAccount ?? pricing.taxJurisdiction ?? 'UNRESOLVED', pricing.importTaxAmount ?? 0)
    credit('DUTY_LIABILITY', pricing.dutyLiabilityAccount ?? pricing.taxJurisdiction ?? 'UNRESOLVED', pricing.dutyAmount ?? 0)
    credit('FULFILLMENT_LIABILITY', 'order', pricing.shippingAmount)
  } else if (input.phase === 'CONSULTATION') {
    credit('CONSULTATION_ENTITLEMENT', 'order', paymentAmount)
  } else if (input.phase === 'MATERIAL_ADVANCE') {
    credit('MATERIAL_ADVANCE_LIABILITY', 'order', paymentAmount)
  } else if (input.phase === 'ADJUSTMENT') {
    if (pricing.adjustmentAllocation === 'MATERIAL') {
      credit('MATERIAL_ADVANCE_LIABILITY', 'order-fabric-allowance', pricing.subtotalAmount)
    } else {
      credit('TAILOR_ENTITLEMENT', 'order-adjustment', pricing.subtotalAmount)
    }
    credit('DRAPEON_REVENUE', 'platform', pricing.platformFeeAmount)
    credit('TAX_LIABILITY', pricing.taxJurisdiction ?? 'UNRESOLVED', pricing.taxAmount - (pricing.importTaxAmount ?? 0) - (pricing.dutyAmount ?? 0))
    credit('IMPORT_TAX_LIABILITY', pricing.importTaxLiabilityAccount ?? pricing.taxJurisdiction ?? 'UNRESOLVED', pricing.importTaxAmount ?? 0)
    credit('DUTY_LIABILITY', pricing.dutyLiabilityAccount ?? pricing.taxJurisdiction ?? 'UNRESOLVED', pricing.dutyAmount ?? 0)
    credit('FULFILLMENT_LIABILITY', 'order-adjustment', pricing.shippingAmount)
  } else if (input.phase === 'TIP') {
    credit('TIP_LIABILITY', 'order', paymentAmount)
  } else {
    credit('FULFILLMENT_LIABILITY', 'order', paymentAmount)
  }

  const debits = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0)
  const credits = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0)
  if (debits !== credits) throw new Error(`Ledger instructions are unbalanced: ${debits} debit, ${credits} credit.`)

  return entries
}

export function buildPayoutReleaseLedgerInstructions(input: {
  amount: number
  currency: string
  orderId: string
  sourceAccount?: 'TAILOR_ENTITLEMENT' | 'TAILOR_ELIGIBLE'
}): CommercialLedgerInstruction[] {
  const amount = requireMinorUnits(input.amount, 'amount')
  if (amount <= 0) throw new Error('Payout release amount must be greater than zero.')
  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('currency must be an ISO-style three-letter code.')
  const orderId = input.orderId.trim()
  if (!orderId) throw new Error('orderId is required for a payout release.')
  const sourceAccount = input.sourceAccount ?? 'TAILOR_ENTITLEMENT'

  return [
    {
      accountCode: sourceAccount,
      accountScope: orderId,
      direction: 'DEBIT',
      amount,
      currency,
    },
    {
      accountCode: 'TAILOR_RELEASED',
      accountScope: orderId,
      direction: 'CREDIT',
      amount,
      currency,
    },
  ]
}

export function buildRefundLedgerInstructions(input: {
  refundAmount: number
  captureEntries: CommercialLedgerBalanceEntry[]
  previousRefundEntries?: CommercialLedgerBalanceEntry[]
}): CommercialLedgerInstruction[] {
  const refundAmount = requireMinorUnits(input.refundAmount, 'refundAmount')
  if (refundAmount <= 0) throw new Error('refundAmount must be greater than zero.')

  const captureCredits = input.captureEntries.filter((entry) => entry.direction === 'CREDIT')
  if (captureCredits.length === 0) throw new Error('The capture has no credit allocation to reverse.')
  const currencies = new Set(captureCredits.map((entry) => entry.currency))
  if (currencies.size !== 1) throw new Error('Refund allocation must stay inside one currency.')

  const previousDebits = input.previousRefundEntries ?? []
  const remaining = captureCredits.map((entry) => {
    const alreadyReversed = previousDebits
      .filter((refund) =>
        refund.direction === 'DEBIT'
        && refund.accountCode === entry.accountCode
        && refund.accountScope === entry.accountScope
        && refund.currency === entry.currency)
      .reduce((sum, refund) => sum + refund.amount, 0)
    return { entry, amount: Math.max(entry.amount - alreadyReversed, 0) }
  }).filter((allocation) => allocation.amount > 0)

  const totalRemaining = remaining.reduce((sum, allocation) => sum + allocation.amount, 0)
  if (refundAmount > totalRemaining) throw new Error('Refund exceeds the remaining captured allocation.')

  const allocations = remaining.map((allocation, index) => {
    // Use integer arithmetic throughout. Currency values fit JavaScript's safe
    // integer range individually, but their product may not.
    const exactNumerator = BigInt(refundAmount) * BigInt(allocation.amount)
    const totalRemainingBigInt = BigInt(totalRemaining)
    return {
      ...allocation,
      index,
      allocated: Number(exactNumerator / totalRemainingBigInt),
      remainder: exactNumerator % totalRemainingBigInt,
    }
  })
  let unallocated = refundAmount - allocations.reduce((sum, allocation) => sum + allocation.allocated, 0)
  for (const allocation of [...allocations].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index
    return a.remainder > b.remainder ? -1 : 1
  })) {
    if (unallocated <= 0) break
    if (allocation.allocated < allocation.amount) {
      allocation.allocated += 1
      unallocated -= 1
    }
  }

  const currency = captureCredits[0]!.currency
  const entries: CommercialLedgerInstruction[] = allocations
    .filter((allocation) => allocation.allocated > 0)
    .map((allocation) => ({
      accountCode: allocation.entry.accountCode,
      accountScope: allocation.entry.accountScope,
      direction: 'DEBIT',
      amount: allocation.allocated,
      currency,
    }))
  entries.push({
    accountCode: 'PROVIDER_CLEARING',
    accountScope: 'provider',
    direction: 'CREDIT',
    amount: refundAmount,
    currency,
  })
  return entries
}
