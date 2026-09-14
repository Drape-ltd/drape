'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { RECOVERY_INTENT_KEY } from '../lib/auth-recovery-intent'
import { TurnstileChallenge } from './turnstile-challenge'

function mapRecoveryError(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Please wait a minute before requesting another reset link.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Connection looks weak. Try again when the signal improves.'
  }
  if (normalized.includes('captcha') || normalized.includes('security verification')) {
    return 'The security check expired or could not be verified. Complete it again and retry.'
  }
  return 'We could not send a reset link right now. Please try again.'
}

function getBrowserRecoveryOrigin() {
  if (typeof window === 'undefined') return null
  return window.location.origin
}

function getHostedRecoveryUrl() {
  const browserOrigin = getBrowserRecoveryOrigin()
  if (
    browserOrigin &&
    (browserOrigin.includes('://localhost') || browserOrigin.includes('://127.0.0.1'))
  ) {
    return `${browserOrigin}/auth/recover?flow=recovery`
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    return `${configured}/auth/recover?flow=recovery`
  }

  if (browserOrigin) return `${browserOrigin}/auth/recover?flow=recovery`

  return 'https://drapeon.co/auth/recover?flow=recovery'
}

export function AccountRecoveryRequestForm(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const captchaFailed = error?.toLowerCase().includes('security check') ?? false

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      // Never reuse a Turnstile token restored from browser history. The
      // widget remount is what obtains a fresh token for this request.
      setCaptchaToken(null)
      setError(null)
      setCaptchaResetKey((current) => current + 1)
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  async function submit() {
    if (loading) return
    setError(null)
    setMessage(null)

    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter the email attached to your Drapeon account.')
      return
    }
    if (!captchaToken) {
      setError('Complete the security check before requesting a reset link.')
      return
    }

    let supabase
    try {
      supabase = createClient()
    } catch {
      setError(
        'Account recovery is temporarily unavailable. Please try again later or contact support.'
      )
      return
    }

    setLoading(true)
    // Keep a short-lived browser hint for older Supabase links that redirect
    // to a bare `/` and lose their recovery type before reaching Drapeon. The
    // callback consumes it before exchanging the code, so an existing account
    // session cannot swallow a password-reset link as ordinary sign-in.
    window.localStorage.setItem(RECOVERY_INTENT_KEY, JSON.stringify({ requestedAt: Date.now() }))
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: getHostedRecoveryUrl(),
      captchaToken,
    })
    setCaptchaToken(null)
    setCaptchaResetKey((current) => current + 1)
    setLoading(false)

    if (resetError) {
      setError(mapRecoveryError(resetError.message))
      return
    }

    setMessage('If that email has a Drapeon account, a password reset email is on the way.')
  }

  return (
    <form
      className="grid gap-5 rounded-[8px] border border-ink/8 bg-white/90 p-5 shadow-[0_18px_55px_rgba(22,28,24,0.06)] sm:p-7"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          Reset password
        </p>
        <h2 className="mt-3 text-3xl leading-tight text-ink">Where should we send the link?</h2>
        <p className="mt-3 text-sm leading-7 text-ink/64">
          Enter the email on your Drapeon account. For privacy, the confirmation looks the same
          whether or not the address is registered.
        </p>
      </div>
      <label className="grid gap-2 text-sm font-semibold text-ink">
        Email
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
        />
      </label>
      <TurnstileChallenge
        key={captchaResetKey}
        action="recovery"
        onTokenChange={(token) => {
          setCaptchaToken(token)
          if (token) setError(null)
        }}
      />
      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink"
        >
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-needle/16 bg-needle/8 px-4 py-3 text-sm leading-6 text-ink">
          {message}
        </div>
      ) : null}
      {captchaFailed ? (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setCaptchaToken(null)
            setCaptchaResetKey((current) => current + 1)
          }}
          className="w-fit rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-needle transition hover:bg-bone"
        >
          Retry security check
        </button>
      ) : null}
      <button
        type="submit"
        disabled={loading || !captchaToken}
        className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
      >
        {loading ? 'Sending...' : 'Send reset link'}
      </button>
    </form>
  )
}
