import type { CustomOrderFabricSource } from './custom-order-fabric.ts'

export const FABRIC_FUNDING_POLICY_VERSION = 'fabric-funding-2026-08-01-v1' as const
export const FABRIC_FUNDING_POLICY_V2_VERSION = 'fabric-funding-2026-08-21-v2' as const
export const LEGACY_FABRIC_FUNDING_POLICY_VERSION = 'legacy-material-add-on-v1' as const

export type FabricFundingPolicyVersion =
  | typeof FABRIC_FUNDING_POLICY_VERSION
  | typeof FABRIC_FUNDING_POLICY_V2_VERSION
  | typeof LEGACY_FABRIC_FUNDING_POLICY_VERSION

export const FABRIC_ALLOWANCE_COVERAGE_CODES = [
  'FABRIC',
  'LINING',
  'EMBROIDERY',
  'TRIMS',
  'NOTIONS',
  'OTHER_AGREED_MATERIAL',
] as const

export type FabricAllowanceCoverageCode = typeof FABRIC_ALLOWANCE_COVERAGE_CODES[number]

export type FabricQuoteAllocationInput = {
  policyVersion: string
  fabricSource: CustomOrderFabricSource
  currency: string
  subtotalAmount: number
  tailoringAmount: number
  fabricAllowanceAmount: number
  coverage: FabricAllowanceCoverageCode[]
  sourcingAssumptions: string
}

export type FabricQuoteAllocation = FabricQuoteAllocationInput & {
  policyVersion: typeof FABRIC_FUNDING_POLICY_VERSION | typeof FABRIC_FUNDING_POLICY_V2_VERSION
}

export type FabricFundingBalancesInput = {
  baseAllowanceAmount: number
  paidAdjustmentAmount?: number
  fundedAmount: number
  releasedAmount: number
  refundedAmount?: number
}

export type FabricFundingBalances = {
  authorizedAmount: number
  fundedAmount: number
  releasedAmount: number
  refundedAmount: number
  remainingFundedAmount: number
  unfundedAuthorizedAmount: number
}

function requireMinorUnits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer in minor units.`)
  }
  return value
}

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw new Error('currency must be an ISO-style three-letter code.')
  }
  return currency
}

export function isFundedFabricPolicy(
  policyVersion: string | null | undefined,
): policyVersion is typeof FABRIC_FUNDING_POLICY_VERSION | typeof FABRIC_FUNDING_POLICY_V2_VERSION {
  return policyVersion === FABRIC_FUNDING_POLICY_VERSION
    || policyVersion === FABRIC_FUNDING_POLICY_V2_VERSION
}

export function validateFabricQuoteAllocation(
  input: FabricQuoteAllocationInput,
): FabricQuoteAllocation {
  if (!isFundedFabricPolicy(input.policyVersion)) {
    throw new Error('policyVersion must be a supported funded-fabric policy.')
  }

  const currency = normalizeCurrency(input.currency)
  const subtotalAmount = requireMinorUnits(input.subtotalAmount, 'subtotalAmount')
  const tailoringAmount = requireMinorUnits(input.tailoringAmount, 'tailoringAmount')
  const fabricAllowanceAmount = requireMinorUnits(input.fabricAllowanceAmount, 'fabricAllowanceAmount')
  if (tailoringAmount + fabricAllowanceAmount !== subtotalAmount) {
    throw new Error('tailoringAmount plus fabricAllowanceAmount must equal subtotalAmount.')
  }

  const coverage = [...new Set(input.coverage)]
  if (coverage.some((code) => !FABRIC_ALLOWANCE_COVERAGE_CODES.includes(code))) {
    throw new Error('coverage contains an unsupported fabric allowance category.')
  }

  const sourcingAssumptions = input.sourcingAssumptions.trim()
  if (input.fabricSource === 'CUSTOMER_SUPPLIES') {
    if (fabricAllowanceAmount !== 0) {
      throw new Error('Customer-supplied fabric must have a zero fabric allowance.')
    }
    if (coverage.length > 0) {
      throw new Error('Customer-supplied fabric cannot reserve tailor material coverage.')
    }
  } else if (input.fabricSource === 'TAILOR_SOURCES') {
    if (fabricAllowanceAmount <= 0) {
      throw new Error('Tailor-sourced fabric requires a positive fabric allowance.')
    }
    if (coverage.length === 0) {
      throw new Error('Tailor-sourced fabric requires allowance coverage details.')
    }
    if (sourcingAssumptions.length < 8) {
      throw new Error('Tailor-sourced fabric requires clear sourcing assumptions.')
    }
  } else {
    throw new Error('fabricSource must be CUSTOMER_SUPPLIES or TAILOR_SOURCES.')
  }

  return {
    ...input,
    policyVersion: input.policyVersion as FabricQuoteAllocation['policyVersion'],
    currency,
    subtotalAmount,
    tailoringAmount,
    fabricAllowanceAmount,
    coverage,
    sourcingAssumptions,
  }
}

export function deriveFabricFundingBalances(
  input: FabricFundingBalancesInput,
): FabricFundingBalances {
  const baseAllowanceAmount = requireMinorUnits(input.baseAllowanceAmount, 'baseAllowanceAmount')
  const paidAdjustmentAmount = requireMinorUnits(input.paidAdjustmentAmount ?? 0, 'paidAdjustmentAmount')
  const fundedAmount = requireMinorUnits(input.fundedAmount, 'fundedAmount')
  const releasedAmount = requireMinorUnits(input.releasedAmount, 'releasedAmount')
  const refundedAmount = requireMinorUnits(input.refundedAmount ?? 0, 'refundedAmount')
  const authorizedAmount = baseAllowanceAmount + paidAdjustmentAmount

  if (fundedAmount > authorizedAmount) {
    throw new Error('fundedAmount cannot exceed the authorized fabric allowance.')
  }
  if (releasedAmount + refundedAmount > fundedAmount) {
    throw new Error('Released and refunded fabric value cannot exceed funded value.')
  }

  return {
    authorizedAmount,
    fundedAmount,
    releasedAmount,
    refundedAmount,
    remainingFundedAmount: fundedAmount - releasedAmount - refundedAmount,
    unfundedAuthorizedAmount: authorizedAmount - fundedAmount,
  }
}

export function canRequestFabricRelease(
  balances: FabricFundingBalancesInput,
  requestedAmount: number,
) {
  const request = requireMinorUnits(requestedAmount, 'requestedAmount')
  if (request <= 0) return false
  return request <= deriveFabricFundingBalances(balances).remainingFundedAmount
}

export type FabricReleaseFundingRoute =
  | { kind: 'FUNDED_RELEASE'; requestedAmount: number; remainingAmount: number; shortfallAmount: 0 }
  | { kind: 'COMMERCIAL_ADJUSTMENT_REQUIRED'; requestedAmount: number; remainingAmount: number; shortfallAmount: number }

/** Routes only the uncovered supplier cost into a formal customer-funded change. */
export function deriveFabricReleaseFundingRoute(
  balances: FabricFundingBalancesInput,
  requestedAmount: number,
): FabricReleaseFundingRoute {
  const requested = requireMinorUnits(requestedAmount, 'requestedAmount')
  if (requested <= 0) throw new Error('requestedAmount must be greater than zero.')
  const remainingAmount = deriveFabricFundingBalances(balances).remainingFundedAmount
  return requested <= remainingAmount
    ? { kind: 'FUNDED_RELEASE', requestedAmount: requested, remainingAmount, shortfallAmount: 0 }
    : {
        kind: 'COMMERCIAL_ADJUSTMENT_REQUIRED',
        requestedAmount: requested,
        remainingAmount,
        shortfallAmount: requested - remainingAmount,
      }
}
