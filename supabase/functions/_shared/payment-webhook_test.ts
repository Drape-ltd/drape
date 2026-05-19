import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  buildRejectedWebhookEventId,
  buildRejectedWebhookPayload,
  shouldAlertOnSignatureFailureCount,
} from './payment-webhook.ts'

Deno.test('buildRejectedWebhookEventId is stable for identical rejected payloads', async () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })
  const one = await buildRejectedWebhookEventId('STRIPE', 'invalid_signature', payload)
  const two = await buildRejectedWebhookEventId('STRIPE', 'invalid_signature', payload)

  assertEquals(one, two)
  assert(one.startsWith('stripe:invalid_signature:'))
})

Deno.test('buildRejectedWebhookPayload preserves unverified webhook metadata for debugging', () => {
  const payload = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'pay_ref_123', id: 44 },
  })

  const result = buildRejectedWebhookPayload({
    rawPayload: payload,
    reason: 'invalid_signature',
    signatureHeader: 'sig_abc',
    provider: 'PAYSTACK',
    verificationError: 'No Paystack webhook signatures matched the expected signature.',
  })

  assertEquals(result.unverified_event_type, 'charge.success')
  assertEquals(result.unverified_reference, 'pay_ref_123')
  assertEquals(result.signature_header_present, true)
  assertEquals(result.verification_error, 'No Paystack webhook signatures matched the expected signature.')
})

Deno.test('shouldAlertOnSignatureFailureCount only alerts once at threshold', () => {
  assertEquals(shouldAlertOnSignatureFailureCount(1), false)
  assertEquals(shouldAlertOnSignatureFailureCount(2), false)
  assertEquals(shouldAlertOnSignatureFailureCount(3), true)
  assertEquals(shouldAlertOnSignatureFailureCount(4), false)
})
