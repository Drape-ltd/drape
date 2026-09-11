import { ArrowLeft, CircleUserRound, ExternalLink, ShieldCheck } from 'lucide-react'
import { formatMoney } from '@drape/shared/presentation'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHead } from '../../../../components/page-head'
import { OpsPhoneRestriction } from '../../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../../components/ops-permission-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../../lib/client-surface'
import { parseOpsUuidPathParam } from '../../../../lib/identifiers'
import { loadCustomerDetailData } from '../../../../lib/remaining-domain-data'
import { hasOpsAreaAccess } from '../../../../lib/route-access'
import { formatEnum, formatRelativeTime } from '../../../../lib/work-items'

export const dynamic = 'force-dynamic'

function money(amount: number | null, currency: string | null) {
  return formatMoney(amount, currency, { pendingLabel: 'Amount not recorded' })
}

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  if (!(await hasOpsAreaAccess('customers'))) return <OpsPermissionRestriction area="Customer operations" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="full customer records" />
  const customerId = parseOpsUuidPathParam((await params).customerId)
  if (!customerId) notFound()
  const data = await loadCustomerDetailData(customerId)
  if (!data) notFound()
  const openCases = data.cases.filter((record) => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(record.status))
  return <>
    <Link href="/ops/customers" className="ops-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><ArrowLeft size={14} />Back to customers</Link>
    <PageHead eyebrow="Marketplace / Customer record" title={data.customer.name} description="Purpose-limited account context. Private messages, addresses, phone numbers, and body measurements are not loaded." meta={`Observed ${formatRelativeTime(data.observedAt)}`} />
    <div className="ops-status-banner" data-tone="healthy" role="status"><ShieldCheck size={16} />This route exposes operational state only. Measurement presence is shown without measurement values.</div>
    <section className="ops-panel ops-section-block"><div className="ops-panel-head"><h2>Account facts</h2><CircleUserRound size={17} /></div><div className="ops-panel-body"><dl className="ops-facts">
      <div className="ops-fact"><dt>Account ID</dt><dd>{data.customer.id}</dd></div>
      <div className="ops-fact"><dt>Email</dt><dd>{data.customer.email ?? 'Not available'}</dd></div>
      <div className="ops-fact"><dt>Role</dt><dd>{formatEnum(data.customer.role)}</dd></div>
      <div className="ops-fact"><dt>Region</dt><dd>{data.customer.region ?? 'Not recorded'}</dd></div>
      <div className="ops-fact"><dt>Currency</dt><dd>{data.customer.currency ?? 'Not recorded'}</dd></div>
      <div className="ops-fact"><dt>Phone assurance</dt><dd>{data.customer.phoneVerified ? 'Verified' : 'Not verified'}</dd></div>
      <div className="ops-fact"><dt>Measurement profile</dt><dd>{data.customer.measurementProfilePresent ? `Present · ${data.customer.measurementUnit ?? 'unit not recorded'}` : 'Not created'}</dd></div>
      <div className="ops-fact"><dt>Account updated</dt><dd>{new Date(data.customer.updatedAt).toLocaleString()}</dd></div>
    </dl></div></section>
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Current work</p><h2>Cases</h2></div><span className="ops-muted">{openCases.length} open · {data.cases.length} in view</span></div>{data.cases.length ? <div className="ops-linked-list">{data.cases.map((record) => <Link href={`/ops/cases/${record.caseNumber}`} key={record.id}><ExternalLink size={14} /><span><strong>{record.caseNumber} · {record.title}</strong><small>{formatEnum(record.status)} · {formatEnum(record.severity)} · {formatRelativeTime(record.updatedAt)}</small></span></Link>)}</div> : <div className="ops-empty ops-empty-compact"><h3>No customer cases</h3><p>No operational exception is linked to this account.</p></div>}</section>
    <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Order context</p><h2>Recent orders</h2></div><span className="ops-muted">Latest {data.orders.length}</span></div>{data.orders.length ? <div className="ops-domain-list">{data.orders.map((order) => <article className="ops-domain-row ops-domain-row-compact" key={order.id}><span className="ops-provider-icon" data-tone="neutral">{order.reference.slice(0, 1)}</span><div><Link className="ops-case-link" href={`/ops/orders/${order.id}`}><strong>{order.reference} · {order.item}</strong><small>{formatEnum(order.kind ?? 'ORDER')} · {formatRelativeTime(order.stageUpdatedAt)}</small></Link></div><div><span className="ops-label">Stage</span><strong>{formatEnum(order.stage)}</strong><small>{formatEnum(order.deliveryMethod ?? 'Not set')}</small></div><div><span className="ops-label">Value</span><strong>{money(order.amount, order.currency)}</strong><small>Created {new Date(order.createdAt).toLocaleDateString()}</small></div></article>)}</div> : <div className="ops-empty ops-empty-compact"><h3>No orders</h3><p>This account has no order records.</p></div>}</section>
    {data.deletions.length ? <section className="ops-section-block"><div className="ops-section-head"><div><p className="ops-action-label">Privacy ledger</p><h2>Deletion requests</h2></div><Link className="ops-button" href="/ops/queues/privacy">Open privacy queue</Link></div><div className="ops-domain-list">{data.deletions.map((request) => <article className="ops-domain-row ops-domain-row-compact" key={request.id}><span className="ops-provider-icon" data-tone={['COMPLETED', 'CANCELLED'].includes(request.status) ? 'healthy' : 'warning'}><ShieldCheck size={16} /></span><div><strong>{request.id}</strong><small>{request.reason ?? 'No reason supplied'}</small></div><div><span className="ops-label">Status</span><strong>{formatEnum(request.status)}</strong><small>Requested {formatRelativeTime(request.requestedAt)}</small></div><div><span className="ops-label">Terminal state</span><strong>{request.completedAt ? new Date(request.completedAt).toLocaleString() : 'Not complete'}</strong><small>{request.processedAt ? `Processed ${formatRelativeTime(request.processedAt)}` : 'Awaiting processing'}</small></div></article>)}</div></section> : null}
  </>
}
