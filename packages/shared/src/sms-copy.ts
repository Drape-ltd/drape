export type SmsPaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT'
export type SmsReviewType = 'CANCELLATION' | 'DELIVERY'
export type SmsReviewOutcome = 'REFUND' | 'CONTINUE'

const STAGE_LABELS = {
  CONFIRMED: 'confirmed',
  DESIGNING: 'designing',
  SOURCING: 'sourcing',
  CUTTING: 'cutting',
  SEWING: 'sewing',
  FINISHING: 'finishing',
  READY_FOR_COLLECTION: 'ready for collection',
  READY_FOR_DRAPE_DISPATCH: 'ready for Drape dispatch',
  OUT_FOR_DELIVERY: 'out for delivery',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  COLLECTED: 'collected',
  COMPLETE: 'complete',
  REFUNDED: 'refunded',
} as const

export type OrderSmsContext = {
  id: string
  reference?: string | null
  orderKind?: string | null
  garmentType?: string | null
  itemTitle?: string | null
  itemSize?: string | null
  deliveryMethod?: string | null
}

export type OrderStageSmsContext = OrderSmsContext & {
  fulfillmentProvider?: string | null
  carrier?: string | null
}

function orderReference(order: Pick<OrderSmsContext, 'reference' | 'id'>) {
  return (order.reference?.trim() || order.id.slice(0, 8).toUpperCase()).toUpperCase()
}

function orderLabel(order: Pick<OrderSmsContext, 'orderKind' | 'itemTitle' | 'garmentType'>) {
  if (order.orderKind === 'READY_MADE') {
    return order.itemTitle?.trim() || order.garmentType?.trim() || 'your ready-made order'
  }

  return order.garmentType?.trim() || 'your custom order'
}

function fulfillmentLabel(method: string | null | undefined) {
  if (method === 'LOCAL_DELIVERY') return 'delivery'
  if (method === 'LOCAL_COLLECTION') return 'pickup'
  return 'shipping'
}

function stageLabel(stage: string) {
  return STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage.replace(/_/g, ' ').toLowerCase()
}

function providerLabel(order: Pick<OrderStageSmsContext, 'fulfillmentProvider' | 'carrier'>) {
  return order.fulfillmentProvider?.trim() || order.carrier?.trim() || null
}

export function buildCustomerOrderPaymentSms(order: OrderSmsContext, phase: SmsPaymentPhase) {
  const ref = orderReference(order)

  if (phase === 'FULFILLMENT') {
    return `Drape: ${fulfillmentLabel(order.deliveryMethod)} payment for order #${ref} is confirmed. Dispatch can now move ahead.`
  }

  return `Drape: Order #${ref} for ${orderLabel(order)} is confirmed. We will keep you updated in the app.`
}

export function buildTailorOrderPaymentSms(order: OrderSmsContext, phase: SmsPaymentPhase) {
  const ref = orderReference(order)

  if (phase === 'FULFILLMENT') {
    return `Drape: ${fulfillmentLabel(order.deliveryMethod)} payment for order #${ref} is confirmed.`
  }

  return `Drape: Order #${ref} for ${orderLabel(order)} is paid and ready for fulfillment in Drape.`
}

export function buildCustomerStageSms(order: OrderStageSmsContext, stage: string) {
  const ref = orderReference(order)
  const provider = providerLabel(order)

  if (stage === 'READY_FOR_COLLECTION') {
    return `Drape: Order #${ref} is ready for pickup. Open Drape for your collection details and code.`
  }

  if (stage === 'READY_FOR_DRAPE_DISPATCH') {
    return `Drape: Order #${ref} is packed and waiting for Drape dispatch. We will text again when it starts moving.`
  }

  if (stage === 'OUT_FOR_DELIVERY') {
    return `Drape: Order #${ref} is out for delivery${provider ? ` with ${provider}` : ''}. Keep your phone available.`
  }

  if (stage === 'SHIPPED') {
    return `Drape: Order #${ref} has shipped${provider ? ` with ${provider}` : ''}. Track it in Drape.`
  }

  if (stage === 'DELIVERED') {
    return `Drape: Order #${ref} was marked delivered. Open Drape if anything looks wrong.`
  }

  return null
}

export function buildTailorStageSms(order: OrderStageSmsContext, stage: string) {
  const ref = orderReference(order)
  const provider = providerLabel(order)

  if (stage === 'OUT_FOR_DELIVERY') {
    return `Drape: Order #${ref} is now out for delivery${provider ? ` with ${provider}` : ''}.`
  }

  if (stage === 'SHIPPED') {
    return `Drape: Order #${ref} has shipped${provider ? ` with ${provider}` : ''}.`
  }

  if (stage === 'DELIVERED') {
    return `Drape: Order #${ref} was confirmed delivered.`
  }

  return null
}

export function buildCustomerReviewResolutionSms(
  order: OrderSmsContext,
  reviewType: SmsReviewType,
  outcome: SmsReviewOutcome,
  restoreStage?: string | null,
) {
  const ref = orderReference(order)

  if (outcome === 'REFUND') {
    return `Drape: We approved the ${reviewType === 'CANCELLATION' ? 'cancellation' : 'delivery'} review for order #${ref} and marked it for refund.`
  }

  return `Drape: We reviewed order #${ref}. It will continue from ${stageLabel(restoreStage ?? 'CONFIRMED')}.`
}

export function buildTailorReviewResolutionSms(
  order: OrderSmsContext,
  reviewType: SmsReviewType,
  outcome: SmsReviewOutcome,
  restoreStage?: string | null,
) {
  const ref = orderReference(order)

  if (outcome === 'REFUND') {
    return `Drape: We approved the ${reviewType === 'CANCELLATION' ? 'cancellation' : 'delivery'} review for order #${ref}. The order is now marked for refund.`
  }

  return `Drape: We reviewed order #${ref}. It will continue from ${stageLabel(restoreStage ?? 'CONFIRMED')}.`
}
