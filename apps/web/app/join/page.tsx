import type { Metadata } from 'next'
import { MarketingShell } from '../../components/marketing-shell'
import { WaitlistForm } from '../../components/waitlist-form'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Join',
  description: 'Join the Drapeon queue as a customer or tailor.',
  path: '/join',
})

export default function JoinPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Early access"
      title="Get early access to Drapeon."
      description="Join as a customer or tailor. We’ll reach out when your access opens."
    >
      <section className="grid gap-8 pb-16">
        <WaitlistForm
          role="CUSTOMER"
          title="Customer queue"
          description="For customers who want a calmer way to discover and order."
        />
        <WaitlistForm
          role="TAILOR"
          title="Tailor queue"
          description="For tailors who want cleaner briefs and a calmer pipeline."
        />
      </section>
    </MarketingShell>
  )
}
