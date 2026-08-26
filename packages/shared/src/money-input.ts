import type { AccountCurrencyCode } from './currency-config'

export const MONEY_INPUT_MAX_MINOR_UNITS = 999_999_999

const CURRENCY_NAMES: Record<AccountCurrencyCode, { major: string; minor: string }> = {
  NGN: { major: 'naira', minor: 'kobo' },
  GHS: { major: 'Ghanaian cedi', minor: 'pesewa' },
  KES: { major: 'Kenyan shilling', minor: 'cent' },
  USD: { major: 'US dollar', minor: 'cent' },
  GBP: { major: 'British pound', minor: 'pence' },
  EUR: { major: 'euro', minor: 'cent' },
  CAD: { major: 'Canadian dollar', minor: 'cent' },
}

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
] as const

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const

function integerBelowThousandToWords(value: number) {
  const words: string[] = []
  const hundreds = Math.floor(value / 100)
  const remainder = value % 100
  if (hundreds > 0) words.push(`${SMALL_NUMBERS[hundreds]} hundred`)
  if (remainder > 0 && remainder < 20) words.push(SMALL_NUMBERS[remainder] ?? '')
  if (remainder >= 20) {
    const tens = TENS[Math.floor(remainder / 10)]
    const ones = remainder % 10
    words.push(ones > 0 ? `${tens}-${SMALL_NUMBERS[ones] ?? ''}` : (tens ?? ''))
  }
  return words.join(' ')
}

export function integerToEnglishWords(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) return ''
  if (value === 0) return SMALL_NUMBERS[0]
  const scales = [
    { value: 1_000_000_000, label: 'billion' },
    { value: 1_000_000, label: 'million' },
    { value: 1_000, label: 'thousand' },
  ] as const
  let remaining = value
  const words: string[] = []
  for (const scale of scales) {
    const group = Math.floor(remaining / scale.value)
    if (group > 0) {
      words.push(`${integerBelowThousandToWords(group)} ${scale.label}`)
      remaining %= scale.value
    }
  }
  if (remaining > 0) words.push(integerBelowThousandToWords(remaining))
  return words.join(' ')
}

export function normalizeMoneyInput(value: string, fractionDigits = 2) {
  const compact = value.replace(/[\s,]/gu, '')
  const cleaned = compact.replace(/[^\d.]/gu, '')
  const decimalIndex = cleaned.indexOf('.')
  const integerRaw = decimalIndex >= 0 ? cleaned.slice(0, decimalIndex) : cleaned
  const fractionRaw = decimalIndex >= 0 ? cleaned.slice(decimalIndex + 1).replace(/\./gu, '') : ''
  const integer = integerRaw.replace(/^0+(?=\d)/u, '') || (decimalIndex >= 0 ? '0' : '')
  const fraction = fractionRaw.slice(0, Math.max(0, fractionDigits))
  return decimalIndex >= 0 && fractionDigits > 0 ? `${integer}.${fraction}` : integer
}

export function formatMoneyInputValue(value: string, fractionDigits = 2) {
  const normalized = normalizeMoneyInput(value, fractionDigits)
  if (!normalized) return ''
  const hasDecimal = normalized.includes('.')
  const [integer = '0', fraction = ''] = normalized.split('.')
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
  return hasDecimal ? `${grouped}.${fraction}` : grouped
}

export function parseMoneyInputToMinorUnits(
  value: string | null | undefined,
  options: { allowZero?: boolean; maximumMinorUnits?: number; fractionDigits?: number } = {},
) {
  if (typeof value !== 'string') return null
  const fractionDigits = options.fractionDigits ?? 2
  const normalized = normalizeMoneyInput(value, fractionDigits)
  if (!normalized || !/^\d+(\.\d{0,2})?$/u.test(normalized)) return null
  const [major = '0', fraction = ''] = normalized.split('.')
  const scale = 10 ** fractionDigits
  const minor = (Number.parseInt(major, 10) * scale) + Number.parseInt(fraction.padEnd(fractionDigits, '0') || '0', 10)
  const maximum = options.maximumMinorUnits ?? MONEY_INPUT_MAX_MINOR_UNITS
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > maximum) return null
  if (!options.allowZero && minor === 0) return null
  return minor
}

export function formatMinorCurrencyAmount(
  amountMinor: number,
  currency: AccountCurrencyCode,
  locale = 'en-US',
) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}

export function moneyAmountReadback(amountMinor: number | null | undefined, currency: AccountCurrencyCode) {
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return ''
  const major = Math.floor(amountMinor / 100)
  const minor = amountMinor % 100
  const names = CURRENCY_NAMES[currency]
  const majorWords = integerToEnglishWords(major)
  const majorName = major === 1 && currency !== 'NGN' ? names.major : names.major
  const base = `${majorWords} ${majorName}`
  return minor > 0 ? `${base} and ${integerToEnglishWords(minor)} ${names.minor}` : base
}
