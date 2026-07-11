'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { clearWebSessionScope } from '../lib/web-session-scope'

const navItems: Array<{ href: Route; label: string }> = [
  { href: '/vision', label: 'Drapeon Vision' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/customers', label: 'Customers' },
  { href: '/tailors', label: 'Tailors' },
]

const actionItems: Array<{ href: Route; label: string; primary: boolean }> = [
  { href: '/sign-in', label: 'Sign in', primary: false },
  { href: '/sign-up', label: 'Create account', primary: true },
]

export function SiteHeader(): React.JSX.Element {
  const pathname = usePathname()
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const isActive = (href: string): boolean => pathname === href || pathname?.startsWith(`${href}/`) === true

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | null = null

    Promise.resolve()
      .then(() => {
        const supabase = createClient()

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
        unsubscribe = () => subscription.subscription.unsubscribe()
      })
      .catch((error: unknown) => {
        console.warn('[site-header] Auth session check unavailable.', error)
        if (!active) return
        setSignedIn(false)
        setCheckingSession(false)
      })

    return () => {
      active = false
      unsubscribe?.()
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
    clearWebSessionScope()
    setSignedIn(false)
    setSigningOut(false)
    router.replace('/sign-in')
    router.refresh()
  }

  return (
    <header className="flex flex-col gap-3 rounded-[1rem] border border-ink/8 bg-white/90 px-4 py-3 shadow-[0_10px_34px_rgba(22,28,24,0.05)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
      <Link href="/" className="shrink-0 text-2xl font-semibold text-needle">
        Drapeon
      </Link>
      <nav className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink/72 lg:justify-end">
        {navItems.map((item) => {
          const active = isActive(item.href)
          const className = active
            ? 'whitespace-nowrap rounded-full border border-transparent bg-bone px-3 py-1.5 text-ink'
            : 'whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 transition hover:bg-bone hover:text-ink'

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
              href="/account/orders"
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
