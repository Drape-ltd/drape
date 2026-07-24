import {
  currencySymbol,
  detectCurrencyPreference,
  extractRegionCodeFromLocale,
  hasSellerPayoutCurrencyMismatch,
  parseMajorCurrencyAmountToMinor,
  resolvePaymentProviderForCurrency,
  resolveSellerPayoutCurrency,
  resolveSellerOrderCurrency,
} from '../src/currency-config'

describe('parseMajorCurrencyAmountToMinor', () => {
  it('converts customer-entered major amounts into stored minor units', () => {
    expect(parseMajorCurrencyAmountToMinor('120')).toBe(12000)
    expect(parseMajorCurrencyAmountToMinor('75,000')).toBe(7500000)
    expect(parseMajorCurrencyAmountToMinor('12.34')).toBe(1234)
  })

  it('rejects missing, non-positive, and over-precision amounts', () => {
    expect(parseMajorCurrencyAmountToMinor(null)).toBeNull()
    expect(parseMajorCurrencyAmountToMinor('0')).toBeNull()
    expect(parseMajorCurrencyAmountToMinor('12.345')).toBeNull()
  })
})

describe('extractRegionCodeFromLocale', () => {
  it('reads dash-delimited locales', () => {
    expect(extractRegionCodeFromLocale('en-CA')).toBe('CA')
    expect(extractRegionCodeFromLocale('en-NG')).toBe('NG')
  })

  it('reads underscore-delimited locales', () => {
    expect(extractRegionCodeFromLocale('fr_CA')).toBe('CA')
  })
})

describe('detectCurrencyPreference', () => {
  it('maps Canadian locale to CAD', () => {
    expect(detectCurrencyPreference({ locale: 'en-CA' })).toEqual({
      currency: 'CAD',
      source: 'DEVICE_LOCALE',
      regionCode: 'CA',
      usedFallback: false,
    })
  })

  it('maps Nigerian locale to NGN', () => {
    expect(detectCurrencyPreference({ locale: 'en-NG' }).currency).toBe('NGN')
  })

  it('prefers IP geolocation when available', () => {
    expect(detectCurrencyPreference({ locale: 'en-US', ipCountryCode: 'GH' })).toEqual({
      currency: 'GHS',
      source: 'IP_GEO',
      regionCode: 'GH',
      usedFallback: false,
    })
  })

  it('falls back to USD for unsupported regions', () => {
    expect(detectCurrencyPreference({ locale: 'en-ZA' })).toEqual({
      currency: 'USD',
      source: 'UNSUPPORTED_FALLBACK',
      regionCode: 'ZA',
      usedFallback: true,
    })
  })
})

describe('resolvePaymentProviderForCurrency', () => {
  it('routes every supported currency explicitly', () => {
    expect(resolvePaymentProviderForCurrency('NGN')).toBe('PAYSTACK')
    expect(resolvePaymentProviderForCurrency('GHS')).toBe('PAYSTACK')
    expect(resolvePaymentProviderForCurrency('KES')).toBe('PAYSTACK')
    expect(resolvePaymentProviderForCurrency('USD')).toBe('STRIPE')
    expect(resolvePaymentProviderForCurrency('GBP')).toBe('STRIPE')
    expect(resolvePaymentProviderForCurrency('EUR')).toBe('STRIPE')
    expect(resolvePaymentProviderForCurrency('CAD')).toBe('STRIPE')
  })
})

describe('resolveSellerPayoutCurrency', () => {
  it('infers NGN when Paystack is configured but payout currency is missing', () => {
    expect(resolveSellerPayoutCurrency({
      payoutProvider: 'PAYSTACK',
      fallbackCurrency: 'USD',
    })).toBe('NGN')
    expect(resolveSellerPayoutCurrency({
      hasPaystackRecipient: true,
      fallbackCurrency: 'USD',
    })).toBe('NGN')
  })

  it('uses the verified payout route over an incompatible legacy payout currency', () => {
    expect(resolveSellerPayoutCurrency({
      payoutCurrency: 'USD',
      payoutProvider: 'PAYSTACK',
      hasPaystackRecipient: true,
      fallbackCurrency: 'USD',
    })).toBe('NGN')
    expect(resolveSellerPayoutCurrency({
      payoutCurrency: 'NGN',
      payoutProvider: 'STRIPE',
      hasStripeConnectAccount: true,
      fallbackCurrency: 'GBP',
    })).toBe('GBP')
  })

  it('keeps Stripe fallback inside Stripe-supported currencies', () => {
    expect(resolveSellerPayoutCurrency({
      payoutProvider: 'STRIPE',
      fallbackCurrency: 'GBP',
    })).toBe('GBP')
    expect(resolveSellerPayoutCurrency({
      payoutProvider: 'STRIPE',
      fallbackCurrency: 'NGN',
    })).toBe('USD')
  })
})

describe('resolveSellerOrderCurrency', () => {
  it('prefers item currency for ready-made checkout', () => {
    expect(resolveSellerOrderCurrency({
      itemCurrency: 'NGN',
      payoutCurrency: 'NGN',
      customerCurrency: 'USD',
    })).toBe('NGN')
  })

  it('prefers payout currency for custom orders without an item currency', () => {
    expect(resolveSellerOrderCurrency({
      tailorCurrency: 'USD',
      payoutCurrency: 'NGN',
      customerCurrency: 'USD',
    })).toBe('NGN')
  })

  it('uses Paystack payout routing before customer currency for custom orders', () => {
    expect(resolveSellerOrderCurrency({
      tailorCurrency: 'USD',
      payoutProvider: 'PAYSTACK',
      customerCurrency: 'USD',
    })).toBe('NGN')
  })

  it('does not let stale USD payout currency override a Paystack destination', () => {
    expect(resolveSellerOrderCurrency({
      tailorCurrency: 'USD',
      payoutCurrency: 'USD',
      payoutAccountType: 'PAYSTACK',
      hasPaystackRecipient: true,
      customerCurrency: 'USD',
    })).toBe('NGN')
  })

  it('falls back to customer currency only when the seller has no commerce currency', () => {
    expect(resolveSellerOrderCurrency({ customerCurrency: 'CAD' })).toBe('CAD')
  })
})

describe('hasSellerPayoutCurrencyMismatch', () => {
  it('blocks ready-made item currency that does not match payout currency', () => {
    expect(hasSellerPayoutCurrencyMismatch({
      itemCurrency: 'USD',
      payoutCurrency: 'NGN',
    })).toBe(true)
  })

  it('blocks item currency mismatch when payout currency must be inferred from Paystack', () => {
    expect(hasSellerPayoutCurrencyMismatch({
      itemCurrency: 'USD',
      payoutProvider: 'PAYSTACK',
      fallbackCurrency: 'USD',
    })).toBe(true)
  })

  it('allows matching item and payout currencies', () => {
    expect(hasSellerPayoutCurrencyMismatch({
      itemCurrency: 'NGN',
      payoutCurrency: 'NGN',
    })).toBe(false)
  })
})

describe('currencySymbol', () => {
  it('uses CA$ for CAD', () => {
    expect(currencySymbol('CAD')).toBe('CA$')
  })
})
