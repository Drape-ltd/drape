'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { createClient } from '../lib/supabase'
import {
  bootstrapWebOnboarding,
  webOnboardingFromUser,
  type WebOnboardingPayload,
} from '../lib/account-bootstrap'

type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

const emailOtpTypes = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

function sanitizeNext(value: string | null) {
  return value?.startsWith('/') === true && !value.startsWith('//') ? value : '/account/dashboard'
}

function normalizeEmailOtpType(value: string | null): EmailOtpType | null {
  return value && emailOtpTypes.has(value as EmailOtpType) ? (value as EmailOtpType) : null
}

function mapCallbackError(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'This account link has expired or was already used. Request a fresh link and try again.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Connection looks weak. Try again when the signal improves.'
  }
  return 'We could not finish this account link. Return to sign in and try again.'
}

async function applySessionFromUrl(
  supabase: ReturnType<typeof createClient>,
  searchParams: { get(name: string): string | null }
) {
  const providerError = searchParams.get('error_description') ?? searchParams.get('error')
  if (providerError) {
    throw new Error(providerError)
  }

  const code = searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error
    return
  }

  const tokenHash = searchParams.get('token_hash')
  const otpType = normalizeEmailOtpType(searchParams.get('type'))
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    })
    if (error) throw error
    return
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error) throw error
  }
}

async function syncRoleMirror(role: 'CUSTOMER' | 'TAILOR') {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id
  if (!userId) return

  await supabase
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)
}

function readStoredOnboarding() {
  const raw = window.localStorage.getItem('drapeon.web.auth.onboarding')
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as WebOnboardingPayload
    return payload?.source === 'web' ? payload : null
  } catch {
    return null
  }
}

export function AuthCallbackClient(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Finishing sign in...')

  useEffect(() => {
    let active = true

    async function complete() {
      const supabase = createClient()
      const next = sanitizeNext(searchParams.get('next'))

      try {
        await applySessionFromUrl(supabase, searchParams)
      } catch (error) {
        if (active) setMessage(mapCallbackError(error instanceof Error ? error.message : undefined))
        return
      }

      if (active) {
        setMessage('Email confirmed. Opening your Drapeon dashboard...')
      }

      const roleIntent = window.localStorage.getItem('drapeon.web.auth.roleIntent')
      const { data } = await supabase.auth.getUser()
      const onboarding = readStoredOnboarding() ?? webOnboardingFromUser(data.user)
      const metadataRole = data.user?.user_metadata?.role
      const role =
        onboarding?.role ??
        (roleIntent === 'CUSTOMER' || roleIntent === 'TAILOR' ? roleIntent : null) ??
        (metadataRole === 'CUSTOMER' || metadataRole === 'TAILOR' ? metadataRole : null)

      if (role) {
        window.localStorage.removeItem('drapeon.web.auth.roleIntent')
        window.localStorage.removeItem('drapeon.web.auth.onboarding')
        await supabase.auth.updateUser({
          data: {
            role,
            display_name: onboarding?.displayName,
            phone: onboarding?.phone,
            web_onboarding: onboarding ?? undefined,
          },
        }).catch(() => null)
        await syncRoleMirror(role)
      }

      if (onboarding) {
        if (data.user?.id) {
          await bootstrapWebOnboarding(supabase, {
            userId: data.user.id,
            onboarding,
          }).catch(() => null)
        }
      }

      router.replace(next as Route)
    }

    void complete()

    return () => {
      active = false
    }
  }, [router, searchParams])

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)] px-5 py-8">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-lg place-items-center">
        <div className="w-full rounded-[1.6rem] border border-ink/8 bg-white/88 p-7 text-center shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Drapeon</p>
          <h1 className="mt-3 text-4xl text-ink">Opening your account</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">{message}</p>
        </div>
      </section>
    </main>
  )
}
