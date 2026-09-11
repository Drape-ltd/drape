import { CheckCircle2, FileClock, FileDown, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { getOpsSession, hasFreshOpsMfa } from '../../../../web/lib/ops-auth'
import { OpsExportDownloadButton } from '../../../components/ops-export-download-button'
import { OpsExportPanel } from '../../../components/ops-export-panel'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadAuditReportData } from '../../../lib/remaining-domain-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

const outcomes = new Set(['SUCCEEDED', 'PENDING', 'FAILED'])

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  if (!(await hasOpsAreaAccess('reports'))) return <OpsPermissionRestriction area="Reports & Audit" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Reports & Audit" />
  const [data, query, session] = await Promise.all([loadAuditReportData(), searchParams, getOpsSession()])
  const selectedOutcome = outcomes.has(String(query.outcome).toUpperCase()) ? String(query.outcome).toUpperCase() : null
  const receipts = selectedOutcome
    ? data.receipts.filter((row) => String(row.outcome).toUpperCase() === selectedOutcome)
    : data.receipts
  const failed = data.receipts.filter((row) => String(row.outcome) === 'FAILED').length
  const pending = data.receipts.filter((row) => String(row.outcome) === 'PENDING').length
  const succeeded = data.receipts.filter((row) => String(row.outcome) === 'SUCCEEDED').length
  const sensitiveAccessReady = Boolean(session && hasFreshOpsMfa(session))

  return (
    <>
      <PageHead eyebrow="Governance / Reports" title="Reports & audit" description="Durable mutation receipts and append-only case events. Counts are current source records, not a spreadsheet or an analytics estimate." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
      <section className="ops-summary-grid" aria-label="Action receipt summary">
        <Link className="ops-summary-cell ops-summary-link" href="/ops/reports#receipt-ledger"><div className="ops-summary-label">Receipts observed</div><div className="ops-summary-value">{data.receipts.length}</div><div className="ops-summary-detail">Latest durable action outcomes</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/reports?outcome=SUCCEEDED#receipt-ledger"><div className="ops-summary-label">Succeeded</div><div className="ops-summary-value">{succeeded}</div><div className="ops-summary-detail">Terminal success recorded</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/reports?outcome=PENDING#receipt-ledger"><div className="ops-summary-label">Pending</div><div className="ops-summary-value">{pending}</div><div className="ops-summary-detail">Not treated as delivered</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/reports?outcome=FAILED#receipt-ledger"><div className="ops-summary-label">Failed</div><div className="ops-summary-value">{failed}</div><div className="ops-summary-detail">Terminal failures retained</div></Link>
      </section>
      <section className="ops-section-block" id="receipt-ledger">
        <div className="ops-section-head">
          <div><p className="ops-action-label">Immutable proof</p><h2>{selectedOutcome ? `${formatEnum(selectedOutcome)} action receipts` : 'Recent action receipts'}</h2></div>
          <div className="ops-section-actions">{selectedOutcome ? <Link className="ops-button" href="/ops/reports#receipt-ledger">Clear filter</Link> : null}<span className="ops-muted">Source rows remain read-only</span></div>
        </div>
        {receipts.length ? (
          <div className="ops-domain-list">
            {receipts.map((row) => {
              const sideEffects = Array.isArray(row.side_effects) ? row.side_effects.length : 0
              const blockers = Array.isArray(row.blockers) ? row.blockers.length : 0
              return (
                <article className="ops-domain-row ops-domain-row-compact" key={String(row.id)}>
                  <span className="ops-provider-icon" data-tone={String(row.outcome) === 'SUCCEEDED' ? 'healthy' : String(row.outcome) === 'FAILED' ? 'critical' : 'warning'}>{String(row.outcome) === 'SUCCEEDED' ? <CheckCircle2 size={16} /> : String(row.outcome) === 'FAILED' ? <TriangleAlert size={16} /> : <FileClock size={16} />}</span>
                  <div><strong>{formatEnum(String(row.action_key))}</strong><small>{String(row.human_status)} · {formatRelativeTime(String(row.persisted_at))}</small></div>
                  <div><span className="ops-label">Outcome</span><strong>{formatEnum(String(row.outcome))}</strong><small>{sideEffects} side effects · {blockers} blockers</small></div>
                  <div><span className="ops-label">Correlation</span><strong>{String(row.correlation_id)}</strong><small>{row.failure_code ? formatEnum(String(row.failure_code)) : 'No failure code'}</small></div>
                </article>
              )
            })}
          </div>
        ) : <div className="ops-empty"><FileClock size={20} /><h2>{selectedOutcome ? `No ${formatEnum(selectedOutcome).toLowerCase()} receipts` : 'No action receipts yet'}</h2><p>{selectedOutcome ? 'The selected outcome has no source record in the current authoritative window.' : 'The ledger is genuinely empty in this environment. Privileged mutations will create durable receipts here.'}</p></div>}
      </section>
      <section className="ops-section-block" id="export-requests">
        <div className="ops-section-head"><div><p className="ops-action-label">Controlled extraction</p><h2>Scoped exports</h2></div><span className="ops-muted">CSV · 15-minute retention · 3 downloads maximum</span></div>
        <OpsExportPanel sensitiveAccessReady={sensitiveAccessReady} defaultOutcome={selectedOutcome} />
        {data.exportRequests.length ? <div className="ops-domain-list ops-export-ledger">{data.exportRequests.map((row) => {
          const status = String(row.status)
          const owned = String(row.requester_email).toLowerCase() === session?.email?.toLowerCase()
          const ready = status === 'READY' && owned && row.expires_at && Date.parse(String(row.expires_at)) > Date.now() && Number(row.download_count) < 3
          return <article className="ops-domain-row ops-domain-row-compact" key={String(row.id)}>
            <span className="ops-provider-icon" data-tone={ready ? 'healthy' : status === 'FAILED' ? 'critical' : 'warning'}>{ready ? <FileDown size={16} /> : status === 'FAILED' ? <TriangleAlert size={16} /> : <FileClock size={16} />}</span>
            <div><strong>{String(row.reference)}</strong><small>{String(row.reason)} · requested {formatRelativeTime(String(row.requested_at))}</small></div>
            <div><span className="ops-label">Scope</span><strong>{formatEnum(String(row.dataset))}</strong><small>{row.row_count == null ? `Up to ${String(row.row_limit)} rows` : `${String(row.row_count)} rows`} · {String(row.requester_email)}</small></div>
            <div><span className="ops-label">State</span><strong>{formatEnum(status)}</strong><small>{row.expires_at ? `Expires ${formatRelativeTime(String(row.expires_at))}` : row.failure_code ? formatEnum(String(row.failure_code)) : 'Generator outcome pending'}</small></div>
            <div>{ready ? <OpsExportDownloadButton exportRequestId={String(row.id)} reference={String(row.reference)} /> : <span className="ops-muted">{owned ? 'Refresh for terminal state' : 'Requester-bound'}</span>}</div>
          </article>
        })}</div> : <div className="ops-empty"><FileDown size={20} /><h2>No export request yet</h2><p>This environment has no export audit record. Nothing has been generated or retained.</p></div>}
      </section>
    </>
  )
}
