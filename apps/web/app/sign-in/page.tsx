import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AccountAuthForm } from '../../components/account-auth-form'
import { AccountSignedInRedirect } from '../../components/account-signed-in-redirect'
import { PublicSiteHeader } from '../../components/public-site-header'
import { buildMetadata } from '../../lib/metadata'
import { SignedOutFlash } from './signed-out-flash'

export const metadata: Metadata = buildMetadata({
  title: 'Sign in',
  description: 'Sign in to Drapeon as a customer or tailor.',
  path: '/sign-in',
  noindex: true,
})

export default function SignInPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <AccountSignedInRedirect to="/account/dashboard" />
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <PublicSiteHeader />
        <section className="grid gap-8 py-8 lg:grid-cols-[1fr_1fr] lg:items-start lg:py-12">
          {/* Left marketing panel */}
          <div className="hidden rounded-[8px] border border-ink/8 bg-white/72 p-8 shadow-[0_18px_60px_rgba(22,28,24,0.05)] lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Your tailoring workspace
            </p>
            <h2 className="mt-4 text-4xl leading-tight text-ink">
              Orders, messages, payments and fit records in one place.
            </h2>

            <div className="mt-8 grid gap-5">
              {/* Benefit 1 */}
              <div className="flex items-start gap-4">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-needle/10">
                  {/* Scissors icon */}
                  <svg viewBox="0 0 24 24" className="size-4 text-needle" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <line x1="20" y1="4" x2="8.12" y2="15.88" />
                    <line x1="14.47" y1="14.48" x2="20" y2="20" />
                    <line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                </div>
                <p className="text-sm leading-7 text-ink/66">
                  Track custom and ready-made orders from brief to delivery
                </p>
              </div>

              {/* Benefit 2 */}
              <div className="flex items-start gap-4">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-needle/10">
                  {/* Chat bubble icon */}
                  <svg viewBox="0 0 24 24" className="size-4 text-needle" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm leading-7 text-ink/66">
                  Message your tailor and share reference photos directly
                </p>
              </div>

              {/* Benefit 3 */}
              <div className="flex items-start gap-4">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-needle/10">
                  {/* Bookmark / saved icon */}
                  <svg viewBox="0 0 24 24" className="size-4 text-needle" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm leading-7 text-ink/66">
                  Manage measurements, saved tailors, and payments
                </p>
              </div>
            </div>

            <div className="mt-10 border-t border-ink/6 pt-6 text-sm text-ink/62">
              New to Drapeon?{' '}
              <a href="/sign-up" className="font-semibold text-needle hover:underline">
                Create account →
              </a>
            </div>
          </div>

          {/* Right form panel */}
          <div>
            <Suspense>
              <SignedOutFlash />
            </Suspense>
            <AccountAuthForm mode="sign-in" />
          </div>
        </section>
      </div>
    </main>
  )
}
