import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAuthForm } from '../../components/account-auth-form'
import { PublicSiteHeader } from '../../components/public-site-header'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Sign in',
  description: 'Sign in to Drapeon as a customer or tailor.',
  path: '/sign-in',
})

export default function SignInPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <PublicSiteHeader />
        <section className="grid gap-8 py-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:py-12">
          <div className="rounded-[1.6rem] border border-ink/8 bg-white/72 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.05)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">One account</p>
            <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">Sign in to Drapeon.</h1>
            <p className="mt-4 text-sm leading-7 text-ink/66">
              Use the same account across web and mobile.
            </p>
          </div>
          <div>
            <AccountAuthForm mode="sign-in" />
          </div>
        </section>
      </div>
    </main>
  )
}
