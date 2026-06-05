import type { Metadata } from 'next'
import type { JSX } from 'react'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

const FAQ: Array<{ question: string; answer: string }> = [
  {
    question: 'How does Drapeon work?',
    answer:
      'Drapeon gives customers one clear order flow and gives tailors one calm workspace. Discovery, briefing, quote review, progress updates, delivery or collection, and review all stay in one trusted thread.',
  },
  {
    question: 'How do customers start an order?',
    answer:
      'Customers find a tailor they trust, then submit one brief with garment details, references, fit context, and delivery expectations. That order becomes the shared thread for quote, production, and handoff.',
  },
  {
    question: 'How do tailors receive work?',
    answer:
      'Tailors who are live on Drapeon receive stronger briefs instead of scattered messages. They can review the order, consult if needed, send a quote, and manage production from one pipeline.',
  },
  {
    question: 'How does payment work?',
    answer:
      'Drapeon is designed so the commercial agreement becomes clear before production begins. Customers review and accept the quote, and the order then moves forward through the tracked workflow.',
  },
  {
    question: 'How are tailors verified?',
    answer:
      'Verification is designed to make trust clearer, with identity checks and visible proof of craft.',
  },
  {
    question: 'How do I track an order?',
    answer:
      'Customers can follow the order through quote, consultation, production stages, and handoff instead of chasing updates across separate channels.',
  },
  {
    question: 'What if something goes wrong?',
    answer:
      'Drapeon keeps the important communication and stage history close to the order so concerns can be raised with the right context attached.',
  },
  {
    question: 'Can I download Drapeon today?',
    answer:
      'Join the queue and we will share access as Drapeon opens to more customers and tailors.',
  },
]

export const metadata: Metadata = buildMetadata({
  title: 'FAQ',
  description: 'Read the public Drapeon FAQ and understand the core customer, tailor, and trust flows.',
  path: '/faq',
})

export default function FaqPage(): JSX.Element {
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
              <div key={item.question} className="rounded-[1.5rem] border border-ink/6 bg-white/82 p-6 shadow-sm">
                <h3 className="text-2xl text-ink">{item.question}</h3>
                <p className="mt-3 text-sm leading-7 text-ink/68">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      </MarketingShell>
    </>
  )
}
