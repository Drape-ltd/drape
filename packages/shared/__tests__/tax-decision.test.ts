import {
  calculateReviewedInternationalCharges,
  TAX_FULFILLMENT_POLICY_VERSION,
  deriveTaxTransactionType,
  isVerifiedTaxLocation,
  resolveRegistrationDecision,
  resolveReviewedTaxResponsibilityControl,
  resolveTaxPolicyActivation,
  validateTaxLineClassifications,
  taxCollectionPromise,
  type ReviewedTaxResponsibilityControl,
} from '../src/tax-decision'

function control(overrides: Partial<ReviewedTaxResponsibilityControl> = {}): ReviewedTaxResponsibilityControl {
  return {
    controlId: '11111111-1111-4111-8111-111111111111',
    controlKey: 'GH:CUSTOM_ORDER:LOCAL_DELIVERY',
    policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
    status: 'ACTIVE',
    jurisdictionCountryCode: 'GH',
    jurisdictionRegionCode: null,
    transactionType: 'CUSTOM_ORDER',
    fulfillmentClassification: 'LOCAL_DELIVERY',
    supplyCharacterization: 'COMPOSITE',
    liabilityGranularity: 'ORDER',
    responsibleParty: 'DRAPEON_MARKETPLACE_FACILITATOR',
    statutoryRole: 'Marketplace facilitator and remitter',
    registrationSubject: 'DRAPEON',
    registrationRuleId: '22222222-2222-4222-8222-222222222222',
    marketplaceFacilitatorApplies: true,
    collectionMode: 'COLLECTED_AT_CHECKOUT',
    calculationStrategy: 'REVIEWED_STATIC_OR_PROVIDER',
    providerReference: null,
    invoiceTreatment: 'Drapeon records collected tax separately.',
    filingLiabilityAccount: 'TAX_LIABILITY:GH',
    amendmentMayInherit: false,
    sourceUrls: ['https://gra.gov.gh/'],
    legalReviewer: 'tax-reviewer@drapeon.co',
    financeApprover: 'finance-approver@drapeon.co',
    engineeringApprover: 'engineering-approver@drapeon.co',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    reviewDueAt: '2027-08-01T00:00:00.000Z',
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    effectiveTo: null,
    supersedesControlId: null,
    changeReason: 'Initial reviewed dry-run control.',
    ...overrides,
  }
}

describe('tax decision contracts', () => {
  it.each([
    [{ paymentPhase: 'INITIAL_ORDER', orderKind: 'CUSTOM' }, 'CUSTOM_ORDER'],
    [{ paymentPhase: 'INITIAL_ORDER', orderKind: 'READY_MADE' }, 'READY_MADE_ORDER'],
    [{ paymentPhase: 'CONSULTATION' }, 'CONSULTATION'],
    [{ paymentPhase: 'MATERIAL_ADVANCE' }, 'MATERIAL_ADVANCE'],
    [{ paymentPhase: 'ADJUSTMENT' }, 'ORDER_AMENDMENT'],
    [{ paymentPhase: 'FULFILLMENT' }, 'FULFILLMENT_CHARGE'],
    [{ paymentPhase: 'TIP' }, 'TIP_OR_GRATUITY'],
  ])('maps an existing commercial event without inventing a new payment vocabulary', (input, expected) => {
    expect(deriveTaxTransactionType(input)).toEqual({ status: 'RESOLVED', transactionType: expected })
  })

  it('preserves the underlying supply for promotional coverage', () => {
    expect(deriveTaxTransactionType({
      purpose: 'PROMOTIONAL_COVERAGE',
      underlyingTransactionType: 'CUSTOM_ORDER',
    })).toEqual({ status: 'RESOLVED', transactionType: 'CUSTOM_ORDER' })
  })

  it('blocks promotional coverage without an underlying supply and blocks OTHER_REVIEWED', () => {
    expect(deriveTaxTransactionType({ purpose: 'PROMOTIONAL_COVERAGE' })).toEqual({
      status: 'BLOCKED',
      reason: 'UNDERLYING_TRANSACTION_TYPE_REQUIRED',
    })
    expect(deriveTaxTransactionType({ purpose: 'OTHER_REVIEWED' })).toEqual({
      status: 'BLOCKED',
      reason: 'OTHER_REVIEWED_REQUIRES_TAX_MAPPING',
    })
  })

  it('selects one effective, reviewed, exact-region control', () => {
    const generic = control()
    const regional = control({
      controlId: '33333333-3333-4333-8333-333333333333',
      controlKey: 'GH-AA:CUSTOM_ORDER:LOCAL_DELIVERY',
      jurisdictionRegionCode: 'AA',
    })
    expect(resolveReviewedTaxResponsibilityControl({
      controls: [generic, regional],
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      jurisdictionCountryCode: 'gh',
      jurisdictionRegionCode: 'aa',
      transactionType: 'CUSTOM_ORDER',
      fulfillmentClassification: 'LOCAL_DELIVERY',
      at: '2026-08-16T00:00:00.000Z',
    })).toEqual({ status: 'RESOLVED', control: regional })
  })

  it('fails closed for conflicts, expired reviews, and unsupported liability granularity', () => {
    const base = control()
    const duplicate = control({
      controlId: '44444444-4444-4444-8444-444444444444',
      controlKey: 'GH:CUSTOM_ORDER:LOCAL_DELIVERY:duplicate',
    })
    const common = {
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      jurisdictionCountryCode: 'GH',
      transactionType: 'CUSTOM_ORDER',
      fulfillmentClassification: 'LOCAL_DELIVERY',
      at: '2026-08-16T00:00:00.000Z',
    } as const

    expect(resolveReviewedTaxResponsibilityControl({ ...common, controls: [base, duplicate] })).toEqual({
      status: 'BLOCKED',
      reason: 'CONTROL_CONFLICT',
    })
    expect(resolveReviewedTaxResponsibilityControl({
      ...common,
      controls: [control({ reviewDueAt: '2026-08-15T00:00:00.000Z' })],
    })).toEqual({ status: 'BLOCKED', reason: 'CONTROL_REVIEW_EXPIRED' })
    expect(resolveReviewedTaxResponsibilityControl({
      ...common,
      controls: [control({ liabilityGranularity: 'LINE_GROUP' })],
    })).toEqual({ status: 'BLOCKED', reason: 'UNSUPPORTED_LIABILITY_GRANULARITY' })
  })

  it('blocks incomplete review evidence and unknown transaction types', () => {
    const common = {
      controls: [control({ sourceUrls: [] })],
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      jurisdictionCountryCode: 'GH',
      fulfillmentClassification: 'LOCAL_DELIVERY',
      at: '2026-08-16T00:00:00.000Z',
    } as const
    expect(resolveReviewedTaxResponsibilityControl({ ...common, transactionType: 'CUSTOM_ORDER' })).toEqual({
      status: 'BLOCKED',
      reason: 'MISSING_SOURCE_REVIEW',
    })
    expect(resolveReviewedTaxResponsibilityControl({ ...common, transactionType: 'UNKNOWN' })).toEqual({
      status: 'BLOCKED',
      reason: 'UNSUPPORTED_TRANSACTION_TYPE',
    })
  })

  it('requires a structured, verified location instead of free-text profile location', () => {
    expect(isVerifiedTaxLocation({
      countryCode: 'GH',
      regionCode: 'AA',
      postalCode: null,
      city: 'Accra',
      addressLine1: '14 Kofi Atta Annan Street',
      verificationSource: 'ADDRESS_PROVIDER',
      verifiedAt: '2026-08-16T00:00:00.000Z',
    })).toBe(true)
    expect(isVerifiedTaxLocation('Accra, Ghana')).toBe(false)
  })

  it('activates only one effective environment-specific scope', () => {
    const activation = {
      activationId: '55555555-5555-4555-8555-555555555555',
      environment: 'DEVELOPMENT' as const,
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      status: 'ACTIVE' as const,
      jurisdictionCountryCode: 'GH',
      jurisdictionRegionCode: null,
      originCountryCode: null,
      destinationCountryCode: null,
      transactionType: 'CUSTOM_ORDER' as const,
      fulfillmentClassification: 'LOCAL_DELIVERY' as const,
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      effectiveTo: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      reviewDueAt: '2027-08-01T00:00:00.000Z',
      legalReviewer: 'legal@drapeon.co',
      financeApprover: 'finance@drapeon.co',
      engineeringApprover: 'engineering@drapeon.co',
      sourceUrls: ['https://gra.gov.gh/'],
    }
    expect(resolveTaxPolicyActivation({
      activations: [activation],
      environment: 'DEVELOPMENT',
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      jurisdictionCountryCode: 'GH',
      transactionType: 'CUSTOM_ORDER',
      fulfillmentClassification: 'LOCAL_DELIVERY',
      at: '2026-08-16T00:00:00.000Z',
    })).toEqual({ status: 'RESOLVED', activation })
    expect(resolveTaxPolicyActivation({
      activations: [activation],
      environment: 'PRODUCTION',
      policyVersion: TAX_FULFILLMENT_POLICY_VERSION,
      jurisdictionCountryCode: 'GH',
      transactionType: 'CUSTOM_ORDER',
      fulfillmentClassification: 'LOCAL_DELIVERY',
    })).toEqual({ status: 'NOT_ACTIVATED' })
  })

  it('fails closed at a registration threshold without a reviewed registered fact', () => {
    const fact = {
      factId: '66666666-6666-4666-8666-666666666666',
      registrationSubject: 'DRAPEON' as const,
      subjectId: 'DRAPEON',
      jurisdictionCountryCode: 'GH',
      jurisdictionRegionCode: null,
      transactionType: 'CUSTOM_ORDER' as const,
      decision: 'NOT_REGISTERED' as const,
      taxableTurnoverMinor: 200_000,
      turnoverCurrency: 'GHS',
      measurementPeriod: 'ROLLING_12_MONTHS',
      evidenceReferences: ['ops://tax/fact/1'],
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      effectiveTo: null,
      reviewedAt: '2026-08-01T00:00:00.000Z',
      reviewDueAt: '2027-08-01T00:00:00.000Z',
    }
    expect(resolveRegistrationDecision({
      control: control(),
      registrationRuleType: 'THRESHOLD',
      thresholdAmountMinor: 100_000,
      thresholdCurrency: 'GHS',
      fact,
      at: '2026-08-16T00:00:00.000Z',
    })).toEqual({ status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' })
    expect(resolveRegistrationDecision({
      control: control(),
      registrationRuleType: 'THRESHOLD',
      thresholdAmountMinor: 100_000,
      thresholdCurrency: 'GHS',
      fact: { ...fact, decision: 'REGISTERED' },
      at: '2026-08-16T00:00:00.000Z',
    })).toEqual({ status: 'RESOLVED', decision: 'REGISTERED', factId: fact.factId })
  })

  it('requires one reviewed classification for every priced line', () => {
    expect(validateTaxLineClassifications({
      requiredLineKeys: ['TAILORING', 'FULFILLMENT'],
      lines: [
        { lineKey: 'TAILORING', lineClass: 'STANDARD', taxable: true, calculationStrategy: 'STANDARD_RATE' },
        { lineKey: 'FULFILLMENT', lineClass: 'EXEMPT', taxable: false, calculationStrategy: 'EXEMPT' },
      ],
    })).toHaveLength(2)
    expect(validateTaxLineClassifications({
      requiredLineKeys: ['TAILORING', 'FULFILLMENT'],
      lines: [{ lineKey: 'TAILORING', lineClass: 'STANDARD', taxable: true, calculationStrategy: 'STANDARD_RATE' }],
    })).toBeNull()
  })

  it('uses party-safe corridor copy without presenting import charges as zero', () => {
    expect(taxCollectionPromise({
      collectionMode: 'PAYABLE_ON_IMPORT',
      responsibleParty: 'CUSTOMER_IMPORTER',
      destinationCountryCode: 'GB',
    })).toEqual({
      title: 'Import charges are not included',
      body: 'The customer/importer may need to pay customs, import tax, duty, or carrier charges in GB.',
    })
  })

  it('calculates reviewed checkout import tax and duty with integer minor units', () => {
    expect(calculateReviewedInternationalCharges({
      subtotalAmount: 100_000,
      shippingAmount: 10_000,
      rule: {
        collectionMode: 'COLLECTED_AT_CHECKOUT',
        dutyRateBps: 500,
        dutyBase: 'SUBTOTAL_AND_SHIPPING',
        importTaxRateBps: 1_500,
        importTaxBase: 'SUBTOTAL_SHIPPING_AND_DUTY',
      },
    })).toEqual({ dutyAmount: 5_500, importTaxAmount: 17_325 })
  })

  it('never invents import charges for payable-on-import or blocked corridors', () => {
    expect(calculateReviewedInternationalCharges({
      subtotalAmount: 100_000,
      shippingAmount: 10_000,
      rule: {
        collectionMode: 'PAYABLE_ON_IMPORT',
        dutyRateBps: null,
        dutyBase: null,
        importTaxRateBps: null,
        importTaxBase: null,
      },
    })).toEqual({ dutyAmount: 0, importTaxAmount: 0 })
    expect(() => calculateReviewedInternationalCharges({
      subtotalAmount: 100_000,
      shippingAmount: 10_000,
      rule: {
        collectionMode: 'BLOCKED',
        dutyRateBps: null,
        dutyBase: null,
        importTaxRateBps: null,
        importTaxBase: null,
      },
    })).toThrow(/blocked/u)
  })
})
