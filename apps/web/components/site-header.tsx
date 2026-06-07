'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { Route } from 'next'
import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'

const navItems: Array<{ href: Route; label: string }> = [
  { href: '/vision', label: 'Drape Vision' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/customers', label: 'Customers' },
  { href: '/tailors', label: 'Tailors' },
]

const actionItems: Array<{ href: Route; label: string; primary: boolean }> = [
  { href: '/sign-in', label: 'Sign in', primary: false },
  { href: '/sign-up', label: 'Create account', primary: true },
]

export function SiteHeader(): JSX.Element {
  const pathname = usePathname()
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const isActive = (href: string): boolean => pathname === href || pathname?.startsWith(`${href}/`) === true

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>

    try {
      supabase = createClient()
    } catch (error) {
      console.warn('[site-header] Auth session check unavailable.', error)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSignedIn(Boolean(data.session?.user.id))
      setCheckingSession(false)
    }).catch((error: unknown) => {
      console.warn('[site-header] Auth session check failed.', error)
      if (!active) return
      setSignedIn(false)
      setCheckingSession(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSignedIn(Boolean(nextSession?.user.id))
      setCheckingSession(false)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (error) {
      console.warn('[site-header] Sign out failed.', error)
    }
    setSignedIn(false)
    setSigningOut(false)
    router.replace('/sign-in')
    router.refresh()
  }

  return (
    <header className="flex flex-col gap-3 rounded-[1.25rem] border border-ink/8 bg-white/88 px-4 py-3 shadow-[0_18px_60px_rgba(22,28,24,0.06)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
      <Link href="/" className="shrink-0 text-2xl font-semibold tracking-[-0.04em] text-needle sm:text-3xl">
        Drapeon
      </Link>
      <nav className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink/72 lg:justify-end">
        {navItems.map((item) => {
          const active = isActive(item.href)
          const className = active
            ? 'whitespace-nowrap rounded-full border border-transparent bg-bone px-3 py-2 text-ink'
            : 'whitespace-nowrap rounded-full border border-transparent px-3 py-2 transition hover:bg-bone hover:text-ink'

          return (
            <Link key={item.href} href={item.href} className={className}>
              {item.label}
            </Link>
          )
        })}
        <span className="mx-1 hidden h-6 w-px bg-ink/8 lg:inline-block" />
        {signedIn ? (
          <>
            <Link
              href="/account/dashboard"
              className={
                isActive('/account')
                  ? 'whitespace-nowrap rounded-full border border-ink/8 bg-bone px-4 py-2 text-ink'
                  : 'whitespace-nowrap rounded-full border border-ink/8 bg-white px-4 py-2 text-ink transition hover:bg-bone'
              }
            >
              Account
            </Link>
            <button
              type="button"
              onClick={() => {
                void signOut()
              }}
              disabled={signingOut}
              className="whitespace-nowrap rounded-full border border-transparent bg-needle px-4 py-2 text-white shadow-sm transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
            >
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </>
        ) : checkingSession ? null : (
          actionItems.map((item) => {
            const active = isActive(item.href)
            const className = item.primary
              ? 'whitespace-nowrap rounded-full border border-transparent bg-needle px-4 py-2 text-white shadow-sm transition hover:bg-needle-600'
              : active
                ? 'whitespace-nowrap rounded-full border border-ink/8 bg-bone px-4 py-2 text-ink'
                : 'whitespace-nowrap rounded-full border border-ink/8 bg-white px-4 py-2 text-ink transition hover:bg-bone'

            return (
              <Link key={item.href} href={item.href} className={className}>
                {item.label}
              </Link>
            )
          })
        )}
      </nav>
    </header>
  )
}
