import {
  getOnboardingProofItemIssues,
  isOnboardingProofItemComplete,
} from '../src/onboarding-proof-item'

const COMPLETE_PROOF_ITEM = {
  title: 'Crochet two-piece set',
  category: 'Two-piece Set',
  description: 'A ready-made crochet set in stock for customer review.',
  mediaCount: 1,
  sizes: ['M'],
  inventoryQuantity: 1,
}

describe('onboarding proof item validation', () => {
  it('accepts a lightweight inspectable ready-made item without live-listing fields', () => {
    expect(getOnboardingProofItemIssues(COMPLETE_PROOF_ITEM)).toEqual([])
    expect(isOnboardingProofItemComplete(COMPLETE_PROOF_ITEM)).toBe(true)
  })

  it('requires only proof basics for setup review', () => {
    const issues = getOnboardingProofItemIssues({
      title: '',
      category: '',
      description: '',
      mediaCount: 0,
      sizes: [],
      inventoryQuantity: 0,
    })

    expect(issues.map((issue) => issue.code)).toEqual([
      'TITLE_REQUIRED',
      'CATEGORY_REQUIRED',
      'DESCRIPTION_REQUIRED',
      'MEDIA_REQUIRED',
      'SIZE_REQUIRED',
      'STOCK_REQUIRED',
    ])
  })

  it('does not require pricing during setup proof capture', () => {
    const issues = getOnboardingProofItemIssues({
      ...COMPLETE_PROOF_ITEM,
      priceAmount: null,
    })

    expect(issues).toEqual([])
  })

  it('does not require fit guide, fulfillment, pickup address, or publish readiness', () => {
    const issues = getOnboardingProofItemIssues({
      ...COMPLETE_PROOF_ITEM,
      fitGuideReady: false,
      fulfillmentSelected: false,
      pickupAddressReady: false,
      canPublishLive: false,
    })

    expect(issues).toEqual([])
  })
})
