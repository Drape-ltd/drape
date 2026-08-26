export const STAGED_SETTLEMENT_POLICY_VERSION = 'settlement-2026-08-01-v1' as const
export const LEGACY_SETTLEMENT_POLICY_VERSION = 'legacy-single-release-72h' as const

export type SettlementMethod = 'SHIPPED' | 'LOCAL_HANDOFF'
export type SettlementTrancheCode =
  | 'SHIP_CUSTODY_70'
  | 'SHIP_DELIVERY_20'
  | 'SHIP_PROTECTION_10'
  | 'LOCAL_HANDOFF_80'
  | 'LOCAL_SETTLED_20'
export type SettlementTrancheStatus =
  | 'LOCKED'
  | 'ELIGIBLE'
  | 'RELEASE_REQUESTED'
  | 'RELEASED'
  | 'BLOCKED'
  | 'CANCELLED'

export type SettlementTrancheDefinition = {
  code: SettlementTrancheCode
  sequence: number
  basisPoints: number
  title: string
  requirement: string
  delayHours: number
}

export type SettlementTranche = SettlementTrancheDefinition & {
  id: string
  amount: number
  status: SettlementTrancheStatus
  eligibleAt: string | null
  releasedAt: string | null
  blockedReason: string | null
}

const SHIPPED: readonly SettlementTrancheDefinition[] = [
  { code: 'SHIP_CUSTODY_70', sequence: 1, basisPoints: 7000, title: 'Accepted for delivery', requirement: 'Verified carrier acceptance or Drapeon custody', delayHours: 0 },
  { code: 'SHIP_DELIVERY_20', sequence: 2, basisPoints: 2000, title: 'Delivery settled', requirement: 'Verified delivery plus 72 hours', delayHours: 72 },
  { code: 'SHIP_PROTECTION_10', sequence: 3, basisPoints: 1000, title: 'Protection window complete', requirement: 'Fourteen days after verified delivery', delayHours: 336 },
] as const

const LOCAL: readonly SettlementTrancheDefinition[] = [
  { code: 'LOCAL_HANDOFF_80', sequence: 1, basisPoints: 8000, title: 'Handoff confirmed', requirement: 'Authenticated local handoff', delayHours: 0 },
  { code: 'LOCAL_SETTLED_20', sequence: 2, basisPoints: 2000, title: 'Handoff settled', requirement: 'Authenticated local handoff plus 72 hours', delayHours: 72 },
] as const

export function settlementMethodForDelivery(deliveryMethod: string | null | undefined): SettlementMethod {
  return deliveryMethod === 'LOCAL_COLLECTION' ? 'LOCAL_HANDOFF' : 'SHIPPED'
}

export function settlementDefinitions(method: SettlementMethod) {
  return method === 'LOCAL_HANDOFF' ? LOCAL : SHIPPED
}

export function allocateSettlementTranches(entitlementAmount: number, method: SettlementMethod) {
  if (!Number.isSafeInteger(entitlementAmount) || entitlementAmount <= 0) {
    throw new Error('Tailor entitlement must be a positive integer in minor units.')
  }
  const definitions = settlementDefinitions(method)
  const allocations = definitions.map((definition) => {
    const numerator = entitlementAmount * definition.basisPoints
    return {
      ...definition,
      amount: Math.floor(numerator / 10_000),
      remainder: numerator % 10_000,
    }
  })
  let remaining = entitlementAmount - allocations.reduce((sum, item) => sum + item.amount, 0)
  for (const item of [...allocations].sort((a, b) => {
    if (a.remainder === b.remainder) return a.sequence - b.sequence
    return a.remainder > b.remainder ? -1 : 1
  })) {
    if (remaining <= 0) break
    item.amount += 1
    remaining -= 1
  }
  return allocations.map(({ remainder: _remainder, ...allocation }) => allocation)
}

export function deriveTailorSettlementEntitlement(input: {
  sellerSubtotalAmount: number
  fabricFundingPolicyVersion?: string | null
  tailoringAmount?: number | null
}) {
  if (!Number.isSafeInteger(input.sellerSubtotalAmount) || input.sellerSubtotalAmount <= 0) throw new Error('Seller subtotal must be a positive integer in minor units.')
  if (!['fabric-funding-2026-08-01-v1', 'fabric-funding-2026-08-21-v2'].includes(input.fabricFundingPolicyVersion ?? '')) {
    return { entitlementAmount: input.sellerSubtotalAmount, excludedFabricAllowanceAmount: 0 }
  }
  if (!Number.isSafeInteger(input.tailoringAmount) || Number(input.tailoringAmount) <= 0 || Number(input.tailoringAmount) > input.sellerSubtotalAmount) throw new Error('Funded-fabric settlement requires the locked tailoring amount.')
  return { entitlementAmount: Number(input.tailoringAmount), excludedFabricAllowanceAmount: input.sellerSubtotalAmount - Number(input.tailoringAmount) }
}

export function settlementStatusLabel(status: SettlementTrancheStatus) {
  const labels: Record<SettlementTrancheStatus, string> = {
    LOCKED: 'Still protected',
    ELIGIBLE: 'Ready for Drapeon review',
    RELEASE_REQUESTED: 'Release under review',
    RELEASED: 'Released',
    BLOCKED: 'Paused for review',
    CANCELLED: 'Cancelled',
  }
  return labels[status]
}

export function summarizeSettlement(tranches: readonly Pick<SettlementTranche, 'amount' | 'status'>[]) {
  return tranches.reduce((summary, tranche) => {
    summary.total += tranche.amount
    if (tranche.status === 'RELEASED') summary.released += tranche.amount
    else if (tranche.status === 'ELIGIBLE' || tranche.status === 'RELEASE_REQUESTED') summary.eligible += tranche.amount
    else summary.protected += tranche.amount
    return summary
  }, { total: 0, released: 0, eligible: 0, protected: 0 })
}
