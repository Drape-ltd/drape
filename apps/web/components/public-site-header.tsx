'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { clearWebSessionScope } from '../lib/web-session-scope'
import { SocialIconLinks } from './social-links'

const navItems: Array<{ href: Route; label: string }> = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/tailors', label: 'For tailors' },
  { href: '/vision', label: 'Drapeon Vision' },
]


export function PublicSiteHeader(): React.JSX.Element {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const isActive = (href: string): boolean => pathname === href || pathname?.startsWith(`${href}/`) === true

  const linkClassName = (href: string) => {
    const active = isActive(href)
    return active
      ? 'rounded-full border border-needle/12 bg-needle/10 px-3 py-2 text-needle'
      : 'rounded-full border border-transparent px-3 py-2 text-ink/72 transition hover:bg-bone hover:text-ink'
  }

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
          console.warn('[public-site-header] Auth session check failed.', error)
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
        console.warn('[public-site-header] Auth session check unavailable.', error)
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
    setMenuOpen(false)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (error) {
      console.warn('[public-site-header] Sign out failed.', error)
    }
    clearWebSessionScope()
    setSignedIn(false)
    setSigningOut(false)
    router.replace('/sign-in')
    router.refresh()
  }

  return (
    <header className="viewport-safe-shell sticky top-3 z-40 min-w-0 rounded-[1.25rem] border border-ink/8 bg-white/92 px-4 py-3 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="shrink-0 text-2xl font-semibold tracking-[-0.04em] text-needle sm:text-3xl"
          data-analytics-event="nav_click"
          data-analytics-label="Drapeon home"
        >
          Drapeon
        </Link>

        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-bone lg:hidden"
          aria-controls="public-site-menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>

        <nav className="hidden items-center gap-1.5 text-sm font-medium lg:flex" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClassName(item.href)}
              aria-current={isActive(item.href) ? 'page' : undefined}
              data-analytics-event="nav_click"
              data-analytics-label={item.label}
            >
              {item.label}
            </Link>
          ))}
          <span className="mx-1 h-6 w-px bg-ink/8" />
          <SocialIconLinks size="sm" />
          <span className="mx-1 h-6 w-px bg-ink/8" />
          {signedIn ? (
            <>
              <Link
                href="/account/work"
                className="rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600"
                data-analytics-event="nav_click"
                data-analytics-label="Dashboard"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => { void signOut() }}
                disabled={signingOut}
                className="px-2 py-2 text-sm font-semibold text-ink/46 transition hover:text-ink disabled:cursor-not-allowed"
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </>
          ) : checkingSession ? null : (
            <>
              <Link
                href="/sign-in"
                className={isActive('/sign-in') ? 'rounded-full border border-ink/8 bg-bone px-4 py-2 text-sm font-semibold text-ink' : 'rounded-full border border-ink/8 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone'}
                aria-current={isActive('/sign-in') ? 'page' : undefined}
                data-analytics-event="nav_click"
                data-analytics-label="Sign in"
              >
                Sign in
              </Link>
              <Link
                href="/join"
                className="rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600"
                data-analytics-event="primary_cta_click"
                data-analytics-label="Join waitlist"
              >
                Join waitlist
              </Link>
            </>
          )}
        </nav>
      </div>

      <nav
        id="public-site-menu"
        className={`${menuOpen ? 'grid' : 'hidden'} mt-4 gap-2 border-t border-ink/6 pt-4 text-sm font-medium lg:hidden`}
        aria-label="Mobile navigation"
      >
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${linkClassName(item.href)} min-h-11 text-center`}
            aria-current={isActive(item.href) ? 'page' : undefined}
            data-analytics-event="nav_click"
            data-analytics-label={item.label}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
        {signedIn ? (
          <div className="grid gap-2 pt-2 sm:grid-cols-2">
            <Link
              href="/account/work"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600"
              data-analytics-event="nav_click"
              data-analytics-label="Dashboard"
              onClick={() => setMenuOpen(false)}
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => { void signOut() }}
              disabled={signingOut}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink/60 transition hover:text-ink disabled:cursor-not-allowed disabled:text-ink/30"
            >
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        ) : checkingSession ? null : (
          <div className="grid gap-2 pt-2 sm:grid-cols-2">
            <Link
              href="/sign-in"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/8 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone"
              data-analytics-event="nav_click"
              data-analytics-label="Sign in"
              onClick={() => setMenuOpen(false)}
            >
              Sign in
            </Link>
            <Link
              href="/join"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600"
              data-analytics-event="primary_cta_click"
              data-analytics-label="Join waitlist"
              onClick={() => setMenuOpen(false)}
            >
              Join waitlist
            </Link>
          </div>
        )}
      </nav>
    </header>
  )
}
