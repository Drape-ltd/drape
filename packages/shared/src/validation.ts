import type { OrderStage } from './order-machine'
import { SUPPORTED_ACCOUNT_CURRENCIES } from './currency-config'
import { normalizePhoneForStorage, validatePhoneForProfile } from './phone'

export const VALID_ORDER_STATUSES = [
  'DRAFT',
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'IN_DISPUTE',
  'REFUNDED',
  'CANCELLED',
] as const satisfies readonly OrderStage[]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PHONE_DIGITS = 7
const MAX_PHONE_DIGITS = 15

export function validateCurrency(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (SUPPORTED_ACCOUNT_CURRENCIES as readonly string[]).includes(code.trim().toUpperCase())
  )
}

export function validateAmount(amount: unknown): boolean {
  return Number.isInteger(amount) && Number(amount) > 0 && Number(amount) <= 999_999_999
}

export function validateOrderStatus(status: unknown): status is OrderStage {
  return (
    typeof status === 'string' &&
    (VALID_ORDER_STATUSES as readonly string[]).includes(status.trim().toUpperCase())
  )
}

export function validateString(str: unknown, maxLength: number): boolean {
  return (
    typeof str === 'string' &&
    Number.isInteger(maxLength) &&
    maxLength >= 0 &&
    str.length <= maxLength &&
    !str.includes('\0')
  )
}

export function validateEmail(email: unknown): boolean {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email.trim())
}

export function validatePhoneNumber(phone: unknown, country?: string | null): boolean {
  if (typeof phone !== 'string') return false

  const normalized = normalizePhoneForStorage(phone)
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized
  const normalizedCountry = country?.trim().toUpperCase()

  if (normalizedCountry === 'NG' || normalizedCountry === 'NGA' || normalizedCountry === 'NIGERIA') {
    return validatePhoneForProfile(phone) === null
  }

  return (
    /^\+?\d+$/.test(normalized) &&
    digits.length >= MIN_PHONE_DIGITS &&
    digits.length <= MAX_PHONE_DIGITS
  )
}

export function validateUrl(url: unknown, allowedDomains: readonly string[]): boolean {
  if (typeof url !== 'string' || allowedDomains.length === 0) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false

  const hostname = parsed.hostname.toLowerCase()
  return allowedDomains.some((domain) => {
    const normalizedDomain = domain.trim().toLowerCase()
    return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)
  })
}
