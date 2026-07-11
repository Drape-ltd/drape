'use client'

import { usePathname } from 'next/navigation'
import { useEffect, type JSX } from 'react'

type AnalyticsProperties = Record<string, boolean | number | string | null | undefined>

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
    plausible?: (eventName: string, options?: { props?: AnalyticsProperties }) => void
    posthog?: {
      capture?: (eventName: string, properties?: AnalyticsProperties) => void
    }
  }
}

export function trackWebEvent(eventName: string, properties: AnalyticsProperties = {}): void {
  if (typeof window === 'undefined') return

  const cleanedProperties = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value != null)
  ) as AnalyticsProperties

  window.posthog?.capture?.(eventName, cleanedProperties)
  window.plausible?.(eventName, { props: cleanedProperties })
  window.dataLayer?.push({ event: eventName, ...cleanedProperties })

  if (process.env.NEXT_PUBLIC_WEB_ANALYTICS_DEBUG === '1') {
    console.info('[web analytics]', eventName, cleanedProperties)
  }
}

export function WebAnalytics(): React.JSX.Element | null {
  const pathname = usePathname()

  useEffect(() => {
    trackWebEvent('page_view', { path: pathname })
  }, [pathname])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return

      const trigger = target.closest<HTMLElement>('[data-analytics-event]')
      if (!trigger) return

      trackWebEvent(trigger.dataset.analyticsEvent ?? 'cta_click', {
        label: trigger.dataset.analyticsLabel,
        href: trigger instanceof HTMLAnchorElement ? trigger.href : undefined,
        path: window.location.pathname,
      })
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return null
}
