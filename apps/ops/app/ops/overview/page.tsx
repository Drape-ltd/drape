import { AlertTriangle, CheckCircle2, Clock3, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { PageHead } from '../../../components/page-head'
import { WorkList } from '../../../components/work-list'
import { OpsMetricCell } from '../../../components/ops-metric-cell'
import { loadCanonicalOpsData } from '../../../lib/data'
import { loadReliabilityData } from '../../../lib/reliability-data'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { deriveIncidentMetricSets, deriveOpsCaseMetricSets } from '../../../lib/metric-eligibility.mjs'
import { buildOpsWorkItems, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  if (!(await hasOpsAreaAccess('overview'))) return <OpsPermissionRestriction area="Leadership Overview" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Leadership Overview" />
  const [canonical, reliability] = await Promise.all([loadCanonicalOpsData(), loadReliabilityData()])
  const items = buildOpsWorkItems(canonical)
  const metrics = deriveOpsCaseMetricSets(items, Date.now())
  const incidentMetrics = deriveIncidentMetricSets(reliability.incidents)
  return <><PageHead eyebrow="Governance / Overview" title="Leadership overview" description="Only actionable, drillable production signals belong here. Every number opens into the same canonical case or incident ledger operators use." meta={`Observed ${formatRelativeTime(reliability.observedAt)}`} />
    <section className="ops-summary-grid" aria-label="Leadership operating summary"><OpsMetricCell metricKey="ops.open_cases" value={metrics.open.length} detail="Across every owned queue" /><OpsMetricCell metricKey="ops.urgent_cases" value={metrics.urgent.length} detail="P0 and P1 priority" /><OpsMetricCell metricKey="ops.sla_breached" value={metrics.breached.length} detail="Needs explicit recovery owner" /><OpsMetricCell metricKey="ops.critical_incidents" value={incidentMetrics.critical.length} detail="Durable critical service incidents" /></section>
    {metrics.unassigned.length ? <div className="ops-status-banner ops-banner-after-grid" data-tone="warning"><AlertTriangle size={16} />{metrics.unassigned.length} open case{metrics.unassigned.length === 1 ? '' : 's'} currently have no named owner.</div> : <div className="ops-status-banner ops-banner-after-grid" data-tone="healthy"><CheckCircle2 size={16} />Every open case currently has a named owner.</div>}
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Leadership attention</p><h2>Urgent and breached work</h2></div><Link className="ops-button" href="/ops/queues/all">All queues</Link></div>{metrics.urgent.length || metrics.breached.length ? <WorkList items={[...new Map([...metrics.urgent, ...metrics.breached].map((item) => [item.id, item])).values()].slice(0, 30)} /> : <div className="ops-empty"><ListChecks size={20} /><h2>No urgent or breached work</h2><p>This means the current canonical queue has no qualifying item; it is not a simulated green metric.</p></div>}</section>
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Freshness</p><h2>Control-plane evidence</h2></div><Clock3 size={18} /></div><div className="ops-facts"><dl className="ops-fact"><dt>Synthetic checks</dt><dd>{reliability.monitors.length ? formatRelativeTime(reliability.monitors[0].checkedAt) : 'No durable signal'}</dd></dl><dl className="ops-fact"><dt>Provider lanes</dt><dd>{reliability.providers.length} observed</dd></dl><dl className="ops-fact"><dt>Pending jobs</dt><dd>{reliability.jobs.pending}</dd></dl><dl className="ops-fact"><dt>Dead-letter jobs</dt><dd>{reliability.jobs.dead}</dd></dl></div></section>
  </>
}
