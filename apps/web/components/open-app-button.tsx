'use client'

import { useState, type ReactElement } from 'react'

export function OpenAppButton({
  label = 'Open app',
  className = 'inline-flex justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white',
}: {
  label?: string
  className?: string
}): ReactElement {
  const [fallback, setFallback] = useState<string | null>(null)

  function openApp() {
    if (typeof window === 'undefined') return
    const isMobile = /iphone|ipad|ipod|android/iu.test(window.navigator.userAgent)
    const appStoreUrl = (process.env.NEXT_PUBLIC_APP_STORE_URL ?? '').trim()
    setFallback(null)
    window.location.href = 'drape://'
    window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return
      if (isMobile && appStoreUrl) {
        window.location.href = appStoreUrl
        return
      }
      setFallback(isMobile ? 'If Drape does not open, use your TestFlight or App Store invite.' : 'Open Drape on your phone for camera, push, and native scan flows.')
    }, 900)
  }

  return (
    <span className="inline-flex flex-col gap-2">
      <button type="button" onClick={openApp} className={className}>
        {label}
      </button>
      {fallback ? <span className="max-w-xs text-xs leading-5 text-ink/52">{fallback}</span> : null}
    </span>
  )
}
