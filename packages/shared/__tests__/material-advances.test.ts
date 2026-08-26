import {
  MATERIAL_ADVANCE_DECLINE_REASONS,
  MATERIAL_FUNDING_EVENTS,
  MATERIAL_FUNDING_EVENT_POLICIES,
  deriveMaterialReconciliation,
  materialReconciliationCopy,
  materialAdvanceRequiresSeparatePayment,
  materialAdvanceCustomerDecisionFromNote,
  materialAdvanceDeclineReasonLabel,
  remainingFundedFabricAllowance,
  validateFundedFabricReleaseAmount,
  materialFundingDestinationData,
} from '../src/material-advances'

describe('material advance decline reasons', () => {
  it('provides a customer-facing label for every stored reason', () => {
    for (const reason of MATERIAL_ADVANCE_DECLINE_REASONS) {
      expect(materialAdvanceDeclineReasonLabel(reason)).toBeTruthy()
    }
  })

  it('does not render unknown database values', () => {
    expect(materialAdvanceDeclineReasonLabel('RANDOM_REASON')).toBeNull()
  })

  it('recognizes authoritative customer decision timeline notes', () => {
    expect(materialAdvanceCustomerDecisionFromNote(
      'Customer declined the material advance for Beads. Reason: Find a cheaper option.',
    )).toBe('DECLINED')
    expect(materialAdvanceCustomerDecisionFromNote(
      'Customer approved the material advance for Lace. Payment is now required.',
    )).toBe('APPROVED')
    expect(materialAdvanceCustomerDecisionFromNote('Cutting started.')).toBeNull()
  })
})

describe('material reconciliation copy', () => {
  it('makes the no-surprise-charge rule explicit for customer overages', () => {
    expect(materialReconciliationCopy({ outcome: 'OVERAGE', actorRole: 'CUSTOMER' })).toMatchObject({
      title: 'Supplier overage under review',
      body: expect.stringContaining('not be charged'),
    })
  })

  it('distinguishes a pending unused amount from a completed refund', () => {
    expect(materialReconciliationCopy({ outcome: 'UNUSED_VALUE', actorRole: 'TAILOR' })?.title).toBe('Unused fabric value under review')
    expect(materialReconciliationCopy({ outcome: 'UNUSED_VALUE', resolution: 'CUSTOMER_REFUNDED', actorRole: 'TAILOR' })?.title).toBe('Unused fabric value refunded')
  })
})

describe('funded fabric release claims', () => {
  const balance = { fundedAmount: 50_000, releasedAmount: 12_000, refundedAmount: 3_000 }

  it('uses only the unconsumed protected fabric allowance', () => {
    expect(remainingFundedFabricAllowance(balance)).toBe(35_000)
    expect(validateFundedFabricReleaseAmount(35_000, balance)).toEqual({ ok: true, remainingAmount: 35_000 })
    expect(validateFundedFabricReleaseAmount(35_001, balance)).toEqual({
      ok: false,
      remainingAmount: 35_000,
      code: 'FABRIC_RELEASE_EXCEEDS_ALLOWANCE',
    })
  })

  it('never starts a second checkout for funded allowance claims', () => {
    expect(materialAdvanceRequiresSeparatePayment('FUNDED_FABRIC_ALLOWANCE')).toBe(false)
    expect(materialAdvanceRequiresSeparatePayment('LEGACY_SEPARATE_PAYMENT')).toBe(true)
  })
})

describe('material reconciliation', () => {
  it('separates refundable unused value from an unapproved overage', () => {
    expect(deriveMaterialReconciliation({ approvedAmount: 10_000, actualSpentAmount: 8_500 })).toMatchObject({ outcome: 'UNUSED_VALUE', deltaAmount: -1_500, customerRefundAmount: 1_500, unapprovedOverageAmount: 0, requiresOpsReview: true })
    expect(deriveMaterialReconciliation({ approvedAmount: 10_000, actualSpentAmount: 12_000 })).toMatchObject({ outcome: 'OVERAGE', deltaAmount: 2_000, customerRefundAmount: 0, unapprovedOverageAmount: 2_000, requiresOpsReview: true })
    expect(deriveMaterialReconciliation({ approvedAmount: 10_000, actualSpentAmount: 10_000 })).toMatchObject({ outcome: 'EXACT', requiresOpsReview: false })
    expect(deriveMaterialReconciliation({ approvedAmount: 8_000, actualSpentAmount: 8_000, protectedUnusedAmount: 2_000 })).toMatchObject({ outcome: 'UNUSED_VALUE', customerRefundAmount: 2_000, protectedAllowanceRefundAmount: 2_000, settlementRecoveryAmount: 0, requiresOpsReview: true })
  })
})

describe('material funding notification parity', () => {
  it('defines a delivery policy for every protected-fabric event', () => {
    expect(Object.keys(MATERIAL_FUNDING_EVENT_POLICIES).sort()).toEqual([...MATERIAL_FUNDING_EVENTS].sort())
  })

  it('mirrors every counterpart decision through push and email without SMS', () => {
    for (const event of MATERIAL_FUNDING_EVENTS) {
      const policy = MATERIAL_FUNDING_EVENT_POLICIES[event]
      if (policy.importance !== 'INFORMATIONAL') {
        expect(policy.channels).toContain('PUSH')
        expect(policy.channels).toContain('EMAIL')
      }
      expect(policy.smsFallback).toBe(false)
    }
  })

  it('opens the exact order and material advance', () => {
    expect(materialFundingDestinationData(' order-1 ', ' advance-1 ', 'RELEASE_CONFIRMED')).toEqual({
      destination: 'ORDER',
      orderId: 'order-1',
      advanceId: 'advance-1',
      action: 'RELEASE_CONFIRMED',
    })
  })
})
