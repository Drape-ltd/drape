import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: 'How does Drapeon work?',
    answer:
      'Drapeon gives customers one order record and gives tailors one operating workspace. Discovery, brief, quote, payment state, production updates, delivery or collection, support, payout readiness, and review stay attached to the same order.',
  },
  {
    question: 'How do customers start an order?',
    answer:
      'Customers choose a tailor or ready-made piece, then submit a brief with garment details, references, fit context, deadline, measurements, and delivery expectations. The tailor can review that context before quoting.',
  },
  {
    question: 'How do tailors receive work?',
    answer:
      'Verified tailors can receive structured briefs, ask follow-up questions, consult if needed, quote from the order, and move production through visible stages instead of managing everything in separate chats.',
  },
  {
    question: 'How does payment work?',
    answer:
      'The customer reviews the quote and payment state before production starts. Drapeon keeps provider checkout, payment confirmation, refund state, and payout readiness attached to the order so nobody relies on screenshots alone.',
  },
  {
    question: 'How are tailors verified?',
    answer:
      'Verification may include identity or business checks, profile completeness, portfolio or craft proof, payout readiness, and terms acceptance. A verified badge is a trust signal, not a guarantee that every order will be perfect.',
  },
  {
    question: 'How do I track an order?',
    answer:
      'Customers can follow quote, payment, consultation, sourcing, approval, cutting, sewing, finishing, delivery, pickup, shipping, receipt confirmation, support, and review from the order timeline.',
  },
  {
    question: 'What if something goes wrong?',
    answer:
      'Drapeon keeps messages, payment state, media, production stages, delivery context, and support history attached to the order so a support or dispute review starts from the shared record.',
  },
  {
    question: 'Can I download Drapeon today?',
    answer:
      'Drapeon is in invite-only testing. Join the early-access queue and we will notify you when your customer or tailor access opens.',
  },
]

export const metadata: Metadata = buildMetadata({
  title: 'FAQ',
  description: 'Learn how Drapeon works for custom tailoring orders, verified tailors, payment state, order tracking, Drapeon Vision, and invite-only access.',
  path: '/faq',
})

export default async function FaqPage(): Promise<React.JSX.Element> {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }

  return (
    <>
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MarketingShell
        eyebrow="FAQ"
        title="Questions resolve into clarity, not more guesswork."
        description="A quick guide to the most common questions about Drapeon."
      >
        <section className="py-8">
          <SectionTitle
            eyebrow="Common questions"
            title="The fundamentals."
            description="Quick answers before you reach out."
          />
          <div className="mt-10 grid gap-4">
            {FAQ.map((item) => (
              <details key={item.question} className="group rounded-[1.5rem] border border-ink/6 bg-white/82 p-5 shadow-sm">
                <summary className="cursor-pointer list-none text-xl text-ink marker:hidden focus-visible:outline-none sm:text-2xl">
                  <span className="inline-flex w-full items-center justify-between gap-4">
                    {item.question}
                    <span className="shrink-0 rounded-full border border-ink/10 px-3 py-1 text-sm font-sans font-semibold text-needle group-open:bg-needle group-open:text-white">
                      Open
                    </span>
                  </span>
                </summary>
                <p className="mt-4 text-sm leading-7 text-ink/68">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </MarketingShell>
    </>
  )
}
