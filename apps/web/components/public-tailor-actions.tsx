'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabase'
import { WishlistSaveControl } from './wishlist-save-control'

type AccountState = 'checking' | 'signed-out' | 'customer' | 'tailor' | 'unconfigured'

export function PublicTailorActions({
  tailorId,
  acceptsCustomOrders,
}: {
  tailorId: string
  acceptsCustomOrders: boolean
}): React.JSX.Element {
  const [accountState, setAccountState] = useState<AccountState>('checking')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const briefHref = useMemo(() => `/account/brief/${tailorId}` as Route, [tailorId])
  const signInHref = useMemo(
    () => `/sign-in?next=${encodeURIComponent(briefHref)}` as Route,
    [briefHref],
  )
  const chooseRoleHref = useMemo(
    () => `/account/choose-role?next=${encodeURIComponent(briefHref)}` as Route,
    [briefHref],
  )

  useEffect(() => {
    let active = true
    const supabase = createClient()

    async function resolveAccount(session: { user: { id: string } } | null) {
      if (!session) {
        if (active) setAccountState('signed-out')
        return
      }

      const [customerResult, tailorResult] = await Promise.all([
        supabase.from('customer_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('tailor_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle(),
      ])
      if (!active) return
      setCustomerId(customerResult.data ? session.user.id : null)
      setAccountState(customerResult.data ? 'customer' : tailorResult.data ? 'tailor' : 'unconfigured')
    }

    void supabase.auth.getSession().then(({ data }) => {
      void resolveAccount(data.session)
    }).catch(() => {
      if (active) setAccountState('signed-out')
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolveAccount(session)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [tailorId])

  return (
    <div aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        {!acceptsCustomOrders ? (
          <span className="text-sm text-ink/48">Custom briefs are not currently open.</span>
        ) : accountState === 'tailor' ? (
          <span className="text-sm text-ink/48">Switch to a customer account to send a brief.</span>
        ) : (
          <Link
            href={accountState === 'customer' ? briefHref : accountState === 'unconfigured' ? chooseRoleHref : signInHref}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-xs font-semibold text-white transition-colors hover:bg-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
          >
            Start a brief <ArrowRight aria-hidden="true" size={14} />
          </Link>
        )}
        {accountState === 'customer' && customerId ? <WishlistSaveControl userId={customerId} target={{ type: 'TAILOR', id: tailorId }} /> : null}
      </div>
      {accountState === 'signed-out' ? (
        <p className="mt-3 text-xs text-ink/48">Sign in or create an account, then return here.</p>
      ) : accountState === 'checking' ? (
        <p className="mt-3 text-xs text-ink/48">Checking your account…</p>
      ) : null}
    </div>
  )
}
