'use client'

import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { PayoutChangeCaseContext } from '../lib/domain-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'
import { MoneyElevationPanel } from './money-action-panel'

function Destination({ label, value }: { label: string; value: PayoutChangeCaseContext['currentDestination'] }) {
  return <div className="ops-action-block"><span className="ops-action-label">{label}</span><h3>{value ? `${value.provider ?? 'Provider'} · ${value.currency ?? 'Currency unavailable'}` : 'No destination on file'}</h3>{value ? <dl className="ops-facts"><div className="ops-fact"><dt>Institution</dt><dd>{value.bankName ?? 'Provider managed'}</dd></div><div className="ops-fact"><dt>Account holder</dt><dd>{value.accountName ?? 'Not supplied'}</dd></div><div className="ops-fact"><dt>Account</dt><dd>{value.accountMasked ?? 'Provider managed'}</dd></div><div className="ops-fact"><dt>Country</dt><dd>{value.countryCode ?? 'Not supplied'}</dd></div><div className="ops-fact"><dt>Provider verification</dt><dd>{value.accountVerified ? 'Verified' : 'Incomplete'}</dd></div></dl> : null}</div>
}

export function PayoutChangeCasePanel({ context, issueId, protectedAccess, protectedCheckpoint, grantExpiresAt, canPrepare }: {
  context: PayoutChangeCaseContext
  issueId: string
  protectedAccess: boolean
  protectedCheckpoint: string
  grantExpiresAt: string | null
  canPrepare: boolean
}) {
  const router = useRouter()
  const [reviewed, setReviewed] = useState(false)
  const [reason, setReason] = useState('Reviewed the verified replacement payout destination and account ownership evidence.')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; correlationId?: string } | null>(null)
  const readyForPreparation = context.status === 'PENDING' && context.lifecycleState === 'OPS_REVIEW' && context.confirmationStatus === 'CONFIRMED' && context.requestedDestination?.accountVerified === true

  async function prepare() {
    if (!readyForPreparation || !protectedAccess || !grantExpiresAt || !canPrepare || !reviewed || pending || reason.trim().length < 12) return
    setPending(true)
    setResult(null)
    try {
      const correlationId = crypto.randomUUID()
      const response = await fetch('/ops/api/actions/money', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({ action: 'PREPARE', issueId, payoutChangeRequestId: context.requestId, reason: reason.trim() }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      const responseCorrelation = typeof body.correlationId === 'string' ? body.correlationId : correlationId
      if (!response.ok) {
        setResult({ ok: false, message: String(body.error ?? 'The payout review could not be prepared.'), correlationId: responseCorrelation })
        return
      }
      setResult({ ok: true, message: 'Founder approval is prepared in Money Desk. The configured founder account can review and approve it.', correlationId: responseCorrelation })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The preparation response was interrupted. Reload before retrying.' })
    } finally {
      setPending(false)
    }
  }

  const moneyRequest = context.moneyRequest
  return <section className="ops-panel"><div className="ops-panel-head"><h2>Payout destination review</h2><span className="ops-chip" data-tone={moneyRequest ? 'warning' : 'critical'}>{moneyRequest ? formatEnum(moneyRequest.status) : 'Not prepared'}</span></div><div className="ops-panel-body" style={{ display: 'grid', gap: 18 }}>
    <div className="ops-payout-compare"><Destination label="Current active destination" value={context.currentDestination} /><Destination label="Requested replacement" value={context.requestedDestination} /></div>
    <div className="ops-action-block"><span className="ops-action-label">Why this reached Ops</span><div className="ops-risk-list">{context.riskSignals.length > 0 ? context.riskSignals.map((signal) => <span className="ops-chip" data-tone="warning" key={signal}>{signal}</span>) : <span className="ops-chip" data-tone="healthy">No destination differences detected</span>}</div><p className="ops-muted" style={{ margin: 0 }}>Submitted {context.submittedAt ? formatRelativeTime(context.submittedAt) : 'at an unknown time'} · customer confirmation {context.confirmedAt ? formatRelativeTime(context.confirmedAt) : formatEnum(context.confirmationStatus ?? 'missing')}</p></div>
    {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{result.message}{result.correlationId ? <><br /><small>Correlation {result.correlationId}</small></> : null}</span></div> : null}
    {moneyRequest ? <div className="ops-action-block"><span className="ops-action-label">Money Desk request</span><h3>{moneyRequest.reference} · {formatEnum(moneyRequest.status)}</h3><p>Prepared by {moneyRequest.requesterEmail}. Approval and execution are restricted to the configured founder account.</p><a className="ops-button ops-button-primary" href={`/ops/money?view=${moneyRequest.status === 'PENDING_APPROVAL' ? 'approval' : 'execution'}#money-${moneyRequest.id}`}>Open in Money Desk</a></div> : !readyForPreparation ? <div className="ops-status-banner" data-tone="warning"><AlertTriangle size={16} />This replacement is not confirmed and provider-verified, so it cannot enter Money Desk.</div> : !protectedAccess ? <a className="ops-button" href={protectedCheckpoint}><ShieldCheck size={15} />Verify protected Money Desk access</a> : !grantExpiresAt ? <MoneyElevationPanel grantExpiresAt={null} /> : <div className="ops-action-block"><span className="ops-action-label">Prepare controlled change</span><h3>Send to founder approval</h3><p>This does not activate Stripe. It snapshots the verified request so the configured founder account can approve it after a fresh evidence check.</p><label className="ops-check-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I compared the current and requested destination, provider verification, currency, and account-holder evidence.</span></label><label className="ops-field">Preparation reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label><button className="ops-button ops-button-primary" type="button" disabled={!canPrepare || !reviewed || pending || reason.trim().length < 12} onClick={prepare}>{pending ? <LoaderCircle className="ops-spin" size={15} /> : <ShieldCheck size={15} />}Prepare founder approval</button></div>}
  </div></section>
}
