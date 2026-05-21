import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueBackgroundJob } from './jobs.ts'
import { log } from './logger.ts'
import { Sentry } from './sentry.ts'

const FN = 'payment-side-effects'

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION'

type PaymentOrderContext = {
  id: string
  customer_id?: string | null
  tailor_id?: string | null
  [key: string]: unknown
}

export async function enqueueOrderConfirmationEmailJob(
  supabase: SupabaseClient,
  input: {
    order: PaymentOrderContext
    phase: PaymentPhase
    source: string
    provider?: string | null
  },
) {
  try {
    await enqueueBackgroundJob(supabase, {
      eventType: 'order.payment_confirmed.email_requested',
      aggregateType: 'order',
      aggregateId: input.order.id,
      orderId: input.order.id,
      actorRole: 'SYSTEM',
      idempotencyKey: `order-confirmation-email:${input.order.id}:${input.phase}`,
      jobType: 'SEND_ORDER_CONFIRMATION_EMAILS',
      priority: 20,
      maxAttempts: 8,
      payload: {
        order: input.order,
        phase: input.phase,
      },
      metadata: {
        source: input.source,
        provider: input.provider ?? null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('warn', FN, 'enqueue.order_confirmation_email_failed', {
      source: input.source,
      order_id: input.order.id,
      payment_phase: input.phase,
      error: message,
    })
    await Sentry.captureMessage('Failed to enqueue order confirmation email job', {
      level: 'warning',
      tags: { fn: FN, source: input.source },
      extra: {
        order_id: input.order.id,
        payment_phase: input.phase,
        provider: input.provider ?? null,
        error: message,
      },
    })
  }
}
