export type RefundOrderPaymentsRequest = {
  orderId: string
  reason?: string
  amount?: number
}

export function buildRefundOrderPaymentsRequest(input: {
  orderId: string
  reason?: string | null
  amount?: number | null
}): RefundOrderPaymentsRequest {
  const reason = input.reason?.trim()

  return {
    orderId: input.orderId,
    ...(reason ? { reason } : {}),
    ...(typeof input.amount === 'number' && Number.isInteger(input.amount) && input.amount > 0
      ? { amount: input.amount }
      : {}),
  }
}
