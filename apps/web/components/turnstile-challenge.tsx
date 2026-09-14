'use client'

import { useEffect, useId, useRef, useState } from 'react'

type TurnstileWidgetId = string

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      appearance: 'interaction-only'
      size: 'flexible'
      theme: 'light'
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
      'before-interactive-callback': () => void
      'after-interactive-callback': () => void
    },
  ) => TurnstileWidgetId
  remove: (widgetId: TurnstileWidgetId) => void
  reset: (widgetId: TurnstileWidgetId) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_ID = 'drapeon-turnstile-script'
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export function TurnstileChallenge({
  action,
  onTokenChange,
}: {
  action: 'signin' | 'signup' | 'recovery' | 'resend'
  onTokenChange: (token: string | null) => void
}): React.JSX.Element {
  const reactId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null)
  const onTokenChangeRef = useRef(onTokenChange)
  const [scriptReady, setScriptReady] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [interactive, setInteractive] = useState(false)
  const siteKey = (
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ||
    (typeof window !== 'undefined'
      ? window.__DRAPEON_PUBLIC_ENV__?.turnstileSiteKey?.trim()
      : '')
  )
  const [challengeError, setChallengeError] = useState<string | null>(
    siteKey ? null : 'Security verification is not configured for this environment.',
  )

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange
  }, [onTokenChange])

  useEffect(() => {
    if (window.turnstile) {
      const readyTimer = window.setTimeout(() => setScriptReady(true), 0)
      return () => window.clearTimeout(readyTimer)
    }

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const onLoad = () => setScriptReady(true)
    const onError = () => setChallengeError('The security check could not load. Check your connection and retry.')

    if (!script) {
      script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    return () => {
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
  }, [retryKey])

  useEffect(() => {
    onTokenChangeRef.current(null)
    if (!siteKey) return
    if (!scriptReady || !containerRef.current || !window.turnstile) return

    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      appearance: 'interaction-only',
      size: 'flexible',
      theme: 'light',
      callback: (token) => {
        setChallengeError(null)
        setInteractive(false)
        onTokenChangeRef.current(token)
      },
      'expired-callback': () => {
        onTokenChangeRef.current(null)
        setChallengeError('The security check expired. Complete it again to continue.')
      },
      'error-callback': () => {
        onTokenChangeRef.current(null)
        setChallengeError('The security check could not finish. Retry it before continuing.')
      },
      'before-interactive-callback': () => setInteractive(true),
      'after-interactive-callback': () => setInteractive(false),
    })
    widgetIdRef.current = widgetId

    // Mobile Safari and in-app browsers can restore the recovery form from
    // bfcache after the user returns from an email link. A Turnstile token
    // restored with that page may already be expired, so force a fresh token
    // before the user can submit again.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !widgetIdRef.current || !window.turnstile) return
      onTokenChangeRef.current(null)
      setChallengeError(null)
      window.turnstile.reset(widgetIdRef.current)
    }
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      window.removeEventListener('pageshow', handlePageShow)
      window.turnstile?.remove(widgetId)
      if (widgetIdRef.current === widgetId) widgetIdRef.current = null
    }
  }, [action, scriptReady, siteKey])

  function retryChallenge() {
    onTokenChangeRef.current(null)
    setChallengeError(null)
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
      return
    }

    document.getElementById(SCRIPT_ID)?.remove()
    setScriptReady(false)
    setRetryKey((current) => current + 1)
  }

  return (
    <div className={challengeError || interactive ? 'grid gap-2' : ''} aria-describedby={challengeError ? `${reactId}-hint` : undefined}>
      <div
        ref={containerRef}
        data-testid={`turnstile-${action}`}
        className={interactive ? 'min-h-[65px] w-full overflow-hidden rounded-lg border border-ink/8 bg-bone/45' : 'h-0 overflow-hidden'}
      />
      {challengeError ? <p id={`${reactId}-hint`} className="text-xs leading-5 text-rust">{challengeError}</p> : null}
      {challengeError ? (
        <button
          type="button"
          onClick={retryChallenge}
          className="w-fit rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-needle transition hover:bg-bone"
        >
          Retry security check
        </button>
      ) : null}
    </div>
  )
}
