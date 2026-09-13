import { ArrowUpRight, Banknote, CheckCircle2, Clock3, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { MoneyData, MoneyRequest } from '../lib/money-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'
import { MoneyDecisionPanel, MoneyElevationPanel, MoneyExecutionPanel } from './money-action-panel'

function tone(value: string) {
  const normalized = value.toUpperCase()
  if (['FAILED', 'BLOCKED', 'REJECTED', 'HIGH'].includes(normalized)) return 'critical'
  if (['PENDING_APPROVAL', 'EXECUTING', 'PROCESSING'].includes(normalized)) return 'warning'
  if (['APPROVED', 'SUCCEEDED'].includes(normalized)) return 'healthy'
  return 'neutral'
}

function money(amount: number | null, currency: string | null) {
  if (amount == null || !currency) return 'Amount derived at execution'
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount / 100) } catch { return `${currency} ${(amount / 100).toFixed(2)}` }
}

function MoneyCard({ request, canDecide, canExecute }: { request: MoneyRequest; canDecide: boolean; canExecute: boolean }) {
  const usesFounderApproval = request.policyVersion === 'commercial-prelaunch-founder-v1'
  const approvalLabel = usesFounderApproval ? 'Founder approval' : 'Legacy dual approval'
  const emptyDecisionLabel = usesFounderApproval ? 'No founder decision recorded yet' : 'No approval decision recorded yet'
  return (
    <article className="ops-money-card" id={`money-${request.id}`}>
      <div className="ops-money-card-head"><div><p className="ops-case-number">{request.reference}</p><h3>{request.actionLabel}</h3><p>{request.reason}</p></div><div className="ops-money-amount"><strong>{money(request.amount, request.currency)}</strong><span className="ops-chip" data-tone={tone(request.status)}>{formatEnum(request.status)}</span></div></div>
      <div className="ops-money-grid">
        <div><span>Risk</span><strong>{formatEnum(request.riskLevel)}</strong><small>{request.riskReasons.map(formatEnum).join(' · ') || 'Standard policy controls'}</small></div>
        <div><span>{approvalLabel}</span><strong>{request.approvalCount} of {request.requiredApprovalCount}</strong><small>{request.decisions.length > 0 ? request.decisions.map((decision) => `${formatEnum(decision.decision)} · ${decision.approverRole}`).join(' · ') : emptyDecisionLabel}</small></div>
        <div><span>Context</span><strong>{request.orderReference ?? formatEnum(request.targetType)}</strong><small>{request.orderId ? `Order ${request.orderId}` : request.targetId}</small></div>
        <div><span>Prepared</span><strong>{formatRelativeTime(request.createdAt)}</strong><small>By {request.requesterRole} · {request.requesterEmail}</small></div>
      </div>
      {request.attempts.length > 0 ? <div className="ops-money-attempt"><Clock3 size={14} /><span>Latest execution {formatEnum(request.attempts[0].status)} · {formatRelativeTime(request.attempts[0].startedAt)}</span>{request.attempts[0].failureSummary ? <small>{request.attempts[0].failureSummary}</small> : null}</div> : null}
      {request.status === 'PENDING_APPROVAL' ? <MoneyDecisionPanel requestId={request.id} canDecide={canDecide} /> : null}
      {request.status === 'APPROVED' ? <MoneyExecutionPanel requestId={request.id} actionLabel={request.actionLabel} canExecute={canExecute} /> : null}
      <details className="ops-technical"><summary>Audit identifiers</summary><dl><div><dt>Target</dt><dd>{formatEnum(request.targetType)} · {request.targetId}</dd></div><div><dt>Correlation</dt><dd>{request.correlationId}</dd></div></dl></details>
    </article>
  )
}

export function MoneyDeskWorkspace({ data, selectedView, sensitiveAccessReady, grantExpiresAt, actorEmail, canApprove, canExecute }: { data: MoneyData; selectedView: string | null; sensitiveAccessReady: boolean; grantExpiresAt: string | null; actorEmail: string | null; canApprove: boolean; canExecute: boolean }) {
  const active = data.requests.filter((request) => !['SUCCEEDED', 'REJECTED', 'CANCELLED'].includes(request.status))
  const history = data.requests.filter((request) => ['SUCCEEDED', 'REJECTED', 'CANCELLED'].includes(request.status))
  const approvals = active.filter((request) => request.status === 'PENDING_APPROVAL').length
  const execution = active.filter((request) => ['APPROVED', 'EXECUTING', 'FAILED'].includes(request.status)).length
  const visibleRequests = selectedView === 'approval' ? active.filter((request) => request.status === 'PENDING_APPROVAL') : selectedView === 'execution' ? active.filter((request) => ['APPROVED', 'EXECUTING', 'FAILED'].includes(request.status)) : active
  const blockedPayouts = data.payouts.filter((payout) => ['BLOCKED', 'FAILED'].includes(payout.status))
  const eligibleTranches = data.tranches.filter((tranche) => tranche.status === 'ELIGIBLE')
  return (
    <>
      <section className="ops-summary-grid" aria-label="Money Desk summary">
        <Link className="ops-summary-cell ops-summary-link" href="/ops/money?view=approval#money-request-ledger"><div className="ops-summary-label">Awaiting approval</div><div className="ops-summary-value">{approvals}</div><div className="ops-summary-detail">Founder-only during prelaunch</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/money?view=execution#money-request-ledger"><div className="ops-summary-label">Execution work</div><div className="ops-summary-value">{execution}</div><div className="ops-summary-detail">Approved, processing, or failed</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/money?view=payout-blocked#payout-ledger"><div className="ops-summary-label">Payout blockers</div><div className="ops-summary-value">{blockedPayouts.length}</div><div className="ops-summary-detail">Provider or destination follow-up</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/money?view=eligible-tranches#tranche-ledger"><div className="ops-summary-label">Eligible tranches</div><div className="ops-summary-value">{eligibleTranches.length}</div><div className="ops-summary-detail">Evidence-backed release candidates</div></Link>
      </section>
      <section className="ops-money-control" data-ready={sensitiveAccessReady}>
        <div className="ops-money-control-icon">{sensitiveAccessReady ? <ShieldCheck /> : <KeyRound />}</div>
        <div><p className="ops-action-label">Protected money movement</p><h2>{sensitiveAccessReady ? 'Fresh MFA assurance is active' : 'Verify protected access before acting'}</h2><p>Preparation, founder approval, and provider execution remain separate durable states. Reading this queue never grants authority to move money.</p></div>
        {!sensitiveAccessReady ? <Link className="ops-button ops-button-primary" href="/ops/sensitive/money?returnTo=/ops/money">Verify protected access <ArrowUpRight size={14} /></Link> : <span className="ops-command-confirmed"><CheckCircle2 size={15} />15-minute action window</span>}
      </section>
      {sensitiveAccessReady ? <MoneyElevationPanel grantExpiresAt={grantExpiresAt} /> : null}
      {selectedView !== 'payout-blocked' && selectedView !== 'eligible-tranches' ? <section className="ops-section-block" id="money-request-ledger"><div className="ops-section-head"><div><p className="ops-action-label">Current work</p><h2>{selectedView ? `${formatEnum(selectedView)} requests` : 'Money movement queue'}</h2></div><div className="ops-section-actions">{selectedView ? <Link className="ops-button" href="/ops/money#money-request-ledger">Clear filter</Link> : null}<span className="ops-muted">{visibleRequests.length} source record{visibleRequests.length === 1 ? '' : 's'}</span></div></div>{visibleRequests.length > 0 ? <div className="ops-money-list">{visibleRequests.map((request) => <MoneyCard key={request.id} request={request} canDecide={Boolean(canApprove && grantExpiresAt && actorEmail)} canExecute={Boolean(canExecute && grantExpiresAt)} />)}</div> : <div className="ops-empty"><Banknote size={20} /><h2>No eligible Money Desk request</h2><p>The selected authoritative request set is empty.</p></div>}</section> : null}
      {selectedView === 'payout-blocked' ? <section className="ops-section-block" id="payout-ledger"><div className="ops-section-head"><div><p className="ops-action-label">Provider settlement source set</p><h2>Blocked payouts</h2></div><Link className="ops-button" href="/ops/money#money-request-ledger">Clear filter</Link></div>{blockedPayouts.length ? <div className="ops-domain-list">{blockedPayouts.map((payout) => <article className="ops-domain-row ops-domain-row-compact" key={payout.id}><span className="ops-provider-icon" data-tone="critical"><TriangleAlert size={16} /></span><div><strong>{formatEnum(payout.provider)} payout</strong><small>Payout {payout.id}</small></div><div><span className="ops-label">State</span><strong>{formatEnum(payout.status)}</strong><small>{payout.processedAt ? `Observed ${formatRelativeTime(payout.processedAt)}` : 'No processing timestamp'}</small></div><div><span className="ops-label">Amount</span><strong>{money(payout.amount, payout.currency)}</strong><small>{payout.orderId ? `Order ${payout.orderId}` : 'No order linked'}</small></div></article>)}</div> : <div className="ops-empty"><CheckCircle2 size={20} /><h2>No blocked payout</h2><p>No blocked or failed payout exists in the bounded source window.</p></div>}</section> : null}
      {selectedView === 'eligible-tranches' ? <section className="ops-section-block" id="tranche-ledger"><div className="ops-section-head"><div><p className="ops-action-label">Settlement source set</p><h2>Eligible settlement tranches</h2></div><Link className="ops-button" href="/ops/money#money-request-ledger">Clear filter</Link></div>{eligibleTranches.length ? <div className="ops-domain-list">{eligibleTranches.map((tranche) => <article className="ops-domain-row ops-domain-row-compact" key={tranche.id}><span className="ops-provider-icon" data-tone="warning"><Clock3 size={16} /></span><div><strong>{formatEnum(tranche.code)}</strong><small>Order {tranche.orderId}</small></div><div><span className="ops-label">State</span><strong>{formatEnum(tranche.status)}</strong><small>{tranche.eligibleAt ? `Eligible ${formatRelativeTime(tranche.eligibleAt)}` : 'Eligibility timestamp absent'}</small></div><div><span className="ops-label">Amount</span><strong>{money(tranche.amount, tranche.currency)}</strong><small>{tranche.correlationId}</small></div></article>)}</div> : <div className="ops-empty"><CheckCircle2 size={20} /><h2>No eligible tranche</h2><p>No release candidate exists in the bounded source window.</p></div>}</section> : null}
      {data.payoutSummary.blocked > 0 || data.settlementSummary.blocked > 0 ? <div className="ops-status-banner" data-tone="critical" role="alert"><TriangleAlert size={16} />{data.payoutSummary.blocked} payout and {data.settlementSummary.blocked} settlement blockers require an originating case before a money action is prepared.</div> : null}
      {history.length > 0 ? <details className="ops-history"><summary>Completed Money Desk history · {history.length}</summary><div className="ops-money-list">{history.map((request) => <MoneyCard key={request.id} request={request} canDecide={false} canExecute={false} />)}</div></details> : null}
    </>
  )
}
