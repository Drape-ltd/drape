type PaymentProvider = 'STRIPE' | 'PAYSTACK'
type PaymentPhase = 'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT'
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
}

export type PaymentWebhookEventRecord = {
  id: string
  processed_at: string | null
  processing_result: string | null
}

function isUniqueViolation(error: { code?: string | null } | null | undefined) {
  return error?.code === '23505'
}

export async function findPaymentAttemptByProviderPaymentId(
  supabase: any,
  provider: PaymentProvider,
  providerPaymentId: string,
) {
  const { data, error } = await supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url')
    .eq('provider', provider)
    .eq('provider_payment_id', providerPaymentId)
    .maybeSingle()

  if (error) throw error
  return (data as PaymentAttempt | null) ?? null
}

export async function findLatestPaymentAttemptForOrderPhase(
  supabase: any,
  input: {
    orderId: string
    phase: PaymentPhase
    provider?: PaymentProvider
    statuses?: PaymentStatus[]
  },
) {
  let query = supabase
    .from('order_payments')
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url')
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
  supabase: any,
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
  },
) {
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
      .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url')
      .single()

    if (error) throw error
    return data as PaymentAttempt
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
  }

  const { data, error } = await supabase
    .from('order_payments')
    .insert(insertPayload)
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url')
    .single()

  if (error && isUniqueViolation(error)) {
    const { data: retryData, error: retryError } = await supabase
      .from('order_payments')
      .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url')
      .eq('idempotency_key', input.idempotencyKey)
      .single()

    if (retryError) throw retryError
    return retryData as PaymentAttempt
  }

  if (error) throw error
  return data as PaymentAttempt
}

export async function markPaymentAttemptStatus(
  supabase: any,
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
    .select('id, order_id, phase, provider, currency, amount, status, idempotency_key, provider_payment_id, provider_checkout_url')
    .maybeSingle()

  if (error) throw error
  return (data as PaymentAttempt | null) ?? null
}

export async function createWebhookEvent(
  supabase: any,
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
  supabase: any,
  webhookEventId: string,
  input: {
    orderId?: string | null
    paymentId?: string | null
    processingResult: string
  },
) {
  const { error } = await supabase
    .from('payment_webhook_events')
    .update({
      order_id: input.orderId ?? null,
      payment_id: input.paymentId ?? null,
      processed_at: new Date().toISOString(),
      processing_result: input.processingResult,
    })
    .eq('id', webhookEventId)

  if (error) throw error
}
