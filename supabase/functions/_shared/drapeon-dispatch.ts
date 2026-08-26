import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'

export async function finalizeDispatchShortfallFunding(
  supabase: SupabaseClient,
  input: {
    orderId: string
    actorId?: string | null
    actorRole: 'CUSTOMER' | 'SYSTEM'
    provider: 'PAYSTACK' | 'STRIPE'
    providerPaymentId: string
  },
) {
  const { data: payment, error: paymentError } = await supabase
    .from('order_payments')
    .select('id, amount, currency')
    .eq('order_id', input.orderId)
    .eq('phase', 'FULFILLMENT')
    .eq('provider', input.provider)
    .eq('provider_payment_id', input.providerPaymentId)
    .maybeSingle()
  if (paymentError) throw paymentError

  const { data: run, error: runError } = await supabase
    .from('order_fulfillment_runs')
    .select('id, status, shortfall_total_amount, correlation_id, provider_quote_evidence')
    .eq('order_id', input.orderId)
    .maybeSingle()
  if (runError) throw runError
  if (!run?.id) return { applied: false as const, reason: 'NO_DISPATCH_RUN' as const }
  if (run.status === 'READY_TO_BOOK' || run.status === 'BOOKED' || run.status === 'IN_TRANSIT') {
    return { applied: false as const, reason: 'ALREADY_APPLIED' as const }
  }
  if (run.status !== 'AWAITING_SHORTFALL_PAYMENT') {
    throw new Error('Dispatch shortfall payment reached the provider in an unexpected dispatch state.')
  }
  if (!payment?.id || payment.amount !== run.shortfall_total_amount) {
    throw new Error('Dispatch shortfall payment does not match the authoritative dispatch amount.')
  }

  const { error: attachError } = await supabase
    .from('order_fulfillment_runs')
    .update({ provider_payment_id: payment.id })
    .eq('id', run.id)
    .eq('status', 'AWAITING_SHORTFALL_PAYMENT')
  if (attachError) throw attachError

  const { error: eventError } = await supabase.rpc('record_order_fulfillment_event', {
    p_order_id: input.orderId,
    p_parcel_number: 1,
    p_event_type: 'SHORTFALL_PAID',
    p_source: input.actorRole === 'CUSTOMER' ? 'CUSTOMER' : 'SYSTEM',
    p_actor_id: input.actorId ?? null,
    p_actor_role: input.actorRole,
    p_provider_event_id: null,
    p_idempotency_key: `dispatch-shortfall-paid:${payment.id}`,
    p_provider_name: input.provider,
    p_service_level: null,
    p_provider_reference: input.providerPaymentId,
    p_tracking_number: null,
    p_tracking_url: null,
    p_contact_name: null,
    p_contact_phone: null,
    p_customer_note: 'The additional delivery amount was paid. Drapeon can now book the delivery.',
    p_internal_note: null,
    p_evidence_media: [],
    p_location: null,
    p_eta_at: null,
    p_eta_timezone: null,
    p_occurred_at: new Date().toISOString(),
    p_payload: {
      provider: input.provider,
      paymentId: payment.id,
      providerPaymentId: input.providerPaymentId,
      amount: payment.amount,
      currency: payment.currency,
      correlationId: run.correlation_id,
    },
  })
  if (eventError) throw eventError

  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id,reference,order_kind,item_title,item_size,customer_id,tailor_id,stage,currency,quoted_currency,quoted_amount,total_amount,garment_type,delivery_method')
    .eq('id', input.orderId)
    .maybeSingle()
  if (orderError) throw orderError
  if (order?.id) {
    const quoteEvidence = Array.isArray(run.provider_quote_evidence)
      ? run.provider_quote_evidence[0] as Record<string, unknown> | undefined
      : undefined
    const evidencePath = typeof quoteEvidence?.storageObjectPath === 'string'
      ? quoteEvidence.storageObjectPath
      : typeof quoteEvidence?.storage_object_path === 'string'
        ? quoteEvidence.storage_object_path
        : null
    const body = `The exact additional delivery payment for order ${order.reference} is confirmed. Drapeon Dispatch can now book the rider or carrier.`
    await Promise.all([
      enqueuePushJob(supabase, {
        userId: order.customer_id,
        orderId: order.id,
        source: 'drapeon-dispatch-shortfall',
        idempotencyKey: `dispatch-shortfall-paid:${payment.id}:customer:push`,
        notification: {
          title: 'Delivery payment confirmed',
          body,
          preferenceKey: 'orderUpdates',
          data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' },
        },
      }),
      enqueuePushJob(supabase, {
        userId: order.tailor_id,
        orderId: order.id,
        source: 'drapeon-dispatch-shortfall',
        idempotencyKey: `dispatch-shortfall-paid:${payment.id}:tailor:push`,
        notification: {
          title: 'Delivery funding ready',
          body,
          preferenceKey: 'orderUpdates',
          data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' },
        },
      }),
      enqueueOrderEventEmailJob(supabase, {
        order,
        recipientUserId: order.customer_id,
        audience: 'CUSTOMER',
        subject: 'Your delivery payment is confirmed',
        headline: 'Drapeon Dispatch can now book your delivery',
        body,
        ctaLabel: 'View delivery status',
        action: 'SHORTFALL_PAID',
        source: 'drapeon-dispatch-shortfall',
        idempotencyKey: `dispatch-shortfall-paid:${payment.id}:customer:email`,
        evidenceImageUrl: evidencePath,
        evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null,
      }),
      enqueueOrderEventEmailJob(supabase, {
        order,
        recipientUserId: order.tailor_id,
        audience: 'TAILOR',
        subject: 'Delivery funding is ready',
        headline: 'Drapeon Dispatch can now book the order',
        body,
        ctaLabel: 'View delivery status',
        action: 'SHORTFALL_PAID',
        source: 'drapeon-dispatch-shortfall',
        idempotencyKey: `dispatch-shortfall-paid:${payment.id}:tailor:email`,
        evidenceImageUrl: evidencePath,
        evidenceStorageBucket: evidencePath ? 'commercial-evidence' : null,
      }),
    ])
  }
  return { applied: true as const, reason: 'SHORTFALL_PAID' as const }
}
