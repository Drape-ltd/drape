import { ArrowLeft, Banknote, CircleUserRound, Clock3, PackageCheck, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import type { OrderDetail } from '../lib/order-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'

function money(amount: number | null, currency: string | null) {
  if (amount == null || !currency) return 'Not recorded'
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount / 100) } catch { return `${currency} ${(amount / 100).toFixed(2)}` }
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded'
}

export function OrderCommandDetail({ data }: { data: OrderDetail }) {
  const { order } = data
  return (
    <>
      <Link className="ops-back-link" href="/ops/orders"><ArrowLeft size={14} />Orders & production</Link>
      <header className="ops-order-detail-head"><div><p className="ops-case-number">{order.reference}</p><h1>{order.item}</h1><p>{formatEnum(order.kind)} · created {formatRelativeTime(order.createdAt)}</p></div><div className="ops-order-detail-status"><span className="ops-chip">{formatEnum(order.stage)}</span><small>Updated {formatRelativeTime(order.stageUpdatedAt)}</small></div></header>
      <section className="ops-order-command-band"><div><p className="ops-action-label">Who acts next</p><strong>{order.nextOwner}</strong></div><div><p className="ops-action-label">Required outcome</p><strong>{order.nextAction}</strong></div><div><p className="ops-action-label">Open controls</p><strong>{order.openCaseCount} case{order.openCaseCount === 1 ? '' : 's'} · {order.moneyStatus ? formatEnum(order.moneyStatus) : 'No money request'}</strong></div></section>
      <div className="ops-order-detail-grid">
        <main className="ops-order-detail-main">
          <section className="ops-panel"><div className="ops-panel-head"><h2>Order timeline</h2><span className="ops-muted">{data.timeline.length} events</span></div><div className="ops-panel-body">{data.timeline.length ? <ol className="ops-timeline">{data.timeline.map((entry) => <li key={`${entry.source}:${entry.id}`}><strong>{formatEnum(entry.title)}</strong><span>{entry.actor} · {date(entry.occurredAt)}{entry.summary ? ` · ${entry.summary}` : ''}</span></li>)}</ol> : <div className="ops-empty"><Clock3 size={18} /><h2>No timeline evidence</h2><p>No append-only lifecycle event has been recorded for this order.</p></div>}</div></section>
          <section className="ops-panel"><div className="ops-panel-head"><h2>Payments and settlement</h2><a className="ops-button" href={`/ops/money?orderId=${order.id}`}>Open Money Desk</a></div><div className="ops-panel-body ops-financial-stack">
            {data.payments.length ? data.payments.map((payment) => <div className="ops-financial-row" key={payment.id}><Banknote size={16} /><div><strong>{formatEnum(payment.phase)}</strong><span>{payment.provider ? formatEnum(payment.provider) : 'Provider not recorded'} · {date(payment.confirmedAt ?? payment.createdAt)}</span></div><div><strong>{money(payment.amount, payment.currency)}</strong><span className="ops-chip">{formatEnum(payment.status)}</span>{payment.refundedAmount > 0 ? <small>{money(payment.refundedAmount, payment.currency)} refunded</small> : null}</div></div>) : <p className="ops-muted">No payment record has been created.</p>}
            {data.tranches.map((tranche) => <div className="ops-financial-row" key={tranche.id}><ShieldAlert size={16} /><div><strong>{formatEnum(tranche.code)}</strong><span>{tranche.blockedReason ?? `Eligible ${date(tranche.eligibleAt)}`}</span></div><div><strong>{money(tranche.amount, tranche.currency)}</strong><span className="ops-chip">{formatEnum(tranche.status)}</span></div></div>)}
          </div></section>
        </main>
        <aside className="ops-order-detail-aside">
          <section className="ops-panel"><div className="ops-panel-head"><h2>Order context</h2></div><div className="ops-panel-body"><dl className="ops-runtime"><div className="ops-runtime-row"><dt>Customer</dt><dd>{order.customerName ?? order.customerId}</dd></div><div className="ops-runtime-row"><dt>Tailor</dt><dd>{order.tailorName ?? order.tailorId ?? 'Not assigned'}</dd></div><div className="ops-runtime-row"><dt>Fulfilment</dt><dd>{formatEnum(order.deliveryMethod ?? 'Not set')}</dd></div><div className="ops-runtime-row"><dt>Deadline</dt><dd>{date(order.deadline)}</dd></div><div className="ops-runtime-row"><dt>Fabric</dt><dd>{formatEnum(order.fabricSource ?? 'Not set')}</dd></div><div className="ops-runtime-row"><dt>Escrow released</dt><dd>{order.escrowReleased ? date(order.escrowReleasedAt) : 'No'}</dd></div><div className="ops-runtime-row"><dt>Handoff</dt><dd>{date(order.handoffCompletedAt)}</dd></div></dl></div></section>
          <section className="ops-panel"><div className="ops-panel-head"><h2>Linked cases</h2></div><div className="ops-panel-body ops-linked-list">{data.cases.length ? data.cases.map((entry) => <a href={`/ops/cases/${entry.caseNumber}`} key={entry.id}><ShieldAlert size={15} /><span><strong>{entry.caseNumber} · {formatEnum(entry.type)}</strong><small>{formatEnum(entry.status)} · {entry.recommendedAction}</small></span></a>) : <p className="ops-muted">No case is linked to this order.</p>}</div></section>
          <section className="ops-panel"><div className="ops-panel-head"><h2>Actors & custody</h2></div><div className="ops-panel-body ops-icon-facts"><div><CircleUserRound size={16} /><span>Customer confirmation<strong>{date(order.customerHandoffConfirmedAt)}</strong></span></div><div><PackageCheck size={16} /><span>Carrier reference<strong>{order.carrier && order.trackingNumber ? `${order.carrier} · ${order.trackingNumber}` : 'Not recorded'}</strong></span></div></div></section>
        </aside>
      </div>
    </>
  )
}
