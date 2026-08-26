import {
  deriveMoneyDeskRisk,
  moneyDeskPolicySnapshot,
  validateMoneyDeskReason,
} from '../src/money-desk'

describe('Money Desk controls', () => {
  it('requires one independent approval for a standard action below the threshold', () => {
    expect(deriveMoneyDeskRisk({ actionType: 'PAYOUT_RELEASE', amountUsdEquivalent: 49_999 })).toEqual({
      approvalCount: 1,
      riskLevel: 'STANDARD',
      riskReasons: [],
    })
  })

  it('requires dual approval at the USD 500 equivalent threshold', () => {
    expect(deriveMoneyDeskRisk({ actionType: 'CUSTOMER_REFUND', amountUsdEquivalent: 50_000 })).toMatchObject({
      approvalCount: 2,
      riskLevel: 'HIGH',
      riskReasons: ['USD_500_EQUIVALENT_OR_MORE'],
    })
  })

  it('fails unresolved FX and always-sensitive actions into dual approval', () => {
    const risk = deriveMoneyDeskRisk({ actionType: 'MANUAL_FX', amountUsdEquivalent: null })
    expect(risk.approvalCount).toBe(2)
    expect(risk.riskReasons).toEqual([
      'ACTION_ALWAYS_REQUIRES_DUAL_APPROVAL',
      'USD_EQUIVALENT_UNRESOLVED',
    ])
  })

  it('requires a useful reason and publishes the frozen policy', () => {
    expect(() => validateMoneyDeskReason('too short')).toThrow()
    expect(validateMoneyDeskReason('Customer-approved material release with receipt evidence.')).toContain('receipt')
    expect(moneyDeskPolicySnapshot()).toMatchObject({
      policyVersion: 'commercial-2026-07-31-v1',
      jitDurationMinutes: 15,
      allActionsRequireIndependentApproval: true,
    })
  })
})
