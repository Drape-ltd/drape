'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { validateDisplayName } from '@drape/shared/contact-filter'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'
import { createClient } from '../lib/supabase'

type AuthMode = 'sign-in' | 'sign-up'
type DrapeRole = 'CUSTOMER' | 'TAILOR'

function normalizeRole(value: string | null): DrapeRole {
  return value?.toLowerCase() === 'tailor' ? 'TAILOR' : 'CUSTOMER'
}

function roleLabel(role: DrapeRole) {
  return role === 'TAILOR' ? 'tailor' : 'customer'
}

function mapAuthError(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')) {
    return 'Incorrect email or password.'
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'This email already has a Drapeon account. Sign in instead.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Check your email and confirm your Drapeon account before signing in.'
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Please wait a minute before trying again.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Connection looks weak. Try again when the signal improves.'
  }
  return 'We could not complete this step right now. Please try again.'
}

export function AccountAuthForm({ mode }: { mode: AuthMode }): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialRole = useMemo(() => normalizeRole(searchParams.get('role')), [searchParams])
  const [role, setRole] = useState<DrapeRole>(initialRole)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const isSignUp = mode === 'sign-up'

  function getSupabase() {
    try {
      return createClient()
    } catch {
      setError('Account access is temporarily unavailable. Please try again later or contact support.')
      return null
    }
  }

  function validate() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return 'Enter a valid email address.'
    }
    if (isSignUp) {
      const nameError = validateDisplayName(displayName)
      if (nameError) return nameError
      const passwordError = validatePasswordStrength(password, {
        forbiddenValues: [normalizedEmail, displayName],
      })
      if (passwordError) return passwordError
    }
    if (!password) return 'Enter your password.'
    return null
  }

  async function submit() {
    if (loading || oauthLoading) return
    setError(null)
    setMessage(null)

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const redirectTo = `${window.location.origin}/account/dashboard`

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            display_name: displayName.trim(),
            role,
          },
        },
      })

      setLoading(false)
      if (error) {
        setError(mapAuthError(error.message))
        return
      }
      if (!data.session) {
        setMessage('Check your email to confirm your Drapeon account, then sign in.')
        return
      }
      router.replace('/account/dashboard')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })
    if (error) {
      setLoading(false)
      setError(mapAuthError(error.message))
      return
    }

    setLoading(false)
    router.replace('/account/dashboard')
  }

  async function oauth(provider: 'google' | 'apple') {
    if (loading || oauthLoading) return
    setError(null)
    setMessage(null)
    const supabase = getSupabase()
    if (!supabase) return

    setOauthLoading(provider)
    if (isSignUp) {
      window.localStorage.setItem('drapeon.web.auth.roleIntent', role)
    } else {
      window.localStorage.removeItem('drapeon.web.auth.roleIntent')
    }
    const next = encodeURIComponent('/account/dashboard')
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
      },
    })
    setOauthLoading(null)
    if (error) {
      setError(mapAuthError(error.message))
    }
  }

  return (
    <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          {isSignUp ? 'Create account' : 'Sign in'}
        </p>
        <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
          {isSignUp ? `Start as a ${roleLabel(role)}.` : 'Sign in to Drapeon.'}
        </h1>
        <p className="mt-4 text-sm leading-7 text-ink/66">
          {isSignUp
            ? 'One Drapeon account can use both customer and tailor mode. This choice opens the right side first.'
            : 'Use the same account you use in the app to view your Drapeon history on web.'}
        </p>
      </div>

      {isSignUp ? (
        <div className="mt-6 grid grid-cols-2 gap-2 rounded-[1.1rem] border border-ink/8 bg-bone/70 p-1.5">
          {(['CUSTOMER', 'TAILOR'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setRole(entry)}
              className={
                role === entry
                  ? 'rounded-[0.9rem] bg-white px-4 py-3 text-sm font-semibold text-ink shadow-sm'
                  : 'rounded-[0.9rem] px-4 py-3 text-sm font-semibold text-ink/58 transition hover:text-ink'
              }
            >
              {entry === 'CUSTOMER' ? 'Customer' : 'Tailor'}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {isSignUp ? (
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
            />
          </label>
        ) : null}
        <label className="grid gap-2 text-sm font-semibold text-ink">
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-ink">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isSignUp ? '8+ characters' : 'Your password'}
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            maxLength={MAX_PASSWORD_LENGTH}
            className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
          />
          {isSignUp ? <span className="text-xs font-normal leading-5 text-ink/52">{PASSWORD_POLICY_HINT}</span> : null}
        </label>

        {error ? (
          <div className="rounded-[1rem] border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-[1rem] border border-needle/16 bg-needle/8 px-4 py-3 text-sm leading-6 text-ink">
            {message}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            void submit()
          }}
          disabled={loading || !!oauthLoading}
          className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
        >
          {loading ? 'Working...' : isSignUp ? 'Create account' : 'Sign in'}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              void oauth('google')
            }}
            disabled={loading || !!oauthLoading}
            className="min-h-12 rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-60"
          >
            {oauthLoading === 'google' ? 'Opening...' : 'Continue with Google'}
          </button>
          <button
            type="button"
            onClick={() => {
              void oauth('apple')
            }}
            disabled={loading || !!oauthLoading}
            className="min-h-12 rounded-full border border-ink bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink/88 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {oauthLoading === 'apple' ? 'Opening...' : 'Continue with Apple'}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-ink/6 pt-5 text-sm text-ink/62 sm:flex-row sm:items-center sm:justify-between">
        {isSignUp ? (
          <>
            <span>Already have an account?</span>
            <a href={`/sign-in?role=${role.toLowerCase()}`} className="font-semibold text-needle">Sign in</a>
          </>
        ) : (
          <>
            <a href="/account/recovery" className="font-semibold text-needle">Forgot password?</a>
            <a href={`/sign-up?role=${role.toLowerCase()}`} className="font-semibold text-needle">Create account</a>
          </>
        )}
      </div>
    </div>
  )
}
