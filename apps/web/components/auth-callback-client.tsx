'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { createClient } from '../lib/supabase'
import {
  bootstrapWebOnboarding,
  type WebOnboardingPayload,
} from '../lib/account-bootstrap'

function sanitizeNext(value: string | null) {
  return value?.startsWith('/') === true ? value : '/account/dashboard'
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
      const code = searchParams.get('code')
      const next = sanitizeNext(searchParams.get('next'))

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          if (active) setMessage('We could not finish sign in. Return to sign in and try again.')
          return
        }
      }

      const roleIntent = window.localStorage.getItem('drapeon.web.auth.roleIntent')
      const onboarding = readStoredOnboarding()
      if (roleIntent === 'CUSTOMER' || roleIntent === 'TAILOR') {
        window.localStorage.removeItem('drapeon.web.auth.roleIntent')
        window.localStorage.removeItem('drapeon.web.auth.onboarding')
        await supabase.auth.updateUser({
          data: {
            role: onboarding?.role ?? roleIntent,
            display_name: onboarding?.displayName,
            phone: onboarding?.phone,
            web_onboarding: onboarding ?? undefined,
          },
        }).catch(() => null)
        await syncRoleMirror(roleIntent)
      }

      if (onboarding) {
        const { data } = await supabase.auth.getUser()
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
