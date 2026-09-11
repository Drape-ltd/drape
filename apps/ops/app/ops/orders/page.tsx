import { OrderCommandList } from '../../../components/order-command-list'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { PageHead } from '../../../components/page-head'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { loadOrdersData } from '../../../lib/order-data'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { formatRelativeTime } from '../../../lib/work-items'

export const dynamic = 'force-dynamic'

const orderViews = new Set(['active', 'attention', 'handoff', 'closed'])

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!(await hasOpsAreaAccess('orders'))) return <OpsPermissionRestriction area="Orders & Production" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Orders & Production" />
  const [data, query] = await Promise.all([loadOrdersData(), searchParams])
  const selectedView = orderViews.has(String(query.view)) ? String(query.view) : null
  return <><PageHead eyebrow="Marketplace / Orders" title="Orders & production" description="One operational record for the brief, consultation, money, production, fulfilment, handoff, and recovery lifecycle." meta={`Observed ${formatRelativeTime(data.observedAt)}`} /><OrderCommandList orders={data.orders} selectedView={selectedView} /></>
}
