export type RefundAudience = 'CUSTOMER' | 'TAILOR'

export function refundTimingMessage(providerValue: unknown, audience: RefundAudience, expectedAt?: string | null) {
  const provider = typeof providerValue === 'string' ? providerValue.trim().toUpperCase() : ''
  const destination = audience === 'CUSTOMER' ? 'your original payment method' : "the customer's original payment method"
  if (provider === 'STRIPE') {
    return `Stripe has accepted the refund to ${destination}. It usually appears within 5–10 business days; the bank controls the final display time.`
  }
  if (provider === 'PAYSTACK') {
    const date = expectedAt
      ? new Date(expectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : null
    return date
      ? `Paystack expects to process the refund by ${date}. It returns to ${destination}; the bank may take up to 10 business days to display it after processing.`
      : `Paystack confirmed the refund to ${destination}. Paystack refunds generally take 3–10 working days, and the bank controls the final display time.`
  }
  return `The refund is returning to ${destination}. The payment provider and bank control when it appears.`
}

export function refundOutcomeMessage(outcome: unknown, resumeStage?: unknown) {
  if (outcome === 'CONTINUE_ORDER') {
    const stage = typeof resumeStage === 'string' ? resumeStage.toLowerCase().replaceAll('_', ' ') : 'production'
    return `The order has returned to ${stage}.`
  }
  if (outcome === 'CLOSE_ORDER') return 'The order is now closed as partially refunded.'
  return 'The order remains under Drapeon review.'
}

export function pendingRefundOutcomeMessage(outcome: unknown, resumeStage?: unknown) {
  if (outcome === 'CONTINUE_ORDER') {
    const stage = typeof resumeStage === 'string' ? resumeStage.toLowerCase().replaceAll('_', ' ') : 'production'
    return `After provider success, the order will return to ${stage}.`
  }
  if (outcome === 'CLOSE_ORDER') return 'After provider success, the order will close as partially refunded.'
  return 'After provider success, the order will remain under Drapeon review.'
}
