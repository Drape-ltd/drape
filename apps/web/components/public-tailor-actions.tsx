'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { ArrowRight, Bookmark } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabase'

type AccountState = 'checking' | 'signed-out' | 'customer' | 'tailor' | 'unconfigured'

type TailorProfileRead = {
  isSaved?: boolean
  profile?: { userId?: string | null } | null
}

export function PublicTailorActions({
  tailorId,
  acceptsCustomOrders,
}: {
  tailorId: string
  acceptsCustomOrders: boolean
}): React.JSX.Element {
  const [accountState, setAccountState] = useState<AccountState>('checking')
  const [isSaved, setIsSaved] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
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

      const [customerResult, tailorResult, profileResult] = await Promise.all([
        supabase.from('customer_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('tailor_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle(),
        supabase.functions.invoke<TailorProfileRead>('read-gateway', {
          body: { action: 'tailor-profile', tailorId },
        }),
      ])
      if (!active) return
      setIsSaved(profileResult.data?.isSaved === true)
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

  async function toggleSaved(): Promise<void> {
    if (accountState !== 'customer' || savePending) return
    setSavePending(true)
    setSaveMessage(null)
    const nextSaved = !isSaved
    try {
      const { data, error } = await createClient().functions.invoke<{ error?: string; message?: string }>('saved-tailor-action', {
        body: {
          action: nextSaved ? 'save-tailor' : 'unsave-by-profile',
          tailorProfileId: tailorId,
        },
      })
      if (error || data?.error) throw new Error(data?.message ?? 'Saved tailors could not be updated.')
      setIsSaved(nextSaved)
      setSaveMessage(nextSaved ? 'Saved to your tailors.' : 'Removed from saved tailors.')
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Saved tailors could not be updated. Try again.')
    } finally {
      setSavePending(false)
    }
  }

  if (!acceptsCustomOrders) {
    return <p className="text-sm text-ink/48">Custom briefs are not currently open.</p>
  }

  return (
    <div aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        {accountState === 'tailor' ? (
          <span className="text-sm text-ink/48">Switch to a customer account to send a brief.</span>
        ) : (
          <Link
            href={accountState === 'customer' ? briefHref : accountState === 'unconfigured' ? chooseRoleHref : signInHref}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-xs font-semibold text-white transition-colors hover:bg-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
          >
            Start a brief <ArrowRight aria-hidden="true" size={14} />
          </Link>
        )}
        {accountState === 'customer' ? (
          <button
            type="button"
            onClick={() => { void toggleSaved() }}
            disabled={savePending}
            aria-pressed={isSaved}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/14 px-4 text-xs font-semibold text-ink transition-colors hover:border-needle hover:text-needle disabled:cursor-wait disabled:opacity-55"
          >
            <Bookmark aria-hidden="true" size={14} fill={isSaved ? 'currentColor' : 'none'} />
            {savePending ? 'Updating…' : isSaved ? 'Saved' : 'Save tailor'}
          </button>
        ) : null}
      </div>
      {accountState === 'signed-out' ? (
        <p className="mt-3 text-xs text-ink/48">Sign in or create an account, then return here.</p>
      ) : accountState === 'checking' ? (
        <p className="mt-3 text-xs text-ink/48">Checking your account…</p>
      ) : saveMessage ? (
        <p className="mt-3 text-xs text-ink/58">{saveMessage}</p>
      ) : null}
    </div>
  )
}
