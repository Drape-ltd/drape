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

const SENSITIVE_EVENT_KEYS = /authorization|cookie|password|token|secret|phone|email|address|message_body|voice_url/iu

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

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn) return // Skip in dev if not configured

  const appVariant = process.env.EXPO_PUBLIC_APP_VARIANT ?? (__DEV__ ? 'development' : 'production')
  const environment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? appVariant

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    enabled: !__DEV__,
    sendDefaultPii: false,
    attachStacktrace: true,
    enableAutoSessionTracking: true,
    beforeSend(event) {
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
}

export { Sentry }
