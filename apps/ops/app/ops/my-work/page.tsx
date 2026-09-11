import { PageHead } from '../../../components/page-head'
import { WorkList } from '../../../components/work-list'
import { OpsMetricCell } from '../../../components/ops-metric-cell'
import { loadCanonicalOpsData } from '../../../lib/data'
import { deriveOpsCaseMetricSets } from '../../../lib/metric-eligibility.mjs'
import { buildOpsWorkItems, runtimeContract } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

export default async function MyWorkPage() {
  const data = await loadCanonicalOpsData()
  const items = buildOpsWorkItems(data)
  const contract = runtimeContract(data.canonicalColumnsAvailable)
  const metrics = deriveOpsCaseMetricSets(items, Date.now())

  return (
    <>
      <PageHead
        eyebrow="Work / My Work"
        title="What needs attention now"
        description="One ordered queue across trust, privacy, orders, money, and reliability. Priority and SLA decide the order; departments do not compete for screen space."
        meta={<>Fresh authoritative read · {new Date(data.observedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</>}
      />
      <section className="ops-summary-grid" aria-label="Work summary">
        <OpsMetricCell metricKey="ops.open_cases" value={metrics.open.length} detail="Across all permitted queues" ariaLabel={`Open all ${metrics.open.length} work items`} />
        <OpsMetricCell metricKey="ops.urgent_cases" value={metrics.urgent.length} detail="Policy-ordered attention" ariaLabel={`Open ${metrics.urgent.length} P0 or P1 work items`} />
        <OpsMetricCell metricKey="ops.sla_breached" value={metrics.slaTracked.length > 0 ? metrics.breached.length : null} detail={metrics.slaTracked.length > 0 ? `${metrics.slaTracked.length} open cases with running authoritative deadlines` : 'No open running authoritative deadlines'} ariaLabel={metrics.slaTracked.length > 0 ? `Open ${metrics.breached.length} overdue work items` : 'Open the authoritative SLA queue'} />
        <OpsMetricCell metricKey="ops.unassigned_cases" value={metrics.unassigned.length} detail="Named claim needed; owning teams are set" ariaLabel={`Open ${metrics.unassigned.length} unassigned work items`} />
      </section>
      <WorkList items={items} />
      <section className="ops-panel" style={{ marginTop: 24 }} aria-labelledby="runtime-contract-title">
        <div className="ops-panel-head"><h2 id="runtime-contract-title">Runtime contract</h2><span className="ops-chip" data-tone={contract.environment === 'production' ? 'warning' : 'healthy'}>{contract.environment}</span></div>
        <div className="ops-panel-body">
          <dl className="ops-runtime">
            <div className="ops-runtime-row"><dt>Release</dt><dd>{contract.release}</dd></div>
            <div className="ops-runtime-row"><dt>Supabase target</dt><dd>{contract.projectRef}</dd></div>
            <div className="ops-runtime-row"><dt>Identity</dt><dd>{contract.accessMode}</dd></div>
            <div className="ops-runtime-row"><dt>Sensitive step-up</dt><dd>{contract.sensitiveAccess}</dd></div>
            <div className="ops-runtime-row"><dt>Database authority</dt><dd>{contract.databaseAuthority}</dd></div>
            <div className="ops-runtime-row"><dt>Communication mode</dt><dd>{contract.communications}</dd></div>
          </dl>
        </div>
      </section>
    </>
  )
}
