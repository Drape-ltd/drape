import { getCustomOrderFabricIssues, isCustomOrderFabricBriefComplete } from '../src/custom-order-fabric'

describe('custom order fabric brief policy', () => {
  it('requires budget, currency, references, and substitution preference when the tailor sources fabric', () => {
    const issues = getCustomOrderFabricIssues({
      fabricSource: 'TAILOR_SOURCES',
      fabricDescription: 'Emerald lace with a soft drape',
      fabricBudgetAmount: null,
      fabricBudgetCurrency: null,
      fabricReferenceMediaCount: 0,
      fabricReferenceLinkCount: 0,
      fabricSubstitutionPreference: null,
    })

    expect(issues.map((issue) => issue.code)).toEqual([
      'FABRIC_BUDGET_REQUIRED',
      'FABRIC_BUDGET_CURRENCY_REQUIRED',
      'FABRIC_REFERENCE_REQUIRED',
      'FABRIC_SUBSTITUTION_REQUIRED',
    ])
  })

  it('accepts a complete tailor-sourced fabric plan with an optional vendor suggestion', () => {
    expect(isCustomOrderFabricBriefComplete({
      fabricSource: 'TAILOR_SOURCES',
      fabricDescription: 'Emerald lace with a soft drape and gold thread detail',
      fabricBudgetAmount: 85000,
      fabricBudgetCurrency: 'NGN',
      fabricReferenceMediaCount: 1,
      fabricReferenceLinkCount: 0,
      fabricSubstitutionPreference: 'ASK_BEFORE_SUBSTITUTING',
      suggestedVendorName: 'Balogun Market stall',
      suggestedVendorLocation: 'Lagos Island',
    })).toBe(true)
  })

  it('requires proof media and a handoff plan when the customer supplies fabric', () => {
    const issues = getCustomOrderFabricIssues({
      fabricSource: 'CUSTOMER_SUPPLIES',
      fabricHandoffMode: null,
      fabricReferenceMediaCount: 0,
    })

    expect(issues.map((issue) => issue.code)).toEqual([
      'CUSTOMER_FABRIC_MEDIA_REQUIRED',
      'FABRIC_HANDOFF_REQUIRED',
    ])
  })

  it('requires a bulk fabric mode for group orders', () => {
    const issues = getCustomOrderFabricIssues({
      fabricSource: 'TAILOR_SOURCES',
      fabricDescription: 'One coordinated asoebi fabric direction for the group',
      fabricBudgetAmount: 250000,
      fabricBudgetCurrency: 'NGN',
      fabricReferenceMediaCount: 1,
      fabricReferenceLinkCount: 0,
      fabricSubstitutionPreference: 'SIMILAR_OK',
      isBulkOrder: true,
      bulkRecipientCount: 6,
      bulkFabricMode: null,
    })

    expect(issues.map((issue) => issue.code)).toEqual(['BULK_FABRIC_MODE_REQUIRED'])
  })
})
