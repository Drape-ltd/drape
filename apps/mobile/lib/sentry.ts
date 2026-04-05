/**
 * Drape — Sentry error monitoring
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

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn) return // Skip in dev if not configured

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    // Don't send events in dev unless you want to
    enabled: !__DEV__,
    // Keep replay off in V1 so diagnostics stay narrower than full session capture.
    integrations: [],
  })
}

export { Sentry }
