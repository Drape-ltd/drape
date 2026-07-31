import { countries, type TCountryCode } from 'countries-list'
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'
export type PhoneCountryCode = CountryCode

export type PhoneCountryOption = {
  code: PhoneCountryCode
  name: string
  nativeName: string
  callingCode: `+${string}`
  searchText: string
}

export const DEFAULT_PHONE_COUNTRY_CODE: PhoneCountryCode = 'NG'

export const FEATURED_PHONE_COUNTRY_CODES: readonly PhoneCountryCode[] = [
  'NG',
  'US',
  'GB',
  'GH',
  'KE',
  'CA',
]

export const PHONE_COUNTRIES: readonly PhoneCountryOption[] = Object.freeze(
  getCountries()
    .map((code) => {
      const country = countries[code as TCountryCode]
      const name = country?.name ?? code
      const nativeName = country?.native ?? name
      const callingCode = `+${getCountryCallingCode(code)}` as const

      return {
        code,
        name,
        nativeName,
        callingCode,
        searchText: `${name} ${nativeName} ${code} ${callingCode}`.toLocaleLowerCase(),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name)),
)

const PHONE_COUNTRY_BY_CODE = new Map(
  PHONE_COUNTRIES.map((country) => [country.code, country] as const),
)

export function getPhoneCountryOption(
  code: PhoneCountryCode,
): PhoneCountryOption {
  return (
    PHONE_COUNTRY_BY_CODE.get(code) ??
    PHONE_COUNTRY_BY_CODE.get(DEFAULT_PHONE_COUNTRY_CODE)!
  )
}

export function searchPhoneCountries(
  query: string,
): readonly PhoneCountryOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return PHONE_COUNTRIES

  return PHONE_COUNTRIES.filter((country) =>
    country.searchText.includes(normalizedQuery),
  )
}

export function inferPhoneCountryCode(
  value: string,
  fallback: PhoneCountryCode = DEFAULT_PHONE_COUNTRY_CODE,
): PhoneCountryCode {
  const normalized = value.trim().replace(/^00/, '+')
  if (!normalized.startsWith('+')) return fallback

  const parsed = parsePhoneNumberFromString(normalized)
  if (parsed?.country) return parsed.country

  const digits = normalized.replace(/\D/g, '')
  const fallbackCallingCode = getCountryCallingCode(fallback)
  if (digits.startsWith(fallbackCallingCode)) return fallback

  const candidates = PHONE_COUNTRIES.filter((country) =>
    digits.startsWith(country.callingCode.slice(1)),
  )
  const longestCallingCodeLength = Math.max(
    0,
    ...candidates.map((country) => country.callingCode.length),
  )
  const matchingCountries = candidates.filter(
    (country) => country.callingCode.length === longestCallingCodeLength,
  )

  // Shared calling codes (notably +1) are not reliable country evidence.
  // Preserve the user's editable selection until libphonenumber can resolve it.
  return matchingCountries.length === 1 ? matchingCountries[0]!.code : fallback
}

export function getNationalPhoneInput(
  value: string,
  countryCode: PhoneCountryCode,
): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const normalized = trimmed.replace(/^00/, '+')
  if (normalized.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(normalized)
    if (parsed) return parsed.nationalNumber

    const digits = normalized.replace(/\D/g, '')
    const callingCode = getCountryCallingCode(countryCode)
    return digits.startsWith(callingCode)
      ? digits.slice(callingCode.length)
      : digits
  }

  return trimmed.replace(/\D/g, '')
}

export function composeInternationalPhoneNumber(
  nationalValue: string,
  countryCode: PhoneCountryCode,
): string {
  const trimmed = nationalValue.trim()
  if (!trimmed) return ''

  const normalized = trimmed.replace(/^00/, '+')
  if (normalized.startsWith('+')) {
    const parsedInternational = parsePhoneNumberFromString(normalized)
    return parsedInternational?.number ?? `+${normalized.replace(/\D/g, '')}`
  }

  const digits = normalized.replace(/\D/g, '')
  if (!digits) return ''

  const formatter = new AsYouType(countryCode)
  formatter.input(digits)
  return (
    formatter.getNumberValue() ??
    (`+${getCountryCallingCode(countryCode)}${digits}` as `+${string}`)
  )
}
