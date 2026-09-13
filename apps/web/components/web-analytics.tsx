'use client'

type AnalyticsProperties = Record<string, boolean | number | string | null | undefined>

export function trackWebEvent(eventName: string, properties: AnalyticsProperties = {}): void {
  if (typeof window === 'undefined') return
  if (process.env.NEXT_PUBLIC_WEB_ANALYTICS_DEBUG !== '1') return

  const cleanedProperties = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value != null)
  ) as AnalyticsProperties
  console.info('[web analytics disabled]', eventName, cleanedProperties)
}

export function WebAnalytics(): null {
  return null
}
