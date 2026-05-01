import { isTerminal, type OrderStage } from '@drape/shared/order-machine'
import { queryClient } from './queryClient'
import { qk } from './queries'

type TerminalOrderStateCleanupParams = {
  orderId: string
  customerId?: string | null
  sellerItemId?: string | null
}

export function isTerminalOrderStage(stage: string | null | undefined): stage is OrderStage {
  return typeof stage === 'string' && isTerminal(stage as OrderStage)
}

export async function purgeTerminalOrderClientState(params: TerminalOrderStateCleanupParams) {
  const work: Array<Promise<unknown> | void> = [
    queryClient.removeQueries({ queryKey: qk.customerOrder(params.orderId), exact: true }),
    queryClient.removeQueries({ queryKey: qk.tailorOrder(params.orderId), exact: true }),
    queryClient.invalidateQueries({ queryKey: ['customer-orders'] }),
    queryClient.invalidateQueries({ queryKey: ['tailor-orders'] }),
    queryClient.invalidateQueries({ queryKey: ['customer-profile-overview'] }),
    queryClient.invalidateQueries({ queryKey: ['tailor-dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['seller-item'] }),
    queryClient.invalidateQueries({ queryKey: ['tailor-shop'] }),
    queryClient.invalidateQueries({ queryKey: ['tailor-public'] }),
    queryClient.invalidateQueries({ queryKey: ['notif-count'] }),
  ]

  if (params.customerId) {
    work.push(
      queryClient.removeQueries({
        queryKey: qk.customerMessageOrder(params.orderId, params.customerId),
        exact: true,
      }),
    )
  }

  if (params.sellerItemId) {
    work.push(queryClient.invalidateQueries({ queryKey: qk.sellerItem(params.sellerItemId) }))
  }

  await Promise.all(work.map((task) => Promise.resolve(task)))
}
