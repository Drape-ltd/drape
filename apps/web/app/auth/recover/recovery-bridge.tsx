'use client'

import { useEffect, useState } from 'react'

const APP_RESET_URL = 'drape://reset-password'

function buildDeepLinkTarget() {
  if (typeof window === 'undefined') return APP_RESET_URL

  const baseUrl = `${window.location.origin}${window.location.pathname}`
  const suffix = window.location.href.slice(baseUrl.length)

  return `${APP_RESET_URL}${suffix}`
}

export function RecoveryBridge(): any {
  const [targetUrl, setTargetUrl] = useState(APP_RESET_URL)
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    const nextTarget = buildDeepLinkTarget()
    setTargetUrl(nextTarget)

    const redirectTimer = window.setTimeout(() => {
      window.location.replace(nextTarget)
    }, 80)

    const fallbackTimer = window.setTimeout(() => {
      setShowFallback(true)
    }, 1600)

    return () => {
      window.clearTimeout(redirectTimer)
      window.clearTimeout(fallbackTimer)
    }
  }, [])

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#F5F0E8',
        color: '#1A1A1A',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '460px',
          background: '#FFFFFF',
          borderRadius: '24px',
          padding: '32px 24px',
          boxShadow: '0 16px 40px rgba(26, 26, 26, 0.08)',
        }}
      >
        <p
          style={{
            margin: 0,
            color: '#2D6A4F',
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Drape account recovery
        </p>
        <h1
          style={{
            margin: '16px 0 12px',
            fontSize: '34px',
            lineHeight: 1.05,
          }}
        >
          Opening Drape
        </h1>
        <p
          style={{
            margin: 0,
            color: '#4A4A4A',
            fontSize: '16px',
            lineHeight: 1.6,
          }}
        >
          We&apos;re sending this password reset back into the app now.
        </p>

        {showFallback ? (
          <div
            style={{
              marginTop: '24px',
              display: 'grid',
              gap: '12px',
            }}
          >
            <a
              href={targetUrl}
              style={{
                display: 'inline-flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '52px',
                borderRadius: '16px',
                background: '#2D6A4F',
                color: '#FFFFFF',
                fontWeight: 700,
              }}
            >
              Open Drape
            </a>
            <p
              style={{
                margin: 0,
                color: '#4A4A4A',
                fontSize: '14px',
                lineHeight: 1.6,
              }}
            >
              If the app does not open, use this same device with Drape installed and request a new
              password reset link if needed.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  )
}
