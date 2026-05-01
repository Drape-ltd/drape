export const CUSTOM_ORDER_RESUMABLE_STAGES = [
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
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
] as const

export function isResumableCustomOrderStage(stage: string | null | undefined) {
  return typeof stage === 'string' && CUSTOM_ORDER_RESUMABLE_STAGES.includes(stage as (typeof CUSTOM_ORDER_RESUMABLE_STAGES)[number])
}
