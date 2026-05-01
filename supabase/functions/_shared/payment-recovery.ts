type PaymentProvider = 'STRIPE' | 'PAYSTACK'

type PaymentAttemptLike = {
  provider: PaymentProvider
  provider_payment_id: string | null
  provider_checkout_url?: string | null
}

export function resolvePreparedPaymentReference(input: {
  expectedProvider: PaymentProvider
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
