type PaymentProvider = 'STRIPE' | 'PAYSTACK' | 'COVERAGE'
type ExternalPaymentProvider = Exclude<PaymentProvider, 'COVERAGE'>

type PaymentAttemptLike = {
  provider: PaymentProvider
  provider_payment_id: string | null
  provider_checkout_url?: string | null
}

type PaymentAttemptStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'REFUNDED'

export function canReplacePreparedPaymentAfterAmountChange(input: {
  action: 'prepare-payment' | 'confirm-payment'
  attemptStatus?: PaymentAttemptStatus | null
}) {
  return input.action === 'prepare-payment'
    && (input.attemptStatus === 'FAILED' || input.attemptStatus === 'CANCELED')
}

export function resolvePreparedPaymentReference(input: {
  expectedProvider: ExternalPaymentProvider
  storedPaymentIntentId?: string | null
  storedCheckoutUrl?: string | null
  latestAttempt?: PaymentAttemptLike | null
}) {
  const storedPaymentIntentId = input.storedPaymentIntentId?.trim() || null
  const storedCheckoutUrl = input.storedCheckoutUrl?.trim() || null

  if (!input.latestAttempt) {
    return {
      providerPaymentId: storedPaymentIntentId,
      providerCheckoutUrl: storedCheckoutUrl,
      recoveredFromLedger: false,
      providerMismatch: false,
    }
  }

  if (input.latestAttempt.provider !== input.expectedProvider) {
    return {
      providerPaymentId: storedPaymentIntentId,
      providerCheckoutUrl: storedCheckoutUrl,
      recoveredFromLedger: false,
      providerMismatch: true,
    }
  }

  const recoveredPaymentId = input.latestAttempt.provider_payment_id?.trim() || null
  const recoveredCheckoutUrl = input.latestAttempt.provider_checkout_url?.trim() || null

  return {
    providerPaymentId: storedPaymentIntentId ?? recoveredPaymentId,
    providerCheckoutUrl: storedCheckoutUrl ?? recoveredCheckoutUrl,
    recoveredFromLedger: !storedPaymentIntentId && !!recoveredPaymentId,
    providerMismatch: false,
  }
}
