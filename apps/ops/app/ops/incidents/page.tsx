import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Radio } from 'lucide-react'
import Link from 'next/link'
import { PageHead } from '../../../components/page-head'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { IncidentCommandPanel } from '../../../components/incident-command-panel'
import { WorkList } from '../../../components/work-list'
import { loadCanonicalOpsData } from '../../../lib/data'
import { loadReliabilityData } from '../../../lib/reliability-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { deriveIncidentMetricSets, isOpenServiceIncident } from '../../../lib/metric-eligibility.mjs'
import { buildOpsWorkItems, formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

function tone(value: string) {
  const normalized = value.toUpperCase()
  if (normalized === 'CRITICAL' || normalized === 'INVESTIGATING') return 'critical'
  if (normalized === 'WARNING' || normalized === 'IDENTIFIED' || normalized === 'MONITORING') return 'warning'
  if (normalized === 'RESOLVED' || normalized === 'OK') return 'healthy'
  return 'neutral'
}

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  if (!(await hasOpsAreaAccess('incidents'))) return <OpsPermissionRestriction area="Incident command" />
  const phoneRestricted = await isRestrictedOpsPhoneRequest()
  const [reliability, canonical, query] = await Promise.all([loadReliabilityData(), loadCanonicalOpsData(), searchParams])
  const incidentWork = buildOpsWorkItems(canonical).filter((item) => item.queueKey === 'reliability')
  const incidentMetrics = deriveIncidentMetricSets(reliability.incidents)
  const latestMonitor = reliability.monitors[0] ?? null
  const monitorAge = latestMonitor ? Date.now() - new Date(latestMonitor.checkedAt).getTime() : Number.POSITIVE_INFINITY
  const monitorFresh = Number.isFinite(monitorAge) && monitorAge <= 12 * 60_000
  const selectedScope = query.scope === 'open' || query.scope === 'critical' ? query.scope : null
  const visibleIncidents = selectedScope === 'critical' ? incidentMetrics.critical : selectedScope === 'open' ? incidentMetrics.open : reliability.incidents

  return (
    <>
      <PageHead eyebrow="Reliability / Incidents" title="Incident command" description="Drapeon-owned synthetic failures and provider signals become durable incidents here before Slack carries the alert." meta={`Observed ${formatRelativeTime(reliability.observedAt)}`} />
      <section className="ops-summary-grid" aria-label="Incident summary">
        <Link className="ops-summary-cell ops-summary-link" href="/ops/incidents?scope=open#incident-ledger"><div className="ops-summary-label">Open incidents</div><div className="ops-summary-value">{incidentMetrics.open.length}</div><div className="ops-summary-detail">Investigating, identified, or monitoring</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/incidents?scope=critical#incident-ledger"><div className="ops-summary-label">Critical now</div><div className="ops-summary-value">{incidentMetrics.critical.length}</div><div className="ops-summary-detail">Immediate engineering ownership</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers#synthetic-paths"><div className="ops-summary-label">Synthetic state</div><div className="ops-summary-value ops-summary-word">{latestMonitor ? (latestMonitor.healthy ? 'Ready' : 'Degraded') : 'No signal'}</div><div className="ops-summary-detail">{monitorFresh ? 'Fresh within 12 minutes' : 'Stale or never recorded'}</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=DEAD#job-ledger"><div className="ops-summary-label">Dead-letter jobs</div><div className="ops-summary-value">{reliability.jobs.dead}</div><div className="ops-summary-detail">Terminal queue failures requiring review</div></Link>
      </section>

      {!monitorFresh ? <div className="ops-status-banner ops-banner-after-grid" data-tone="critical" role="alert"><Radio size={16} />Monitor silence is an incident: the durable production synthetic state is older than twelve minutes or has never been recorded.</div> : null}

      <section className="ops-section-block" id="incident-ledger">
        <div className="ops-section-head"><div><p className="ops-action-label">Authoritative ledger</p><h2>{selectedScope === 'critical' ? 'Critical open incidents' : selectedScope === 'open' ? 'Open service incidents' : 'Service incidents'}</h2></div><div className="ops-section-actions">{selectedScope ? <Link className="ops-button" href="/ops/incidents#incident-ledger">Clear filter</Link> : null}<span className="ops-muted">Slack is delivery, not the record</span></div></div>
        {visibleIncidents.length > 0 ? (
          <div className="ops-incident-list">
            {visibleIncidents.map((incident) => (
              <article className="ops-incident-card" key={incident.id}>
                <div className="ops-incident-state">{isOpenServiceIncident(incident) ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span className="ops-chip" data-tone={tone(incident.severity)}>{formatEnum(incident.severity)}</span></div>
                <div><p className="ops-case-number">{incident.incidentKey}</p><h3>{incident.title}</h3><p>{incident.summary}</p><div className="ops-inline-meta"><span>{formatEnum(incident.status)}</span><span>{incident.affectedServices.map(formatEnum).join(', ') || 'No service listed'}</span><span><Clock3 size={12} />{formatRelativeTime(incident.lastObservedAt ?? incident.updatedAt)}</span>{incident.snoozedUntil && new Date(incident.snoozedUntil).getTime() > Date.now() ? <span>Snoozed until {new Date(incident.snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span> : null}</div>{(() => { const linked = incidentWork.find((item) => item.relatedEntityId === incident.id); return linked && isOpenServiceIncident(incident) && linked.recordVersion ? <IncidentCommandPanel incidentId={incident.id} acknowledgementRequired={incident.acknowledgementRequired} recordVersion={linked.recordVersion} allowResolve={!phoneRestricted} /> : null })()}</div>
                <div className="ops-incident-aside"><span className="ops-muted">{formatEnum(incident.source)}</span>{incident.runbookUrl ? <a className="ops-button" href={incident.runbookUrl}>Runbook <ExternalLink size={13} /></a> : <Link className="ops-button" href="/ops/knowledge?runbook=production-health">Runbook</Link>}</div>
              </article>
            ))}
          </div>
        ) : <div className="ops-empty"><CheckCircle2 size={20} /><h2>{selectedScope ? `No ${selectedScope} service incident` : 'No service incident has been recorded'}</h2><p>{selectedScope ? 'The selected source set is empty in the authoritative incident ledger.' : 'This is a live empty state. A Drapeon-owned synthetic transition or an operator-created incident will persist here with its source, recovery, and correlation ID.'}</p><Link className="ops-button" style={{ marginTop: 16 }} href="/ops/providers">Inspect providers and jobs</Link></div>}
      </section>

      <section className="ops-section-block">
        <div className="ops-section-head"><div><p className="ops-action-label">Owned work</p><h2>Reliability cases</h2></div><span className="ops-muted">One recommended next action per case</span></div>
        <WorkList items={incidentWork} />
      </section>
    </>
  )
}
