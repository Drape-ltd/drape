import type { Metadata } from 'next'
import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import Link from 'next/link'
import { AccountRecoveryRequestForm } from '../../../components/account-recovery-request-form'
import { AppSurfacePreview } from '../../../components/product-visuals'
import { MarketingShell, SectionTitle } from '../../../components/marketing-shell'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Account recovery',
  description: 'Recover a Drapeon account, reset password, or get account access help.',
  path: '/account/recovery',
})

export default function AccountRecoveryPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Account recovery"
      title="Recover access without weakening account security."
      description="Request a password reset from web, then complete the protected recovery flow from the secure reset link."
      visual={<AppSurfacePreview variant="privacy" />}
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href="#password-reset"
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Reset password
          </a>
          <a
            href={buildWhatsAppSupportUrl('Hi Drapeon, I need help recovering account access.')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-needle/15 bg-white px-5 py-3 text-sm font-semibold text-needle"
          >
            WhatsApp support
          </a>
          <a
            href={`mailto:${CONTACTS.support}?subject=Account%20recovery%20help`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Contact support
          </a>
        </div>
      }
    >
      <section id="password-reset" className="py-8">
        <AccountRecoveryRequestForm />
      </section>

      <section className="py-8">
        <SectionTitle
          eyebrow="How recovery works"
          title="Recovery starts on web and finishes securely."
          description="Drapeon keeps account recovery clear for customers and tailors without exposing sensitive account controls on a public page."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3 xl:grid-cols-4">
          {[
            ['Request a reset link', 'Use the email attached to your Drapeon account. We show the same safe response even if the address is not registered.'],
            ['Open the email link', 'The reset link opens the protected recovery bridge so the new password is saved in a signed recovery flow.'],
            ['Confirm sensitive changes', 'Password, phone, payout, email, and deletion actions require recent password confirmation server-side.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Still blocked?"
          title="Use a human fallback."
          description="If you no longer control your email or suspect account takeover, support may ask for stronger proof before making changes."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <a href={`mailto:${CONTACTS.support}?subject=Account%20access%20help`} className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Support</p>
            <h3 className="mt-4 break-words text-2xl text-ink">{CONTACTS.support}</h3>
          </a>
          <a
            href={buildWhatsAppSupportUrl('Hi Drapeon, I need help recovering account access.')}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">WhatsApp</p>
            <h3 className="mt-4 break-words text-2xl text-ink">Message Drapeon</h3>
          </a>
          <a href={`mailto:${CONTACTS.security}?subject=Account%20security%20concern`} className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Security</p>
            <h3 className="mt-4 break-words text-2xl text-ink">{CONTACTS.security}</h3>
          </a>
          <Link href="/account-deletion" className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Deletion</p>
            <h3 className="mt-4 text-2xl text-ink">Account deletion</h3>
          </Link>
        </div>
      </section>
    </MarketingShell>
  )
}
