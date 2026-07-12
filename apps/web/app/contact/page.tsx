import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata, publicPhoneDisplay, publicPhoneE164, socialLinks } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Contact',
  description: 'Reach Drapeon by email, phone, Instagram, or X for support, privacy, security, legal, press, and partnerships.',
  path: '/contact',
})

const primaryContactRoutes = [
  ['General', CONTACTS.hello, 'General questions, partnerships, press routing, or anything you are unsure about.'],
  ['Security', CONTACTS.security, 'Security disclosures, suspicious behavior, or account takeover concerns.'],
] satisfies Array<readonly [string, string, string]>

const specializedContactRoutes = [
  ['Customer support', CONTACTS.support, 'Customer help.'],
  ['Tailor support', CONTACTS.tailors, 'Tailor help and applications.'],
  ['Partnerships', CONTACTS.partnerships, 'Partnership conversations.'],
  ['Press', CONTACTS.press, 'Media inquiries.'],
  ['Privacy', CONTACTS.privacy, 'Privacy and data requests.'],
  ['Legal', CONTACTS.legal, 'Formal legal communication.'],
] satisfies Array<readonly [string, string, string]>

export default function ContactPage(): React.JSX.Element {
  const publicContactRoutes = [
    {
      label: 'Phone',
      value: publicPhoneDisplay,
      href: `tel:${publicPhoneE164}`,
      description: 'Call or text the public Drapeon line for launch and support routing.',
    },
    ...socialLinks.map((link) => ({
      label: link.label,
      value: link.url.replace(/^https?:\/\//u, '').replace(/\/$/u, ''),
      href: link.url,
      description: `Follow Drapeon on ${link.label} for launch updates and public announcements.`,
    })),
  ] satisfies Array<{ label: string; value: string; href: string; description: string }>

  return (
    <MarketingShell
      eyebrow="Contact"
      title="Reach the right Drapeon team."
      description="Drapeon is operated by O4 Group LLC. Use the right drapeon.co inbox, phone line, or social channel for support, privacy, security, legal, press, and partnerships."
      cta={
        <a
          href={`mailto:${CONTACTS.hello}?subject=Drapeon%20contact`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Email Drapeon
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="Start here"
          title="Two routes cover most public questions."
          description="Use general contact for commercial or product questions. Use security for vulnerability reports or suspicious account behavior."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {primaryContactRoutes.map(([label, email, description]) => (
            <a
              key={String(email)}
              href={`mailto:${email}`}
              aria-label={`Email ${label.toLowerCase()} at ${email}`}
              className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
              <p className="mt-3 break-words text-lg font-semibold text-ink">{email}</p>
              <p className="mt-3 text-sm leading-7 text-ink/68">{description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Public channels"
          title="Phone and social links."
          description="These are the official public channels Drapeon uses for launch updates and first-contact routing."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {publicContactRoutes.map((route) => (
            <a
              key={route.href}
              href={route.href}
              target={route.href.startsWith('http') ? '_blank' : undefined}
              rel={route.href.startsWith('http') ? 'me noopener noreferrer' : undefined}
              aria-label={`${route.label}: ${route.value}`}
              className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{route.label}</p>
              <p className="mt-3 break-words text-lg font-semibold text-ink">{route.value}</p>
              <p className="mt-3 text-sm leading-7 text-ink/68">{route.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="border-t border-ink/6 py-16">
        <SectionTitle
          eyebrow="Specialized inboxes"
          title="Use these when the topic is specific."
          description="These routes help us triage support, privacy, legal, verification, payout, and media questions."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {specializedContactRoutes.map(([label, email, description]) => (
            <a
              key={String(email)}
              href={`mailto:${email}`}
              aria-label={`Email ${label.toLowerCase()} at ${email}`}
              className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(22,28,24,0.10)]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">{label}</p>
              <p className="mt-3 break-words text-lg font-semibold text-ink">{email}</p>
              <p className="mt-3 text-sm leading-7 text-ink/68">{description}</p>
            </a>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}
