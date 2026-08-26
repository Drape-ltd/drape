import {
  adjustmentDecisionCopy,
  adjustmentRequiresPayment,
  reconcileApprovedValue,
  validateCommercialAdjustmentProposal,
  type CommercialAdjustmentProposal,
} from '../src/commercial-adjustments'

const proposal: CommercialAdjustmentProposal = {
  orderId: 'order-1',
  type: 'DEADLINE_EXTENSION',
  proposedBy: 'TAILOR',
  summary: 'Move completion by three days.',
  reason: 'Supplier delivery was delayed by the carrier.',
  responsibility: 'UNRESOLVED',
  amountDelta: 0,
  currency: 'USD',
  proposedDeadline: '2026-08-10T17:00:00.000Z',
  evidenceIds: [],
  idempotencyKey: 'extension:order-1:1',
}

describe('commercial adjustments', () => {
  it('normalizes a typed deadline proposal', () => {
    expect(validateCommercialAdjustmentProposal(proposal)).toEqual(proposal)
    expect(adjustmentDecisionCopy(proposal)).toMatch(/changes the promised deadline/u)
  })

  it('blocks a tailor-caused customer charge', () => {
    expect(() => validateCommercialAdjustmentProposal({
      ...proposal,
      type: 'CORRECTION',
      responsibility: 'TAILOR',
      amountDelta: 2_000,
      proposedDeadline: null,
    })).toThrow(/cannot create a customer charge/u)
  })

  it('requires an explicit deadline for extensions', () => {
    expect(() => validateCommercialAdjustmentProposal({ ...proposal, proposedDeadline: null })).toThrow(/requires the proposed deadline/u)
  })

  it('derives exact, unused, and overage reconciliation outcomes', () => {
    expect(reconcileApprovedValue({ approvedAmount: 10_000, actualAmount: 10_000 }).outcome).toBe('EXACT')
    expect(reconcileApprovedValue({ approvedAmount: 10_000, actualAmount: 8_500 })).toEqual(expect.objectContaining({ outcome: 'UNUSED_VALUE', deltaAmount: -1_500, requiresOpsReview: true }))
    expect(reconcileApprovedValue({ approvedAmount: 10_000, actualAmount: 12_000 })).toEqual(expect.objectContaining({ outcome: 'OVERAGE', deltaAmount: 2_000, requiresOpsReview: true }))
  })

  it('only charges a customer for customer-responsible positive value', () => {
    expect(adjustmentRequiresPayment({ amountDelta: 1_000, responsibility: 'CUSTOMER' })).toBe(true)
    expect(adjustmentRequiresPayment({ amountDelta: 1_000, responsibility: 'DRAPEON' })).toBe(false)
    expect(adjustmentRequiresPayment({ amountDelta: -1_000, responsibility: 'CUSTOMER' })).toBe(false)
  })
})
