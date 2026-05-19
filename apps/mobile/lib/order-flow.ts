import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'

export type MobileOrderKind = 'CUSTOM' | 'READY_MADE'

export const READY_MADE_PREPARATION_STAGES: OrderStage[] = [
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
]

export const CUSTOMER_ACTIVE_ORDER_STAGES: OrderStage[] = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
]

export const CUSTOMER_COMPLETED_ORDER_STAGES: OrderStage[] = [
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'REFUNDED',
  'CANCELLED',
]

export const TAILOR_ACTIVE_ORDER_STAGES: OrderStage[] = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'IN_DISPUTE',
]

export const TAILOR_COMPLETED_ORDER_STAGES: OrderStage[] = [
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'REFUNDED',
  'CANCELLED',
]

export function isReadyMadePreparationStage(stage: OrderStage) {
  return READY_MADE_PREPARATION_STAGES.includes(stage)
}

export function isReadyMadeInquiryOrder(input: {
  orderKind: MobileOrderKind
  stage: string | null | undefined
  sellerItemId?: string | null | undefined
}) {
  return input.stage === 'PENDING_QUOTE' && (
    input.orderKind === 'READY_MADE' ||
    (typeof input.sellerItemId === 'string' && input.sellerItemId.trim().length > 0)
  )
}

export function customerOrderStageLabel(stage: OrderStage, orderKind: MobileOrderKind) {
  if (orderKind === 'READY_MADE') {
    if (stage === 'PENDING_QUOTE') return 'Inquiry open'
    if (stage === 'PAYMENT_PENDING') return 'Checkout open'
    if (stage === 'PAYMENT_FAILED') return 'Checkout failed'
    if (stage === 'CONFIRMED') return 'Order placed'
    if (isReadyMadePreparationStage(stage)) return 'Preparing order'
    if (stage === 'READY_FOR_DRAPE_DISPATCH') return 'Awaiting Drape dispatch'
    if (stage === 'OUT_FOR_DELIVERY') return 'Out for delivery'
    if (stage === 'SHIPPED') return 'Shipped'
  }

  return STAGE_LABELS[stage] ?? stage
}

export function tailorOrderStageLabel(stage: OrderStage, orderKind: MobileOrderKind) {
  if (orderKind === 'READY_MADE') {
    if (stage === 'PENDING_QUOTE') return 'Inquiry open'
    if (stage === 'PAYMENT_PENDING') return 'Checkout open'
    if (stage === 'PAYMENT_FAILED') return 'Checkout failed'
    if (stage === 'CONFIRMED') return 'Paid order'
    if (isReadyMadePreparationStage(stage)) return 'Preparing order'
    if (stage === 'READY_FOR_DRAPE_DISPATCH') return 'Ready for Drape dispatch'
    if (stage === 'OUT_FOR_DELIVERY') return 'Out for delivery'
    if (stage === 'SHIPPED') return 'Shipped'
  }

  return STAGE_LABELS[stage] ?? stage
}

export function customerOrderHint(stage: OrderStage, orderKind: MobileOrderKind): string | null {
  switch (stage) {
    case 'PENDING_QUOTE':
      return orderKind === 'READY_MADE' ? 'Inquiry open' : 'Waiting for quote'
    case 'CONSULTATION':
      return 'Consultation in progress'
    case 'QUOTE_SENT':
      return 'Waiting for you'
    case 'PAYMENT_PENDING':
      return orderKind === 'READY_MADE' ? 'Complete checkout' : 'Complete payment'
    case 'PAYMENT_FAILED':
      return orderKind === 'READY_MADE' ? 'Retry checkout' : 'Retry payment'
    case 'CONFIRMED':
      return orderKind === 'READY_MADE' ? 'Order placed' : 'Confirmed'
    case 'DESIGNING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Designing'
    case 'SOURCING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Sourcing materials'
    case 'CUTTING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Cutting'
    case 'SEWING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Sewing'
    case 'FINISHING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Finishing'
    case 'READY_FOR_DRAPE_DISPATCH':
      return 'Awaiting Drape dispatch'
    case 'READY_FOR_COLLECTION':
      return 'Ready for collection'
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery'
    case 'SHIPPED':
      return 'In transit'
    case 'DELIVERED':
    case 'COLLECTED':
      return 'Review window open'
    case 'IN_DISPUTE':
      return 'Concern under review'
    default:
      return null
  }
}

export function tailorOrderHint(stage: OrderStage, orderKind: MobileOrderKind): string | null {
  switch (stage) {
    case 'PENDING_QUOTE':
      return orderKind === 'READY_MADE' ? 'Customer inquiry' : 'Quote needed'
    case 'CONSULTATION':
      return 'Consultation in progress'
    case 'QUOTE_SENT':
      return 'Waiting for customer'
    case 'PAYMENT_PENDING':
      return orderKind === 'READY_MADE' ? 'Checkout open' : 'Awaiting payment'
    case 'PAYMENT_FAILED':
      return orderKind === 'READY_MADE' ? 'Retry checkout' : 'Payment failed'
    case 'CONFIRMED':
      return orderKind === 'READY_MADE' ? 'Prepare order' : 'Ready to start'
    case 'DESIGNING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Designing'
    case 'SOURCING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Sourcing'
    case 'CUTTING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Cutting'
    case 'SEWING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Sewing'
    case 'FINISHING':
      return orderKind === 'READY_MADE' ? 'Preparing order' : 'Finishing'
    case 'READY_FOR_DRAPE_DISPATCH':
      return 'Ready for Drape dispatch'
    case 'READY_FOR_COLLECTION':
      return 'Ready for collection'
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery'
    case 'SHIPPED':
      return 'In transit'
    case 'DELIVERED':
    case 'COLLECTED':
      return 'Review window open'
    case 'IN_DISPUTE':
      return 'Concern under review'
    default:
      return null
  }
}

export function tailorOrderPriority(stage: OrderStage): number {
  switch (stage) {
    case 'PENDING_QUOTE':
      return 0
    case 'CONSULTATION':
      return 1
    case 'IN_DISPUTE':
      return 2
    case 'READY_FOR_COLLECTION':
      return 3
    case 'READY_FOR_DRAPE_DISPATCH':
      return 4
    case 'OUT_FOR_DELIVERY':
    case 'SHIPPED':
      return 5
    default:
      return 6
  }
}
