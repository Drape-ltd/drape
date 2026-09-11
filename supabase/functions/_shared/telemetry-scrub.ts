const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|card|bank[_-]?account|account[_-]?number|routing[_-]?number|phone|email|address|webhook[_-]?body|raw[_-]?body|evidence[_-]?(?:url|path|body|content)|private[_-]?(?:url|path|media))/iu
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const PHONE_VALUE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/gu
const URL_VALUE = /https?:\/\/[^\s"'<>]+/giu
const CREDENTIAL_VALUE = /\b(?:sk|rk|pk)_(?:live|test)_[A-Z0-9_-]+\b|\bwhsec_[A-Z0-9_-]+\b|\bBearer\s+[A-Z0-9._~+\/-]+=*|\beyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b/giu

export type TelemetryLevel = 'info' | 'warn' | 'error'

export function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]'
  if (typeof value === 'string') {
    return value
      .slice(0, 1_000)
      .replace(EMAIL_VALUE, '[REDACTED_EMAIL]')
      .replace(PHONE_VALUE, '[REDACTED_PHONE]')
      .replace(URL_VALUE, '[REDACTED_URL]')
      .replace(CREDENTIAL_VALUE, '[REDACTED_CREDENTIAL]')
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeTelemetryValue(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeTelemetryValue(item, depth + 1),
      ]),
    )
  }
  return value
}

export function serializeTelemetryEntry(
  level: TelemetryLevel,
  fn: string,
  event: string,
  data?: Record<string, unknown>,
): string {
  return JSON.stringify(sanitizeTelemetryValue({
    level,
    fn,
    event,
    ts: new Date().toISOString(),
    ...data,
  }))
}
