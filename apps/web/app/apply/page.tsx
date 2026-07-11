import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { TailorApplicationForm } from '../../components/tailor-application-form'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Apply as Tailor',
  description: 'Submit a short tailor application to Drapeon.',
  path: '/apply',
})

export default function ApplyPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Tailor application"
      title="Show your craft clearly. Tell us why you belong in Drapeon."
      description="A short application for serious tailors."
      cta={
        <Link
          href="/tailors"
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          See the tailor journey
        </Link>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="What we want to learn"
          title="Strong fit matters more than generic volume."
          description="Specialty, proof of craft, and where you work."
        />
      </section>

      <section className="pb-12">
        <div className="rounded-[1.75rem] border border-ink/6 bg-white/88 p-6 shadow-sm">
        <TailorApplicationForm />
        </div>
      </section>
    </MarketingShell>
  )
}
