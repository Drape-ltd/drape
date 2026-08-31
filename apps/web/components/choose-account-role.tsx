'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { createClient } from '../lib/supabase'

type Role = 'CUSTOMER' | 'TAILOR'

function safeNext(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/account/dashboard'
}

export function ChooseAccountRole(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState<Role | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(role: Role) {
    if (loading) return
    setLoading(role)
    setError(null)
    const supabase = createClient()
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError || !data.user) {
      setLoading(null)
      setError('Your sign-in expired. Return to sign in and try again.')
      return
    }

    const { error: metadataError } = await supabase.auth.updateUser({ data: { role } })
    if (metadataError) {
      setLoading(null)
      setError('We could not save that choice. Try again.')
      return
    }

    const { error: mirrorError } = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', data.user.id)
    if (mirrorError) {
      setLoading(null)
      setError('We could not finish account setup. Try again.')
      return
    }

    if (role === 'TAILOR') {
      router.replace('/apply?source=account' as Route)
      return
    }
    router.replace(safeNext(searchParams.get('next')) as Route)
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)] px-5 py-8">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-2xl place-items-center">
        <div className="w-full rounded-[8px] border border-ink/8 bg-white/88 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">One last step</p>
          <h1 className="mt-3 text-4xl text-ink sm:text-5xl">How will you use Drapeon?</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">Choose once to open the right setup. You can still discover and collaborate across Drapeon.</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => void choose('CUSTOMER')} disabled={loading !== null} className="min-h-32 rounded-[8px] border border-ink/10 bg-white p-5 text-left transition hover:border-needle hover:bg-bone disabled:opacity-50">
              <span className="block text-lg font-semibold text-ink">I’m looking for a tailor</span>
              <span className="mt-2 block text-sm leading-6 text-ink/60">Explore profiles, save measurements, and manage orders.</span>
            </button>
            <button type="button" onClick={() => void choose('TAILOR')} disabled={loading !== null} className="min-h-32 rounded-[8px] border border-ink/10 bg-white p-5 text-left transition hover:border-needle hover:bg-bone disabled:opacity-50">
              <span className="block text-lg font-semibold text-ink">I’m a tailor</span>
              <span className="mt-2 block text-sm leading-6 text-ink/60">Create your profile, show your work, and manage clients.</span>
            </button>
          </div>
          {loading ? <p className="mt-4 text-sm text-ink/60">Saving your choice…</p> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">{error}</p> : null}
        </div>
      </section>
    </main>
  )
}
