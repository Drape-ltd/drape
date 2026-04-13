/**
 * Drape — PostHog analytics wrapper
 *
 * Setup:
 *   1. Create a project at posthog.com (or posthog.eu)
 *   2. Copy the Project API Key
 *   3. Add to .env.local:
 *        EXPO_PUBLIC_POSTHOG_API_KEY=phc_xxxx
 *        EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  (or eu.i.posthog.com)
 *
 * Usage:
 *   import { capture, identify, reset } from '@/lib/analytics'
 *   capture('order_placed', { garment_type: 'Suit' })
 */

import PostHog from 'posthog-react-native'

let client: PostHog | null = null
let analyticsEnabled = false

function ensureClient() {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY
  if (!apiKey) return null
  if (client) return client

  client = new PostHog(apiKey, {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    defaultOptIn: false,
  })

  return client
}

export function initAnalytics() {
  return ensureClient()
}

export function setAnalyticsConsent(enabled: boolean) {
  analyticsEnabled = enabled

  const instance = ensureClient()
  if (!instance) return

  try {
    if (enabled) {
      ;(instance as any).optIn?.()
    } else {
      ;(instance as any).optOut?.()
    }
  } catch {
    // Keep analytics best-effort so consent sync never breaks app startup.
  }
}

export function identify(userId: string, traits?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  ensureClient()
  client?.identify(userId, traits as any)
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  ensureClient()
  client?.capture(event, properties as any)
}

export function reset() {
  if (!analyticsEnabled) return
  client?.reset()
}
