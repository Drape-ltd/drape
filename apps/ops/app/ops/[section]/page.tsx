import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHead } from '../../../components/page-head'
import { WorkList } from '../../../components/work-list'
import { loadCanonicalOpsData } from '../../../lib/data'
import { buildOpsWorkItems } from '../../../lib/work-items'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { isOpsArea } from '../../../lib/route-access-policy'

export const dynamic = 'force-dynamic'

const sections = {
  customers: { eyebrow: 'Marketplace / Customers', title: 'Customer operations', description: 'Privacy, support, disputes, and order exceptions connected to the customer record.', queues: ['privacy', 'support', 'operations'] },
  tailors: { eyebrow: 'Marketplace / Tailors', title: 'Tailor network', description: 'Trust, marketplace readiness, support, and payout blockers connected to each tailor.', queues: ['trust', 'support', 'operations', 'money'] },
  orders: { eyebrow: 'Marketplace / Orders', title: 'Orders & production', description: 'One operational view for the brief, consultation, money, production, fulfilment, and handoff lifecycle.', queues: ['operations', 'delivery', 'money'] },
  vision: { eyebrow: 'Marketplace / Vision', title: 'Measurements & Vision', description: 'Exceptions and support involving measurement profiles and Drapeon Vision, without exposing body data in list views.', queues: ['operations'] },
  communications: { eyebrow: 'Marketplace / Communications', title: 'Communications', description: 'Transactional, operational, and reviewed campaign delivery with terminal provider outcomes.', queues: ['operations', 'reliability'] },
  trust: { eyebrow: 'Marketplace / Trust', title: 'Trust & safety', description: 'Challenge-video verification, moderation, restrictions, appeals, and safety investigations.', queues: ['trust'] },
  delivery: { eyebrow: 'Marketplace / Delivery', title: 'Delivery & supply', description: 'Fulfilment changes, dispatch, custody evidence, sourcing, and provider recovery.', queues: ['delivery'] },
  money: { eyebrow: 'Marketplace / Money Desk', title: 'Money Desk', description: 'Prepared, independently reviewed money movement with scoped elevation and terminal receipts.', queues: ['money'] },
  incidents: { eyebrow: 'Reliability / Incidents', title: 'Incident command', description: 'Production-owned incidents from Drapeon synthetics and provider signals, ordered by impact.', queues: ['reliability'] },
  providers: { eyebrow: 'Reliability / Providers', title: 'Providers & jobs', description: 'Provider circuits, callback failures, queues, retries, and dead-letter work. Green vendor pages are not proof of Drapeon health.', queues: ['reliability'] },
  overview: { eyebrow: 'Governance / Overview', title: 'Leadership overview', description: 'A drillable operating picture for authorized leadership—not the ordinary operator landing page.', queues: ['privacy', 'support', 'operations', 'trust', 'delivery', 'money', 'reliability'] },
  reports: { eyebrow: 'Governance / Reports', title: 'Reports & audit', description: 'Versioned operational metrics and durable action receipts, reconciled to source records.', queues: [] },
  knowledge: { eyebrow: 'Governance / Knowledge', title: 'Knowledge & runbooks', description: 'Contextual policy, escalation, provider, and recovery guidance linked from the work itself.', queues: [] },
} as const

const PHONE_SAFE_SECTIONS = new Set(['incidents', 'knowledge'])

export default async function DomainPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  const definition = sections[section as keyof typeof sections]
  if (!definition) notFound()
  if (isOpsArea(section) && !(await hasOpsAreaAccess(section))) return <OpsPermissionRestriction area={definition.title} />
  if (!PHONE_SAFE_SECTIONS.has(section) && await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area={definition.title} />
  const data = await loadCanonicalOpsData()
  const allItems = buildOpsWorkItems(data)
  const items = definition.queues.length === 0
    ? []
    : allItems.filter((entry) => (definition.queues as readonly string[]).includes(entry.queueKey))

  return (
    <>
      <PageHead eyebrow={definition.eyebrow} title={definition.title} description={definition.description} meta={`${items.length} current item${items.length === 1 ? '' : 's'}`} />
      {definition.queues.length > 0 ? (
        <WorkList items={items} />
      ) : (
        <div className="ops-empty"><h2>No decorative dashboard</h2><p>This route will expose only reconciled, drillable records. Until its canonical projection and proof contract are migrated, use My Work and linked case runbooks.</p><Link className="ops-button ops-button-primary" style={{ marginTop: 16 }} href="/ops/my-work">Return to My Work</Link></div>
      )}
    </>
  )
}
