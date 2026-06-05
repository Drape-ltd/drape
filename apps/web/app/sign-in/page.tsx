import type { Metadata } from 'next'
import type { JSX } from 'react'
import { AccountAuthForm } from '../../components/account-auth-form'
import { SiteHeader } from '../../components/site-header'
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
        <SiteHeader />
        <section className="mx-auto max-w-xl py-8 lg:py-10">
          <AccountAuthForm mode="sign-in" />
        </section>
      </div>
    </main>
  )
}
