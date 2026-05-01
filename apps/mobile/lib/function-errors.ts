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
  const payloadMessage = payload?.error
  if (typeof payloadMessage === 'string' && payloadMessage.trim().length > 0) {
    return payloadMessage.trim()
  }

  return readErrorMessage(error) ?? fallback
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
