import { AlertTriangle, CheckCircle2, Clock3, Radio, RotateCcw } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadReliabilityData } from '../../../lib/reliability-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

const jobStates = new Set(['PENDING', 'RETRYABLE', 'PROCESSING', 'DEAD'])

function tone(value: string) {
  const normalized = value.toUpperCase()
  if (normalized.includes('OPEN') || normalized.includes('FAILED') || normalized.includes('CRITICAL') || normalized === 'DEAD') return 'critical'
  if (normalized.includes('DEGRADED') || normalized.includes('WARNING') || normalized.includes('RETRY') || normalized === 'PENDING') return 'warning'
  if (normalized.includes('HEALTHY') || normalized.includes('CLOSED') || normalized === 'OK') return 'healthy'
  return 'neutral'
}

const jobPageSize = 25

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ providerState?: string; jobState?: string; page?: string }> }) {
  if (!(await hasOpsAreaAccess('providers'))) return <OpsPermissionRestriction area="Providers & Jobs" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Providers & Jobs" />
  const [data, query] = await Promise.all([loadReliabilityData(), searchParams])
  const degradedProviders = data.providers.filter((provider) => !['HEALTHY', 'CLOSED', 'OK'].includes(provider.status.toUpperCase()))
  const selectedProviderState = query.providerState === 'degraded' ? 'degraded' : null
  const selectedJobState = jobStates.has(String(query.jobState).toUpperCase()) ? String(query.jobState).toUpperCase() : null
  const visibleProviders = selectedProviderState ? degradedProviders : data.providers
  const allVisibleJobs = selectedJobState ? data.jobItems.filter((job) => job.status.toUpperCase() === selectedJobState) : data.jobItems
  const requestedPage = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
  const jobPageCount = Math.max(1, Math.ceil(allVisibleJobs.length / jobPageSize))
  const jobPage = Math.min(requestedPage, jobPageCount)
  const visibleJobs = allVisibleJobs.slice((jobPage - 1) * jobPageSize, jobPage * jobPageSize)
  const pageHref = (page: number) => `/ops/providers?${new URLSearchParams({ ...(selectedProviderState ? { providerState: selectedProviderState } : {}), ...(selectedJobState ? { jobState: selectedJobState } : {}), page: String(page) }).toString()}#job-ledger` as Route
  const queueRisk = data.jobs.dead + data.jobs.retryable
  const jobsMissingCases = data.jobItems.filter((job) => job.status === 'DEAD' && !job.linkedCaseNumber).length

  return (
    <>
      <PageHead eyebrow="Reliability / Providers" title="Providers & jobs" description="Provider circuits, queue pressure, callbacks, and Drapeon-owned synthetic paths. A green vendor status page is never treated as workflow proof." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
      <section className="ops-summary-grid" aria-label="Provider and queue summary">
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?providerState=degraded#provider-lanes"><div className="ops-summary-label">Degraded lanes</div><div className="ops-summary-value">{degradedProviders.length}</div><div className="ops-summary-detail">Provider-operation circuits needing attention</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=PENDING#job-ledger"><div className="ops-summary-label">Pending jobs</div><div className="ops-summary-value">{data.jobs.pending}</div><div className="ops-summary-detail">Oldest {data.jobs.oldestPendingAt ? formatRelativeTime(data.jobs.oldestPendingAt) : 'not recorded'}</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=RETRYABLE#job-ledger"><div className="ops-summary-label">Retryable</div><div className="ops-summary-value">{data.jobs.retryable}</div><div className="ops-summary-detail">Bounded recovery candidates</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/providers?jobState=DEAD#job-ledger"><div className="ops-summary-label">Dead</div><div className="ops-summary-value">{data.jobs.dead}</div><div className="ops-summary-detail">Terminal outcomes, never hidden as pending</div></Link>
      </section>

      {queueRisk > 0 ? <div className="ops-status-banner ops-banner-after-grid" data-tone={data.jobs.dead > 0 ? 'critical' : 'warning'} role="alert"><AlertTriangle size={16} /><span>The job queue has {data.jobs.dead} dead and {data.jobs.retryable} retryable job{queueRisk === 1 ? '' : 's'}.{jobsMissingCases ? ` ${jobsMissingCases} visible dead jobs predate automatic Reliability ownership.` : ''} <Link href="/ops/queues/reliability">Open Reliability</Link> before replaying anything.</span></div> : null}

      <section className="ops-section-block" id="provider-lanes">
        <div className="ops-section-head"><div><p className="ops-action-label">Circuit state</p><h2>{selectedProviderState ? 'Degraded provider lanes' : 'Provider lanes'}</h2></div><div className="ops-section-actions">{selectedProviderState ? <Link className="ops-button" href="/ops/providers#provider-lanes">Clear filter</Link> : null}<span className="ops-muted">Provider + operation, not one vague vendor light</span></div></div>
        {visibleProviders.length > 0 ? (
          <div className="ops-provider-grid">
            {visibleProviders.map((provider) => (
              <article className="ops-provider-card" key={`${provider.provider}:${provider.operation}`}>
                <div className="ops-provider-head"><span className="ops-provider-icon" data-tone={tone(provider.status)}>{['HEALTHY', 'CLOSED', 'OK'].includes(provider.status.toUpperCase()) ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><span className="ops-chip" data-tone={tone(provider.status)}>{formatEnum(provider.status)}</span></div>
                <p className="ops-action-label">{formatEnum(provider.provider)}</p>
                <h3>{formatEnum(provider.operation)}</h3>
                <dl className="ops-mini-facts">
                  <div><dt>Failures</dt><dd>{provider.failureCount}</dd></div>
                  <div><dt>Circuit</dt><dd>{provider.circuitOpenUntil ? `Until ${new Date(provider.circuitOpenUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Closed'}</dd></div>
                  <div><dt>Last update</dt><dd>{provider.updatedAt ? formatRelativeTime(provider.updatedAt) : 'Never'}</dd></div>
                </dl>
                {provider.hasRecordedError ? <p className="ops-provider-error">Failure detail is retained in the linked incident and provider logs.</p> : <p className="ops-provider-ok"><CheckCircle2 size={13} />No active provider error recorded</p>}
              </article>
            ))}
          </div>
        ) : <div className="ops-empty"><Radio size={20} /><h2>{selectedProviderState ? 'No degraded provider lane' : 'No provider circuit observations yet'}</h2><p>{selectedProviderState ? 'The current authoritative provider set has no degraded operation.' : 'This is live state. A provider-operation lane appears after the authoritative circuit breaker records a success or failure.'}</p></div>}
      </section>

      <section className="ops-section-block" id="job-ledger">
        <div className="ops-section-head"><div><p className="ops-action-label">Queue source set</p><h2>{selectedJobState ? `${formatEnum(selectedJobState)} jobs` : 'Actionable job ledger'}</h2></div><div className="ops-section-actions">{selectedJobState ? <Link className="ops-button" href="/ops/providers#job-ledger">Clear filter</Link> : null}<Link className="ops-button" href="/ops/queues/reliability">Open reliability cases</Link><span className="ops-muted">Payloads and raw errors are excluded</span></div></div>
        {visibleJobs.length > 0 ? <><div className="ops-domain-list">{visibleJobs.map((job) => <Link aria-label={`${job.linkedCaseNumber ? 'Open' : 'Search for'} reliability case for job ${job.id}`} className="ops-domain-row ops-domain-row-compact ops-domain-row-link" href={job.linkedCaseNumber ? `/ops/cases/${job.linkedCaseNumber}` : `/ops/queues/reliability?q=${encodeURIComponent(job.id)}`} key={job.id}><span className="ops-provider-icon" data-tone={tone(job.status)}>{job.status === 'DEAD' ? <AlertTriangle size={16} /> : <Clock3 size={16} />}</span><div><strong>{formatEnum(job.type)}</strong><small>Job {job.id} · created {formatRelativeTime(job.createdAt)}</small></div><div><span className="ops-label">State</span><strong>{formatEnum(job.status)}</strong><small>{job.attempts} of {job.maxAttempts} attempts</small></div><div><span className="ops-label">Recovery</span><strong>{job.linkedCaseNumber ?? 'No linked case'}</strong><small>{job.linkedCaseNumber ? `${formatEnum(job.linkedCaseStatus ?? 'open')} · ` : 'Historical pre-policy gap · '}updated {formatRelativeTime(job.updatedAt)}</small></div></Link>)}</div><nav className="ops-pagination" aria-label="Job ledger pages"><span>{(jobPage - 1) * jobPageSize + 1}–{Math.min(jobPage * jobPageSize, allVisibleJobs.length)} of {allVisibleJobs.length}</span><div>{jobPage > 1 ? <Link className="ops-button" href={pageHref(jobPage - 1)}>Previous</Link> : <span className="ops-button" aria-disabled="true">Previous</span>}<span>Page {jobPage} of {jobPageCount}</span>{jobPage < jobPageCount ? <Link className="ops-button" href={pageHref(jobPage + 1)}>Next</Link> : <span className="ops-button" aria-disabled="true">Next</span>}</div></nav></> : <div className="ops-empty"><CheckCircle2 size={20} /><h2>{selectedJobState ? `No ${formatEnum(selectedJobState).toLowerCase()} jobs` : 'No actionable jobs'}</h2><p>The selected state has no source record in the bounded authoritative window. Completed jobs are intentionally excluded from this operational lane.</p></div>}
      </section>

      <section className="ops-section-block" id="synthetic-paths">
        <div className="ops-section-head"><div><p className="ops-action-label">Drapeon-owned proof</p><h2>Synthetic paths</h2></div><span className="ops-muted">Freshness threshold: 12 minutes</span></div>
        {data.monitors.length > 0 ? <div className="ops-monitor-list">{data.monitors.map((monitor) => {
          const stale = Date.now() - new Date(monitor.checkedAt).getTime() > 12 * 60_000
          return <article className="ops-monitor-row" key={monitor.id}><span className="ops-provider-icon" data-tone={stale || !monitor.healthy ? 'critical' : 'healthy'}>{stale ? <Clock3 size={17} /> : monitor.healthy ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><div><h3>{monitor.targetName}</h3><p>{monitor.detail}</p></div><div><strong>{monitor.httpStatus || 'No HTTP'}</strong><span>{monitor.latencyMs} ms · {formatRelativeTime(monitor.checkedAt)}</span></div></article>
        })}</div> : <div className="ops-empty"><RotateCcw size={20} /><h2>No durable synthetic signal yet</h2><p>The Cloudflare monitor must authenticate to the reliability ingest function. Missing configuration is a failed monitor, not a green state.</p></div>}
      </section>
    </>
  )
}
