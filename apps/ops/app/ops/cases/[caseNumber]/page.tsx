import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { loadCanonicalOpsData } from '../../../../lib/data'
import { buildOpsWorkItems, formatEnum, formatRelativeTime, formatSla } from '../../../../lib/work-items'
import { DeletionActionPanel } from '../../../../components/deletion-action-panel'
import { CaseCollaborationPanel } from '../../../../components/case-collaboration-panel'
import { CaseLineageHistory, CaseLineagePanel } from '../../../../components/case-lineage-panel'
import { SupportCasePanel } from '../../../../components/support-case-panel'
import { TrustCasePanel } from '../../../../components/trust-case-panel'
import { loadSupportCaseContext, loadTrustCaseContext } from '../../../../lib/domain-data'
import { isRestrictedOpsPhoneRequest } from '../../../../lib/client-surface'
import { getOpsSession } from '../../../../../web/lib/ops-auth'

export const dynamic = 'force-dynamic'

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseNumber: string }>
  searchParams: Promise<{ protected?: string }>
}) {
  const { caseNumber } = await params
  const protectedState = (await searchParams).protected
  const [phoneRestricted, data, session] = await Promise.all([
    isRestrictedOpsPhoneRequest(),
    loadCanonicalOpsData({ caseNumber: decodeURIComponent(caseNumber) }),
    getOpsSession(),
  ])
  const record = buildOpsWorkItems(data).find((entry) => entry.caseNumber.toLowerCase() === decodeURIComponent(caseNumber).toLowerCase())
  if (!record) notFound()
  const authorizedForQueue = Boolean(session?.role && record.permittedRoles.includes(session.role))
  const visibleHistory = record.history.slice(0, 100)
  const sla = formatSla(record.slaDueAt, record.slaPaused)
  const sensitiveAction = record.caseType === 'ACCOUNT_DELETION_REQUEST'
    ? 'account-deletion'
    : record.caseType === 'TAILOR_VERIFICATION'
      ? 'trust-decision'
      : 'case'
  const protectedCheckpoint = `/ops/sensitive/${sensitiveAction}?returnTo=${encodeURIComponent(`/ops/cases/${record.caseNumber}`)}`
  const availableLineageContext = [
    record.userId ? { key: 'user_id', label: 'Customer account' } : null,
    record.tailorProfileId ? { key: 'tailor_profile_id', label: 'Tailor profile' } : null,
    record.orderId ? { key: 'order_id', label: 'Order' } : null,
    record.relatedEntityId ? { key: 'related_entity', label: 'Related domain record' } : null,
    record.provider ? { key: 'provider', label: 'Provider lane' } : null,
  ].filter((entry): entry is { key: string; label: string } => entry !== null)
  const [trustContext, supportContext] = await Promise.all([
    !phoneRestricted && record.caseType === 'TAILOR_VERIFICATION'
      ? loadTrustCaseContext({ tailorProfileId: record.tailorProfileId, userId: record.userId })
      : Promise.resolve(null),
    !phoneRestricted && record.queueKey === 'support'
      ? loadSupportCaseContext({ userId: record.userId, orderId: record.orderId })
      : Promise.resolve(null),
  ])

  return (
    <>
      <header className="ops-page-head">
        <div>
          <a href={`/ops/queues/${record.queueKey}`} className="ops-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><ArrowLeft size={14} />Back to {formatEnum(record.queueKey)}</a>
          <p className="ops-kicker" style={{ marginTop: 14 }}>{record.caseNumber} · {formatEnum(record.caseType)}</p>
          <h1>{record.title}</h1>
          <p>{record.summary}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span className="ops-chip" data-tone={record.priority === 'P0' || record.priority === 'P1' ? 'critical' : 'warning'}>{record.priority}</span>
          <span className="ops-chip">{formatEnum(record.severity)} severity</span>
          <span className="ops-chip">{formatEnum(record.status)}</span>
          <span className="ops-chip" data-tone={sla.overdue ? 'critical' : 'healthy'}>{sla.label}</span>
        </div>
      </header>
      {protectedState === 'verified' ? <div className="ops-status-banner" data-tone="healthy" role="status"><ShieldCheck size={16} />Protected workforce access is current. The case must still be reread before a sensitive action is submitted.</div> : null}
      {protectedState === 'step-up-required' ? <div className="ops-status-banner" data-tone="warning" role="alert"><ShieldCheck size={16} />Sensitive access is not current. In production, Cloudflare Access must complete the dedicated MFA policy before this action can unlock.</div> : null}
      {phoneRestricted ? <div className="ops-status-banner" data-tone="healthy" role="status"><ShieldCheck size={16} />Phone triage mode shows only the minimum case summary and safe collaboration actions. Sensitive evidence, related records, and irreversible controls were not loaded.</div> : null}
      <div className="ops-case-grid">
        <div style={{ display: 'grid', gap: 18 }}>
          <section className="ops-panel">
            <div className="ops-panel-head"><h2>Authoritative facts</h2><span className="ops-muted" style={{ fontSize: 11 }}>Observed {formatRelativeTime(record.updatedAt)}</span></div>
            <div className="ops-panel-body">
              <dl className="ops-facts">
                <div className="ops-fact"><dt>Status</dt><dd>{formatEnum(record.status)}</dd></div>
                <div className="ops-fact"><dt>Queue</dt><dd>{formatEnum(record.queueKey)}</dd></div>
                <div className="ops-fact"><dt>Owning team</dt><dd>{record.ownerTeam ? formatEnum(record.ownerTeam) : 'Policy unavailable'}</dd></div>
                <div className="ops-fact"><dt>Assigned to</dt><dd>{record.assignee ?? 'Unassigned'}</dd></div>
                <div className="ops-fact"><dt>SLA clock</dt><dd>{record.slaPaused ? 'Paused while waiting' : `${formatEnum(record.slaPhase)} · ${sla.label}`}</dd></div>
                <div className="ops-fact"><dt>SLA policy</dt><dd>{record.slaPolicyVersion ?? 'Policy unavailable'}</dd></div>
                {!phoneRestricted ? <>
                  <div className="ops-fact"><dt>Related context</dt><dd>{record.context}</dd></div>
                  <div className="ops-fact"><dt>Backup team</dt><dd>{record.backupTeam ? formatEnum(record.backupTeam) : 'Policy unavailable'}</dd></div>
                  <div className="ops-fact"><dt>Waiting reason</dt><dd>{record.waitingReason ? formatEnum(record.waitingReason) : 'No explicit blocker'}</dd></div>
                  <div className="ops-fact"><dt>Sensitivity</dt><dd>{formatEnum(record.sensitivity)}</dd></div>
                  {record.facts.map((fact) => <div className="ops-fact" key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
                </> : null}
              </dl>
              <div className="ops-next-action" style={{ marginTop: 16 }}>
                <h3>Recommended next action</h3>
                <p>{record.recommendedAction}</p>
              </div>
            </div>
          </section>
          {trustContext ? <TrustCasePanel context={trustContext} caseNumber={record.caseNumber} issueId={record.id} recordVersion={record.recordVersion} protectedAccess={protectedState === 'verified'} protectedCheckpoint={protectedCheckpoint} /> : null}
          {supportContext ? <SupportCasePanel context={supportContext} /> : null}
          {!phoneRestricted ? <section className="ops-panel">
            <div className="ops-panel-head"><h2>Durable receipts</h2><span className="ops-muted" style={{ fontSize: 11 }}>{record.receipts.length} persisted</span></div>
            <div className="ops-panel-body">
              {record.receipts.length > 0 ? (
                <ol className="ops-timeline">
                  {record.receipts.map((receipt) => (
                    <li key={receipt.id}>
                      <strong>{formatEnum(receipt.actionKey)} · {formatEnum(receipt.outcome)}</strong>
                      <span>{receipt.humanStatus} · {formatRelativeTime(receipt.completedAt ?? receipt.persistedAt)}</span>
                      <span>Correlation {receipt.correlationId} · {receipt.sideEffectCount} side effects · {receipt.blockerCount} blockers</span>
                    </li>
                  ))}
                </ol>
              ) : <div className="ops-empty ops-empty-compact"><h3>No action receipt yet</h3><p>The case has not recorded a canonical mutation. Legacy audit history remains visible above during migration.</p></div>}
            </div>
          </section> : null}
          {!phoneRestricted ? <section className="ops-panel">
            <div className="ops-panel-head"><h2>Case timeline</h2><span className="ops-muted" style={{ fontSize: 11 }}>{record.history.length + 1} recorded · latest {visibleHistory.length + 1} shown</span></div>
            <div className="ops-panel-body">
              <ol className="ops-timeline">
                {visibleHistory.map((event) => (
                  <li key={event.id}><strong>{formatEnum(event.actionTaken)}</strong><span>{event.reason ?? 'No additional note'} · {event.performedBy ?? 'System'} · {formatRelativeTime(event.createdAt)}</span></li>
                ))}
                <li><strong>Case source observed</strong><span>{formatEnum(record.caseType)} · {new Date(record.createdAt).toLocaleString()}</span></li>
              </ol>
            </div>
          </section> : null}
          {!phoneRestricted ? <CaseLineageHistory issueId={record.id} lineage={data.lineage} /> : null}
          {!phoneRestricted && session?.role === 'admin' ? <CaseLineagePanel
            issueId={record.id}
            caseNumber={record.caseNumber}
            status={record.status}
            recordVersion={record.recordVersion}
            protectedAccess={protectedState === 'verified'}
            protectedCheckpoint={protectedCheckpoint}
            availableContext={availableLineageContext}
          /> : null}
        </div>
        <aside style={{ display: 'grid', alignContent: 'start', gap: 18 }}>
          <section className="ops-panel">
            <div className="ops-panel-head"><h2>Action boundary</h2><ShieldCheck size={16} color="var(--needle)" /></div>
            <div className="ops-panel-body">
              {!phoneRestricted && record.caseType === 'ACCOUNT_DELETION_REQUEST' && record.relatedEntityId ? (
                <DeletionActionPanel
                  issueId={record.id}
                  requestId={record.relatedEntityId}
                  status={record.status}
                  recordVersion={record.recordVersion}
                  protectedAccess={protectedState === 'verified'}
                  protectedCheckpoint={protectedCheckpoint}
                />
              ) : <CaseCollaborationPanel
                issueId={record.id}
                status={record.status}
                assignee={record.assignee}
                recordVersion={record.recordVersion}
                authorizedForQueue={authorizedForQueue}
                allowAcknowledge={record.permittedActions.includes('acknowledge') || record.permittedActions.includes('triage')}
                allowAssign={record.permittedActions.includes('assign')}
                allowEscalate={record.permittedActions.includes('escalate')}
              />}
              {!phoneRestricted && record.sourceHref ? <a className="ops-button" style={{ marginTop: 14, width: '100%' }} href={record.sourceHref}>Open related record <ExternalLink size={14} /></a> : null}
            </div>
          </section>
          <section className="ops-panel">
            <div className="ops-panel-head"><h2>Runbook</h2></div>
            <div className="ops-panel-body"><p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>Confirm identity and scope, preserve evidence, reread current state, use the recommended action, and do not close until side effects have a terminal recorded outcome.</p><Link className="ops-button" style={{ marginTop: 14, width: '100%' }} href={(record.runbookPath ?? '/ops/knowledge') as '/ops/knowledge'}>Open contextual knowledge</Link></div>
          </section>
        </aside>
      </div>
    </>
  )
}
