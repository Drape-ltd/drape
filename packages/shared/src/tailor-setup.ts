import type { AccountCurrencyCode } from './currency-config.ts'

export const TAILOR_SETUP_VALIDATION = {
  ID_DOCUMENT_REQUIRED_MESSAGE: 'Please upload a valid ID document to continue',
  DISPLAY_NAME_REQUIRED_MESSAGE: 'Add your public display name to continue',
  PHONE_REQUIRED_MESSAGE: 'Add a valid phone number for order updates and account recovery',
  LOCATION_REQUIRED_MESSAGE: 'Add your location to continue',
  BIO_REQUIRED_MESSAGE: 'Add at least 80 characters about your work to continue',
  LANGUAGE_REQUIRED_MESSAGE: 'Choose at least one language to continue',
  LANGUAGE_LIMIT_MESSAGE: 'Choose up to 12 languages',
  SPECIALTY_REQUIRED_MESSAGE: 'Choose at least one specialty to continue',
  SPECIALTY_LIMIT_MESSAGE: 'Choose up to 20 specialties',
  PRICE_REQUIRED_MESSAGE: 'Set a valid price range to continue',
  PORTFOLIO_REQUIRED_MESSAGE: 'Add at least 1 photo or video of your work to continue',
  ORDER_MODE_REQUIRED_MESSAGE: 'Choose at least one way customers can order from you',
  FULFILLMENT_REQUIRED_MESSAGE: 'Choose at least one way customers receive orders',
  PICKUP_ADDRESS_REQUIRED_MESSAGE: 'Add a fuller pickup address before offering pickup',
} as const

export const TAILOR_PRICE_LIMITS_MAJOR: Record<AccountCurrencyCode, number> = {
  NGN: 9_999_999,
  GHS: 1_000_000,
  KES: 5_000_000,
  USD: 100_000,
  GBP: 100_000,
  EUR: 100_000,
  CAD: 100_000,
} as const

export const TAILOR_PRICE_MINIMUMS_MAJOR: Record<AccountCurrencyCode, number> = {
  NGN: 5_000,
  GHS: 50,
  KES: 500,
  USD: 10,
  GBP: 10,
  EUR: 10,
  CAD: 10,
} as const

const ID_DOCUMENT_STORAGE_PATH_PATTERN =
  /^id-verification\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+\.(?:jpe?g|png|webp)$/iu

function normalizeTailorSetupCurrency(value: string | null | undefined): AccountCurrencyCode {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (normalized in TAILOR_PRICE_LIMITS_MAJOR) return normalized as AccountCurrencyCode
  return 'USD'
}

export function getTailorPriceMaxMajor(currency: string | null | undefined): number {
  return TAILOR_PRICE_LIMITS_MAJOR[normalizeTailorSetupCurrency(currency)]
}

export function getTailorPriceMinMajor(currency: string | null | undefined): number {
  return TAILOR_PRICE_MINIMUMS_MAJOR[normalizeTailorSetupCurrency(currency)]
}

export function getTailorPriceLimitMessage(currency: string | null | undefined): string {
  const normalized = normalizeTailorSetupCurrency(currency)
  const max = getTailorPriceMaxMajor(normalized).toLocaleString('en')
  return `Set a valid ${normalized} price range up to ${max}.`
}

export function getTailorPriceMinimumMessage(currency: string | null | undefined): string {
  const normalized = normalizeTailorSetupCurrency(currency)
  const min = getTailorPriceMinMajor(normalized).toLocaleString('en')
  return `Set a realistic ${normalized} starting price of at least ${min}.`
}

export function validateTailorSetupIdDocumentUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE

  if (ID_DOCUMENT_STORAGE_PATH_PATTERN.test(trimmed)) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE
    }
    return null
  } catch {
    return TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE
  }
}

export type TailorSetupStep = 0 | 1 | 2 | 3

export type TailorSetupField =
  | 'displayName'
  | 'phone'
  | 'location'
  | 'bio'
  | 'languages'
  | 'specialties'
  | 'priceRange'
  | 'portfolio'
  | 'orderMode'
  | 'fulfillment'
  | 'pickupAddress'
  | 'idDocument'

export type TailorSetupFieldErrors = Partial<Record<TailorSetupField, string>>

export type TailorSetupProgressInput = {
  displayName: string
  nameError?: string | null
  phone: string
  phoneError?: string | null
  location: string
  bio: string
  bioError?: string | null
  bioLooksInvalid?: boolean
  languages: string[]
  specialties: string[]
  priceMin: string
  priceMax: string
  currency?: AccountCurrencyCode | string | null
  portfolioItemCount: number
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  pickupAddress: string
  idDocumentPresent: boolean
}

export type TailorSetupProgress = {
  firstIncompleteStep: TailorSetupStep
  fieldErrors: TailorSetupFieldErrors
  stepErrors: Record<TailorSetupStep, TailorSetupFieldErrors>
  stepValid: Record<TailorSetupStep, boolean>
}

export function parseTailorPriceMajor(value: string) {
  const compact = value
    .trim()
    .toLowerCase()
    .replace(/[₦$£€₵]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')

  if (!compact) return Number.NaN

  const shorthand = compact.match(/^(\d+(?:\.\d+)?)(m|mil|million|k|thousand)$/)
  if (shorthand) {
    const amountText = shorthand[1]
    const suffix = shorthand[2]
    if (!amountText || !suffix) return Number.NaN
    const amount = Number.parseFloat(amountText)
    if (!Number.isFinite(amount)) return Number.NaN
    return suffix === 'k' || suffix === 'thousand'
      ? amount * 1_000
      : amount * 1_000_000
  }

  if (!/^\d+(?:\.\d+)?$/.test(compact)) return Number.NaN
  return Number.parseFloat(compact)
}

function pushError(errors: TailorSetupFieldErrors, field: TailorSetupField, message: string) {
  if (!errors[field]) errors[field] = message
}

export function deriveTailorSetupProgress(input: TailorSetupProgressInput): TailorSetupProgress {
  const stepErrors: Record<TailorSetupStep, TailorSetupFieldErrors> = {
    0: {},
    1: {},
    2: {},
    3: {},
  }

  const displayNameError = input.nameError?.trim()
  if (!input.displayName.trim()) {
    pushError(stepErrors[0], 'displayName', TAILOR_SETUP_VALIDATION.DISPLAY_NAME_REQUIRED_MESSAGE)
  } else if (displayNameError) {
    pushError(stepErrors[0], 'displayName', displayNameError)
  }

  const phoneError = input.phoneError?.trim()
  if (!input.phone.trim()) {
    pushError(stepErrors[0], 'phone', TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE)
  } else if (phoneError) {
    pushError(stepErrors[0], 'phone', phoneError)
  }

  if (!input.location.trim()) {
    pushError(stepErrors[0], 'location', TAILOR_SETUP_VALIDATION.LOCATION_REQUIRED_MESSAGE)
  }

  const bioError = input.bioError?.trim()
  if (bioError) {
    pushError(stepErrors[0], 'bio', bioError)
  } else if (input.bio.trim().length < 80 || input.bioLooksInvalid) {
    pushError(stepErrors[0], 'bio', TAILOR_SETUP_VALIDATION.BIO_REQUIRED_MESSAGE)
  }

  if (input.languages.length < 1) {
    pushError(stepErrors[0], 'languages', TAILOR_SETUP_VALIDATION.LANGUAGE_REQUIRED_MESSAGE)
  } else if (input.languages.length > 12) {
    pushError(stepErrors[0], 'languages', TAILOR_SETUP_VALIDATION.LANGUAGE_LIMIT_MESSAGE)
  }

  if (input.specialties.length < 1) {
    pushError(stepErrors[1], 'specialties', TAILOR_SETUP_VALIDATION.SPECIALTY_REQUIRED_MESSAGE)
  } else if (input.specialties.length > 20) {
    pushError(stepErrors[1], 'specialties', TAILOR_SETUP_VALIDATION.SPECIALTY_LIMIT_MESSAGE)
  }

  const min = parseTailorPriceMajor(input.priceMin)
  const max = parseTailorPriceMajor(input.priceMax)
  if (!input.priceMin.trim() || !input.priceMax.trim() || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    pushError(stepErrors[1], 'priceRange', TAILOR_SETUP_VALIDATION.PRICE_REQUIRED_MESSAGE)
  } else if (min < getTailorPriceMinMajor(input.currency)) {
    pushError(stepErrors[1], 'priceRange', getTailorPriceMinimumMessage(input.currency))
  } else if (max > getTailorPriceMaxMajor(input.currency)) {
    pushError(stepErrors[1], 'priceRange', getTailorPriceLimitMessage(input.currency))
  }

  if (input.portfolioItemCount < 1) {
    pushError(stepErrors[2], 'portfolio', TAILOR_SETUP_VALIDATION.PORTFOLIO_REQUIRED_MESSAGE)
  }

  if (!(input.supportsCustomOrders || input.supportsReadyMade)) {
    pushError(stepErrors[3], 'orderMode', TAILOR_SETUP_VALIDATION.ORDER_MODE_REQUIRED_MESSAGE)
  }

  if (!(input.pickupAvailable || input.deliveryAvailable || input.shippingAvailable)) {
    pushError(stepErrors[3], 'fulfillment', TAILOR_SETUP_VALIDATION.FULFILLMENT_REQUIRED_MESSAGE)
  }

  if (input.pickupAvailable && input.pickupAddress.trim().length < 8) {
    pushError(stepErrors[3], 'pickupAddress', TAILOR_SETUP_VALIDATION.PICKUP_ADDRESS_REQUIRED_MESSAGE)
  }

  if (!input.idDocumentPresent) {
    pushError(stepErrors[3], 'idDocument', TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
  }

  const stepValid: Record<TailorSetupStep, boolean> = {
    0: Object.keys(stepErrors[0]).length === 0,
    1: Object.keys(stepErrors[1]).length === 0,
    2: Object.keys(stepErrors[2]).length === 0,
    3: Object.keys(stepErrors[3]).length === 0,
  }

  const firstIncompleteStep = ([0, 1, 2, 3] as TailorSetupStep[]).find((step) => !stepValid[step]) ?? 3

  return {
    firstIncompleteStep,
    fieldErrors: {
      ...stepErrors[0],
      ...stepErrors[1],
      ...stepErrors[2],
      ...stepErrors[3],
    },
    stepErrors,
    stepValid,
  }
}
