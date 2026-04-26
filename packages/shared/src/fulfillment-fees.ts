export type SupportedFulfillmentCurrency = 'USD' | 'GBP' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD'

export type FulfillmentMode = 'PICKUP' | 'DELIVERY' | 'SHIPPING'

type CountryCode = 'NG' | 'US' | 'GH' | 'KE' | 'GB' | 'CA' | null

type BaseFee =
  | { amountMajor: 0; currency: 'USD'; policy: 'PICKUP'; scope: 'PICKUP' }
  | { amountMajor: number; currency: SupportedFulfillmentCurrency; policy: 'FLAT_STANDARD'; scope: 'DOMESTIC_NIGERIA' | 'DOMESTIC_STANDARD' | 'INTERNATIONAL_STANDARD' }

const STATIC_FALLBACK_RATES: Record<SupportedFulfillmentCurrency, number> = {
  USD: 1,
  GBP: 0.79,
  EUR: 0.92,
  NGN: 1580,
  GHS: 15.6,
  KES: 129,
  CAD: 1.36,
}

const COUNTRY_ALIASES: Array<{ code: Exclude<CountryCode, null>; aliases: string[] }> = [
  {
    code: 'NG',
    aliases: ['nigeria', 'lagos', 'abuja', 'lekki', 'ikeja', 'ibadan', 'port harcourt', 'enugu', 'oyo', 'ogun', 'eti osa'],
  },
  {
    code: 'US',
    aliases: ['united states', 'usa', 'us ', ' us', 'new york', 'california', 'texas', 'florida', 'illinois', 'atlanta', 'georgia'],
  },
  {
    code: 'CA',
    aliases: ['canada', 'toronto', 'ontario', 'ottawa', 'vancouver', 'british columbia', 'montreal', 'quebec', 'calgary', 'alberta'],
  },
  { code: 'GH', aliases: ['ghana', 'accra', 'kumasi', 'tema'] },
  { code: 'KE', aliases: ['kenya', 'nairobi', 'mombasa', 'kisumu'] },
  { code: 'GB', aliases: ['united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham'] },
]

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function inferCountryCode(value: string | null | undefined): CountryCode {
  const text = normalizeText(value)
  if (!text) return null

  for (const entry of COUNTRY_ALIASES) {
    if (entry.aliases.some((alias) => text.includes(alias))) {
      return entry.code
    }
  }

  return null
}

function convertMajorAmount(
  amountMajor: number,
  fromCurrency: SupportedFulfillmentCurrency,
  toCurrency: SupportedFulfillmentCurrency,
) {
  if (fromCurrency === toCurrency) return amountMajor

  const fromRate = STATIC_FALLBACK_RATES[fromCurrency] ?? 1
  const toRate = STATIC_FALLBACK_RATES[toCurrency] ?? 1
  const usdAmount = amountMajor / fromRate
  return usdAmount * toRate
}

function resolveBaseFee(
  fulfillment: FulfillmentMode,
  sellerLocation: string | null | undefined,
  destinationCountry: string | null | undefined,
  destinationAddress: string | null | undefined,
): BaseFee {
  if (fulfillment === 'PICKUP') {
    return { amountMajor: 0, currency: 'USD', policy: 'PICKUP', scope: 'PICKUP' }
  }

  const sellerCountry = inferCountryCode(sellerLocation)
  const recipientCountry = inferCountryCode(destinationCountry) ?? inferCountryCode(destinationAddress)
  const sameCountry = sellerCountry != null && recipientCountry != null && sellerCountry === recipientCountry

  if (sameCountry && sellerCountry === 'NG') {
    return {
      amountMajor: 10_000,
      currency: 'NGN',
      policy: 'FLAT_STANDARD',
      scope: 'DOMESTIC_NIGERIA',
    }
  }

  if (sameCountry) {
    return {
      amountMajor: 15,
      currency: 'USD',
      policy: 'FLAT_STANDARD',
      scope: 'DOMESTIC_STANDARD',
    }
  }

  return {
    amountMajor: 30,
    currency: 'USD',
    policy: 'FLAT_STANDARD',
    scope: 'INTERNATIONAL_STANDARD',
  }
}

export function resolveDrapeManagedFulfillmentFee(input: {
  fulfillment: FulfillmentMode
  orderCurrency: SupportedFulfillmentCurrency
  sellerLocation?: string | null
  destinationCountry?: string | null
  destinationAddress?: string | null
}) {
  const baseFee = resolveBaseFee(
    input.fulfillment,
    input.sellerLocation,
    input.destinationCountry,
    input.destinationAddress,
  )

  if (baseFee.amountMajor <= 0) {
    return {
      feeMinorUnits: 0,
      feeMajorUnits: 0,
      baseCurrency: baseFee.currency,
      baseAmountMajor: baseFee.amountMajor,
      scope: baseFee.scope,
      policy: baseFee.policy,
    }
  }

  const convertedMajor = convertMajorAmount(baseFee.amountMajor, baseFee.currency, input.orderCurrency)
  const feeMinorUnits = Math.max(0, Math.round(convertedMajor * 100))

  return {
    feeMinorUnits,
    feeMajorUnits: feeMinorUnits / 100,
    baseCurrency: baseFee.currency,
    baseAmountMajor: baseFee.amountMajor,
    scope: baseFee.scope,
    policy: baseFee.policy,
  }
}
