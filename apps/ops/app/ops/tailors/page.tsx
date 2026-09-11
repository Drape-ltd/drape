import { CheckCircle2, ShieldAlert, Store } from 'lucide-react'
import Link from 'next/link'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadTailorNetworkData } from '../../../lib/remaining-domain-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

const tailorViews = new Set(['live', 'trust-review', 'payout-blocked', 'applications'])

export default async function TailorsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await hasOpsAreaAccess('tailors'))) return <OpsPermissionRestriction area="Tailor Network" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Tailor Network" />
  const [data, query] = await Promise.all([loadTailorNetworkData(), searchParams])
  const selectedView = tailorViews.has(String(query.view)) ? String(query.view) : null
  const pendingTrust = data.profiles.filter((profile) => ['PENDING', 'REVIEWING'].includes(profile.trust)).length
  const live = data.profiles.filter((profile) => profile.live).length
  const payoutBlocked = data.profiles.filter((profile) => !profile.payoutReady).length
  const openApplications = data.applications.filter((application) => !['APPROVED', 'REJECTED'].includes(application.status)).length
  const profiles = selectedView === 'live'
    ? data.profiles.filter((profile) => profile.live)
    : selectedView === 'trust-review'
      ? data.profiles.filter((profile) => ['PENDING', 'REVIEWING'].includes(profile.trust))
      : selectedView === 'payout-blocked'
        ? data.profiles.filter((profile) => !profile.payoutReady)
        : data.profiles
  const applications = data.applications.filter((application) => !['APPROVED', 'REJECTED'].includes(application.status))
  return <><PageHead eyebrow="Marketplace / Tailors" title="Tailor network" description="Trust, profile readiness, marketplace visibility, shop health, and payout capability stay distinct so one green badge never hides another gate." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
    <section className="ops-summary-grid"><Link className="ops-summary-cell ops-summary-link" href="/ops/tailors?view=live#tailor-roster"><div className="ops-summary-label">Marketplace live</div><div className="ops-summary-value">{live}</div><div className="ops-summary-detail">Approved and intentionally visible</div></Link><Link className="ops-summary-cell ops-summary-link" href="/ops/tailors?view=trust-review#tailor-roster"><div className="ops-summary-label">Trust review</div><div className="ops-summary-value">{pendingTrust}</div><div className="ops-summary-detail">Private challenge evidence queue</div></Link><Link className="ops-summary-cell ops-summary-link" href="/ops/tailors?view=payout-blocked#tailor-roster"><div className="ops-summary-label">Payout blocked</div><div className="ops-summary-value">{payoutBlocked}</div><div className="ops-summary-detail">Provider capability is separate from trust</div></Link><Link className="ops-summary-cell ops-summary-link" href="/ops/tailors?view=applications#application-roster"><div className="ops-summary-label">Applications</div><div className="ops-summary-value">{openApplications}</div><div className="ops-summary-detail">Open acquisition intake</div></Link></section>
    {selectedView === 'applications' ? <section className="ops-section-block" id="application-roster"><div className="ops-section-head"><div><p className="ops-action-label">Acquisition intake</p><h2>Open tailor applications</h2></div><Link className="ops-button" href="/ops/tailors#tailor-roster">Clear filter</Link></div>{applications.length ? <div className="ops-domain-list">{applications.map((application) => <article className="ops-domain-row ops-domain-row-compact" key={application.id}><span className="ops-provider-icon" data-tone="warning"><Store size={16} /></span><div><strong>{application.name}</strong><small>Submitted {formatRelativeTime(application.createdAt)}</small></div><div><span className="ops-label">State</span><strong>{formatEnum(application.status)}</strong><small>{application.source ? formatEnum(application.source) : 'Source not recorded'}</small></div></article>)}</div> : <div className="ops-empty"><Store size={20} /><h2>No open application</h2><p>No eligible application exists in the current authoritative window.</p></div>}</section> : <section className="ops-section-block" id="tailor-roster"><div className="ops-section-head"><div><p className="ops-action-label">Operational roster</p><h2>{selectedView ? `${formatEnum(selectedView)} tailors` : 'Tailor readiness'}</h2></div><div className="ops-section-actions">{selectedView ? <Link className="ops-button" href="/ops/tailors#tailor-roster">Clear filter</Link> : null}<Link className="ops-button" href="/ops/queues/trust">Open trust queue</Link></div></div>{profiles.length ? <div className="ops-domain-list">{profiles.map((profile) => <article className="ops-domain-row" key={profile.id}><span className="ops-provider-icon" data-tone={profile.live ? 'healthy' : profile.trust === 'REJECTED' ? 'critical' : 'warning'}>{profile.live ? <CheckCircle2 size={16} /> : <Store size={16} />}</span><div><Link className="ops-case-link" href={`/ops/tailors/${profile.id}`}><strong>{profile.name}</strong><small>{profile.location ?? 'Location not recorded'} · updated {formatRelativeTime(profile.updatedAt)}</small></Link></div><div><span className="ops-label">Trust</span><strong>{formatEnum(profile.trust)}</strong><small>{profile.profileComplete ? 'Profile complete' : 'Profile incomplete'}</small></div><div><span className="ops-label">Commerce</span><strong>{profile.payoutReady ? 'Payout ready' : 'Payout blocked'}</strong><small>{profile.liveItemCount} of {profile.itemCount} items live</small></div><div><span className="ops-label">Service</span><strong>{profile.shopPaused ? 'Shop paused' : formatEnum(profile.availability ?? 'Not set')}</strong><small>{profile.totalOrders} orders{profile.rating == null ? '' : ` · ${profile.rating.toFixed(1)} rating`}</small></div></article>)}</div> : <div className="ops-empty"><Store size={20} /><h2>No eligible tailor profile</h2><p>No example profile has been inserted. Approved onboarding submissions will appear here.</p></div>}</section>}
    {payoutBlocked > 0 ? <div className="ops-status-banner" data-tone="warning"><ShieldAlert size={16} />{payoutBlocked} tailor profile{payoutBlocked === 1 ? '' : 's'} cannot receive paid work until the payout provider capability is ready.</div> : null}
  </>
}
