'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'

export function RecoveryBridge(): any {
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordStrengthError = password.length > 0 ? validatePasswordStrength(password, {}) : null

  useEffect(() => {
    // Establish the recovery session from the email link. Web recovery stays on
    // the web; it must never require an installed mobile app to finish.
    async function applyRecoverySession() {
      if (typeof window === 'undefined') return
      const searchParams = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash')
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const code = searchParams.get('code')

      if (!tokenHash && !(accessToken && refreshToken) && !code) {
        setSessionError('No valid recovery token found. Request a new password reset link.')
        return
      }

      let supabase
      try {
        supabase = createClient()
      } catch {
        setSessionError(
          'Account recovery is temporarily unavailable. Request a new link or contact support.'
        )
        return
      }

      // token_hash flow (email link)
      if (tokenHash) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        })
        if (otpError) {
          setSessionError('This reset link has expired or was already used. Request a new one.')
          return
        }
        setSessionReady(true)
        return
      }

      // hash access_token flow (older Supabase email links)
      if (accessToken && refreshToken) {
        const { error: sessionErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (sessionErr) {
          setSessionError('This reset link has expired or was already used. Request a new one.')
          return
        }
        setSessionReady(true)
        return
      }

      // code flow
      if (code) {
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(code)
        if (codeError) {
          setSessionError('This reset link has expired or was already used. Request a new one.')
          return
        }
        setSessionReady(true)
        return
      }
    }

    void applyRecoverySession().catch(() => {
      setSessionError('Drapeon could not verify this reset link. Request a new one and try again.')
    })
  }, [])

  async function resetPassword() {
    if (loading || !sessionReady) return
    const strengthError = validatePasswordStrength(password, {})
    if (strengthError) {
      setError(strengthError)
      return
    }
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) {
      setError(
        'Could not update your password. The reset link may have expired — request a new one.'
      )
      return
    }

    const [{ error: revokeError }, { error: noticeError }] = await Promise.all([
      supabase.functions.invoke('trusted-device-action', {
        body: { action: 'revoke-all' },
      }),
      supabase.functions.invoke('account-security-notification', {
        body: { event: 'PASSWORD_CHANGED' },
      }),
    ])
    if (revokeError || noticeError) {
      setError(
        'Your password changed, but Drapeon could not finish every security cleanup step. Sign in with your new password and review Login & security.'
      )
      return
    }

    await supabase.auth.signOut({ scope: 'others' })
    await supabase.auth.signOut({ scope: 'local' })
    setDone(true)
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)] px-5 py-8">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-md place-items-center">
        <div className="w-full rounded-[8px] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Drapeon
          </p>

          {done ? (
            <>
              <h1 className="mt-3 text-3xl text-ink">Password updated.</h1>
              <p className="mt-3 text-sm leading-7 text-ink/66">
                Your other sessions and remembered devices have been signed out. Use your new
                password to sign in again.
              </p>
              <a
                href="/sign-in?password_reset=1"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white"
              >
                Sign in securely
              </a>
            </>
          ) : sessionError ? (
            <>
              <h1 className="mt-3 text-3xl text-ink">Link expired</h1>
              <p className="mt-3 text-sm leading-7 text-ink/66">{sessionError}</p>
              <a
                href="/account/recovery"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white"
              >
                Request a new reset link
              </a>
            </>
          ) : !sessionReady ? (
            <>
              <h1 className="mt-3 text-3xl text-ink">Verifying your link…</h1>
              <p className="mt-3 text-sm leading-7 text-ink/66">
                Hold on while we confirm this reset link.
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-3xl text-ink">Set a new password.</h1>
              <p className="mt-3 text-sm leading-7 text-ink/66">
                Choose a strong password for your Drapeon account.
              </p>
              <form
                className="mt-6 grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void resetPassword()
                }}
              >
                <div className="grid gap-2 text-sm font-semibold text-ink">
                  <label>New password</label>
                  <span className="relative block">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="10+ characters"
                      autoComplete="new-password"
                      maxLength={MAX_PASSWORD_LENGTH}
                      className="min-h-12 w-full rounded-lg border border-ink/10 bg-white px-4 pr-20 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-needle transition hover:bg-bone"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </span>
                  <span
                    className={`text-xs font-normal leading-5 ${
                      password.length > 0 && !passwordStrengthError
                        ? 'text-needle'
                        : passwordStrengthError
                          ? 'text-rust'
                          : 'text-ink/52'
                    }`}
                  >
                    {password.length > 0 && !passwordStrengthError
                      ? 'Password meets the Drapeon policy.'
                      : (passwordStrengthError ?? PASSWORD_POLICY_HINT)}
                  </span>
                </div>
                {error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink"
                  >
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={loading || !!passwordStrengthError}
                  className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle/90 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
                >
                  {loading ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-xs text-ink/40">
            <a href="/sign-in" className="hover:text-ink">
              Back to sign in
            </a>
            {' · '}
            <a href="/account/recovery" className="hover:text-ink">
              Request new link
            </a>
          </p>
        </div>
      </section>
    </main>
  )
}
