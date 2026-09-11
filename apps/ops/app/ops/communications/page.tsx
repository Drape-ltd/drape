import { CheckCircle2, MailWarning, MessageSquareText, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadCommunicationsOperationsData } from '../../../lib/remaining-domain-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

const communicationViews = new Set(['approval', 'active', 'recipient-failures', 'dead-jobs'])

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await hasOpsAreaAccess('communications'))) return <OpsPermissionRestriction area="Communications" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Communications" />
  const [data, query] = await Promise.all([loadCommunicationsOperationsData(), searchParams])
  const selectedView = communicationViews.has(String(query.view)) ? String(query.view) : null
  const approval = data.campaigns.filter((campaign) => campaign.status === 'PENDING_APPROVAL').length
  const active = data.campaigns.filter((campaign) => ['SCHEDULED', 'SENDING', 'PAUSED'].includes(campaign.status)).length
  const recipientFailures = data.campaigns.reduce((sum, campaign) => sum + campaign.failed, 0)
  const deadJobs = data.jobs.filter((job) => job.status === 'DEAD').length
  const campaigns = selectedView === 'approval'
    ? data.campaigns.filter((campaign) => campaign.status === 'PENDING_APPROVAL')
    : selectedView === 'active'
      ? data.campaigns.filter((campaign) => ['SCHEDULED', 'SENDING', 'PAUSED'].includes(campaign.status))
      : selectedView === 'recipient-failures'
        ? data.campaigns.filter((campaign) => campaign.failed > 0)
        : data.campaigns
  const jobs = selectedView === 'dead-jobs' ? data.jobs.filter((job) => job.status === 'DEAD') : data.jobs
  return <><PageHead eyebrow="Marketplace / Communications" title="Communications" description="Consent-aware campaigns, transactional delivery, provider callbacks, and terminal outcomes. Queued is never presented as delivered." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
    <section className="ops-summary-grid"><Link className="ops-summary-cell ops-summary-link" href="/ops/communications?view=approval#campaign-ledger"><div className="ops-summary-label">Awaiting approval</div><div className="ops-summary-value">{approval}</div><div className="ops-summary-detail">Independent review required</div></Link><Link className="ops-summary-cell ops-summary-link" href="/ops/communications?view=active#campaign-ledger"><div className="ops-summary-label">Active campaigns</div><div className="ops-summary-value">{active}</div><div className="ops-summary-detail">Scheduled, sending, or paused</div></Link><Link className="ops-summary-cell ops-summary-link" href="/ops/communications?view=recipient-failures#campaign-ledger"><div className="ops-summary-label">Recipient failures</div><div className="ops-summary-value">{recipientFailures}</div><div className="ops-summary-detail">Recorded terminal failures</div></Link><Link className="ops-summary-cell ops-summary-link" href="/ops/communications?view=dead-jobs#communication-job-ledger"><div className="ops-summary-label">Dead delivery jobs</div><div className="ops-summary-value">{deadJobs}</div><div className="ops-summary-detail">Recovery requires a linked case</div></Link></section>
    {selectedView !== 'dead-jobs' ? <section className="ops-section-block" id="campaign-ledger"><div className="ops-section-head"><div><p className="ops-action-label">Reviewed sends</p><h2>{selectedView ? `${formatEnum(selectedView)} campaigns` : 'Campaign ledger'}</h2></div><div className="ops-section-actions">{selectedView ? <Link className="ops-button" href="/ops/communications#campaign-ledger">Clear filter</Link> : null}<span className="ops-muted">Audience counts from durable recipients</span></div></div>{campaigns.length ? <div className="ops-domain-list">{campaigns.map((campaign) => <article className="ops-domain-row" key={campaign.id}><span className="ops-provider-icon" data-tone={campaign.failed ? 'critical' : campaign.status === 'COMPLETED' ? 'healthy' : 'warning'}>{campaign.failed ? <MailWarning size={16} /> : campaign.status === 'COMPLETED' ? <CheckCircle2 size={16} /> : <MessageSquareText size={16} />}</span><div><strong>{campaign.name}</strong><small>{formatEnum(campaign.kind)} · {formatEnum(campaign.purpose)} · {formatRelativeTime(campaign.createdAt)}</small></div><div><span className="ops-label">State</span><strong>{formatEnum(campaign.status)}</strong><small>{formatEnum(campaign.riskLevel)} risk</small></div><div><span className="ops-label">Audience</span><strong>{campaign.recipients} recipients</strong><small>{campaign.delivered} delivered · {campaign.failed} failed</small></div><div><span className="ops-label">Correlation</span><strong>{campaign.correlationId}</strong><small>{formatEnum(campaign.category)} · {formatEnum(campaign.severity)}</small></div></article>)}</div> : <div className="ops-empty"><MessageSquareText size={20} /><h2>No eligible campaign</h2><p>The selected source set is empty. Transactional notifications may still be active and no engagement is fabricated.</p></div>}</section> : null}
    <section className="ops-section-block" id="communication-job-ledger"><div className="ops-section-head"><div><p className="ops-action-label">Delivery recovery</p><h2>{selectedView === 'dead-jobs' ? 'Dead communication jobs' : 'Communication job ledger'}</h2></div><div className="ops-section-actions">{selectedView === 'dead-jobs' ? <Link className="ops-button" href="/ops/communications#communication-job-ledger">Clear filter</Link> : null}<span className="ops-muted">Payloads and raw errors excluded</span></div></div>{jobs.length ? <div className="ops-domain-list">{jobs.map((job) => <article className="ops-domain-row ops-domain-row-compact" key={job.id}><span className="ops-provider-icon" data-tone={job.status === 'DEAD' ? 'critical' : job.status === 'RETRYABLE' ? 'warning' : 'neutral'}>{job.status === 'DEAD' ? <TriangleAlert size={16} /> : <MessageSquareText size={16} />}</span><div><strong>{formatEnum(job.type)}</strong><small>Job {job.id} · created {formatRelativeTime(job.createdAt)}</small></div><div><span className="ops-label">State</span><strong>{formatEnum(job.status)}</strong><small>{job.attempts} of {job.maxAttempts} attempts</small></div><div><span className="ops-label">Next run</span><strong>{formatRelativeTime(job.runAt)}</strong><small>Updated {formatRelativeTime(job.updatedAt)}</small></div></article>)}</div> : <div className="ops-empty"><CheckCircle2 size={20} /><h2>No communication job in this view</h2><p>No source record exists in the bounded authoritative window.</p></div>}</section>
    {deadJobs > 0 ? <div className="ops-status-banner" data-tone="critical"><TriangleAlert size={16} />{deadJobs} communications job{deadJobs === 1 ? '' : 's'} reached a terminal dead-letter state.</div> : null}
  </>
}
