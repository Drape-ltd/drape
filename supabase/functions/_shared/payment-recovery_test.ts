import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { resolvePreparedPaymentReference } from './payment-recovery.ts'

Deno.test('resolvePreparedPaymentReference recovers a missing payment reference from the latest matching ledger attempt', () => {
  const result = resolvePreparedPaymentReference({
    expectedProvider: 'PAYSTACK',
    storedPaymentIntentId: null,
    storedCheckoutUrl: null,
    latestAttempt: {
      provider: 'PAYSTACK',
      provider_payment_id: 'pay_ref_123',
      provider_checkout_url: 'https://checkout.example/pay_ref_123',
    },
  })

  assertEquals(result.providerPaymentId, 'pay_ref_123')
  assertEquals(result.providerCheckoutUrl, 'https://checkout.example/pay_ref_123')
  assertEquals(result.recoveredFromLedger, true)
  assertEquals(result.providerMismatch, false)
})

Deno.test('resolvePreparedPaymentReference keeps stored values when present', () => {
  const result = resolvePreparedPaymentReference({
    expectedProvider: 'STRIPE',
    storedPaymentIntentId: 'pi_live',
    storedCheckoutUrl: null,
    latestAttempt: {
      provider: 'STRIPE',
      provider_payment_id: 'pi_old',
      provider_checkout_url: null,
    },
  })

  assertEquals(result.providerPaymentId, 'pi_live')
  assertEquals(result.recoveredFromLedger, false)
  assertEquals(result.providerMismatch, false)
})

Deno.test('resolvePreparedPaymentReference flags provider mismatch instead of silently recovering the wrong provider', () => {
  const result = resolvePreparedPaymentReference({
    expectedProvider: 'STRIPE',
    storedPaymentIntentId: null,
    storedCheckoutUrl: null,
    latestAttempt: {
      provider: 'PAYSTACK',
      provider_payment_id: 'pay_ref_wrong',
      provider_checkout_url: 'https://checkout.example/pay_ref_wrong',
    },
  })

  assertEquals(result.providerPaymentId, null)
  assertEquals(result.recoveredFromLedger, false)
  assertEquals(result.providerMismatch, true)
})
