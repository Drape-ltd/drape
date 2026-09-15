'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { PublicSiteHeader } from './public-site-header'

type Preview = { referrerName: string; completedOrderCount: number; alreadyClaimedByYou: boolean; claimedBySomeoneElse: boolean }

export function ReferralClaim({ params }: { params: Promise<{ code: string }> }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    let cancelled = false
    void params.then(async ({ code: nextCode }) => {
      if (cancelled) return
      setCode(nextCode)
      const client = createClient()
      const { data } = await client.auth.getSession()
      if (cancelled) return
      setSignedIn(Boolean(data.session))
      setSessionReady(true)
      if (!data.session) return
      const { data: result, error: invokeError } = await client.functions.invoke<Preview & { error?: string }>('referral-action', { body: { action: 'preview', referralCode: nextCode } })
      if (cancelled) return
      if (invokeError || !result || result.error) {
        setError(result?.error ?? 'This referral link is not available. Ask for a fresh link.')
        return
      }
      setPreview(result)
    })
    return () => { cancelled = true }
  }, [params])

  async function claim() {
    if (!code || claiming) return
    setClaiming(true)
    setError(null)
    const { data, error: invokeError } = await createClient().functions.invoke<{ ok?: boolean; error?: string }>('referral-action', { body: { action: 'claim', referralCode: code } })
    setClaiming(false)
    if (invokeError || !data?.ok) {
      setError(data?.error ?? 'We could not claim this referral right now. Please try again.')
      return
    }
    router.replace('/account/orders?notice=referral-claimed')
  }

  const signInHref = `/sign-in?next=${encodeURIComponent(`/referral/${encodeURIComponent(code)}`)}`
  return (
    <main className="min-h-screen bg-[#f4f0e8] text-ink">
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-5 sm:px-8"><PublicSiteHeader />
        <section className="mx-auto mt-12 max-w-xl"><div className="rounded-[18px] border border-ink/10 bg-white p-7 shadow-[0_18px_60px_rgba(22,28,24,0.07)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Drapeon referral</p>
          {!sessionReady ? <p className="mt-5 text-sm text-ink/60">Opening your referral…</p> : !signedIn ? <>
            <h1 className="mt-3 text-4xl leading-tight">Someone invited you to Drapeon.</h1>
            <p className="mt-4 text-sm leading-6 text-ink/65">Sign in or create an account to attach this referral to your Drapeon history. Referral context is only shown to future tailors as a trust signal.</p>
            <Link href={signInHref as Route} className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-needle px-5 text-sm font-semibold text-white">Sign in or create account</Link>
          </> : error ? <>
            <h1 className="mt-3 text-4xl leading-tight">Referral unavailable.</h1>
            <p className="mt-4 rounded-[10px] border border-rust/20 bg-rust/5 p-4 text-sm leading-6 text-ink/70">{error}</p>
            <Link href="/explore" className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 bg-bone px-5 text-sm font-semibold">Explore Drapeon</Link>
          </> : preview ? <>
            <h1 className="mt-3 text-4xl leading-tight">{preview.referrerName} invited you to Drapeon.</h1>
            <p className="mt-4 text-sm leading-6 text-ink/65">Claiming this referral gives future tailors helpful context while you build your own Drapeon history. It never replaces normal brief, measurement, payment, or trust review.</p>
            <dl className="mt-7 divide-y divide-ink/10 rounded-[12px] border border-ink/10 bg-bone/55 px-4"><div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-ink/55">Referred by</dt><dd className="font-semibold">{preview.referrerName}</dd></div><div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-ink/55">Completed Drapeon orders</dt><dd className="font-semibold">{preview.completedOrderCount}</dd></div></dl>
            {preview.alreadyClaimedByYou ? <p className="mt-6 rounded-[10px] border border-needle/20 bg-needle/5 p-4 text-sm font-semibold text-needle">This referral is already attached to your account.</p> : preview.claimedBySomeoneElse ? <p className="mt-6 rounded-[10px] border border-rust/20 bg-rust/5 p-4 text-sm">This referral has already been claimed.</p> : <button type="button" onClick={() => void claim()} disabled={claiming} className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-needle px-5 text-sm font-semibold text-white disabled:opacity-60">{claiming ? 'Claiming referral…' : 'Claim referral'}</button>}
          </> : null}
        </div></section>
      </div>
    </main>
  )
}
