const MIN_PHONE_DIGITS = 7
const MAX_PHONE_DIGITS = 15
const NIGERIAN_MOBILE_WITHOUT_ZERO_LENGTH = 10

function looksLikeNigerianLocalMobile(digits: string) {
  return /^0[789]\d{9}$/.test(digits)
}

function looksLikeNigerianMobileWithoutLeadingZero(digits: string) {
  return /^[789]\d{9}$/.test(digits)
}

function looksLikeNigerianE164Digits(digits: string) {
  return /^234[789]\d{9}$/.test(digits)
}

export function normalizePhoneForStorage(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  if (trimmed.startsWith('+')) {
    if (looksLikeNigerianE164Digits(digits)) {
      return `+${digits}`
    }

    return `+${digits}`
  }

  if (trimmed.startsWith('00') && digits.length > 2) {
    return `+${digits.slice(2)}`
  }

  if (looksLikeNigerianLocalMobile(digits)) {
    return `+234${digits.slice(1)}`
  }

  // Drape is currently Nigeria-first, so treat 10-digit 7/8/9 mobile values
  // as local numbers missing the leading zero.
  if (digits.length === NIGERIAN_MOBILE_WITHOUT_ZERO_LENGTH && looksLikeNigerianMobileWithoutLeadingZero(digits)) {
    return `+234${digits}`
  }

  if (looksLikeNigerianE164Digits(digits)) {
    return `+${digits}`
  }

  // If the user entered a long digit-only value without a leading zero,
  // treat it as an international number missing the plus sign.
  if (!trimmed.startsWith('0') && digits.length > 10) {
    return `+${digits}`
  }

  return digits
}

export function validatePhoneForProfile(value: string): string | null {
  const normalized = normalizePhoneForStorage(value)
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return 'Enter a valid phone number.'
  }

  if (normalized.startsWith('+')) {
    return null
  }

  return 'Add a full phone number with country code, for example +2348012345678. Nigerian mobile numbers starting with 0 also work.'
}

export function validateDispatchPhoneForProfile(value: string): string | null {
  const normalized = normalizePhoneForStorage(value)
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return 'Enter a valid phone number.'
  }

  if (normalized.startsWith('+')) {
    return null
  }

  return 'Add a full phone number with country code so the customer knows who is contacting them.'
}

export const PHONE_STORAGE_HINT =
  'Use a full phone number with country code, for example +2348012345678, +447700900123, or +14155550123. Nigerian mobile numbers starting with 0 also work.'
