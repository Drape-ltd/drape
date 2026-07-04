import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type PaymentProvider = 'STRIPE' | 'PAYSTACK'

type PaymentFailurePhase = 'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT'

type OrderForPaymentFailure = {
  id: string
  stage: string
  order_kind?: string | null
  payment_provider?: PaymentProvider | null
  payment_intent_id?: string | null
  payment_checkout_url?: string | null
}

function paymentFailedStageNote(orderKind: string | null | undefined) {
  return (orderKind ?? 'CUSTOM') === 'READY_MADE'
    ? 'Checkout failed. Retry payment within 2 hours or this order will cancel automatically.'
    : 'Payment failed. Retry within 2 hours or this order will cancel automatically.'
}

export async function markInitialOrderPaymentFailed(
  supabase: SupabaseClient,
  order: OrderForPaymentFailure,
  input: {
    provider: PaymentProvider
    paymentIntentId: string
    phase: PaymentFailurePhase
  },
) {
  if (input.phase !== 'INITIAL_ORDER') {
    return { changed: false as const, stage: order.stage }
  }

  if (order.stage === 'PAYMENT_FAILED') {
    return { changed: false as const, stage: 'PAYMENT_FAILED' as const }
  }

  if (order.stage !== 'PAYMENT_PENDING') {
    return { changed: false as const, stage: order.stage }
  }

  const nowIso = new Date().toISOString()
  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'PAYMENT_FAILED',
      stage_updated_at: nowIso,
      payment_provider: input.provider,
      payment_intent_id: input.paymentIntentId,
      payment_checkout_url: null,
    })
    .eq('id', order.id)
    .eq('stage', 'PAYMENT_PENDING')
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (!updatedOrder?.id) {
    return { changed: false as const, stage: order.stage }
  }

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'PAYMENT_FAILED',
    note: paymentFailedStageNote(order.order_kind),
  })

  return { changed: true as const, stage: 'PAYMENT_FAILED' as const }
}
