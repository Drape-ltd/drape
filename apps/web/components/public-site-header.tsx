'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Route } from 'next'
import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { signOutWebSession } from '../lib/web-auth-session'
import { SocialIconLinks } from './social-links'

const navItems: Array<{ href: Route; label: string; ownsPath: (pathname: string) => boolean }> = [
  { href: '/explore', label: 'Explore', ownsPath: (pathname) => pathname === '/explore' || pathname.startsWith('/tailors/') },
  { href: '/how-it-works', label: 'How it works', ownsPath: (pathname) => pathname === '/how-it-works' },
  { href: '/tailors', label: 'For tailors', ownsPath: (pathname) => pathname === '/tailors' },
  { href: '/vision', label: 'Drapeon Vision', ownsPath: (pathname) => pathname === '/vision' },
]


export function PublicSiteHeader({ tone = 'light' }: { tone?: 'light' | 'overlay' }): React.JSX.Element {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const isActive = (href: string): boolean => pathname === href || pathname?.startsWith(`${href}/`) === true
  const isNavItemActive = (item: (typeof navItems)[number]): boolean => item.ownsPath(pathname ?? '')

  const linkClassName = (item: (typeof navItems)[number]) => {
    const active = isNavItemActive(item)
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
      await signOutWebSession({
        reason: 'manual',
        redirectTo: '/sign-in',
        scope: 'local',
      })
    } catch (error) {
      console.warn('[public-site-header] Sign out failed.', error)
    }
    setSignedIn(false)
    setSigningOut(false)
  }

  const overlay = tone === 'overlay'

  return (
    <header className={overlay
      ? 'relative z-40 min-w-0 border-b border-white/18 px-5 py-4 text-white sm:px-7'
      : 'viewport-safe-shell sticky top-3 z-40 min-w-0 rounded-[8px] border border-ink/8 bg-white/92 px-4 py-3 shadow-[0_18px_60px_rgba(22,28,24,0.08)] backdrop-blur'}>
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className={overlay ? 'shrink-0 text-2xl font-semibold text-white sm:text-3xl' : 'shrink-0 text-2xl font-semibold text-needle sm:text-3xl'}
          data-analytics-event="nav_click"
          data-analytics-label="Drapeon home"
        >
          Drapeon
        </Link>

        <button
          type="button"
          className={overlay
            ? 'inline-flex min-h-11 items-center justify-center rounded-full border border-white/24 bg-black/18 px-4 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/28 lg:hidden'
            : 'inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-bone lg:hidden'}
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
              className={overlay ? 'rounded-full border border-transparent px-3 py-2 text-white/82 transition hover:bg-white/12 hover:text-white' : linkClassName(item)}
              aria-current={isNavItemActive(item) ? 'page' : undefined}
              data-analytics-event="nav_click"
              data-analytics-label={item.label}
            >
              {item.label}
            </Link>
          ))}
          {!overlay ? (
            <>
              <span className="mx-1 h-6 w-px bg-ink/8" />
              <SocialIconLinks size="sm" />
            </>
          ) : null}
          <span className={overlay ? 'mx-1 h-6 w-px bg-white/18' : 'mx-1 h-6 w-px bg-ink/8'} />
          {signedIn ? (
            <>
              <Link
                href="/account/work"
                className={overlay ? 'rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm transition hover:bg-bone' : 'rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600'}
                data-analytics-event="nav_click"
                data-analytics-label="Dashboard"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => { void signOut() }}
                disabled={signingOut}
                className={overlay ? 'px-2 py-2 text-sm font-semibold text-white/64 transition hover:text-white disabled:cursor-not-allowed' : 'px-2 py-2 text-sm font-semibold text-ink/46 transition hover:text-ink disabled:cursor-not-allowed'}
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </>
          ) : checkingSession ? null : (
            <>
              <Link
                href="/sign-in"
                className={overlay ? 'rounded-full px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/12' : isActive('/sign-in') ? 'rounded-full border border-ink/8 bg-bone px-4 py-2 text-sm font-semibold text-ink' : 'rounded-full border border-ink/8 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-bone'}
                aria-current={isActive('/sign-in') ? 'page' : undefined}
                data-analytics-event="nav_click"
                data-analytics-label="Sign in"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className={overlay ? 'rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm transition hover:bg-bone' : 'rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600'}
                data-analytics-event="primary_cta_click"
                data-analytics-label="Create account"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>

      <nav
        id="public-site-menu"
        className={`${menuOpen ? 'grid' : 'hidden'} mt-4 gap-2 border-t ${overlay ? 'border-white/18 bg-ink/72 p-3 backdrop-blur' : 'border-ink/6'} pt-4 text-sm font-medium lg:hidden`}
        aria-label="Mobile navigation"
      >
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${overlay ? 'rounded-full px-3 py-2 text-center text-white transition hover:bg-white/12' : linkClassName(item)} min-h-11 text-center`}
            aria-current={isNavItemActive(item) ? 'page' : undefined}
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
              href="/sign-up"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-needle-600"
              data-analytics-event="primary_cta_click"
              data-analytics-label="Create account"
              onClick={() => setMenuOpen(false)}
            >
              Create account
            </Link>
          </div>
        )}
      </nav>
    </header>
  )
}
