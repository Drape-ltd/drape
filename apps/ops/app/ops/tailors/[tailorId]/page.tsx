import { ArrowLeft, ExternalLink, ShieldCheck, Store } from 'lucide-react'
import { formatMoney } from '@drape/shared/presentation'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHead } from '../../../../components/page-head'
import { OpsPhoneRestriction } from '../../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../../components/ops-permission-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../../lib/client-surface'
import { parseOpsUuidPathParam } from '../../../../lib/identifiers'
import { loadTailorDetailData } from '../../../../lib/remaining-domain-data'
import { hasOpsAreaAccess } from '../../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../../lib/work-items'

export const dynamic = 'force-dynamic'

function money(amount: number | null, currency: string | null) {
  return formatMoney(amount, currency, { pendingLabel: 'Not recorded' })
}

export default async function TailorPage({ params }: { params: Promise<{ tailorId: string }> }) {
  if (!(await hasOpsAreaAccess('tailors'))) return <OpsPermissionRestriction area="Tailor Network" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="full tailor records" />
  const tailorId = parseOpsUuidPathParam((await params).tailorId)
  if (!tailorId) notFound()
  const data = await loadTailorDetailData(tailorId)
  if (!data) notFound()
  return <>
    <Link href="/ops/tailors" className="ops-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><ArrowLeft size={14} />Back to tailors</Link>
    <PageHead eyebrow="Marketplace / Tailor record" title={data.tailor.name} description="Trust, marketplace, capacity, and payout readiness remain separate operational facts." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
    <div className="ops-status-banner" data-tone="healthy" role="status"><ShieldCheck size={16} />Trust approval controls marketplace visibility; provider capability independently controls paid work and payout release.</div>
    <section className="ops-panel ops-section-block"><div className="ops-panel-head"><h2>Readiness contract</h2><Store size={17} /></div><div className="ops-panel-body"><dl className="ops-facts">
      <div className="ops-fact"><dt>Profile ID</dt><dd>{data.tailor.id}</dd></div>
      <div className="ops-fact"><dt>Account email</dt><dd>{data.tailor.email ?? 'Not available'}</dd></div>
      <div className="ops-fact"><dt>Location</dt><dd>{data.tailor.location ?? 'Not recorded'}{data.tailor.region ? ` · ${data.tailor.region}` : ''}</dd></div>
      <div className="ops-fact"><dt>Trust</dt><dd>{formatEnum(data.tailor.trustStatus)}</dd></div>
      <div className="ops-fact"><dt>Marketplace</dt><dd>{data.tailor.live ? 'Live' : 'Not public'} · {data.tailor.profileComplete ? 'Profile complete' : 'Profile incomplete'}</dd></div>
      <div className="ops-fact"><dt>Payout</dt><dd>{data.tailor.payoutReady ? 'Ready' : 'Blocked'}{data.tailor.payoutProvider ? ` · ${formatEnum(data.tailor.payoutProvider)}` : ''}</dd></div>
      <div className="ops-fact"><dt>Availability</dt><dd>{data.tailor.shopPaused ? 'Shop paused' : formatEnum(data.tailor.availability ?? 'Not set')}</dd></div>
      <div className="ops-fact"><dt>Typical price</dt><dd>{data.tailor.priceMin === null ? 'Not recorded' : `${money(data.tailor.priceMin, data.tailor.currency)}–${money(data.tailor.priceMax, data.tailor.currency)}`}</dd></div>
      <div className="ops-fact"><dt>Specialties</dt><dd>{data.tailor.specialties.length ? data.tailor.specialties.join(', ') : 'Not recorded'}</dd></div>
      <div className="ops-fact"><dt>Languages</dt><dd>{data.tailor.languages.length ? data.tailor.languages.join(', ') : 'Not recorded'}</dd></div>
    </dl></div></section>
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Current work</p><h2>Cases</h2></div><Link className="ops-button" href="/ops/queues/trust">Open trust queue</Link></div>{data.cases.length ? <div className="ops-linked-list">{data.cases.map((record) => <Link href={`/ops/cases/${record.caseNumber}`} key={record.id}><ExternalLink size={14} /><span><strong>{record.caseNumber} · {record.title}</strong><small>{formatEnum(record.status)} · {formatEnum(record.severity)} · {formatRelativeTime(record.updatedAt)}</small></span></Link>)}</div> : <div className="ops-empty ops-empty-compact"><h3>No tailor cases</h3><p>No operational exception is linked to this tailor.</p></div>}</section>
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Public inventory</p><h2>Shop items</h2></div><span className="ops-muted">{data.items.filter((item) => item.live).length} live · {data.items.length} in view</span></div>{data.items.length ? <div className="ops-domain-list">{data.items.map((item) => <article className="ops-domain-row ops-domain-row-compact" key={item.id}><span className="ops-provider-icon" data-tone={item.live ? 'healthy' : 'neutral'}><Store size={16} /></span><div><strong>{item.title}</strong><small>{item.category ? formatEnum(item.category) : 'Uncategorized'} · updated {formatRelativeTime(item.updatedAt)}</small></div><div><span className="ops-label">Visibility</span><strong>{item.live ? 'Public' : 'Not public'}</strong><small>Safety tombstones remain authoritative</small></div><div><span className="ops-label">Stock</span><strong>{formatEnum(item.stockStatus ?? 'Not set')}</strong><small>Item {item.id}</small></div></article>)}</div> : <div className="ops-empty ops-empty-compact"><h3>No shop items</h3><p>This tailor has not created seller inventory.</p></div>}</section>
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Service history</p><h2>Recent orders</h2></div><span className="ops-muted">{data.orders.length} in view</span></div>{data.orders.length ? <div className="ops-domain-list">{data.orders.map((order) => <article className="ops-domain-row ops-domain-row-compact" key={order.id}><span className="ops-provider-icon" data-tone="neutral">{order.reference.slice(0, 1)}</span><div><Link className="ops-case-link" href={`/ops/orders/${order.id}`}><strong>{order.reference} · {order.item}</strong><small>{formatEnum(order.kind ?? 'ORDER')} · {formatRelativeTime(order.stageUpdatedAt)}</small></Link></div><div><span className="ops-label">Stage</span><strong>{formatEnum(order.stage)}</strong><small>{formatEnum(order.deliveryMethod ?? 'Not set')}</small></div><div><span className="ops-label">Value</span><strong>{money(order.amount, order.currency)}</strong><small>Created {new Date(order.createdAt).toLocaleDateString()}</small></div></article>)}</div> : <div className="ops-empty ops-empty-compact"><h3>No orders</h3><p>This tailor has no order records.</p></div>}</section>
  </>
}
