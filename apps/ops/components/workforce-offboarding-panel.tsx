'use client'

import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, UserRoundX } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'

type OffboardingCase = {
  id: string
  caseNumber: string
  status: string
  recordVersion: number
} | null

type Result = {
  tone: 'healthy' | 'warning' | 'critical'
  title: string
  detail: string
  correlationId?: string
}

const EVIDENCE_FIELDS = [
  { key: 'accessProvider', label: 'Access / identity provider', placeholder: 'Example: CF-AUDIT-20260911-0042' },
  { key: 'collaborationTools', label: 'Slack, Jira, and Confluence', placeholder: 'Example: OFFBOARD-20260911-COLLAB' },
  { key: 'providerDashboards', label: 'Supabase and provider dashboards', placeholder: 'Example: OFFBOARD-20260911-PROVIDERS' },
  { key: 'scopedCredentials', label: 'Scoped credentials and tokens', placeholder: 'Example: ROTATION-20260911-0017' },
] as const

export function WorkforceOffboardingPanel({
  targetPrincipalId,
  targetEmail,
  targetStatus,
  targetUpdatedAt,
  actorEmail,
  offboardingCase,
  protectedAccess,
  protectedCheckpoint,
}: {
  targetPrincipalId: string
  targetEmail: string
  targetStatus: string
  targetUpdatedAt: string
  actorEmail: string
  offboardingCase: OffboardingCase
  protectedAccess: boolean
  protectedCheckpoint: string
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [evidenceRefs, setEvidenceRefs] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const command = useIdempotentCommand('ops-workforce-offboarding')
  const revoked = targetStatus.toUpperCase() === 'REVOKED'
  const terminal = offboardingCase && ['RESOLVED', 'CLOSED'].includes(offboardingCase.status.toUpperCase())
  const self = actorEmail.trim().toLowerCase() === targetEmail.trim().toLowerCase()
  const action = revoked ? 'VERIFY_EXTERNAL_OFFBOARDING' : 'REVOKE_DRAPEON_ACCESS'
  const evidenceComplete = EVIDENCE_FIELDS.every(({ key }) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,254}$/u.test((evidenceRefs[key] ?? '').trim()))
  const confirmed = revoked ? confirmation.trim().toUpperCase() === 'VERIFY' : confirmation.trim().toLowerCase() === targetEmail.trim().toLowerCase()
  const enabled = !pending && !self && !terminal && reason.trim().length >= 12 && confirmed && (!revoked || (Boolean(offboardingCase) && evidenceComplete))

  async function submit() {
    if (!enabled) return
    const cleanEvidence = Object.fromEntries(EVIDENCE_FIELDS.map(({ key }) => [key, (evidenceRefs[key] ?? '').trim()]))
    const fingerprint = idempotencyFingerprint([
      targetPrincipalId,
      action,
      reason.trim(),
      targetUpdatedAt,
      offboardingCase?.recordVersion ?? null,
      ...EVIDENCE_FIELDS.map(({ key }) => cleanEvidence[key]),
    ])
    const attempt = command.begin(fingerprint)
    setPending(true)
    setResult(null)
    try {
      const response = await fetch('/api/actions/workforce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPrincipalId,
          action,
          reason: reason.trim(),
          expectedTargetUpdatedAt: targetUpdatedAt,
          expectedCaseVersion: offboardingCase?.recordVersion ?? null,
          evidenceRefs: revoked ? cleanEvidence : {},
          idempotencyKey: attempt.key,
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const correlationId = typeof payload.correlationId === 'string' ? payload.correlationId : undefined
      if (!response.ok) {
        setResult({
          tone: response.status === 409 ? 'warning' : 'critical',
          title: response.status === 409 ? 'Authoritative state changed' : 'Offboarding action stopped safely',
          detail: response.status === 409
            ? 'Reload the workforce record and review the current case before trying again.'
            : String(payload.error ?? 'The protected action did not complete.'),
          correlationId,
        })
        return
      }
      command.complete(fingerprint)
      setResult({
        tone: 'healthy',
        title: revoked ? 'External offboarding verified' : 'Drapeon access revoked',
        detail: revoked
          ? 'A second-admin receipt now links all four retained evidence references. The case is terminal.'
          : 'Sessions and Ops notifications are cut off. A different admin must now verify every external access source.',
        correlationId,
      })
      router.refresh()
    } catch {
      setResult({
        tone: 'warning',
        title: 'Response interrupted',
        detail: 'Your inputs are preserved. Retry unchanged to recover the same durable action receipt.',
      })
    } finally {
      setPending(false)
    }
  }

  if (terminal) {
    return <div className="ops-workforce-terminal"><CheckCircle2 size={14} />Offboarding verified{offboardingCase ? <> · <Link href={`/ops/cases/${encodeURIComponent(offboardingCase.caseNumber)}`}>{offboardingCase.caseNumber}</Link></> : null}</div>
  }

  return (
    <details className="ops-workforce-action">
      <summary>
        <span>{revoked ? <ShieldCheck size={15} /> : <UserRoundX size={15} />}{revoked ? 'Verify external offboarding' : 'Begin protected offboarding'}</span>
        {offboardingCase ? <Link href={`/ops/cases/${encodeURIComponent(offboardingCase.caseNumber)}`} onClick={(event) => event.stopPropagation()}>{offboardingCase.caseNumber}<ExternalLink size={12} /></Link> : null}
      </summary>
      <div className="ops-workforce-action-body">
        {result ? <div className="ops-status-banner" data-tone={result.tone} role={result.tone === 'critical' ? 'alert' : 'status'}>{result.tone === 'healthy' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span><strong>{result.title}</strong><br />{result.detail}{result.correlationId ? <><br /><small>Correlation {result.correlationId}</small></> : null}</span></div> : null}
        {self ? <div className="ops-status-banner" data-tone="warning"><AlertTriangle size={16} />You cannot revoke or certify your own workforce access. A different named admin is required.</div> : null}
        {!self && !protectedAccess ? <div className="ops-status-banner" data-tone="warning"><ShieldCheck size={16} /><span>Fresh protected access is required. <a href={protectedCheckpoint}>Verify protected access</a>.</span></div> : null}
        {revoked ? (
          <>
            <p>Drapeon access is already revoked. A different admin must inspect the actual provider records and retain stable evidence references before closing the case.</p>
            {!offboardingCase ? <div className="ops-status-banner" data-tone="critical"><AlertTriangle size={16} />No canonical offboarding case exists. Repair the record before attempting certification.</div> : null}
            <div className="ops-workforce-evidence-grid">
              {EVIDENCE_FIELDS.map((field) => <label className="ops-field" key={field.key}>{field.label}<input value={evidenceRefs[field.key] ?? ''} maxLength={255} onChange={(event) => setEvidenceRefs((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} /></label>)}
            </div>
          </>
        ) : <p>This immediately invalidates Drapeon workforce sessions and disables every Ops push subscription for this principal. External tools remain a separate verified follow-up.</p>}
        <label className="ops-field">Reason<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder={revoked ? 'Explain the evidence review and any exception checked.' : 'Explain why this principal must be offboarded now.'} /></label>
        <label className="ops-field">Confirmation<input value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} placeholder={revoked ? 'Type VERIFY' : `Type ${targetEmail}`} /></label>
        <button className={revoked ? 'ops-button ops-button-primary' : 'ops-button ops-button-danger'} type="button" disabled={!enabled || !protectedAccess} onClick={submit}>
          {pending ? <LoaderCircle className="ops-spin" size={15} /> : revoked ? <ShieldCheck size={15} /> : <UserRoundX size={15} />}
          {revoked ? 'Record independent verification' : 'Revoke Drapeon access'}
        </button>
        <p className="ops-muted" style={{ margin: 0, fontSize: 11 }}>The server rereads and locks both principals, rejects stale versions and self-action, and records an environment-bound receipt.</p>
      </div>
    </details>
  )
}
