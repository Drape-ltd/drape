import { allocateSettlementTranches, deriveTailorSettlementEntitlement, settlementMethodForDelivery, summarizeSettlement } from '../src/staged-settlement'

describe('staged settlement', () => {
  it('allocates shipped entitlement exactly across 70/20/10', () => {
    const rows = allocateSettlementTranches(10_001, 'SHIPPED')
    expect(rows.map((row) => row.amount)).toEqual([7_001, 2_000, 1_000])
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(10_001)
  })

  it('allocates local handoff exactly across 80/20', () => {
    expect(allocateSettlementTranches(101, 'LOCAL_HANDOFF').map((row) => row.amount)).toEqual([81, 20])
  })

  it('does not mistake local delivery or shipping for authenticated collection', () => {
    expect(settlementMethodForDelivery('LOCAL_COLLECTION')).toBe('LOCAL_HANDOFF')
    expect(settlementMethodForDelivery('LOCAL_DELIVERY')).toBe('SHIPPED')
    expect(settlementMethodForDelivery('SHIPPING')).toBe('SHIPPED')
  })

  it('summarizes protected, eligible, and released money', () => {
    expect(summarizeSettlement([
      { amount: 70, status: 'RELEASED' },
      { amount: 20, status: 'ELIGIBLE' },
      { amount: 10, status: 'BLOCKED' },
    ])).toEqual({ total: 100, released: 70, eligible: 20, protected: 10 })
  })

  it('excludes a protected fabric allowance from tailor settlement', () => {
    expect(deriveTailorSettlementEntitlement({ sellerSubtotalAmount: 200_000, fabricFundingPolicyVersion: 'fabric-funding-2026-08-01-v1', tailoringAmount: 150_000 })).toEqual({ entitlementAmount: 150_000, excludedFabricAllowanceAmount: 50_000 })
    expect(deriveTailorSettlementEntitlement({ sellerSubtotalAmount: 200_000 })).toEqual({ entitlementAmount: 200_000, excludedFabricAllowanceAmount: 0 })
  })
})
