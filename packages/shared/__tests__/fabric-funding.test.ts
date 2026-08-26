import {
  FABRIC_FUNDING_POLICY_VERSION,
  canRequestFabricRelease,
  deriveFabricReleaseFundingRoute,
  deriveFabricFundingBalances,
  validateFabricQuoteAllocation,
} from '../src/fabric-funding'

describe('fabric funding allocation', () => {
  const tailorSources = {
    policyVersion: FABRIC_FUNDING_POLICY_VERSION,
    fabricSource: 'TAILOR_SOURCES' as const,
    currency: 'ngn',
    subtotalAmount: 200_000,
    tailoringAmount: 150_000,
    fabricAllowanceAmount: 50_000,
    coverage: ['FABRIC', 'LINING'] as const,
    sourcingAssumptions: 'Six yards of breathable cotton with matching lining.',
  }

  it('locks an explicit tailor and fabric split in the order currency', () => {
    expect(validateFabricQuoteAllocation({ ...tailorSources, coverage: [...tailorSources.coverage] })).toEqual({
      ...tailorSources,
      currency: 'NGN',
      coverage: ['FABRIC', 'LINING'],
    })
  })

  it('rejects hidden or under-specified tailor-sourced material value', () => {
    expect(() => validateFabricQuoteAllocation({
      ...tailorSources,
      coverage: [...tailorSources.coverage],
      tailoringAmount: 200_000,
    })).toThrow(/must equal subtotalAmount/u)
    expect(() => validateFabricQuoteAllocation({
      ...tailorSources,
      coverage: [],
    })).toThrow(/coverage details/u)
  })

  it('requires a zero allowance when the customer supplies fabric', () => {
    expect(() => validateFabricQuoteAllocation({
      ...tailorSources,
      fabricSource: 'CUSTOMER_SUPPLIES',
      coverage: [],
      sourcingAssumptions: '',
    })).toThrow(/zero fabric allowance/u)
    expect(validateFabricQuoteAllocation({
      ...tailorSources,
      fabricSource: 'CUSTOMER_SUPPLIES',
      tailoringAmount: 200_000,
      fabricAllowanceAmount: 0,
      coverage: [],
      sourcingAssumptions: '',
    }).fabricAllowanceAmount).toBe(0)
  })

  it('derives the exact funded balance without treating authorization as cash', () => {
    expect(deriveFabricFundingBalances({
      baseAllowanceAmount: 50_000,
      paidAdjustmentAmount: 10_000,
      fundedAmount: 50_000,
      releasedAmount: 32_000,
      refundedAmount: 3_000,
    })).toEqual({
      authorizedAmount: 60_000,
      fundedAmount: 50_000,
      releasedAmount: 32_000,
      refundedAmount: 3_000,
      remainingFundedAmount: 15_000,
      unfundedAuthorizedAmount: 10_000,
    })
  })

  it('blocks releases above remaining funded value and impossible balances', () => {
    const balances = {
      baseAllowanceAmount: 50_000,
      fundedAmount: 50_000,
      releasedAmount: 32_000,
      refundedAmount: 3_000,
    }
    expect(canRequestFabricRelease(balances, 15_000)).toBe(true)
    expect(canRequestFabricRelease(balances, 15_001)).toBe(false)
    expect(() => deriveFabricFundingBalances({
      ...balances,
      releasedAmount: 48_000,
    })).toThrow(/cannot exceed funded value/u)
  })

  it('routes only an uncovered supplier cost to a commercial adjustment', () => {
    const balances = { baseAllowanceAmount: 10_000, fundedAmount: 10_000, releasedAmount: 6_000 }
    expect(deriveFabricReleaseFundingRoute(balances, 4_000)).toEqual({
      kind: 'FUNDED_RELEASE', requestedAmount: 4_000, remainingAmount: 4_000, shortfallAmount: 0,
    })
    expect(deriveFabricReleaseFundingRoute(balances, 5_500)).toEqual({
      kind: 'COMMERCIAL_ADJUSTMENT_REQUIRED', requestedAmount: 5_500, remainingAmount: 4_000, shortfallAmount: 1_500,
    })
  })
})
