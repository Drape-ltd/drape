import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { AccountCurrencyCode, CurrencySource } from '@drape/shared'
import type { SignupMediaDraftDescriptor } from './signup-media-draft'

export type DrapeRole = 'CUSTOMER' | 'TAILOR'
export type CustomerGarmentContext = 'MENSWEAR' | 'WOMENSWEAR' | 'BOTH' | 'PREFER_NOT_TO_SAY'
export type MeasurementUnit = 'in' | 'cm'
export type TailorFulfillment = 'PICKUP' | 'DELIVERY' | 'SHIPPING'
export type TailorSellerType = 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
export type TailorAvailability = 'OPEN' | 'LIMITED' | 'FULLY_BOOKED'

export type WebOnboardingPayload = {
  source: 'web'
  role: DrapeRole
  displayName: string
  phone: string
  defaultCurrency: AccountCurrencyCode
  currencySource: CurrencySource
  regionCode: string
  /** Legacy client-only preview. Removed before auth metadata and Edge payloads are written. */
  avatarDataUrl?: string
  /** Client-only image descriptor. Blob bytes remain in IndexedDB until confirmation. */
  avatarDraft?: SignupMediaDraftDescriptor
  /** Legacy client-only setup media. Uploaded after the confirmation link creates a session. */
  portfolioDataUrls?: string[]
  /** Client-only image descriptors. Blob bytes remain in IndexedDB until confirmation. */
  portfolioImageDrafts?: SignupMediaDraftDescriptor[]
  /** Client-only video descriptors. Blob bytes remain in IndexedDB until confirmation. */
  portfolioVideoDrafts?: SignupMediaDraftDescriptor[]
  /** Client-only private trust-video draft and its matching randomized prompt. */
  trustVideoDraft?: SignupMediaDraftDescriptor
  trustChallengeId?: string
  trustChallengeText?: string
  trustConsentGranted?: boolean
  customer?: {
    unitPreference: MeasurementUnit
    garmentContext: CustomerGarmentContext
  }
  tailor?: {
    location: string
    bio?: string
    languages: string[]
    specialties: string[]
    sellerType?: TailorSellerType
    availability?: TailorAvailability
    priceRangeMin: number | null
    priceRangeMax: number | null
    supportsCustomOrders: boolean
    supportsReadyMade: boolean
    fulfillment: TailorFulfillment[]
    pickupAddress?: string
    pickupCity?: string
    pickupRegion?: string
    pickupPostalCode?: string
    pickupCountryCode?: string
    consultationMode?: 'UNAVAILABLE' | 'FREE' | 'PAID'
    consultationRequirement?: 'OPTIONAL' | 'REQUIRED'
    consultationFee?: string
    consultationDuration?: '15' | '30' | '45' | '60'
    consultationCallType?: 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'
    consultationFeeCreditable?: boolean
  }
}

export type PersistedWebOnboardingPayload = Omit<
  WebOnboardingPayload,
  | 'avatarDataUrl'
  | 'avatarDraft'
  | 'portfolioDataUrls'
  | 'portfolioImageDrafts'
  | 'portfolioVideoDrafts'
  | 'trustVideoDraft'
  | 'trustChallengeId'
  | 'trustChallengeText'
  | 'trustConsentGranted'
>

export function persistedWebOnboardingPayload(
  onboarding: WebOnboardingPayload,
): PersistedWebOnboardingPayload {
  const {
    avatarDataUrl: _avatarDataUrl,
    avatarDraft: _avatarDraft,
    portfolioDataUrls: _portfolioDataUrls,
    portfolioImageDrafts: _portfolioImageDrafts,
    portfolioVideoDrafts: _portfolioVideoDrafts,
    trustVideoDraft: _trustVideoDraft,
    trustChallengeId: _trustChallengeId,
    trustChallengeText: _trustChallengeText,
    trustConsentGranted: _trustConsentGranted,
    ...persisted
  } = onboarding
  return persisted
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : []
}

function normalizePayload(value: unknown): WebOnboardingPayload | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<WebOnboardingPayload>
  if (payload.source !== 'web') return null
  if (payload.role !== 'CUSTOMER' && payload.role !== 'TAILOR') return null
  const displayName = asString(payload.displayName)
  const phone = asString(payload.phone)
  const defaultCurrency = payload.defaultCurrency
  const currencySource = payload.currencySource
  const regionCode = asString(payload.regionCode) || 'ZZ'
  if (!displayName || !phone || !defaultCurrency || !currencySource) return null

  if (payload.role === 'CUSTOMER') {
    const customer = payload.customer
    const unitPreference = customer?.unitPreference === 'cm' ? 'cm' : 'in'
    const garmentContext = customer?.garmentContext
    if (
      garmentContext !== 'MENSWEAR' &&
      garmentContext !== 'WOMENSWEAR' &&
      garmentContext !== 'BOTH' &&
      garmentContext !== 'PREFER_NOT_TO_SAY'
    ) {
      return null
    }
    return {
      source: 'web',
      role: payload.role,
      displayName,
      phone,
      defaultCurrency,
      currencySource,
      regionCode,
      customer: { unitPreference, garmentContext },
    }
  }

  const tailor = payload.tailor
  const location = asString(tailor?.location)
  const languages = asStringList(tailor?.languages).slice(0, 12)
  const specialties = asStringList(tailor?.specialties).slice(0, 20)
  const fulfillment = Array.isArray(tailor?.fulfillment)
    ? tailor.fulfillment.filter((entry): entry is TailorFulfillment => entry === 'PICKUP' || entry === 'DELIVERY' || entry === 'SHIPPING')
    : []
  if (!location || languages.length === 0 || fulfillment.length === 0) return null

  return {
    source: 'web',
    role: payload.role,
    displayName,
    phone,
    defaultCurrency,
    currencySource,
    regionCode,
    tailor: {
      location,
      bio: asString(tailor?.bio),
      languages,
      specialties,
      sellerType:
        tailor?.sellerType === 'BOUTIQUE' || tailor?.sellerType === 'TAILOR_SHOP'
          ? tailor.sellerType
          : 'TAILOR',
      availability:
        tailor?.availability === 'LIMITED' || tailor?.availability === 'FULLY_BOOKED'
          ? tailor.availability
          : 'OPEN',
      priceRangeMin: typeof tailor?.priceRangeMin === 'number' ? tailor.priceRangeMin : null,
      priceRangeMax: typeof tailor?.priceRangeMax === 'number' ? tailor.priceRangeMax : null,
      supportsCustomOrders: tailor?.supportsCustomOrders !== false,
      supportsReadyMade: tailor?.supportsReadyMade === true,
      fulfillment,
      pickupAddress: asString(tailor?.pickupAddress),
      pickupCity: asString(tailor?.pickupCity),
      pickupRegion: asString(tailor?.pickupRegion),
      pickupPostalCode: asString(tailor?.pickupPostalCode),
      pickupCountryCode: asString(tailor?.pickupCountryCode),
      consultationMode:
        tailor?.consultationMode === 'UNAVAILABLE' || tailor?.consultationMode === 'PAID'
          ? tailor.consultationMode
          : 'FREE',
      consultationRequirement:
        tailor?.consultationRequirement === 'REQUIRED' ? 'REQUIRED' : 'OPTIONAL',
      consultationFee: asString(tailor?.consultationFee),
      consultationDuration:
        tailor?.consultationDuration === '15' || tailor?.consultationDuration === '45' || tailor?.consultationDuration === '60'
          ? tailor.consultationDuration
          : '30',
      consultationCallType:
        tailor?.consultationCallType === 'AUDIO' || tailor?.consultationCallType === 'AUDIO_OR_VIDEO'
          ? tailor.consultationCallType
          : 'VIDEO',
      consultationFeeCreditable: tailor?.consultationFeeCreditable === true,
    },
  }
}

export function webOnboardingFromUser(user: User | null | undefined) {
  return normalizePayload(user?.user_metadata?.web_onboarding)
}

export async function bootstrapWebOnboarding(
  supabase: SupabaseClient,
  input: {
    userId: string
    onboarding: WebOnboardingPayload
  }
) {
  const { data, error } = await supabase.functions.invoke('account-profile-action', {
    body: {
      action: 'bootstrap-web-onboarding',
      onboarding: persistedWebOnboardingPayload(input.onboarding),
    },
  })

  const payload = (data ?? {}) as { error?: unknown; message?: unknown }
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.error === 'string'
      ? payload.error
      : 'We could not finish your account setup right now. Please try again.'

  if (error || payload.error) {
    throw new Error(message)
  }
}
