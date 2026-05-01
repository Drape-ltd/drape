import {
  currencySymbol,
  detectCurrencyPreference,
  extractRegionCodeFromLocale,
  resolvePaymentProviderForCurrency,
} from '../src/currency-config'

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

describe('currencySymbol', () => {
  it('uses CA$ for CAD', () => {
    expect(currencySymbol('CAD')).toBe('CA$')
  })
})
