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

type AnalyticsJson = string | number | boolean | null | AnalyticsJson[] | { [key: string]: AnalyticsJson }
type AnalyticsProperties = Record<string, AnalyticsJson>

type ConsentAwarePostHog = PostHog & {
  optIn?: () => void
  optOut?: () => void
}

function toAnalyticsJson(value: unknown): AnalyticsJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(toAnalyticsJson)
  if (typeof value === 'object') {
    const output: { [key: string]: AnalyticsJson } = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toAnalyticsJson(nestedValue)
    }
    return output
  }
  return String(value)
}

function toAnalyticsProperties(input?: Record<string, unknown>): AnalyticsProperties | undefined {
  if (!input) return undefined
  const output: AnalyticsProperties = {}
  for (const [key, value] of Object.entries(input)) {
    output[key] = toAnalyticsJson(value)
  }
  return output
}

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
    const consentClient = instance as ConsentAwarePostHog
    if (enabled) {
      consentClient.optIn?.()
    } else {
      consentClient.optOut?.()
    }
  } catch {
    // Keep analytics best-effort so consent sync never breaks app startup.
  }
}

export function identify(userId: string, traits?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  ensureClient()
  client?.identify(userId, toAnalyticsProperties(traits))
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  ensureClient()
  client?.capture(event, toAnalyticsProperties(properties))
}

export function reset() {
  if (!analyticsEnabled) return
  client?.reset()
}
