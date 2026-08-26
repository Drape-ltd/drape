import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  attachCommercialPricingReservation,
  attachPreparedCommercialPricing,
  recordCommercialPaymentCapture,
  type PreparedCommercialPricing,
} from './commercial-ledger.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob } from './side-effect-jobs.ts'

type PaymentProvider = 'STRIPE' | 'PAYSTACK' | 'COVERAGE'
type PaymentPhase = 'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT' | 'MATERIAL_ADVANCE' | 'ADJUSTMENT' | 'TIP'
type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'REFUNDED'

export type PaymentAttempt = {
  id: string
  order_id: string
  phase: PaymentPhase
  provider: PaymentProvider
  currency: string
  amount: number
  status: PaymentStatus
  idempotency_key: string
  provider_payment_id: string | null
  provider_checkout_url: string | null
  policy_version?: string | null
  pricing_version?: number | null
  correlation_id?: string | null
  ledger_recorded_at?: string | null
  commercial_breakdown?: import('../../../packages/shared/src/commercial-pricing.ts').CommercialPricingBreakdown | null
  fabric_candidate_id?: string | null
}

async function syncFabricCandidateShortfallOutcome(
  supabase: SupabaseClient,
  payment: PaymentAttempt,
  status: PaymentStatus,
) {
  if (payment.phase !== 'ADJUSTMENT' || !payment.fabric_candidate_id) return
  if (status !== 'SUCCEEDED') return

  const { data: candidate, error } = await supabase.rpc('mark_fabric_candidate_shortfall_paid_v2', {
    p_candidate_id: payment.fabric_candidate_id,
    p_payment_id: payment.id,
  })
  if (error) throw error
  if (!candidate?.id) return

  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id,reference,stage,customer_id,tailor_id')
    .eq('id', candidate.order_id)
    .single()
  if (orderError) throw orderError

  await Promise.all([
    enqueuePushJob(supabase, {
      userId: candidate.tailor_id,
      orderId: candidate.order_id,
      source: 'fabric-shortfall-payment',
      idempotencyKey: `SHORTFALL_PAID:push:${candidate.id}`,
      priority: 10,
      notification: {
        title: 'Fabric payment confirmed',
        body: 'The uncovered material amount is paid. The exact approved fabric release is now queued.',
        data: { destination: 'ORDER', orderId: candidate.order_id, section: 'fabric', candidateId: candidate.id },
      },
    }),
    enqueueOrderEventEmailJob(supabase, {
      order,
      recipientUserId: candidate.tailor_id,
      audience: 'TAILOR',
      source: 'fabric-shortfall-payment',
      idempotencyKey: `SHORTFALL_PAID:email:${candidate.id}`,
      priority: 10,
      subject: 'Fabric payment confirmed',
      headline: 'Fabric payment confirmed',
      body: 'The uncovered material amount is paid. The exact approved fabric release is now queued.',
      ctaLabel: 'Open fabric task',
      action: 'SHORTFALL_PAID',
    }),
  ])

  await supabase.from('order_fabric_events').insert({
    order_id: candidate.order_id,
    candidate_id: candidate.id,
    event_type: 'RELEASE_QUEUED',
    actor_role: 'SYSTEM',
    payload: {
      paymentId: payment.id,
      providerReference: payment.provider_payment_id,
      shortfallSubtotalAmount: candidate.shortfall_subtotal_amount,
      taxExcluded: candidate.shortfall_tax_amount,
      feesExcluded: candidate.shortfall_fee_amount,
    },
    correlation_id: candidate.correlation_id,
  })

  const { error: queueError } = await supabase.rpc('enqueue_domain_event', {
    p_event_type: 'fabric.release_requested',
    p_aggregate_type: 'fabric_candidate',
    p_idempotency_key: `fabric-release:${candidate.id}`,
    p_payload: { candidateId: candidate.id },
    p_aggregate_id: candidate.id,
    p_actor_id: candidate.customer_id,
    p_actor_role: 'CUSTOMER',
    p_order_id: candidate.order_id,
    p_metadata: { correlationId: candidate.correlation_id },
    p_jobs: ['PROCESS_FABRIC_RELEASE'],
    p_priority: 10,
    p_max_attempts: 8,
    p_run_at: new Date().toISOString(),
  })
  if (queueError) throw queueError
}

export type PaymentWebhookEventRecord = {
  id: string
  processed_at: string | null
  processing_result: string | null
}

function isUniqueViolation(error: { code?: string | null } | null | undefined) {
  return error?.code === '23505'
}

async function syncAdjustmentPaymentOutcome(
  supabase: SupabaseClient,
  payment: PaymentAttempt,
  status: PaymentStatus,
) {
  if (payment.phase !== 'ADJUSTMENT') return
  const { data: adjustment, error: lookupError } = await supabase
    .from('commercial_adjustments')
    .select('id, order_id, financial_case_id, status, correlation_id')
    .eq('payment_id', payment.id)
    .maybeSingle()
  if (lookupError) throw lookupError
  if (!adjustment?.id) return

  if (status === 'SUCCEEDED') {
    const { data: fabricLink, error: fabricLinkError } = await supabase
      .from('fabric_release_adjustment_links')
      .select('adjustment_id,material_advance_id')
      .eq('adjustment_id', adjustment.id)
      .maybeSingle()
    if (fabricLinkError) throw fabricLinkError
    if (adjustment.status !== 'PAID' && adjustment.status !== 'COMPLETED') {
      const { error: updateError } = await supabase
        .from('commercial_adjustments')
        .update({ status: 'PAID' })
        .eq('id', adjustment.id)
        .eq('status', 'PAYMENT_PENDING')
      if (updateError) throw updateError
      if (fabricLink?.adjustment_id && !fabricLink.material_advance_id) {
        const { error: activationError } = await supabase.rpc('activate_paid_fabric_release_adjustment', {
          p_adjustment_id: adjustment.id,
        })
        if (activationError) throw activationError
      }
      await supabase.from('commercial_adjustment_events').insert({
        adjustment_id: adjustment.id,
        event_type: 'PAYMENT_CONFIRMED',
        actor_role: 'SYSTEM',
        payload: { paymentId: payment.id, providerReference: payment.provider_payment_id },
        correlation_id: adjustment.correlation_id,
      })
      if (adjustment.financial_case_id) {
        await supabase.from('financial_cases').update({
          status: 'RESOLVED',
          money_movement_blocked: false,
          resolved_at: new Date().toISOString(),
          resolution_code: 'ADJUSTMENT_PAID',
          resolution_summary: 'The customer-approved order adjustment payment was provider-confirmed.',
        }).eq('id', adjustment.financial_case_id)
      }
      const { data: order } = await supabase.from('orders').select('stage').eq('id', adjustment.order_id).maybeSingle()
      if (order?.stage) {
        await supabase.from('order_stage_updates').insert({
          order_id: adjustment.order_id,
          stage: order.stage,
          note: fabricLink?.adjustment_id
            ? 'Customer paid the approved fabric shortfall. The exact fabric release is now waiting for customer approval; no funds have been released yet.'
            : 'Customer paid the approved order change. The added work can now continue.',
        })
      }
      const { data: issue } = await supabase.from('ops_issues').select('id, status').eq('dedupe_key', `commercial-adjustment:${adjustment.id}`).maybeSingle()
      if (issue?.id && issue.status !== 'RESOLVED') {
        await supabase.from('ops_issues').update({ status: 'RESOLVED', resolved_at: new Date().toISOString() }).eq('id', issue.id)
        await supabase.from('ops_audit_logs').insert({ issue_id: issue.id, action_taken: 'ISSUE_RESOLVED', performed_role: 'SYSTEM', reason: 'Provider-confirmed adjustment payment.', before_state: { status: issue.status }, after_state: { status: 'RESOLVED', payment_id: payment.id } })
      }
    }
    // Activation is intentionally retryable even when a previous webhook already
    // marked the adjustment PAID but failed before creating the release claim.
    if (adjustment.status === 'PAID' && fabricLink?.adjustment_id && !fabricLink.material_advance_id) {
      const { error: activationError } = await supabase.rpc('activate_paid_fabric_release_adjustment', {
        p_adjustment_id: adjustment.id,
      })
      if (activationError) throw activationError
    }
    return
  }

  if (status === 'FAILED' || status === 'CANCELED') {
    await supabase.from('commercial_adjustment_events').insert({
      adjustment_id: adjustment.id,
      event_type: 'NOTE_ADDED',
      actor_role: 'SYSTEM',
      payload: { paymentId: payment.id, paymentStatus: status },
      correlation_id: adjustment.correlation_id,
    })
  }
}

async function syncTipPaymentOutcome(supabase: SupabaseClient, payment: PaymentAttempt, status: PaymentStatus) {
  if (payment.phase !== 'TIP') return
  const { data: tip, error } = await supabase.from('order_tips').select('id, status, correlation_id').eq('payment_id', payment.id).maybeSingle()
  if (error) throw error
  if (!tip?.id) return
  const next = status === 'SUCCEEDED' ? 'PAYOUT_PENDING' : status === 'REFUNDED' ? 'REFUNDED' : status === 'FAILED' || status === 'CANCELED' ? 'FAILED' : null
  if (!next || tip.status === next) return
  const { data: ledger } = status === 'SUCCEEDED' ? await supabase.from('commercial_ledger_transactions').select('id').eq('payment_id', payment.id).eq('transaction_kind', 'CAPTURE').maybeSingle() : { data: null }
  const { error: updateError } = await supabase.from('order_tips').update({ status: next, ...(status === 'SUCCEEDED' ? { paid_at: new Date().toISOString(), ledger_transaction_id: ledger?.id ?? null } : { failure_reason: status }) }).eq('id', tip.id)
  if (updateError) throw updateError
  const { error: eventError } = await supabase.from('order_tip_events').insert({ tip_id: tip.id, event_type: status === 'SUCCEEDED' ? 'TIP_CAPTURED' : status === 'REFUNDED' ? 'TIP_REFUNDED' : 'TIP_FAILED', actor_role: 'SYSTEM', payload: { paymentId: payment.id, providerReference: payment.provider_payment_id, paymentStatus: status }, correlation_id: tip.correlation_id })
  if (eventError) throw eventError
}

export async function findPaymentAttemptByProviderPaymentId(
  supabase: SupabaseClient,
  provider: PaymentProvider,
  providerPaymentId: string,
) {
  const { data, error } = await supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown, fabric_candidate_id')
    .eq('provider', provider)
    .eq('provider_payment_id', providerPaymentId)
    .maybeSingle()

  if (error) throw error
  return (data as PaymentAttempt | null) ?? null
}

export async function findLatestPaymentAttemptForOrderPhase(
  supabase: SupabaseClient,
  input: {
    orderId: string
    phase: PaymentPhase
    provider?: PaymentProvider
    statuses?: PaymentStatus[]
  },
) {
  let query = supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown, fabric_candidate_id')
    .eq('order_id', input.orderId)
    .eq('phase', input.phase)
    .order('created_at', { ascending: false })
    .limit(1)

  if (input.provider) {
    query = query.eq('provider', input.provider)
  }

  if (input.statuses?.length) {
    query = query.in('status', input.statuses)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as PaymentAttempt | null) ?? null
}

export async function upsertPreparedPaymentAttempt(
  supabase: SupabaseClient,
  input: {
    orderId: string
    phase: PaymentPhase
    provider: PaymentProvider
    currency: string
    amount: number
    idempotencyKey: string
    providerPaymentId: string
    providerCheckoutUrl?: string | null
    providerResponse?: Record<string, unknown> | null
    status?: PaymentStatus
    preparedCommercialPricing?: PreparedCommercialPricing | null
  },
) {
  const { data: orderContract, error: orderContractError } = await supabase
    .from('orders')
    .select('commercial_policy_version')
    .eq('id', input.orderId)
    .single()
  if (orderContractError) throw orderContractError
  const policyVersion = typeof orderContract?.commercial_policy_version === 'string'
    ? orderContract.commercial_policy_version
    : 'legacy-single-release-72h'

  const existing = await findPaymentAttemptByProviderPaymentId(supabase, input.provider, input.providerPaymentId)
  if (existing?.id) {
    const { data, error } = await supabase
      .from('order_payments')
      .update({
        order_id: input.orderId,
        phase: input.phase,
        currency: input.currency,
        amount: input.amount,
        status: input.status ?? 'PENDING',
        provider_checkout_url: input.providerCheckoutUrl ?? null,
        provider_response: input.providerResponse ?? {},
      })
      .eq('id', existing.id)
      .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown, fabric_candidate_id')
      .single()

    if (error) throw error
    const payment = data as PaymentAttempt
    if (input.preparedCommercialPricing) {
      await attachPreparedCommercialPricing(supabase, payment, input.preparedCommercialPricing)
    } else {
      await attachCommercialPricingReservation(supabase, payment)
    }
    return payment
  }

  const insertPayload = {
    order_id: input.orderId,
    phase: input.phase,
    provider: input.provider,
    currency: input.currency,
    amount: input.amount,
    status: input.status ?? 'PENDING',
    idempotency_key: input.idempotencyKey,
    provider_payment_id: input.providerPaymentId,
    provider_checkout_url: input.providerCheckoutUrl ?? null,
    provider_response: input.providerResponse ?? {},
    policy_version: policyVersion,
    pricing_version: 1,
    correlation_id: crypto.randomUUID(),
  }

  const { data, error } = await supabase
    .from('order_payments')
    .insert(insertPayload)
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown, fabric_candidate_id')
    .single()

  if (error && isUniqueViolation(error)) {
    const { data: retryData, error: retryError } = await supabase
      .from('order_payments')
      .update({
        provider_payment_id: input.providerPaymentId,
        provider_checkout_url: input.providerCheckoutUrl ?? null,
        provider_response: input.providerResponse ?? {},
        status: input.status ?? 'PENDING',
      })
      .eq('idempotency_key', input.idempotencyKey)
      .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown, fabric_candidate_id')
      .single()

    if (retryError) throw retryError
    const payment = retryData as PaymentAttempt
    if (input.preparedCommercialPricing) {
      await attachPreparedCommercialPricing(supabase, payment, input.preparedCommercialPricing)
    } else {
      await attachCommercialPricingReservation(supabase, payment)
    }
    return payment
  }

  if (error) throw error
  const payment = data as PaymentAttempt
  if (input.preparedCommercialPricing) {
    await attachPreparedCommercialPricing(supabase, payment, input.preparedCommercialPricing)
  } else {
    await attachCommercialPricingReservation(supabase, payment)
  }
  return payment
}

export async function markPaymentAttemptStatus(
  supabase: SupabaseClient,
  input: {
    provider: PaymentProvider
    providerPaymentId: string
    status: PaymentStatus
    providerResponse?: Record<string, unknown> | null
  },
) {
  const patch: Record<string, unknown> = {
    status: input.status,
    provider_response: input.providerResponse ?? {},
  }

  if (input.status === 'SUCCEEDED') patch.confirmed_at = new Date().toISOString()
  if (input.status === 'FAILED' || input.status === 'CANCELED') patch.failed_at = new Date().toISOString()
  if (input.status === 'REFUNDED') patch.refunded_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('order_payments')
    .update(patch)
    .eq('provider', input.provider)
    .eq('provider_payment_id', input.providerPaymentId)
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url, policy_version, pricing_version, correlation_id, ledger_recorded_at, commercial_breakdown, fabric_candidate_id')
    .maybeSingle()

  if (error) throw error
  const payment = (data as PaymentAttempt | null) ?? null
  if (payment && input.status === 'SUCCEEDED') {
    await recordCommercialPaymentCapture(supabase, payment)
  }
  if (payment) await syncFabricCandidateShortfallOutcome(supabase, payment, input.status)
  if (payment) await syncAdjustmentPaymentOutcome(supabase, payment, input.status)
  if (payment) await syncTipPaymentOutcome(supabase, payment, input.status)
  return payment
}

export async function createWebhookEvent(
  supabase: SupabaseClient,
  input: {
    provider: PaymentProvider
    providerEventId: string
    eventType: string
    idempotencyKey?: string | null
    orderId?: string | null
    paymentId?: string | null
    signatureValid: boolean
    payload: Record<string, unknown>
  },
) {
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .upsert({
      provider: input.provider,
      provider_event_id: input.providerEventId,
      event_type: input.eventType,
      idempotency_key: input.idempotencyKey ?? null,
      order_id: input.orderId ?? null,
      payment_id: input.paymentId ?? null,
      signature_valid: input.signatureValid,
      payload: input.payload,
    }, {
      onConflict: 'provider,provider_event_id',
      ignoreDuplicates: true,
    })
    .select('id, processed_at, processing_result')

  if (error) {
    throw error
  }

  const rows = (data ?? []) as PaymentWebhookEventRecord[]
  if (rows.length > 0) {
    return {
      duplicate: false as const,
      id: rows[0].id,
      alreadyProcessed: false as const,
      processingResult: null,
    }
  }

  {
    const { data: existingEvent, error: existingError } = await supabase
      .from('payment_webhook_events')
      .select('id, processed_at, processing_result')
      .eq('provider', input.provider)
      .eq('provider_event_id', input.providerEventId)
      .single()

    if (existingError) throw existingError

    return {
      duplicate: true as const,
      id: (existingEvent as PaymentWebhookEventRecord).id,
      alreadyProcessed: !!(existingEvent as PaymentWebhookEventRecord).processed_at,
      processingResult: (existingEvent as PaymentWebhookEventRecord).processing_result,
    }
  }
}

export async function markWebhookEventProcessed(
  supabase: SupabaseClient,
  webhookEventId: string,
  input: {
    orderId?: string | null
    paymentId?: string | null
    processingResult: string
    reconciliationRequired?: boolean
  },
) {
  const { error } = await supabase
    .from('payment_webhook_events')
    .update({
      order_id: input.orderId ?? null,
      payment_id: input.paymentId ?? null,
      processed_at: new Date().toISOString(),
      processing_result: input.processingResult,
      processing_status: 'PROCESSED',
      last_processing_error: null,
      reconciliation_status: input.reconciliationRequired === false ? null : 'PENDING',
    })
    .eq('id', webhookEventId)

  if (error) throw error
}
