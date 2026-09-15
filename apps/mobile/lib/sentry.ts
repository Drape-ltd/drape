/**
 * Drapeon — Sentry error monitoring
 *
 * Setup:
 *   1. Create a project at sentry.io (React Native)
 *   2. Add your DSN to .env.local:
 *        EXPO_PUBLIC_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz
 *   3. Run: npx expo install @sentry/react-native
 *   4. Run the Sentry wizard once to patch metro.config.js:
 *        npx @sentry/wizard -i reactNative
 */

import * as Sentry from '@sentry/react-native'
import Constants from 'expo-constants'

const SENSITIVE_EVENT_KEYS = /authorization|cookie|password|token|secret|phone|email|address|message_body|voice_url/iu
const GENERIC_OBJECT_EXCEPTION = /object captured as exception/iu

function scrubDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubDiagnosticValue(item, depth + 1))
  if (typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_EVENT_KEYS.test(key)
      ? '[Filtered]'
      : scrubDiagnosticValue(nestedValue, depth + 1)
  }
  return output
}

type StructuredFailure = {
  name?: unknown
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

export function normalizeCapturedException(exception: unknown): {
  error: Error
  diagnostic?: Record<string, unknown>
} {
  if (exception instanceof Error) return { error: exception }

  if (exception && typeof exception === 'object') {
    const failure = exception as StructuredFailure
    const message = typeof failure.message === 'string' && failure.message.trim()
      ? failure.message.trim()
      : 'A structured provider or database operation failed.'
    const error = new Error(message)
    error.name = typeof failure.name === 'string' && failure.name.trim()
      ? failure.name.trim()
      : 'StructuredOperationError'
    return {
      error,
      diagnostic: {
        originalType: exception.constructor?.name ?? 'Object',
        code: failure.code,
        details: failure.details,
        hint: failure.hint,
      },
    }
  }

  return {
    error: new Error(
      typeof exception === 'string' && exception.trim()
        ? exception.trim()
        : `A non-error value was captured (${String(exception)}).`,
    ),
    diagnostic: { originalType: typeof exception },
  }
}

function captureNormalizedException(
  exception: unknown,
  hint?: Parameters<typeof Sentry.captureException>[1],
) {
  const normalized = normalizeCapturedException(exception)
  const metadata = releaseTelemetry()
  const context = (hint && typeof hint === 'object' ? hint : {}) as {
    tags?: Record<string, string>
    extra?: Record<string, unknown>
  }
  const enrichedHint = {
    ...(context as object),
    tags: { ...(context.tags ?? {}), ...metadata },
    extra: { ...(context.extra ?? {}), releaseMetadata: metadata },
  }
  if (!normalized.diagnostic) return Sentry.captureException(normalized.error, enrichedHint)

  return Sentry.withScope((scope) => {
    scope.setContext('original_failure', scrubDiagnosticValue(normalized.diagnostic) as Record<string, unknown>)
    return Sentry.captureException(normalized.error, enrichedHint)
  })
}

function releaseTelemetry() {
  const appVariant = process.env.EXPO_PUBLIC_APP_VARIANT ?? (__DEV__ ? 'development' : 'production')
  const environment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? appVariant
  const releaseSha =
    process.env.EXPO_PUBLIC_RELEASE_SHA?.trim() ||
    process.env.EAS_BUILD_GIT_COMMIT_HASH?.trim() ||
    (typeof Constants.expoConfig?.extra?.releaseSha === 'string'
      ? Constants.expoConfig.extra.releaseSha.trim()
      : '') ||
    'unknown'
  const buildNumber =
    process.env.EXPO_PUBLIC_BUILD_NUMBER?.trim() ||
    String(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? 'unknown')

  return {
    environment,
    releaseSha,
    buildNumber,
    surface: 'mobile',
    flow: 'unknown',
    route: 'unknown',
    correlationId: `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    provider: 'sentry',
    statusClass: 'client_error',
  }
}

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn) return // Skip in dev if not configured

  const appVariant = process.env.EXPO_PUBLIC_APP_VARIANT ?? (__DEV__ ? 'development' : 'production')
  const environment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? appVariant

  Sentry.init({
    dsn,
    environment,
    release: releaseTelemetry().releaseSha === 'unknown' ? undefined : releaseTelemetry().releaseSha,
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    enabled: !__DEV__,
    sendDefaultPii: false,
    attachStacktrace: true,
    enableAutoSessionTracking: true,
    beforeSend(event) {
      // Apply the release contract metadata to automatic/unhandled events too,
      // not only to calls made through the DrapeSentry wrapper below.
      const metadata = releaseTelemetry()
      event.tags = { ...event.tags, ...metadata }
      event.extra = { ...(event.extra ?? {}), releaseMetadata: metadata }
      // Sentry serializes rejected provider/database objects under __serialized__
      // and otherwise titles them "Object captured as exception". Recover the
      // actionable, non-sensitive fields even for automatic/unhandled captures.
      const serialized = event.extra?.__serialized__
      if (serialized && typeof serialized === 'object') {
        const failure = serialized as StructuredFailure
        const message = typeof failure.message === 'string' ? failure.message.trim() : ''
        const exceptionValue = event.exception?.values?.[0]?.value ?? ''
        if (message && GENERIC_OBJECT_EXCEPTION.test(exceptionValue)) {
          const exception = event.exception?.values?.[0]
          if (exception) {
            exception.type = 'StructuredOperationError'
            exception.value = message
          }
          if (typeof failure.code === 'string' && failure.code.trim()) {
            event.tags = { ...event.tags, failure_code: failure.code.trim() }
          }
          event.contexts = {
            ...event.contexts,
            original_failure: scrubDiagnosticValue({
              code: failure.code,
              details: failure.details,
              hint: failure.hint,
            }) as Record<string, unknown>,
          }
        }
      }
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined
      }
      if (event.request) {
        event.request = {
          method: event.request.method,
          url: event.request.url?.split('?')[0],
        }
      }
      if (event.extra) {
        event.extra = scrubDiagnosticValue(event.extra) as Record<string, unknown>
      }
      if (event.contexts) {
        event.contexts = scrubDiagnosticValue(event.contexts) as typeof event.contexts
      }
      return event
    },
  })

  Sentry.setTag('app.variant', appVariant)
  Sentry.setTag('supabase.environment', process.env.EXPO_PUBLIC_SUPABASE_ENV ?? 'unknown')
  const metadata = releaseTelemetry()
  for (const [key, value] of Object.entries(metadata)) Sentry.setTag(key, value)
}

const DrapeSentry = {
  addBreadcrumb: Sentry.addBreadcrumb,
  captureException: captureNormalizedException,
  captureMessage: (
    message: string,
    hint?: Parameters<typeof Sentry.captureMessage>[1],
  ) => {
    const metadata = releaseTelemetry()
    if (typeof hint === 'string') {
      return Sentry.withScope((scope) => {
        for (const [key, value] of Object.entries(metadata)) scope.setTag(key, value)
        scope.setExtra('releaseMetadata', metadata)
        return Sentry.captureMessage(message, hint)
      })
    }
    const context = (hint && typeof hint === 'object' ? hint : {}) as {
      tags?: Record<string, string>
      extra?: Record<string, unknown>
    }
    return Sentry.captureMessage(message, {
      ...(context as object),
      tags: { ...(context.tags ?? {}), ...metadata },
      extra: { ...(context.extra ?? {}), releaseMetadata: metadata },
    })
  },
  setUser: Sentry.setUser,
}

export { DrapeSentry as Sentry }
