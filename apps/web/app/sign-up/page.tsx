import type { Metadata } from 'next'
import Link from 'next/link'
import type { JSX } from 'react'
import { AccountAuthForm } from '../../components/account-auth-form'
import { SiteHeader } from '../../components/site-header'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Create account',
  description: 'Create a Drapeon account as a customer or tailor.',
  path: '/sign-up',
})

export default function SignUpPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <SiteHeader />
        <section className="mx-auto max-w-xl py-8 lg:py-10">
          <AccountAuthForm mode="sign-up" />
          <div className="mt-5 flex flex-wrap justify-center gap-4 text-sm font-semibold text-needle">
            <Link href="/sign-in">Already have an account?</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </section>
      </div>
    </main>
  )
}
