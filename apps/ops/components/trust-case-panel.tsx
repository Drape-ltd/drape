import { ExternalLink, ImageIcon, ShieldCheck, Video } from 'lucide-react'
import Image from 'next/image'
import type { TrustCaseContext } from '../lib/domain-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'
import { TrustDecisionPanel } from './trust-decision-panel'

export function TrustCasePanel({ context, caseNumber, issueId, recordVersion, protectedAccess, protectedCheckpoint }: {
  context: TrustCaseContext
  caseNumber: string
  issueId: string
  recordVersion: number | null
  protectedAccess: boolean
  protectedCheckpoint: string
}) {
  const publicMedia = [
    ...(context.avatarUrl ? [{ url: context.avatarUrl, label: 'Public avatar' }] : []),
    ...context.portfolioPhotoUrls.map((url, index) => ({ url, label: `Portfolio photo ${index + 1}` })),
    ...context.proofItems.flatMap((item) => item.mediaUrls.map((url, index) => ({ url, label: `${item.title} ${index + 1}` }))),
  ].slice(0, 9)

  return (
    <section className="ops-panel">
      <div className="ops-panel-head"><h2>Trust review evidence</h2><span className="ops-chip" data-tone={context.hasChallengeVideo ? 'healthy' : 'critical'}>{context.hasChallengeVideo ? 'Evidence ready' : 'Video missing'}</span></div>
      <div className="ops-panel-body ops-trust-stack">
        <dl className="ops-facts">
          <div className="ops-fact"><dt>Tailor</dt><dd>{context.displayName}</dd></div>
          <div className="ops-fact"><dt>Location</dt><dd>{context.location ?? 'Not provided'}</dd></div>
          <div className="ops-fact"><dt>Specialties</dt><dd>{context.specialties.length > 0 ? context.specialties.join(', ') : 'Not provided'}</dd></div>
          <div className="ops-fact"><dt>Submitted</dt><dd>{context.submittedAt ? formatRelativeTime(context.submittedAt) : 'Not recorded'}</dd></div>
          <div className="ops-fact"><dt>Trust gate</dt><dd>{formatEnum(context.reviewStatus)}</dd></div>
          <div className="ops-fact"><dt>Payout gate</dt><dd>{context.payoutAccountVerified ? `Verified · ${context.payoutProvider ?? 'provider'} ${context.payoutCurrency ?? ''}` : 'Independent payout verification incomplete'}</dd></div>
        </dl>
        <div className="ops-evidence-callout">
          <div><span className="ops-action-label">Randomized private challenge</span><h3>{context.challengeText ?? 'Challenge text was not recorded'}</h3><p>{context.challengeId ? `Challenge ${context.challengeId}` : 'No challenge identifier'} · Drapeon does not collect a government ID or create a biometric template.</p></div>
          {context.hasChallengeVideo ? (
            protectedAccess ? (
              <form action={`/ops/evidence/trust/${encodeURIComponent(context.profileId)}`} method="post" target="_blank">
                <input type="hidden" name="caseNumber" value={caseNumber} />
                <input type="hidden" name="accessReason" value="INITIAL_TRUST_REVIEW" />
                <button className="ops-button ops-button-primary" type="submit"><Video size={15} />Open audited video</button>
              </form>
            ) : <a className="ops-button" href={protectedCheckpoint}><ShieldCheck size={15} />Verify protected access</a>
          ) : <span className="ops-muted">A decision stays disabled until the submitted evidence is present.</span>}
        </div>
        <div>
          <div className="ops-subhead"><div><span className="ops-action-label">Public proof</span><h3>Profile and portfolio</h3></div><span className="ops-muted">{publicMedia.length} visible item{publicMedia.length === 1 ? '' : 's'}</span></div>
          {publicMedia.length > 0 ? (
            <div className="ops-media-grid">
              {publicMedia.map((media) => <a key={`${media.label}:${media.url}`} href={media.url} target="_blank" rel="noreferrer" className="ops-media-tile"><Image src={media.url} alt={media.label} width={480} height={320} unoptimized /><span>{media.label}<ExternalLink size={12} /></span></a>)}
            </div>
          ) : <div className="ops-empty ops-empty-compact"><ImageIcon size={18} /><h3>No public proof available</h3><p>Keep the case open and request a complete profile before deciding trust.</p></div>}
        </div>
        {context.reviewStatus.toUpperCase() === 'PENDING' ? (
          <TrustDecisionPanel
            issueId={issueId}
            profileId={context.profileId}
            tailorUserId={context.userId}
            recordVersion={recordVersion}
            evidenceReady={context.hasChallengeVideo}
            protectedAccess={protectedAccess}
            protectedCheckpoint={protectedCheckpoint}
          />
        ) : <div className="ops-status-banner" data-tone="healthy"><ShieldCheck size={16} />This trust review is {formatEnum(context.reviewStatus).toLowerCase()}. No additional decision is available.</div>}
      </div>
    </section>
  )
}
