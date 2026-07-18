import type { Metadata } from 'next'
import { CONTACTS, DRAPE_EXCEPTION_BUCKETS, DRAPE_HELP_FAQ, buildWhatsAppSupportUrl } from '@drape/shared'
import Link from 'next/link'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: 'How do I track an order on Drapeon?',
    answer:
      'Orders move through one clear thread, so customers can follow quote, consultation, production, delivery or collection, and final completion in one place.',
  },
  {
    question: 'How do customers raise a concern?',
    answer:
      'Concerns start from the order itself, where the history and updates are still visible.',
  },
  {
    question: 'What if the connection is weak or a live feature fails?',
    answer:
      'Start from the live order first. Messages, stage history, and order updates remain the source of truth even when calls, pushes, or other real-time features do not come through cleanly.',
  },
  {
    question: 'How do tailors receive and manage orders?',
    answer:
      'Tailors receive a clear brief, review the fit and garment context, then quote and manage production from one workspace.',
  },
  {
    question: 'What if I just need the right inbox?',
    answer:
      'Use support for customer help, tailors for tailor-side help, privacy for privacy questions, security for security issues, and legal for formal matters.',
  },
  ...DRAPE_HELP_FAQ,
]

export const metadata: Metadata = buildMetadata({
  title: 'Help',
  description: 'Get help with Drapeon and find the right team for support, privacy, security, or legal issues.',
  path: '/help',
})

export default function HelpPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Help"
      title="Get the right answer without more confusion."
      description="Quick answers, degraded-state guidance, and the right contact path."
      cta={
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={`mailto:${CONTACTS.support}?subject=Drapeon%20support%20request`}
            className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          >
            Contact customer support
          </a>
          <a
            href={buildWhatsAppSupportUrl('Hi Drapeon, I need support.')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-needle/15 bg-white px-5 py-3 text-sm font-semibold text-needle"
          >
            WhatsApp support
          </a>
          <a
            href={`mailto:${CONTACTS.tailors}?subject=Tailor%20support%20request`}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink"
          >
            Contact tailor support
          </a>
        </div>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Common questions"
          title="Start with the fundamentals."
          description="A few quick answers first."
        />
        <div className="mt-10 grid gap-4">
          {FAQ.map((item) => (
            <div key={item.question} className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <h3 className="text-2xl text-ink">{item.question}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Real-life exceptions"
          title="When the normal path is not enough, Drapeon still has a path."
          description="Most tailoring problems are not bugs. They are real-life moments that need clear ownership."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {DRAPE_EXCEPTION_BUCKETS.map((bucket) => (
            <div key={bucket.id} className="rounded-[8px] border border-ink/6 bg-white/82 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
                {bucket.title}
              </p>
              <p className="mt-3 text-sm leading-7 text-ink/68">{bucket.launchRule}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="When Signal Is Weak"
          title="Use the durable path first."
          description="Drapeon keeps the order record useful when live features are delayed or connectivity is uneven."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {[
            [
              'Open the order first',
              'Quotes, handoff status, and concern history stay clearest from the order itself.',
            ],
            [
              'Keep messages in Drapeon',
              'If a call or push fails, keep the conversation in the order thread so the shared timeline stays intact.',
            ],
            [
              'Escalate with context',
              'When the normal flow is no longer enough, support works better when the order history is already preserved in one place.',
            ],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{title}</p>
              <p className="mt-3 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Need a direct path?"
          title="Use the team that matches the issue."
          description="Go straight to the right inbox."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <a
            href={buildWhatsAppSupportUrl('Hi Drapeon, I need help.')}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[8px] border border-ink/6 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">WhatsApp support</p>
            <h3 className="mt-3 text-2xl text-ink">Message Drapeon</h3>
            <p className="mt-3 text-sm leading-7 text-ink/68">Quick human routing for launch support and general help.</p>
          </a>
          {[
            ['Customer support', CONTACTS.support, 'Customer help and order questions.'],
            ['Tailor support', CONTACTS.tailors, 'Tailor help and application questions.'],
            ['Privacy', CONTACTS.privacy, 'Privacy and data requests.'],
            ['Security', CONTACTS.security, 'Security reports.'],
            ['Legal', CONTACTS.legal, 'Formal legal communication.'],
            ['Verification', CONTACTS.verify, 'Verification questions.'],
          ].map(([label, email, description]) => (
            <a
              key={String(email)}
              href={`mailto:${email}`}
              className="rounded-[8px] border border-ink/6 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
              <h3 className="mt-3 text-2xl text-ink">{email}</h3>
              <p className="mt-3 text-sm leading-7 text-ink/68">{description}</p>
            </a>
          ))}
        </div>
        <div className="mt-10">
          <Link href="/faq" className="inline-flex items-center text-sm font-semibold text-needle">
            Browse the public FAQ too
          </Link>
        </div>
      </section>
    </MarketingShell>
  )
}
