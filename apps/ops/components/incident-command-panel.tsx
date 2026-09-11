'use client'

import { BellOff, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

type IncidentAction = 'ACKNOWLEDGE' | 'SNOOZE' | 'RESOLVE'

export function IncidentCommandPanel({ incidentId, acknowledgementRequired, recordVersion, allowResolve = true }: {
  incidentId: string
  acknowledgementRequired: boolean
  recordVersion: number
  allowResolve?: boolean
}) {
  const router = useRouter()
  const command = useIdempotentCommand<{ snoozeUntil: string | null }>('ops-incident')
  const [pending, setPending] = useState<IncidentAction | null>(null)
  const [reason, setReason] = useState('')
  const [snoozeMinutes, setSnoozeMinutes] = useState('60')
  const [result, setResult] = useState<{ ok: boolean; message: string; correlationId?: string } | null>(null)

  async function act(action: IncidentAction) {
    if (pending) return
    const actionReason = action === 'ACKNOWLEDGE' ? '' : reason.trim()
    const fingerprint = idempotencyFingerprint([incidentId, action, actionReason, snoozeMinutes, recordVersion])
    const attempt = command.begin(fingerprint, () => ({
      snoozeUntil: action === 'SNOOZE' ? new Date(Date.now() + Number(snoozeMinutes) * 60_000).toISOString() : null,
    }))
    setPending(action)
    setResult(null)
    try {
      const response = await fetch('/api/actions/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId, action, reason: actionReason, snoozeUntil: attempt.metadata?.snoozeUntil ?? null, expectedRecordVersion: recordVersion, idempotencyKey: attempt.key, correlationId: crypto.randomUUID() }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const correlationId = typeof payload.correlationId === 'string' ? payload.correlationId : undefined
      if (!response.ok) {
        setResult({ ok: false, message: response.status === 409 ? 'The incident changed. Your reason is preserved; refresh and review the current state.' : String(payload.error ?? 'The action failed safely.'), correlationId })
        return
      }
      command.complete(fingerprint)
      setResult({ ok: true, message: 'Incident, case timeline, and durable receipt were updated together.', correlationId })
      setReason('')
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The server response was interrupted. Your reason and snooze deadline are preserved; retry unchanged to recover the same receipt.' })
    } finally {
      setPending(null)
    }
  }

  const hasReason = reason.trim().length >= 8

  return (
    <div className="ops-incident-command">
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}><CheckCircle2 size={15} /><span>{result.message}{result.correlationId ? <><br /><small>Correlation {result.correlationId}</small></> : null}</span></div> : null}
      <div className="ops-incident-command-row">
        {acknowledgementRequired ? <button className="ops-button ops-button-primary" type="button" disabled={pending !== null} onClick={() => act('ACKNOWLEDGE')}>{pending === 'ACKNOWLEDGE' ? <LoaderCircle className="ops-spin" size={14} /> : <ShieldCheck size={14} />}Acknowledge</button> : <span className="ops-command-confirmed"><ShieldCheck size={14} />Acknowledged</span>}
        <select aria-label="Snooze duration" value={snoozeMinutes} disabled={pending !== null} onChange={(event) => setSnoozeMinutes(event.target.value)}>
          <option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option>
        </select>
        <button className="ops-button" type="button" disabled={pending !== null || !hasReason} onClick={() => act('SNOOZE')}>{pending === 'SNOOZE' ? <LoaderCircle className="ops-spin" size={14} /> : <BellOff size={14} />}Snooze</button>
        {allowResolve ? <button className="ops-button" type="button" disabled={pending !== null || !hasReason} onClick={() => act('RESOLVE')}>{pending === 'RESOLVE' ? <LoaderCircle className="ops-spin" size={14} /> : <CheckCircle2 size={14} />}Resolve</button> : null}
      </div>
      <label className="ops-field ops-incident-reason">Operator reason<textarea maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={allowResolve ? 'Required for snooze or resolution; record recovery evidence or the bounded follow-up rationale.' : 'Required for snooze; record the bounded follow-up rationale.'} /></label>
    </div>
  )
}
