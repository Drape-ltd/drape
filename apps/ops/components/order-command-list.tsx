import { AlertTriangle, ArrowRight, CircleDollarSign, PackageCheck } from 'lucide-react'
import Link from 'next/link'
import type { OrderSummary } from '../lib/order-data'
import { formatEnum, formatRelativeTime } from '../lib/work-items'

function tone(value: string | null) {
  const normalized = value?.toUpperCase() ?? ''
  if (['FAILED', 'BLOCKED', 'IN_DISPUTE', 'PAYMENT_FAILED'].includes(normalized)) return 'critical'
  if (['PENDING', 'PENDING_APPROVAL', 'RELEASE_REQUESTED', 'READY_FOR_DRAPE_DISPATCH'].includes(normalized)) return 'warning'
  if (['SUCCEEDED', 'PAID', 'COMPLETE', 'DELIVERED', 'COLLECTED', 'SETTLED'].includes(normalized)) return 'healthy'
  return 'neutral'
}

function money(amount: number | null, currency: string | null) {
  if (amount == null || !currency) return 'Not priced'
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount / 100) } catch { return `${currency} ${(amount / 100).toFixed(2)}` }
}

export function OrderCommandList({ orders, selectedView }: { orders: OrderSummary[]; selectedView: string | null }) {
  const active = orders.filter((order) => !['COMPLETE', 'CANCELLED', 'DECLINED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED'].includes(order.stage))
  const attention = active.filter((order) => order.stage === 'IN_DISPUTE' || order.openCaseCount > 0 || tone(order.paymentStatus) === 'critical' || tone(order.settlementStatus) === 'critical')
  const handoff = active.filter((order) => ['READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'READY_FOR_COLLECTION'].includes(order.stage))
  const closed = orders.filter((order) => !active.includes(order))
  const visibleOrders = selectedView === 'active' ? active : selectedView === 'attention' ? attention : selectedView === 'handoff' ? handoff : selectedView === 'closed' ? closed : orders
  return (
    <>
      <section className="ops-summary-grid" aria-label="Order operations summary">
        <Link className="ops-summary-cell ops-summary-link" href="/ops/orders?view=active#order-ledger"><div className="ops-summary-label">Active orders</div><div className="ops-summary-value">{active.length}</div><div className="ops-summary-detail">Authoritative lifecycle records</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/orders?view=attention#order-ledger"><div className="ops-summary-label">Needs attention</div><div className="ops-summary-value">{attention.length}</div><div className="ops-summary-detail">Cases or financial blockers</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/orders?view=handoff#order-ledger"><div className="ops-summary-label">At handoff</div><div className="ops-summary-value">{handoff.length}</div><div className="ops-summary-detail">Dispatch, shipping, or collection</div></Link>
        <Link className="ops-summary-cell ops-summary-link" href="/ops/orders?view=closed#order-ledger"><div className="ops-summary-label">Closed in view</div><div className="ops-summary-value">{closed.length}</div><div className="ops-summary-detail">Recent terminal records</div></Link>
      </section>
      <section className="ops-section-block" id="order-ledger">
        <div className="ops-section-head"><div><p className="ops-action-label">Lifecycle command</p><h2>{selectedView ? `${formatEnum(selectedView)} orders` : 'Orders & production'}</h2></div><div className="ops-section-actions">{selectedView ? <Link className="ops-button" href="/ops/orders#order-ledger">Clear filter</Link> : null}<span className="ops-muted">{visibleOrders.length} source record{visibleOrders.length === 1 ? '' : 's'}</span></div></div>
        {visibleOrders.length === 0 ? <div className="ops-empty"><PackageCheck size={20} /><h2>{selectedView ? `No ${formatEnum(selectedView).toLowerCase()} order` : 'No eligible order data yet'}</h2><p>This is a production-safe empty state. No example orders or inferred work have been inserted.</p></div> : <div className="ops-order-list">{visibleOrders.map((order) => (
          <a className="ops-order-row" href={`/ops/orders/${order.id}`} key={order.id}>
            <div className="ops-order-main"><span className="ops-case-number">{order.reference}</span><strong>{order.item}</strong><small>{formatEnum(order.kind)} · {money(order.amount, order.currency)}</small></div>
            <div><span className="ops-label">Stage</span><span className="ops-chip" data-tone={tone(order.stage)}>{formatEnum(order.stage)}</span><small>{formatRelativeTime(order.stageUpdatedAt)}</small></div>
            <div><span className="ops-label">Next owner</span><strong>{order.nextOwner}</strong><small>{order.nextAction}</small></div>
            <div><span className="ops-label">Control state</span><div className="ops-order-signals">{order.openCaseCount > 0 ? <span title={`${order.openCaseCount} open cases`}><AlertTriangle size={14} />{order.openCaseCount}</span> : null}{order.paymentStatus ? <span title={`Payment ${formatEnum(order.paymentStatus)}`}><CircleDollarSign size={14} />{formatEnum(order.paymentStatus)}</span> : null}{order.fulfillmentStatus ? <span title={`Fulfilment ${formatEnum(order.fulfillmentStatus)}`}><PackageCheck size={14} />{formatEnum(order.fulfillmentStatus)}</span> : null}</div></div>
            <ArrowRight className="ops-order-open" size={16} aria-hidden="true" />
          </a>
        ))}</div>}
      </section>
    </>
  )
}
