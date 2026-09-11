'use client'

import { CheckCircle2, FileDown, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

export function OpsExportPanel({ sensitiveAccessReady, defaultOutcome }: {
  sensitiveAccessReady: boolean
  defaultOutcome: string | null
}) {
  const router = useRouter()
  const command = useIdempotentCommand('ops-export')
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState(defaultOutcome ?? 'ALL')
  const [rowLimit, setRowLimit] = useState('250')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; correlationId?: string } | null>(null)

  async function requestExport() {
    if (!sensitiveAccessReady || pending || reason.trim().length < 12) return
    const normalizedReason = reason.trim()
    const fingerprint = idempotencyFingerprint([normalizedReason, outcome, rowLimit, fromDate, toDate])
    const attempt = command.begin(fingerprint)
    setPending(true)
    setResult(null)
    const correlationId = crypto.randomUUID()
    try {
      const response = await fetch('/ops/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({
          dataset: 'ACTION_RECEIPTS',
          reason: normalizedReason,
          rowLimit: Number(rowLimit),
          filters: {
            outcome,
            from: fromDate ? `${fromDate}T00:00:00.000Z` : null,
            to: toDate ? `${toDate}T23:59:59.999Z` : null,
          },
          idempotencyKey: attempt.key,
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const responseCorrelation = typeof payload.correlationId === 'string' ? payload.correlationId : correlationId
      if (!response.ok) {
        setResult({ ok: false, message: String(payload.error ?? 'The export request failed safely.'), correlationId: responseCorrelation })
        return
      }
      command.complete(fingerprint)
      setResult({ ok: true, message: 'Export request recorded. Generation continues outside this page request.', correlationId: responseCorrelation })
      setReason('')
      router.refresh()
      window.setTimeout(() => router.refresh(), 1_500)
      window.setTimeout(() => router.refresh(), 4_000)
    } catch {
      setResult({ ok: false, message: 'The server response was interrupted. Your export scope is preserved; retry unchanged to recover the same request.', correlationId })
    } finally {
      setPending(false)
    }
  }

  if (!sensitiveAccessReady) {
    return (
      <div className="ops-export-locked">
        <ShieldCheck size={18} />
        <div><strong>Protected export access required</strong><span>Exports always require the dedicated fresh-MFA Access application—even for small result sets.</span></div>
        <Link className="ops-button ops-button-primary" href="/ops/sensitive/export?returnTo=/ops/reports%23export-requests">Verify access</Link>
      </div>
    )
  }

  return (
    <div className="ops-export-form">
      <div className="ops-export-form-copy"><FileDown size={18} /><div><strong>Request a purpose-limited CSV</strong><span>Only the bounded action-receipt fields below are available. The requester is watermarked into every row.</span></div></div>
      {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}<span>{result.message}<small>Correlation {result.correlationId}</small></span></div> : null}
      <div className="ops-export-controls">
        <label className="ops-field">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="ALL">All outcomes</option><option value="SUCCEEDED">Succeeded</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select></label>
        <label className="ops-field">Maximum rows<select value={rowLimit} onChange={(event) => setRowLimit(event.target.value)}><option value="100">100</option><option value="250">250</option><option value="500">500</option><option value="1000">1,000</option></select></label>
        <label className="ops-field">From date<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className="ops-field">To date<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      </div>
      <label className="ops-field">Operational reason<textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="State the incident, reconciliation, or governance purpose (12 characters minimum)." /></label>
      <button className="ops-button ops-button-primary" type="button" disabled={pending || reason.trim().length < 12} onClick={requestExport}>{pending ? <LoaderCircle className="ops-spin" size={14} /> : <FileDown size={14} />}Generate protected export</button>
      {reason.trim().length < 12 ? <small className="ops-disabled-help">Add a specific operational reason to enable generation.</small> : null}
    </div>
  )
}
