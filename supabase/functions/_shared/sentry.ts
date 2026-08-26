import { getOptionalSentryDsn } from './env.ts'

type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

type CaptureMessageOptions = {
  level?: SentryLevel
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|card|bank[_-]?account|account[_-]?number|routing[_-]?number|phone|email|address|webhook[_-]?body|raw[_-]?body|evidence[_-]?(?:body|content))/iu
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const PHONE_VALUE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/gu

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]'
  if (typeof value === 'string') {
    return value
      .slice(0, 1000)
      .replace(EMAIL_VALUE, '[REDACTED_EMAIL]')
      .replace(PHONE_VALUE, '[REDACTED_PHONE]')
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1),
      ]),
    )
  }
  return value
}

async function postSentryEvent(
  message: string,
  options: CaptureMessageOptions = {},
) {
  const dsn = getOptionalSentryDsn()
  if (!dsn) return

  try {
    const dsnUrl = new URL(dsn)
    const projectId = dsnUrl.pathname.replace(/^\/+/u, '')
    const eventId = crypto.randomUUID().replace(/-/gu, '')
    const envelopeHeader = {
      event_id: eventId,
      dsn,
      sent_at: new Date().toISOString(),
    }
    const itemHeader = { type: 'event' }
    const eventPayload = {
      event_id: eventId,
      level: options.level ?? 'error',
      message,
      platform: 'javascript',
      timestamp: Math.floor(Date.now() / 1000),
      tags: options.tags ?? {},
      extra: sanitizeValue(options.extra ?? {}),
    }

    await fetch(`${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: `${JSON.stringify(envelopeHeader)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(eventPayload)}`,
    })
  } catch (error) {
    console.error(JSON.stringify({
      level: 'warn',
      fn: 'sentry',
      event: 'capture_failed',
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

export const Sentry = {
  captureMessage: postSentryEvent,
}
