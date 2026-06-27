function getFunctionErrorContext(error: unknown): Response | null {
  if (!error || typeof error !== 'object') return null

  const context = (error as { context?: unknown }).context
  return context instanceof Response ? context : null
}

export function readFunctionErrorStatus(error: unknown): number | null {
  const response = getFunctionErrorContext(error)
  return response ? response.status : null
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (!error || typeof error !== 'object') return null

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : null
}

export function isMachineErrorCodeMessage(value: string) {
  const trimmed = value.trim()
  return /^[A-Z0-9_:-]+$/.test(trimmed) && !trimmed.includes(' ')
}

const GENERIC_SERVER_ERROR_MESSAGES = new Set([
  'database error',
  'internal error',
  'internal server error',
  'unauthorized',
  'forbidden',
  'not found',
])

function isGenericServerErrorMessage(value: string) {
  const normalized = value.trim().toLowerCase()
  return GENERIC_SERVER_ERROR_MESSAGES.has(normalized)
}

function isValidationLeakMessage(value: string) {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('validation error')
    || normalized.includes('invalid discriminator')
    || normalized.includes('expected ')
    || normalized.includes('received ')
  )
}

export async function readFunctionErrorPayload(error: unknown): Promise<Record<string, unknown> | null> {
  const response = getFunctionErrorContext(error)
  if (!response) return null

  try {
    const clone = response.clone()
    const contentType = clone.headers.get('Content-Type') ?? ''

    if (contentType.includes('application/json')) {
      const payload = await clone.json()
      return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null
    }

    const text = (await clone.text()).trim()
    if (!text) return null

    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { error: text }
    } catch {
      return { error: text }
    }
  } catch {
    return null
  }
}

export async function readFunctionErrorMessage(
  error: unknown,
  fallback = 'Something went wrong.',
): Promise<string> {
  const payload = await readFunctionErrorPayload(error)
  const payloadDetail = payload?.message
  if (typeof payloadDetail === 'string' && payloadDetail.trim().length > 0) {
    const trimmed = payloadDetail.trim()
    return isMachineErrorCodeMessage(trimmed) || isGenericServerErrorMessage(trimmed) || isValidationLeakMessage(trimmed)
      ? fallback
      : trimmed
  }

  const payloadMessage = payload?.error
  if (typeof payloadMessage === 'string' && payloadMessage.trim().length > 0) {
    const trimmed = payloadMessage.trim()
    return isMachineErrorCodeMessage(trimmed) || isGenericServerErrorMessage(trimmed) || isValidationLeakMessage(trimmed)
      ? fallback
      : trimmed
  }

  const rawMessage = readErrorMessage(error)
  if (!rawMessage || isMachineErrorCodeMessage(rawMessage) || isGenericServerErrorMessage(rawMessage) || isValidationLeakMessage(rawMessage)) {
    return fallback
  }

  return rawMessage
}

const CONNECTIVITY_PATTERNS = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'timed out',
  'connection lost',
  'offline',
  'internet connection appears to be offline',
]

export function isLikelyConnectivityIssue(error: unknown): boolean {
  const message = readErrorMessage(error)?.toLowerCase() ?? ''
  return CONNECTIVITY_PATTERNS.some((pattern) => message.includes(pattern))
}

export function isDuplicatePhoneError(error: unknown): boolean {
  const message = readErrorMessage(error)?.toLowerCase() ?? ''
  const code = error && typeof error === 'object'
    ? String((error as { code?: unknown }).code ?? '').toLowerCase()
    : ''

  return (
    code === '23505' && message.includes('phone') ||
    message.includes('phone_already_in_use') ||
    message.includes('already uses this phone number') ||
    message.includes('phone number is already connected')
  )
}
