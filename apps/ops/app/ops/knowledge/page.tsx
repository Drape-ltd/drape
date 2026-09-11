import { BookOpen, ChevronDown, ShieldCheck } from 'lucide-react'
import { PageHead } from '../../../components/page-head'
import { OpsServiceCatalogue } from '../../../components/ops-service-catalogue'
import { OPS_QUEUE_CATALOGUE, OPS_SERVICE_CATALOGUE } from '../../../lib/service-catalogue'

export const dynamic = 'force-dynamic'

const runbooks = [
  { key: 'orders', title: 'Order operations', owner: 'Marketplace Ops', file: 'docs/ops-order-runbook.md', scope: 'Stages, cancellation, fulfilment, settlement, evidence' },
  { key: 'health', title: 'Service health & monitoring', owner: 'Engineering', file: 'docs/service-health-and-monitoring.md', scope: 'Provider signals, synthetics, incidents, Slack recovery' },
  { key: 'security', title: 'Security & observability', owner: 'Security / Engineering', file: 'docs/internal-control-plane-security-observability.md', scope: 'Access, telemetry, insider risk, runtime isolation' },
  { key: 'authority', title: 'Ops ownership & escalation', owner: 'Founder / Ops', file: 'docs/v1-decisions-ops-ownership-and-escalation-authority.md', scope: 'Role authority, escalation, approval boundaries' },
  { key: 'control-plane', title: 'Canonical Ops rebuild', owner: 'Founder / Engineering', file: 'docs/drapeon-ops-control-plane-post-submission-rebuild.md', scope: 'Routes, phases, cache policy, rollback, acceptance' },
  { key: 'catalogue', title: 'Operational catalogue', owner: 'Operations / Engineering / Security', file: 'docs/ops-control-plane-operational-catalogue.md', scope: 'Routes, roles, data classes, queues, SLAs, services, metrics, caches, alerts, proof' },
] as const

export default function KnowledgePage() {
  return <><PageHead eyebrow="Governance / Knowledge" title="Knowledge & runbooks" description="Owned operating policy is linked from the work. Operators use a runbook; they do not invent precedent during a live case." meta={`${OPS_SERVICE_CATALOGUE.length} services · ${runbooks.length} canonical references`} />
    <div className="ops-status-banner" data-tone="healthy"><ShieldCheck size={16} />These references are version-controlled with the product. External wiki mirroring can follow without becoming a second source of truth.</div>
    <section className="ops-section-block" aria-labelledby="queue-registry-title"><div className="ops-section-head"><div><p className="ops-action-label">Versioned operating policy</p><h2 id="queue-registry-title">Queue ownership</h2></div><span className="ops-muted">Primary, backup, SLA, and escalation are explicit</span></div><div className="ops-domain-list ops-queue-registry">{OPS_QUEUE_CATALOGUE.map((queue) => <article className="ops-domain-row" id={queue.key} key={queue.key}><span className="ops-provider-icon"><BookOpen size={15} aria-hidden="true" /></span><div><strong>{queue.label}</strong><small>{queue.policy}</small></div><div><span className="ops-label">Ownership</span><strong>{queue.primary}</strong><small>Backup: {queue.backup}</small></div><div><span className="ops-label">SLA · first response</span><strong>{queue.firstResponse}</strong><small>Resolution: {queue.activeResolution}</small></div><details className="ops-queue-runbook"><summary>Open runbook <ChevronDown size={13} aria-hidden="true" /></summary><div><span><b>First action</b>{queue.firstAction}</span><span><b>Escalate when</b>{queue.escalateWhen}</span><small>Source: {queue.runbook}</small></div></details></article>)}</div></section>
    <OpsServiceCatalogue />
    <section className="ops-section-block"><div className="ops-knowledge-grid">{runbooks.map((runbook) => <article className="ops-knowledge-card" id={runbook.key} key={runbook.key}><span className="ops-provider-icon"><BookOpen size={16} /></span><p className="ops-action-label">{runbook.owner}</p><h2>{runbook.title}</h2><p>{runbook.scope}</p><code>{runbook.file}</code><span className="ops-knowledge-state">Bundled policy <ShieldCheck size={12} aria-hidden="true" /></span></article>)}</div></section>
  </>
}
