'use client'

import { CheckCircle2, KeyRound, LoaderCircle, Play, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

type Result = { ok: boolean; message: string; correlationId?: string }

async function postMoneyAction(payload: Record<string, unknown>) {
  const correlationId = crypto.randomUUID()
  const response = await fetch('/ops/api/actions/money', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  return { response, body, correlationId: typeof body.correlationId === 'string' ? body.correlationId : correlationId }
}

export function MoneyElevationPanel({ grantExpiresAt }: { grantExpiresAt: string | null }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function elevate() {
    if (pending || reason.trim().length < 12) return
    setPending(true)
    setResult(null)
    try {
      const outcome = await postMoneyAction({ action: 'ELEVATE', reason: reason.trim() })
      if (!outcome.response.ok) {
        setResult({ ok: false, message: String(outcome.body.error ?? 'Protected access was not granted.'), correlationId: outcome.correlationId })
        return
      }
      setReason('')
      setResult({ ok: true, message: 'Protected action scope is active and auditable.', correlationId: outcome.correlationId })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The protected-access response was interrupted. Reload the current grant state before requesting another scope.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="ops-money-elevation">
      <div className="ops-money-elevation-head"><ShieldCheck size={16} /><div><strong>{grantExpiresAt ? 'Money Desk scope active' : 'Activate Money Desk scope'}</strong><span>{grantExpiresAt ? `Expires ${new Date(grantExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Fresh MFA alone cannot authorize a financial decision.'}</span></div></div>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}><CheckCircle2 size={14} /><span>{result.message}<small>Correlation {result.correlationId}</small></span></div> : null}
      {!grantExpiresAt ? <><label className="ops-field">Reason for protected scope<textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="State the queue or incident you are handling (12 characters minimum)." /></label><button className="ops-button ops-button-primary" type="button" disabled={pending || reason.trim().length < 12} onClick={elevate}>{pending ? <LoaderCircle className="ops-spin" size={14} /> : <KeyRound size={14} />}Activate for 15 minutes</button></> : null}
    </div>
  )
}

export function MoneyDecisionPanel({ requestId, canDecide }: { requestId: string; canDecide: boolean }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<'APPROVE' | 'REJECT' | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function decide(decision: 'APPROVE' | 'REJECT') {
    if (!canDecide || pending || reason.trim().length < 12) return
    setPending(decision)
    setResult(null)
    try {
      const outcome = await postMoneyAction({ action: 'DECIDE', requestId, decision, reason: reason.trim() })
      if (!outcome.response.ok) {
        setResult({ ok: false, message: String(outcome.body.error ?? 'The financial decision failed safely.'), correlationId: outcome.correlationId })
        return
      }
      setResult({ ok: true, message: `${decision === 'APPROVE' ? 'Approval' : 'Rejection'} recorded with an immutable decision receipt.`, correlationId: outcome.correlationId })
      setReason('')
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The decision response was interrupted. Reload this request to reconcile its authoritative approval state before deciding again.' })
    } finally {
      setPending(null)
    }
  }

  if (!canDecide) return null
  return (
    <div className="ops-money-decision">
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}><CheckCircle2 size={14} /><span>{result.message}<small>Correlation {result.correlationId}</small></span></div> : null}
      <label className="ops-field">Founder decision reason<textarea maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reference the evidence reviewed and why this decision is safe." /></label>
      <div className="ops-inline-actions"><button className="ops-button ops-button-primary" type="button" disabled={pending !== null || reason.trim().length < 12} onClick={() => decide('APPROVE')}>{pending === 'APPROVE' ? <LoaderCircle className="ops-spin" size={14} /> : <CheckCircle2 size={14} />}Approve</button><button className="ops-button" type="button" disabled={pending !== null || reason.trim().length < 12} onClick={() => decide('REJECT')}>{pending === 'REJECT' ? <LoaderCircle className="ops-spin" size={14} /> : <XCircle size={14} />}Reject</button></div>
    </div>
  )
}

export function MoneyExecutionPanel({ requestId, actionLabel, canExecute }: { requestId: string; actionLabel: string; canExecute: boolean }) {
  const router = useRouter()
  const command = useIdempotentCommand('ops-money-execution')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function execute() {
    if (!canExecute || !confirmed || pending) return
    const fingerprint = idempotencyFingerprint([requestId, 'EXECUTE'])
    const attempt = command.begin(fingerprint)
    setPending(true)
    setResult(null)
    try {
      const outcome = await postMoneyAction({ action: 'EXECUTE', requestId, idempotencyKey: attempt.key })
      const execution = outcome.body.result && typeof outcome.body.result === 'object'
        ? outcome.body.result as Record<string, unknown>
        : {}
      if (!outcome.response.ok) {
        setResult({ ok: false, message: String(execution.error ?? outcome.body.error ?? 'The provider command failed safely.'), correlationId: outcome.correlationId })
        return
      }
      command.complete(fingerprint)
      const processing = execution.state === 'PROCESSING'
      setResult({ ok: true, message: processing ? 'Provider execution started. The terminal callback remains visible in this queue.' : 'The approved provider action reached a recorded terminal outcome.', correlationId: outcome.correlationId })
      setConfirmed(false)
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The provider response was interrupted. Keep this request unchanged and retry to recover the same execution attempt.' })
    } finally {
      setPending(false)
    }
  }

  if (!canExecute) return null
  return (
    <div className="ops-money-execution">
      <div className="ops-money-execution-copy"><TriangleAlert size={15} /><div><strong>Final provider command · {actionLabel}</strong><span>This can move or return real funds. The approved amount, destination, and evidence snapshot will be checked again.</span></div></div>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}><CheckCircle2 size={14} /><span>{result.message}<small>Correlation {result.correlationId}</small></span></div> : null}
      <label className="ops-check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the approved request and linked case immediately before execution.</span></label>
      <button className="ops-button ops-button-primary" type="button" disabled={!confirmed || pending} onClick={execute}>{pending ? <LoaderCircle className="ops-spin" size={14} /> : <Play size={14} />}Execute approved action</button>
      {!confirmed ? <small className="ops-disabled-help">Confirm the final evidence check to enable provider execution.</small> : null}
    </div>
  )
}
