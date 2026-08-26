import {
  evidencePromptsForConcern,
  financialCaseTypeForConcern,
  normalizeCustomerConcernReason,
  OPS_PARTIAL_REFUND_DECISION_BASES,
  OPS_PARTIAL_REFUND_DECISION_BASIS_LABELS,
  OPS_PARTIAL_REFUND_EVIDENCE_SOURCES,
  OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_LABELS,
  OPS_PARTIAL_REFUND_REASON_CODES,
  OPS_PARTIAL_REFUND_REASON_LABELS,
  validateFinancialCaseDraft,
} from '../src/financial-cases'

describe('financial case contracts', () => {
  it('normalizes legacy mobile and web concern labels', () => {
    expect(normalizeCustomerConcernReason('Garment not as described')).toBe('NOT_AS_DESCRIBED')
    expect(normalizeCustomerConcernReason('Item was not received')).toBe('NOT_RECEIVED')
    expect(normalizeCustomerConcernReason('FIT_OR_MEASUREMENT_ISSUE')).toBe('FIT_OR_MEASUREMENT_ISSUE')
  })

  it('maps concerns into canonical case types', () => {
    expect(financialCaseTypeForConcern('NOT_RECEIVED')).toBe('FULFILLMENT_RECONCILIATION')
    expect(financialCaseTypeForConcern('OFF_PLATFORM_OR_TRUST_ISSUE')).toBe('SAFETY_FRAUD')
    expect(financialCaseTypeForConcern('DAMAGED')).toBe('QUALITY_CONCERN')
  })

  it('derives reason-aware evidence prompts', () => {
    expect(evidencePromptsForConcern('TAILOR_UNRESPONSIVE')).toEqual([])
    expect(evidencePromptsForConcern('FIT_OR_MEASUREMENT_ISSUE')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fit_area', required: true }),
    ]))
  })

  it('requires a requested outcome and useful narrative', () => {
    expect(validateFinancialCaseDraft({
      reason: 'Damaged item received',
      requestedOutcome: 'ALTERATION_OR_FIX',
      description: 'The sleeve seam arrived torn after delivery.',
    })).toEqual(expect.objectContaining({
      reason: 'DAMAGED',
      requestedOutcome: 'ALTERATION_OR_FIX',
      caseType: 'QUALITY_CONCERN',
    }))
    expect(() => validateFinancialCaseDraft({ reason: 'OTHER', requestedOutcome: '', description: 'Enough detail here.' })).toThrow(/outcome/u)
    expect(() => validateFinancialCaseDraft({ reason: 'OTHER', requestedOutcome: 'OPS_HELP', description: 'short' })).toThrow(/10/u)
  })

  it('keeps reviewed partial-refund controls typed and user-readable', () => {
    expect(OPS_PARTIAL_REFUND_REASON_CODES).toContain('TAILOR_INACTIVITY')
    expect(OPS_PARTIAL_REFUND_REASON_LABELS.TAILOR_INACTIVITY).toBe('Tailor inactivity')
    expect(OPS_PARTIAL_REFUND_DECISION_BASES).toContain('MUTUAL_AGREEMENT')
    expect(OPS_PARTIAL_REFUND_DECISION_BASIS_LABELS.MUTUAL_AGREEMENT).toBe('Both parties agreed')
    expect(OPS_PARTIAL_REFUND_EVIDENCE_SOURCES).toEqual(expect.arrayContaining(['EMAIL_INGEST', 'WHATSAPP_SUMMARY', 'PLATFORM_MESSAGE']))
    expect(OPS_PARTIAL_REFUND_EVIDENCE_SOURCE_LABELS.WHATSAPP_SUMMARY).toBe('WhatsApp conversation')
  })
})
