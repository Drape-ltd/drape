import type { Metadata } from 'next'
import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import { AccountRecoveryRequestForm } from '../../../components/account-recovery-request-form'
import { PublicSiteHeader } from '../../../components/public-site-header'
import { SiteFooter } from '../../../components/site-footer'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Account recovery',
  description: 'Recover a Drapeon account, reset password, or get account access help.',
  path: '/account/recovery',
})

const RECOVERY_STEPS = [
  ['1', 'Check your inbox', 'The email can take a minute or two to arrive.'],
  [
    '2',
    'Open the secure link',
    'The reset is completed on drapeon.co—even when you requested it from the app.',
  ],
  [
    '3',
    'Sign in again',
    'Your remembered devices and other sessions are cleared after the change.',
  ],
] as const

export default function AccountRecoveryPage(): React.JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)]">
      <div className="viewport-safe-shell mx-auto px-0 py-4 sm:px-8 sm:py-6 lg:px-12">
        <PublicSiteHeader />

        <section className="mx-auto max-w-5xl py-10 sm:py-14">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Account recovery
            </p>
            <h1 className="mt-3 text-[2.4rem] leading-[1.02] text-ink sm:text-5xl">
              Reset your password.
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-ink/66">
              We’ll email you a secure link. It opens Drapeon’s web reset screen, then returns you
              to sign in.
            </p>
          </div>

          <div
            id="password-reset"
            className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-start"
          >
            <AccountRecoveryRequestForm />

            <aside className="rounded-[8px] border border-needle/12 bg-needle/[0.055] p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
                What to expect
              </p>
              <ol className="mt-5 grid gap-5">
                {RECOVERY_STEPS.map(([number, title, body]) => (
                  <li key={number} className="grid grid-cols-[32px_1fr] gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-needle text-xs font-semibold text-white">
                      {number}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-ink/62">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6 border-t border-needle/12 pt-5">
                <p className="text-sm font-semibold text-ink">
                  No longer have access to that email?
                </p>
                <p className="mt-1 text-sm leading-6 text-ink/62">
                  Contact us so we can verify ownership without weakening your account.
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-needle">
                  <a href={`mailto:${CONTACTS.support}?subject=Account%20access%20help`}>
                    Email support
                  </a>
                  <a
                    href={buildWhatsAppSupportUrl(
                      'Hi Drapeon, I need help recovering account access.'
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  )
}
