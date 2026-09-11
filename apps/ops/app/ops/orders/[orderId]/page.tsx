import { notFound } from 'next/navigation'
import { OrderCommandDetail } from '../../../../components/order-command-detail'
import { loadOrderDetail } from '../../../../lib/order-data'
import { OpsPhoneRestriction } from '../../../../components/ops-phone-restriction'
import { OpsPermissionRestriction } from '../../../../components/ops-permission-restriction'
import { isRestrictedOpsPhoneRequest } from '../../../../lib/client-surface'
import { hasOpsAreaAccess } from '../../../../lib/route-access'

export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  if (!(await hasOpsAreaAccess('orders'))) return <OpsPermissionRestriction area="Orders & Production" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="full order detail" />
  const { orderId } = await params
  const data = await loadOrderDetail(orderId)
  if (!data) notFound()
  return <OrderCommandDetail data={data} />
}
