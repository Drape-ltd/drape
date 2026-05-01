export const SUPPORTED_ACCOUNT_CURRENCIES = ['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'] as const
export type AccountCurrencyCode = (typeof SUPPORTED_ACCOUNT_CURRENCIES)[number]

export const PAYSTACK_ACCOUNT_CURRENCIES = ['NGN', 'GHS', 'KES'] as const
export const STRIPE_ACCOUNT_CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD'] as const

export type PaymentRoutingProvider = 'PAYSTACK' | 'STRIPE'
export type CurrencySource = 'DEVICE_LOCALE' | 'IP_GEO' | 'USER_SELECTED' | 'UNSUPPORTED_FALLBACK'

export const DEFAULT_ACCOUNT_CURRENCY: AccountCurrencyCode = 'USD'
export const UNKNOWN_REGION_CODE = 'ZZ'

const EURO_REGION_CODES = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
])

const DIRECT_REGION_CURRENCY_MAP: Record<string, AccountCurrencyCode> = {
  NG: 'NGN',
  GH: 'GHS',
  KE: 'KES',
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
}

export function isSupportedAccountCurrency(value: string | null | undefined): value is AccountCurrencyCode {
  return typeof value === 'string' && (SUPPORTED_ACCOUNT_CURRENCIES as readonly string[]).includes(value.trim().toUpperCase())
}

export function normalizeAccountCurrency(value: string | null | undefined): AccountCurrencyCode | null {
  if (!isSupportedAccountCurrency(value)) return null
  return value.trim().toUpperCase() as AccountCurrencyCode
}

export function currencySymbol(currency: AccountCurrencyCode) {
  switch (currency) {
    case 'NGN':
      return '₦'
    case 'GHS':
      return 'GH₵'
    case 'KES':
      return 'KSh'
    case 'USD':
      return '$'
    case 'GBP':
      return '£'
    case 'EUR':
      return '€'
    case 'CAD':
      return 'CA$'
  }
}

export function currencyDisplayLabel(currency: AccountCurrencyCode) {
  switch (currency) {
    case 'NGN':
      return 'Nigerian Naira'
    case 'GHS':
      return 'Ghanaian Cedi'
    case 'KES':
      return 'Kenyan Shilling'
    case 'USD':
      return 'US Dollar'
    case 'GBP':
      return 'British Pound'
    case 'EUR':
      return 'Euro'
    case 'CAD':
      return 'Canadian Dollar'
  }
}

export function resolvePaymentProviderForCurrency(currency: AccountCurrencyCode): PaymentRoutingProvider {
  switch (currency) {
    case 'NGN':
    case 'GHS':
    case 'KES':
      return 'PAYSTACK'
    case 'USD':
    case 'GBP':
    case 'EUR':
    case 'CAD':
      return 'STRIPE'
  }
}

export function extractRegionCodeFromLocale(locale: string | null | undefined): string | null {
  if (typeof locale !== 'string' || locale.trim().length === 0) return null
  const normalized = locale.trim().replace('_', '-')
  const parts = normalized.split('-')
  const regionCandidate = parts[1] ?? ''
  if (!/^[A-Za-z]{2}$/.test(regionCandidate)) return null
  return regionCandidate.toUpperCase()
}

export function currencyForRegionCode(regionCode: string | null | undefined): AccountCurrencyCode | null {
  if (typeof regionCode !== 'string' || regionCode.trim().length !== 2) return null
  const normalized = regionCode.trim().toUpperCase()
  const directCurrency = DIRECT_REGION_CURRENCY_MAP[normalized as keyof typeof DIRECT_REGION_CURRENCY_MAP] ?? null
  if (directCurrency) {
    return directCurrency
  }
  if (EURO_REGION_CODES.has(normalized)) {
    return 'EUR'
  }
  return null
}

export function detectCurrencyPreference(input: {
  locale?: string | null
  ipCountryCode?: string | null
}): {
  currency: AccountCurrencyCode
  source: CurrencySource
  regionCode: string
  usedFallback: boolean
} {
  const ipRegion = typeof input.ipCountryCode === 'string' ? input.ipCountryCode.trim().toUpperCase() : null
  const localeRegion = extractRegionCodeFromLocale(input.locale)

  if (ipRegion) {
    const ipCurrency = currencyForRegionCode(ipRegion)
    if (ipCurrency) {
      return {
        currency: ipCurrency,
        source: 'IP_GEO',
        regionCode: ipRegion,
        usedFallback: false,
      }
    }
  }

  if (localeRegion) {
    const localeCurrency = currencyForRegionCode(localeRegion)
    if (localeCurrency) {
      return {
        currency: localeCurrency,
        source: 'DEVICE_LOCALE',
        regionCode: localeRegion,
        usedFallback: false,
      }
    }
  }

  return {
    currency: DEFAULT_ACCOUNT_CURRENCY,
    source: 'UNSUPPORTED_FALLBACK',
    regionCode: ipRegion ?? localeRegion ?? UNKNOWN_REGION_CODE,
    usedFallback: true,
  }
}
