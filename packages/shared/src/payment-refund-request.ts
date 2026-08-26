export type RefundOrderPaymentsRequest = {
  orderId: string
  reason?: string
  amount?: number
  includeUnreleasedMaterialAdvances?: boolean
  allowedPhases?: Array<'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT' | 'MATERIAL_ADVANCE'>
}

export function buildRefundOrderPaymentsRequest(input: {
  orderId: string
  reason?: string | null
  amount?: number | null
  includeUnreleasedMaterialAdvances?: boolean
  allowedPhases?: Array<'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT' | 'MATERIAL_ADVANCE'>
}): RefundOrderPaymentsRequest {
  const reason = input.reason?.trim()

  return {
    orderId: input.orderId,
    ...(reason ? { reason } : {}),
    ...(typeof input.amount === 'number' && Number.isInteger(input.amount) && input.amount > 0
      ? { amount: input.amount }
      : {}),
    ...(input.includeUnreleasedMaterialAdvances ? { includeUnreleasedMaterialAdvances: true } : {}),
    ...(input.allowedPhases?.length ? { allowedPhases: [...new Set(input.allowedPhases)] } : {}),
  }
}
