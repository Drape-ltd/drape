import {
  composeInternationalPhoneNumber,
  getNationalPhoneInput,
  getPhoneCountryOption,
  inferPhoneCountryCode,
  PHONE_COUNTRIES,
  searchPhoneCountries,
} from '../src/phone-countries'

describe('PHONE_COUNTRIES', () => {
  it('covers the complete libphonenumber country set once', () => {
    expect(PHONE_COUNTRIES.length).toBeGreaterThanOrEqual(240)
    expect(new Set(PHONE_COUNTRIES.map((country) => country.code)).size).toBe(
      PHONE_COUNTRIES.length,
    )
  })

  it('uses canonical calling codes for core markets and NANP countries', () => {
    expect(getPhoneCountryOption('NG').callingCode).toBe('+234')
    expect(getPhoneCountryOption('GB').callingCode).toBe('+44')
    expect(getPhoneCountryOption('US').callingCode).toBe('+1')
    expect(getPhoneCountryOption('AG').callingCode).toBe('+1')
  })
})

describe('country phone helpers', () => {
  it('composes Nigerian local numbers as E.164', () => {
    expect(composeInternationalPhoneNumber('080 1234 5678', 'NG')).toBe(
      '+2348012345678',
    )
  })

  it('composes US local numbers as E.164', () => {
    expect(composeInternationalPhoneNumber('(415) 555-0123', 'US')).toBe(
      '+14155550123',
    )
  })

  it('preserves meaningful Italian leading zeroes', () => {
    expect(composeInternationalPhoneNumber('02 1234 5678', 'IT')).toBe(
      '+390212345678',
    )
  })

  it('infers the country and extracts the national number from stored E.164', () => {
    expect(inferPhoneCountryCode('+44 20 7946 0018')).toBe('GB')
    expect(getNationalPhoneInput('+442079460018', 'GB')).toBe('2079460018')
  })

  it('keeps the editable selection when a shared calling code is ambiguous', () => {
    expect(inferPhoneCountryCode('+1', 'CA')).toBe('CA')
  })

  it('searches by country name, ISO code, native name, and calling code', () => {
    expect(searchPhoneCountries('Nigeria')[0]?.code).toBe('NG')
    expect(searchPhoneCountries('+233')[0]?.code).toBe('GH')
    expect(searchPhoneCountries('Deutschland')[0]?.code).toBe('DE')
  })
})
