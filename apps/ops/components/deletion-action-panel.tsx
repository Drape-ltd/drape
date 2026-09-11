'use client'

import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

type ReceiptState = {
  tone: 'healthy' | 'warning' | 'critical'
  title: string
  detail: string
  correlationId?: string
}

export function DeletionActionPanel({
  issueId,
  requestId,
  status,
  recordVersion,
  protectedAccess,
  protectedCheckpoint,
}: {
  issueId: string
  requestId: string
  status: string
  recordVersion: number | null
  protectedAccess: boolean
  protectedCheckpoint: string
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ReceiptState | null>(null)
  const normalized = status.toUpperCase()
  const canAcknowledge = ['NEW', 'PENDING'].includes(normalized)
  const canReview = !['RESOLVED', 'CLOSED', 'COMPLETED', 'REJECTED'].includes(normalized)
  const canFinalize = ['TRIAGED', 'ACKNOWLEDGED'].includes(normalized)
  const missingVersion = recordVersion === null
  const blockerReasonValid = reason.trim().length >= 8
  const finalizationConfirmed = confirmation.trim().toUpperCase() === 'DELETE'
  const command = useIdempotentCommand('ops-account-deletion')

  async function act(action: 'ACKNOWLEDGE' | 'RECORD_BLOCKER' | 'APPROVE_FINALIZATION') {
    if (pending || missingVersion) return
    const actionReason = action === 'RECORD_BLOCKER' ? reason.trim() : ''
    const fingerprint = idempotencyFingerprint([issueId, requestId, action, actionReason, recordVersion])
    const attempt = command.begin(fingerprint)
    setPending(action)
    setReceipt(null)
    try {
      const response = await fetch('/api/actions/account-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId,
          requestId,
          action,
          reason: actionReason,
          expectedRecordVersion: recordVersion,
          idempotencyKey: attempt.key,
          correlationId: crypto.randomUUID(),
        }),
      })
      const result = await response.json().catch(() => ({})) as Record<string, unknown>
      const correlationId = typeof result.correlationId === 'string' ? result.correlationId : undefined
      if (!response.ok && response.status !== 207) {
        setReceipt({
          tone: response.status === 409 ? 'warning' : 'critical',
          title: response.status === 409 ? 'Case changed' : 'Action not completed',
          detail: response.status === 409 ? 'Reload the authoritative case and review the newer version before trying again.' : String(result.error ?? 'The protected action failed safely.'),
          correlationId,
        })
        return
      }
      command.complete(fingerprint)
      setReceipt({
        tone: response.status === 207 ? 'warning' : 'healthy',
        title: response.status === 207 ? 'Decision saved; follow-up needed' : 'Durable receipt recorded',
        detail: typeof result.warning === 'string' ? result.warning : 'The authoritative state and receipt are persisted. Refreshing the case now.',
        correlationId,
      })
      router.refresh()
    } catch {
      setReceipt({ tone: 'warning', title: 'Response interrupted', detail: 'Your input is preserved. Retry unchanged to recover the same protected-action receipt.' })
    } finally {
      setPending(null)
    }
  }

  if (!canReview) return <p className="ops-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>This deletion request is terminal. Reopening requires a new case-linked workflow; no mutation is available here.</p>

  return (
    <div className="ops-deletion-actions">
      {receipt ? (
        <div className="ops-status-banner" data-tone={receipt.tone} role={receipt.tone === 'critical' ? 'alert' : 'status'}>
          {receipt.tone === 'healthy' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span><strong>{receipt.title}</strong><br />{receipt.detail}{receipt.correlationId ? <><br /><small>Correlation {receipt.correlationId}</small></> : null}</span>
        </div>
      ) : null}
      {missingVersion ? <div className="ops-status-banner" data-tone="warning"><AlertTriangle size={16} />Canonical record version is missing. Repair the case projection before acting.</div> : null}
      {canAcknowledge ? (
        <div className="ops-action-block">
          <p className="ops-action-label">Recommended</p>
          <h3>Acknowledge and begin review</h3>
          <p>Records the first response and queues a customer update. It does not approve deletion.</p>
          <button className="ops-button ops-button-primary" type="button" disabled={pending !== null || missingVersion} onClick={() => act('ACKNOWLEDGE')}>
            {pending === 'ACKNOWLEDGE' ? <LoaderCircle className="ops-spin" size={15} /> : <CheckCircle2 size={15} />}Acknowledge request
          </button>
        </div>
      ) : null}
      <div className="ops-action-block">
        <p className="ops-action-label">Protected exception</p>
        <h3>Record a blocker</h3>
        <p>Use a specific obligation or legal-retention reason. The customer sees a safe status, not internal evidence.</p>
        <label className="ops-field">Blocker reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Example: active order must reach a terminal handoff outcome." /></label>
        {protectedAccess ? <button className="ops-button" type="button" disabled={pending !== null || missingVersion || !blockerReasonValid} onClick={() => act('RECORD_BLOCKER')}><ShieldCheck size={15} />Record protected blocker</button> : <a className="ops-button" href={protectedCheckpoint}><ShieldCheck size={15} />Verify protected access first</a>}
      </div>
      {canFinalize ? (
        <div className="ops-action-block ops-action-danger">
          <p className="ops-action-label">Irreversible boundary</p>
          <h3>Approve finalization</h3>
          <p>The worker rechecks orders, disputes, and payouts before anonymizing identity data and revoking access. Type <strong>DELETE</strong> to confirm.</p>
          <label className="ops-field">Confirmation<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
          {protectedAccess ? <button className="ops-button ops-button-danger" type="button" disabled={pending !== null || missingVersion || !finalizationConfirmed} onClick={() => act('APPROVE_FINALIZATION')}>{pending === 'APPROVE_FINALIZATION' ? <LoaderCircle className="ops-spin" size={15} /> : <ShieldCheck size={15} />}Approve protected finalization</button> : <a className="ops-button" href={protectedCheckpoint}><ShieldCheck size={15} />Verify protected access first</a>}
        </div>
      ) : null}
    </div>
  )
}
