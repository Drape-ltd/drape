function normalizeDigits(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  const hasLeadingPlus = trimmed.startsWith('+')
  const digitsOnly = trimmed.replace(/\D+/g, '')
  if (!digitsOnly) return ''
  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly
}

function recognizedPhoneShape(normalized: string) {
  if (normalized.startsWith('+')) return true
  if (/^0[789]\d{9}$/.test(normalized)) return true

  const digitsOnly = normalized.replace(/\D+/g, '')
  if (/^234[789]\d{9}$/.test(digitsOnly)) return true

  return false
}

function validateShape(
  value: string | null | undefined,
  message: string,
) {
  const normalized = normalizeDigits(value)
  if (!normalized) return null

  const digitsOnly = normalized.replace(/\D+/g, '')
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return message
  if (recognizedPhoneShape(normalized)) return null
  return message
}

export function normalizeStoredPhone(value: string | null | undefined) {
  return normalizeDigits(value)
}

export function validateRecipientPhone(value: string | null | undefined) {
  return validateShape(
    value,
    'Recipient phone looks incomplete. Use a full number with country code, for example +2348012345678. Nigerian mobile numbers starting with 0 also work.',
  )
}

export function validateDispatchPhone(value: string | null | undefined) {
  return validateShape(
    value,
    'Dispatch contact phone looks incomplete. Use a full number with country code, for example +2348012345678. Nigerian mobile numbers starting with 0 also work.',
  )
}
