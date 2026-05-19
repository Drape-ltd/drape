import { getOptionalSentryDsn } from './env.ts'

type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

type CaptureMessageOptions = {
  level?: SentryLevel
  tags?: Record<string, string>
  extra?: Record<string, unknown>
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
      extra: options.extra ?? {},
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
