import {
  deriveTailorSetupProgress,
  parseTailorPriceMajor,
  TAILOR_SETUP_VALIDATION,
  validateTailorSetupIdDocumentUrl,
  type TailorSetupProgressInput,
} from '../src/tailor-setup'

const COMPLETE_SETUP: TailorSetupProgressInput = {
  displayName: 'Amara Atelier',
  phone: '+2348012345678',
  profilePhotoPresent: true,
  location: 'Lagos, Nigeria',
  bio: 'I make custom native wear and occasion outfits with clean finishing, reliable delivery, and careful measurement review.',
  languages: ['English'],
  specialties: ['Ankara'],
  priceMin: '50000',
  priceMax: '200000',
  currency: 'NGN',
  portfolioItemCount: 1,
  supportsCustomOrders: true,
  supportsReadyMade: false,
  pickupAvailable: true,
  deliveryAvailable: false,
  shippingAvailable: false,
  pickupAddress: '12 Marina Road, Lagos, Nigeria',
  idDocumentPresent: true,
}

describe('validateTailorSetupIdDocumentUrl', () => {
  it('requires an uploaded ID document before setup can submit', () => {
    expect(validateTailorSetupIdDocumentUrl(null)).toBe(
      TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE,
    )
    expect(validateTailorSetupIdDocumentUrl('')).toBe(
      TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE,
    )
  })

  it('rejects invalid ID document URLs with the customer-facing setup message', () => {
    expect(validateTailorSetupIdDocumentUrl('not-a-url')).toBe(
      TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE,
    )
    expect(validateTailorSetupIdDocumentUrl('file:///tmp/id.jpg')).toBe(
      TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE,
    )
  })

  it('accepts a stored ID document URL', () => {
    expect(validateTailorSetupIdDocumentUrl('https://storage.example/id.jpg')).toBeNull()
  })

  it('accepts a private ID document storage path', () => {
    expect(
      validateTailorSetupIdDocumentUrl(
        'id-verification/99cea1b0-2b94-4aa7-a574-863ac10e80ac/1778301866356.jpg',
      ),
    ).toBeNull()
  })
})

describe('deriveTailorSetupProgress', () => {
  it('parses real-world tailor price input formats consistently', () => {
    expect(parseTailorPriceMajor('2,000,000')).toBe(2_000_000)
    expect(parseTailorPriceMajor('₦2 million')).toBe(2_000_000)
    expect(parseTailorPriceMajor('2.5m')).toBe(2_500_000)
    expect(parseTailorPriceMajor('750k')).toBe(750_000)
    expect(Number.isNaN(parseTailorPriceMajor('two million'))).toBe(true)
  })

  it('blocks unrealistic public price ranges before they reach customer profiles', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      currency: 'NGN',
      priceMin: '300',
      priceMax: '800',
    })

    expect(progress.fieldErrors.priceRange).toBe('Set a realistic NGN starting price of at least 5,000.')
  })

  it('allows high real-world NGN price ranges used by premium tailors', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      currency: 'NGN',
      priceMin: '750k',
      priceMax: '2 million',
    })

    expect(progress.fieldErrors.priceRange).toBeUndefined()
  })

  it('resumes at identity when public profile basics are incomplete', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      displayName: '',
    })

    expect(progress.firstIncompleteStep).toBe(0)
    expect(progress.fieldErrors.displayName).toBe(
      TAILOR_SETUP_VALIDATION.DISPLAY_NAME_REQUIRED_MESSAGE,
    )
  })

  it('resumes at identity when tailor phone is missing', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      phone: '',
    })

    expect(progress.firstIncompleteStep).toBe(0)
    expect(progress.fieldErrors.phone).toBe(
      TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE,
    )
  })

  it('resumes at identity when profile photo is missing', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      profilePhotoPresent: false,
    })

    expect(progress.firstIncompleteStep).toBe(0)
    expect(progress.fieldErrors.profilePhoto).toBe(
      TAILOR_SETUP_VALIDATION.PROFILE_PHOTO_REQUIRED_MESSAGE,
    )
  })

  it('resumes at pricing and specialties when step 0 is complete but step 1 is incomplete', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      specialties: [],
      priceMax: '20',
    })

    expect(progress.firstIncompleteStep).toBe(1)
    expect(progress.fieldErrors.specialties).toBe(
      TAILOR_SETUP_VALIDATION.SPECIALTY_REQUIRED_MESSAGE,
    )
    expect(progress.fieldErrors.priceRange).toBe(
      TAILOR_SETUP_VALIDATION.PRICE_REQUIRED_MESSAGE,
    )
  })

  it('allows realistic high NGN tailor prices', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      priceMin: '50000',
      priceMax: '2000000',
      currency: 'NGN',
    })

    expect(progress.fieldErrors.priceRange).toBeUndefined()
  })

  it('keeps hard caps currency-aware', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      priceMin: '100000',
      priceMax: '200000',
      currency: 'USD',
    })

    expect(progress.fieldErrors.priceRange).toBe('Set a valid USD price range up to 100,000.')
  })

  it('requires tailor shops to show both portfolio work and a ready-made item', () => {
    const missingReadyMade = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      sellerType: 'TAILOR_SHOP',
      portfolioItemCount: 1,
      readyMadeItemCount: 0,
    })

    expect(missingReadyMade.firstIncompleteStep).toBe(2)
    expect(missingReadyMade.fieldErrors.portfolio).toBe(
      TAILOR_SETUP_VALIDATION.HYBRID_PROOF_REQUIRED_MESSAGE,
    )

    const missingPortfolio = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      sellerType: 'TAILOR_SHOP',
      portfolioItemCount: 0,
      readyMadeItemCount: 1,
    })

    expect(missingPortfolio.firstIncompleteStep).toBe(2)
    expect(missingPortfolio.fieldErrors.portfolio).toBe(
      TAILOR_SETUP_VALIDATION.HYBRID_PROOF_REQUIRED_MESSAGE,
    )

    const completeHybrid = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      sellerType: 'TAILOR_SHOP',
      portfolioItemCount: 1,
      readyMadeItemCount: 1,
    })

    expect(completeHybrid.fieldErrors.portfolio).toBeUndefined()
  })

  it('resumes at portfolio when the minimum work samples are missing', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      portfolioItemCount: 0,
    })

    expect(progress.firstIncompleteStep).toBe(2)
    expect(progress.fieldErrors.portfolio).toBe(
      TAILOR_SETUP_VALIDATION.PORTFOLIO_REQUIRED_MESSAGE,
    )
  })

  it('resumes at selling setup when ID or fulfillment details are missing', () => {
    const progress = deriveTailorSetupProgress({
      ...COMPLETE_SETUP,
      pickupAddress: '',
      idDocumentPresent: false,
    })

    expect(progress.firstIncompleteStep).toBe(3)
    expect(progress.fieldErrors.pickupAddress).toBe(
      TAILOR_SETUP_VALIDATION.PICKUP_ADDRESS_REQUIRED_MESSAGE,
    )
    expect(progress.fieldErrors.idDocument).toBe(
      TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE,
    )
  })
})
