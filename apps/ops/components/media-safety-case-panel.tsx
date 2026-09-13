'use client'

import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck, XCircle } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { MediaSafetyCaseContext } from '../lib/domain-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'

type Result = { ok: boolean; message: string; correlationId?: string }

export function MediaSafetyCasePanel({
  context,
  issueId,
  protectedAccess,
  protectedCheckpoint,
  canModerate,
}: {
  context: MediaSafetyCaseContext
  issueId: string
  protectedAccess: boolean
  protectedCheckpoint: string
  canModerate: boolean
}) {
  const router = useRouter()
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const openAssets = context.assets.filter((asset) => !['APPROVED', 'AUTO_ALLOWED', 'BLOCKED'].includes(asset.moderationStatus.toUpperCase()))

  async function decide(assetId: string, decision: 'APPROVE' | 'BLOCK') {
    const reason = reasons[assetId]?.trim() ?? ''
    if (!protectedAccess || !canModerate || !reviewed[assetId] || pending || (decision === 'BLOCK' && reason.length < 8)) return
    setPending(`${assetId}:${decision}`)
    setResult(null)
    try {
      const correlationId = crypto.randomUUID()
      const response = await fetch('/api/actions/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({ issueId, mediaAssetId: assetId, decision, reason }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      const responseCorrelation = typeof body.correlationId === 'string' ? body.correlationId : correlationId
      if (!response.ok && response.status !== 207) {
        setResult({ ok: false, message: String(body.error ?? 'The media decision failed safely.'), correlationId: responseCorrelation })
        return
      }
      setResult({
        ok: true,
        message: decision === 'APPROVE' ? 'Media approved and its owner update was queued.' : 'Media removed from public Drapeon surfaces and its owner update was queued.',
        correlationId: responseCorrelation,
      })
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'The decision response was interrupted. Reload this case before retrying.' })
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="ops-panel">
      <div className="ops-panel-head"><h2>Public media safety review</h2><span className="ops-chip" data-tone={openAssets.length > 0 ? 'warning' : 'healthy'}>{openAssets.length} awaiting decision</span></div>
      <div className="ops-panel-body" style={{ display: 'grid', gap: 18 }}>
        {result ? <div className="ops-status-banner" data-tone={result.ok ? 'healthy' : 'critical'} role={result.ok ? 'status' : 'alert'}>{result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{result.message}{result.correlationId ? <><br /><small>Correlation {result.correlationId}</small></> : null}</span></div> : null}
        {context.assets.length === 0 ? <div className="ops-empty ops-empty-compact"><AlertTriangle size={18} /><h3>Media evidence could not be loaded</h3><p>Keep this case open. The issue does not contain a usable media-asset reference.</p></div> : context.assets.map((asset) => {
          const terminal = ['APPROVED', 'AUTO_ALLOWED', 'BLOCKED'].includes(asset.moderationStatus.toUpperCase())
          const isVideo = asset.kind.toUpperCase() === 'VIDEO' || /\.(mp4|mov|m4v|webm)(?:$|\?)/iu.test(asset.publicUrl)
          const assetPending = pending?.startsWith(`${asset.id}:`) === true
          const blockReason = reasons[asset.id]?.trim() ?? ''
          return <article className="ops-action-block" key={asset.id}>
            <div className="ops-subhead"><div><span className="ops-action-label">{formatEnum(asset.purpose)}</span><h3>{isVideo ? 'Public video' : 'Public image'}</h3></div><span className="ops-chip" data-tone={terminal && asset.moderationStatus.toUpperCase() !== 'BLOCKED' ? 'healthy' : asset.moderationStatus.toUpperCase() === 'BLOCKED' ? 'critical' : 'warning'}>{formatEnum(asset.moderationStatus)}</span></div>
            <div className="ops-media-review-layout">
              <div className="ops-media-review-preview">
                {isVideo ? <video src={asset.publicUrl} poster={asset.posterUrl ?? undefined} controls preload="metadata" /> : <Image src={asset.publicUrl} alt="Public portfolio media awaiting safety review" fill sizes="(max-width: 900px) 100vw, 360px" unoptimized />}
              </div>
              <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                <dl className="ops-facts">
                  <div className="ops-fact"><dt>Risk</dt><dd>{formatEnum(asset.riskLevel)}</dd></div>
                  <div className="ops-fact"><dt>Uploaded</dt><dd>{formatRelativeTime(asset.createdAt)}</dd></div>
                  <div className="ops-fact"><dt>Signals</dt><dd>{asset.reasons.length > 0 ? asset.reasons.join(', ') : 'No automated safety signal recorded'}</dd></div>
                  <div className="ops-fact"><dt>Reference</dt><dd>{asset.id.slice(0, 8).toUpperCase()}</dd></div>
                </dl>
                <a className="ops-button" href={asset.publicUrl} target="_blank" rel="noreferrer">Open original <ExternalLink size={14} /></a>
                {!terminal ? <>
                  <label className="ops-check-row"><input type="checkbox" checked={reviewed[asset.id] === true} onChange={(event) => setReviewed((current) => ({ ...current, [asset.id]: event.target.checked }))} /><span>I reviewed this media for explicit, unsafe, misleading, and off-platform content.</span></label>
                  <label className="ops-field">Removal reason<textarea value={reasons[asset.id] ?? ''} maxLength={1000} onChange={(event) => setReasons((current) => ({ ...current, [asset.id]: event.target.value }))} placeholder="Required only when removing this media (8 characters minimum)." /></label>
                  {!protectedAccess ? <a className="ops-button" href={protectedCheckpoint}><ShieldCheck size={15} />Verify protected access first</a> : <div className="ops-decision-row">
                    <button className="ops-button ops-button-primary" type="button" disabled={!canModerate || !reviewed[asset.id] || assetPending} onClick={() => decide(asset.id, 'APPROVE')}>{assetPending && pending?.endsWith(':APPROVE') ? <LoaderCircle className="ops-spin" size={15} /> : <CheckCircle2 size={15} />}Approve media</button>
                    <button className="ops-button ops-button-danger" type="button" disabled={!canModerate || !reviewed[asset.id] || blockReason.length < 8 || assetPending} onClick={() => decide(asset.id, 'BLOCK')}>{assetPending && pending?.endsWith(':BLOCK') ? <LoaderCircle className="ops-spin" size={15} /> : <XCircle size={15} />}Remove from public view</button>
                  </div>}
                </> : <div className="ops-status-banner" data-tone={asset.moderationStatus.toUpperCase() === 'BLOCKED' ? 'critical' : 'healthy'}>{asset.moderationStatus.toUpperCase() === 'BLOCKED' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}This media decision is complete.</div>}
              </div>
            </div>
          </article>
        })}
      </div>
    </section>
  )
}
