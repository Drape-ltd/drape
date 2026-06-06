import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { AccountCurrencyCode, CurrencySource } from '@drape/shared'

export type DrapeRole = 'CUSTOMER' | 'TAILOR'
export type CustomerGarmentContext = 'MENSWEAR' | 'WOMENSWEAR' | 'BOTH' | 'PREFER_NOT_TO_SAY'
export type MeasurementUnit = 'in' | 'cm'
export type TailorFulfillment = 'PICKUP' | 'DELIVERY' | 'SHIPPING'

export type WebOnboardingPayload = {
  source: 'web'
  role: DrapeRole
  displayName: string
  phone: string
  defaultCurrency: AccountCurrencyCode
  currencySource: CurrencySource
  regionCode: string
  customer?: {
    unitPreference: MeasurementUnit
    garmentContext: CustomerGarmentContext
  }
  tailor?: {
    location: string
    languages: string[]
    specialties: string[]
    priceRangeMin: number | null
    priceRangeMax: number | null
    supportsCustomOrders: boolean
    supportsReadyMade: boolean
    fulfillment: TailorFulfillment[]
  }
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
  if (!location || languages.length === 0 || specialties.length === 0 || fulfillment.length === 0) return null

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
      languages,
      specialties,
      priceRangeMin: typeof tailor?.priceRangeMin === 'number' ? tailor.priceRangeMin : null,
      priceRangeMax: typeof tailor?.priceRangeMax === 'number' ? tailor.priceRangeMax : null,
      supportsCustomOrders: tailor?.supportsCustomOrders !== false,
      supportsReadyMade: tailor?.supportsReadyMade === true,
      fulfillment,
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
  const { userId, onboarding } = input
  const now = new Date().toISOString()

  await supabase
    .from('users')
    .update({
      display_name: onboarding.displayName,
      role: onboarding.role,
      phone: onboarding.phone,
      default_currency: onboarding.defaultCurrency,
      currency_source: onboarding.currencySource,
      region_code: onboarding.regionCode,
      currency_confirmed_at: now,
      updated_at: now,
    })
    .eq('id', userId)

  if (onboarding.role === 'CUSTOMER' && onboarding.customer) {
    await supabase.from('customer_profiles').upsert(
      {
        user_id: userId,
        display_name: onboarding.displayName,
        phone: onboarding.phone,
        unit_preference: onboarding.customer.unitPreference,
        garment_context: onboarding.customer.garmentContext,
        measurements: {
          unit: onboarding.customer.unitPreference,
          garmentContext: onboarding.customer.garmentContext,
          fitFlags: [],
        },
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )
  }

  if (onboarding.role === 'TAILOR' && onboarding.tailor) {
    await supabase.from('tailor_profiles').upsert(
      {
        user_id: userId,
        display_name: onboarding.displayName,
        bio: null,
        location: onboarding.tailor.location,
        languages: onboarding.tailor.languages,
        specialty_tags: onboarding.tailor.specialties,
        price_range_min: onboarding.tailor.priceRangeMin,
        price_range_max: onboarding.tailor.priceRangeMax,
        currency: onboarding.defaultCurrency,
        seller_type: 'TAILOR',
        supports_custom_orders: onboarding.tailor.supportsCustomOrders,
        supports_ready_made: onboarding.tailor.supportsReadyMade,
        pickup_available: onboarding.tailor.fulfillment.includes('PICKUP'),
        delivery_available: onboarding.tailor.fulfillment.includes('DELIVERY'),
        shipping_available: onboarding.tailor.fulfillment.includes('SHIPPING'),
        delivery_fee: 0,
        shipping_fee: 0,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )
  }
}
