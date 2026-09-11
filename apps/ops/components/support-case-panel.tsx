import { ExternalLink, Mail } from 'lucide-react'
import type { SupportCaseContext } from '../lib/domain-data'
import { formatEnum } from '../lib/work-items'

export function SupportCasePanel({ context }: { context: SupportCaseContext }) {
  return (
    <section className="ops-panel">
      <div className="ops-panel-head"><h2>Support context</h2><span className="ops-chip">Purpose limited</span></div>
      <div className="ops-panel-body">
        <dl className="ops-facts">
          <div className="ops-fact"><dt>Requester</dt><dd>{context.requesterName ?? 'Account owner'}</dd></div>
          <div className="ops-fact"><dt>Contact</dt><dd>{context.requesterEmail ?? 'Not available'}</dd></div>
          {context.order ? <>
            <div className="ops-fact"><dt>Order</dt><dd>{context.order.reference ? `#${context.order.reference}` : context.order.id}</dd></div>
            <div className="ops-fact"><dt>Stage</dt><dd>{formatEnum(context.order.stage ?? 'UNKNOWN')}</dd></div>
            <div className="ops-fact"><dt>Customer</dt><dd>{context.order.customerName ?? 'Not available'}</dd></div>
            <div className="ops-fact"><dt>Tailor</dt><dd>{context.order.tailorName ?? 'Not available'}</dd></div>
            <div className="ops-fact"><dt>Fulfilment</dt><dd>{formatEnum(context.order.deliveryMethod ?? 'NOT_SET')}</dd></div>
            <div className="ops-fact"><dt>Payment provider</dt><dd>{context.order.paymentProvider ?? 'Not applicable'}</dd></div>
          </> : null}
        </dl>
        <div className="ops-inline-actions">
          {context.requesterEmail ? <a className="ops-button" href={`mailto:${context.requesterEmail}?subject=${encodeURIComponent('Your Drapeon support request')}`}><Mail size={15} />Email requester</a> : null}
          {context.order ? <a className="ops-button" href={`/ops/orders/${encodeURIComponent(context.order.id)}`}>Open order record <ExternalLink size={14} /></a> : null}
        </div>
      </div>
    </section>
  )
}
