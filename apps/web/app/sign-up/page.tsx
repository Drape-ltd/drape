import type { Metadata } from 'next'
import Image from 'next/image'
import { AccountAuthForm } from '../../components/account-auth-form'
import { AccountSignedInRedirect } from '../../components/account-signed-in-redirect'
import { PublicSiteHeader } from '../../components/public-site-header'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Create account',
  description: 'Create a Drapeon account as a customer or tailor.',
  path: '/sign-up',
  noindex: true,
})

export default function SignUpPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <AccountSignedInRedirect to="/account/dashboard" tailorIntentTo="/apply?source=account" />
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <PublicSiteHeader />
        <section className="grid gap-8 py-8 lg:grid-cols-[1fr_1fr] lg:items-start lg:py-12">
          <div className="relative hidden min-h-[42rem] overflow-hidden rounded-[8px] bg-forest lg:block">
            <Image src="/editorial/drapeon-pattern-planning-v1.png" alt="A garment pattern being planned on a work table" fill priority sizes="(min-width: 1024px) 50vw, 0px" className="object-cover" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,29,23,0.06)_28%,rgba(15,29,23,0.9)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 p-8 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Begin with context</p>
              <h2 className="mt-3 max-w-md text-4xl leading-[1.02]">A clearer path from idea to handoff.</h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-white/72">Create one account, then choose the workspace that fits how you use Drapeon.</p>
              <a href="/sign-in" className="mt-6 inline-flex rounded-full border border-white/50 px-4 py-2 text-sm font-semibold transition hover:bg-white hover:text-ink">Sign in</a>
            </div>
          </div>

          {/* Right form panel */}
          <div>
            <AccountAuthForm mode="sign-up" />
          </div>
        </section>
      </div>
    </main>
  )
}
