'use client'

import { ArrowRight, GitMerge, GitPullRequestArrow, LoaderCircle, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { CanonicalCaseLineageRow } from '../lib/data'
import { idempotencyFingerprint, useIdempotentCommand } from '../lib/use-idempotent-command'
import { formatEnum, formatRelativeTime } from '../lib/work-items'

type LookupCase = {
  id: string
  caseNumber: string
  title: string
  summary: string
  status: string
  queueKey: string | null
  priority: string | null
  severity: string
  recordVersion: number
}

type Result = {
  ok: boolean
  message: string
  correlationId?: string
  targetCaseNumber?: string
}

const TERMINAL = new Set(['RESOLVED', 'CLOSED'])

export function CaseLineageHistory({ issueId, lineage }: { issueId: string; lineage: CanonicalCaseLineageRow[] }) {
  if (lineage.length === 0) return null
  return (
    <section className="ops-panel">
      <div className="ops-panel-head"><h2>Linked cases</h2><span className="ops-muted" style={{ fontSize: 11 }}>{lineage.length} immutable {lineage.length === 1 ? 'link' : 'links'}</span></div>
      <div className="ops-panel-body">
        <ol className="ops-timeline">
          {lineage.map((entry) => {
            const isSource = entry.source_issue_id === issueId
            const linkedCase = isSource ? entry.target_case_number : entry.source_case_number
            const direction = entry.relationship_type === 'MERGED_INTO'
              ? isSource ? 'Merged into' : 'Absorbed duplicate'
              : isSource ? 'Split child' : 'Split from parent'
            return <li key={entry.id}>
              <strong>{direction} · <Link href={`/ops/cases/${encodeURIComponent(linkedCase)}`}>{linkedCase}</Link></strong>
              <span>{entry.reason} · {entry.actor_label} · {formatRelativeTime(entry.created_at)}</span>
              <span>Correlation {entry.correlation_id}{entry.selected_context.length ? ` · Context: ${entry.selected_context.map(formatEnum).join(', ')}` : ''}</span>
            </li>
          })}
        </ol>
      </div>
    </section>
  )
}

export function CaseLineagePanel({
  issueId,
  caseNumber,
  status,
  recordVersion,
  protectedAccess,
  protectedCheckpoint,
  availableContext,
}: {
  issueId: string
  caseNumber: string
  status: string
  recordVersion: number | null
  protectedAccess: boolean
  protectedCheckpoint: string
  availableContext: Array<{ key: string; label: string }>
}) {
  const [mode, setMode] = useState<'merge' | 'split'>('merge')
  const [targetCaseNumber, setTargetCaseNumber] = useState('')
  const [target, setTarget] = useState<LookupCase | null>(null)
  const [mergeReason, setMergeReason] = useState('')
  const [childTitle, setChildTitle] = useState('')
  const [childSummary, setChildSummary] = useState('')
  const [splitReason, setSplitReason] = useState('')
  const [selectedContext, setSelectedContext] = useState<string[]>([])
  const [pending, setPending] = useState<'lookup' | 'merge' | 'split' | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const command = useIdempotentCommand('ops-case-lineage')
  const terminal = TERMINAL.has(status.toUpperCase())

  function changeTarget(value: string) {
    setTargetCaseNumber(value.toUpperCase())
    setTarget(null)
    setResult(null)
  }

  async function lookupTarget() {
    if (pending || !/^OPS-[A-Z0-9-]{4,60}$/u.test(targetCaseNumber.trim().toUpperCase())) return
    setPending('lookup')
    setResult(null)
    try {
      const response = await fetch('/api/cases/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseNumber: targetCaseNumber.trim().toUpperCase() }),
      })
      const payload = await response.json().catch(() => ({})) as { case?: LookupCase; error?: string; correlationId?: string }
      if (!response.ok || !payload.case) {
        setResult({ ok: false, message: String(payload.error ?? 'The target case could not be verified.'), correlationId: payload.correlationId })
        return
      }
      if (payload.case.id === issueId) {
        setResult({ ok: false, message: 'Choose a different case. A case cannot be merged into itself.', correlationId: payload.correlationId })
        return
      }
      if (TERMINAL.has(payload.case.status.toUpperCase())) {
        setResult({ ok: false, message: 'Choose an active survivor. Resolved and closed cases cannot receive a merge.', correlationId: payload.correlationId })
        return
      }
      setTarget(payload.case)
    } finally {
      setPending(null)
    }
  }

  async function submit(action: 'MERGE_CASE' | 'SPLIT_CASE') {
    if (pending || !recordVersion) return
    const reason = action === 'MERGE_CASE' ? mergeReason.trim() : splitReason.trim()
    const fingerprint = idempotencyFingerprint(action === 'MERGE_CASE'
      ? [issueId, action, target?.id, target?.recordVersion, reason, recordVersion]
      : [issueId, action, childTitle.trim(), childSummary.trim(), [...selectedContext].sort(), reason, recordVersion])
    const attempt = command.begin(fingerprint)
    setPending(action === 'MERGE_CASE' ? 'merge' : 'split')
    setResult(null)
    try {
      const response = await fetch('/api/actions/case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId,
          action,
          targetCaseNumber: action === 'MERGE_CASE' ? target?.caseNumber : undefined,
          expectedTargetVersion: action === 'MERGE_CASE' ? target?.recordVersion : undefined,
          childTitle: action === 'SPLIT_CASE' ? childTitle.trim() : undefined,
          childSummary: action === 'SPLIT_CASE' ? childSummary.trim() : undefined,
          selectedContext: action === 'SPLIT_CASE' ? selectedContext : [],
          reason,
          expectedRecordVersion: recordVersion,
          idempotencyKey: attempt.key,
          correlationId: crypto.randomUUID(),
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const receipt = payload.receipt && typeof payload.receipt === 'object' ? payload.receipt as Record<string, unknown> : {}
      const correlationId = typeof payload.correlationId === 'string' ? payload.correlationId : undefined
      if (!response.ok) {
        setResult({
          ok: false,
          message: response.status === 409
            ? 'One of these cases changed. Your inputs are preserved; reload and verify both current versions.'
            : String(payload.error ?? 'The lineage action failed safely.'),
          correlationId,
        })
        return
      }
      command.complete(fingerprint)
      setResult({
        ok: true,
        message: action === 'MERGE_CASE' ? 'The duplicate was closed and immutable lineage was recorded.' : 'The independent child case was created with only the selected context.',
        correlationId,
        targetCaseNumber: typeof receipt.targetCaseNumber === 'string' ? receipt.targetCaseNumber : undefined,
      })
    } catch {
      setResult({ ok: false, message: 'The server response was interrupted. Retry with the same inputs so the idempotency receipt can be recovered.' })
    } finally {
      setPending(null)
    }
  }

  if (terminal) return null
  if (!protectedAccess) return (
    <section className="ops-panel">
      <div className="ops-panel-head"><h2>Case structure</h2><ShieldCheck size={16} color="var(--needle)" /></div>
      <div className="ops-panel-body">
        <p className="ops-muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>Merging or splitting changes the operational case graph. A fresh protected workforce session and desktop review are required.</p>
        <a className="ops-button ops-button-primary" href={protectedCheckpoint}>Verify protected access</a>
      </div>
    </section>
  )

  return (
    <section className="ops-panel">
      <div className="ops-panel-head"><h2>Case structure</h2><span className="ops-muted" style={{ fontSize: 11 }}>Admin · protected desktop action</span></div>
      <div className="ops-panel-body" style={{ display: 'grid', gap: 16 }}>
        <div role="tablist" aria-label="Case structure action" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={mode === 'merge' ? 'ops-button ops-button-primary' : 'ops-button'} type="button" role="tab" aria-selected={mode === 'merge'} onClick={() => { setMode('merge'); setResult(null) }}><GitMerge size={15} />Merge duplicate</button>
          <button className={mode === 'split' ? 'ops-button ops-button-primary' : 'ops-button'} type="button" role="tab" aria-selected={mode === 'split'} onClick={() => { setMode('split'); setResult(null) }}><GitPullRequestArrow size={15} />Split unrelated work</button>
        </div>
        {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}><span>{result.message}{result.targetCaseNumber ? <> <Link href={`/ops/cases/${encodeURIComponent(result.targetCaseNumber)}`}>Open {result.targetCaseNumber} <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></Link></> : null}{result.correlationId ? <><br /><small>Correlation {result.correlationId}</small></> : null}</span></div> : null}
        {mode === 'merge' ? <div className="ops-action-block">
          <p className="ops-action-label">One surviving case</p>
          <h3>Merge {caseNumber} into an active case</h3>
          <p>The duplicate closes, but its domain reference, events, receipts, and audit history remain intact and linked.</p>
          <label className="ops-field">Surviving case number<input value={targetCaseNumber} maxLength={64} placeholder="OPS-…" onChange={(event) => changeTarget(event.target.value)} /></label>
          <button className="ops-button" type="button" disabled={pending !== null || !/^OPS-[A-Z0-9-]{4,60}$/u.test(targetCaseNumber.trim())} onClick={lookupTarget}>{pending === 'lookup' ? <LoaderCircle className="ops-spin" size={15} /> : <ShieldCheck size={15} />}Verify current survivor</button>
          {target ? <div className="ops-next-action"><h3>{target.caseNumber} · {target.title}</h3><p>{target.summary}</p><p className="ops-muted" style={{ marginBottom: 0, fontSize: 12 }}>{formatEnum(target.status)} · {formatEnum(target.queueKey ?? 'unassigned')} · {target.priority ?? 'No priority'} · version {target.recordVersion}</p></div> : null}
          <label className="ops-field">Why these cases are the same<textarea value={mergeReason} maxLength={1000} onChange={(event) => setMergeReason(event.target.value)} /></label>
          <button className="ops-button ops-button-primary" type="button" disabled={pending !== null || !target || mergeReason.trim().length < 12} onClick={() => submit('MERGE_CASE')}>{pending === 'merge' ? <LoaderCircle className="ops-spin" size={15} /> : <GitMerge size={15} />}Close duplicate and preserve lineage</button>
        </div> : <div className="ops-action-block">
          <p className="ops-action-label">Independent child case</p>
          <h3>Split unrelated work from {caseNumber}</h3>
          <p>The parent stays active. Only checked context identifiers are copied; arbitrary metadata and history are never duplicated.</p>
          <label className="ops-field">Child case title<input value={childTitle} maxLength={180} onChange={(event) => setChildTitle(event.target.value)} /></label>
          <label className="ops-field">Independent problem summary<textarea value={childSummary} maxLength={2000} onChange={(event) => setChildSummary(event.target.value)} /></label>
          {availableContext.length ? <fieldset className="ops-field"><legend>Context to copy</legend><div style={{ display: 'grid', gap: 8, marginTop: 8 }}>{availableContext.map((entry) => <label key={entry.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={selectedContext.includes(entry.key)} onChange={(event) => setSelectedContext((current) => event.target.checked ? [...current, entry.key] : current.filter((key) => key !== entry.key))} />{entry.label}</label>)}</div></fieldset> : <p className="ops-muted" style={{ margin: 0, fontSize: 13 }}>This parent has no reusable context identifiers. The child will still retain immutable lineage.</p>}
          <label className="ops-field">Why this work is unrelated<textarea value={splitReason} maxLength={1000} onChange={(event) => setSplitReason(event.target.value)} /></label>
          <button className="ops-button ops-button-primary" type="button" disabled={pending !== null || childTitle.trim().length < 8 || childSummary.trim().length < 20 || splitReason.trim().length < 12} onClick={() => submit('SPLIT_CASE')}>{pending === 'split' ? <LoaderCircle className="ops-spin" size={15} /> : <GitPullRequestArrow size={15} />}Create linked child case</button>
        </div>}
      </div>
    </section>
  )
}
