import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { markDispatchRefundTerminal } from '../_shared/drapeon-dispatch-refund.ts'
import { getServiceRoleKey, getStripeWebhookSecrets, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from '../_shared/rateLimit.ts'
import { markInitialOrderPaymentFailed } from '../_shared/payment-failure.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { enqueueOrderConfirmationEmailJob } from '../_shared/payment-side-effects.ts'
import { notifyTailorAboutReadyMadeStockChange } from '../_shared/ready-made-stock-alert.ts'
import { sendSmsToUser } from '../_shared/sms.ts'
import { parseOrderSupportMeta, serializeOrderSupportMeta } from '../_shared/order-support.ts'
import {
  fulfillmentPaymentConfirmedStageNote,
  paymentConfirmedStageNote,
  tailorFulfillmentPaymentConfirmedNotification,
  tailorPaymentConfirmedNotification,
} from '../_shared/payment-copy.ts'
import {
  buildCustomerOrderPaymentSms,
  buildPayoutFailedSms,
  buildPayoutReversedSms,
  buildPayoutSetupNeedsAttentionSms,
  buildRefundFailedSms,
  buildTailorOrderPaymentSms,
} from '../../../packages/shared/src/sms-copy.ts'
import {
  createWebhookEvent,
  findPaymentAttemptByProviderPaymentId,
  markPaymentAttemptStatus,
  markWebhookEventProcessed,
} from '../_shared/payment-ledger.ts'
import {
  enqueueVerifiedPaymentWebhook,
  loadQueuedPaymentWebhook,
  recordRejectedWebhook,
} from '../_shared/payment-webhook.ts'
import {
  retrieveStripeCharge,
  retrieveStripeConnectAccount,
  verifyStripeWebhookSignature,
  type StripeConnectAccount,
  type StripePaymentIntent,
  type StripeRefund,
} from '../_shared/stripe.ts'
import { Sentry } from '../_shared/sentry.ts'
import { enqueueTipConfirmedSideEffects } from '../_shared/tip-side-effects.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { finalizeRefundOnAttempt } from '../_shared/payment-refunds.ts'
import { finalizeDispatchShortfallFunding } from '../_shared/drapeon-dispatch.ts'
import { refundOutcomeMessage, refundTimingMessage } from '../_shared/refund-guidance.ts'
import { authorizeCronRequest } from '../_shared/cron.ts'

const FN = 'stripe-webhook'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

type StripeEvent = {
  id: string
  type: string
  account?: string | null
  data?: {
    object?: unknown
  }
}

type OrderRow = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  tailor_id?: string | null
  customer_id?: string | null
  seller_item_id?: string | null
  item_title?: string | null
  item_size?: string | null
  garment_type?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  currency?: string | null
  fulfillment_fee?: number | null
  consultation_fee?: number | null
  special_note?: string | null
  payment_intent_id?: string | null
  delivery_method?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_intent_id?: string | null
}

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION' | 'MATERIAL_ADVANCE' | 'TIP'

type StripeTransferObject = {
  id: string
  amount?: number | null
  currency?: string | null
  metadata?: Record<string, string> | null
}

type StripePayoutObject = {
  id: string
  amount?: number | null
  currency?: string | null
  status?: string | null
  arrival_date?: number | null
  failure_code?: string | null
  failure_message?: string | null
  metadata?: Record<string, string> | null
}

type StripeDisputeObject = {
  id: string
  amount?: number | null
  currency?: string | null
  status?: string | null
  reason?: string | null
  charge?: string | { id?: string | null } | null
  payment_intent?: string | null
  evidence_details?: { due_by?: number | null } | null
  metadata?: Record<string, string> | null
}

type TailorStripePayoutProfile = {
  id: string
  user_id: string | null
  payout_account_verified: boolean | null
  payout_reverification_required: boolean | null
}

function isStripePaymentIntent(value: unknown): value is StripePaymentIntent {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isStripeTransferObject(value: unknown): value is StripeTransferObject {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isStripePayoutObject(value: unknown): value is StripePayoutObject {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isStripeRefundObject(value: unknown): value is StripeRefund {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isStripeDisputeObject(value: unknown): value is StripeDisputeObject {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function stripeDisputeStatus(value: string | null | undefined) {
  switch (value?.trim().toLowerCase()) {
    case 'needs_response': return 'NEEDS_RESPONSE'
    case 'under_review': return 'UNDER_REVIEW'
    case 'won': return 'WON'
    case 'lost': return 'LOST'
    case 'warning_closed': return 'WARNING_CLOSED'
    default: return 'UNKNOWN'
  }
}

function isStripeConnectAccount(value: unknown): value is StripeConnectAccount {
  return !!value
    && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { charges_enabled?: unknown }).charges_enabled === 'boolean'
    && typeof (value as { payouts_enabled?: unknown }).payouts_enabled === 'boolean'
}

async function findTailorProfileForStripeAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<TailorStripePayoutProfile | null> {
  const select = 'id, user_id, payout_account_verified, payout_reverification_required'
  const byConnect = await supabase
    .from('tailor_profiles')
    .select(select)
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle()

  if (byConnect.error) throw new Error(byConnect.error.message)
  if (byConnect.data?.id) return byConnect.data as TailorStripePayoutProfile

  const byLegacy = await supabase
    .from('tailor_profiles')
    .select(select)
    .eq('stripe_account_id', accountId)
    .maybeSingle()

  if (byLegacy.error) throw new Error(byLegacy.error.message)
  return (byLegacy.data as TailorStripePayoutProfile | null) ?? null
}

async function handleStripeConnectAccountUpdated(
  supabase: SupabaseClient,
  input: {
    event: StripeEvent
    account: StripeConnectAccount
    webhookEventId: string
  },
) {
  const profile = await findTailorProfileForStripeAccount(supabase, input.account.id)
  if (!profile?.id) {
    await markWebhookEventProcessed(supabase, input.webhookEventId, {
      orderId: null,
      paymentId: null,
      processingResult: 'missing_tailor_profile',
    })
    await audit(supabase, {
      event: 'seller.payout_account_webhook_missing',
      actor_role: 'SYSTEM',
      severity: 'warn',
      payload: {
        function: FN,
        provider: 'STRIPE',
        stripe_event_id: input.event.id,
        stripe_event_type: input.event.type,
        stripe_connect_account_id: input.account.id,
      },
    })
    return { profile: null, verified: false, notified: false }
  }

  const verified = input.account.charges_enabled === true && input.account.payouts_enabled === true
  const shouldNotify = profile.payout_account_verified !== verified
    || (verified && profile.payout_reverification_required === true)
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = {
    payout_account_type: 'STRIPE_CONNECT',
    payout_account_verified: verified,
    payout_reverification_required: verified ? false : true,
    payout_account_verified_at: verified ? nowIso : null,
    stripe_connect_account_id: input.account.id,
    stripe_account_id: input.account.id,
  }

  if (typeof input.account.country === 'string' && input.account.country.trim()) {
    patch.payout_country_code = input.account.country.trim().toUpperCase()
  }

  const { error: updateError } = await supabase
    .from('tailor_profiles')
    .update(patch)
    .eq('id', profile.id)

  if (updateError) throw new Error(updateError.message)

  await markWebhookEventProcessed(supabase, input.webhookEventId, {
    orderId: null,
    paymentId: null,
    processingResult: verified ? 'connect_account_verified' : 'connect_account_pending',
  })

  await audit(supabase, {
    event: verified ? 'seller.payout_account_verified' : 'seller.payout_account_update',
    actor_role: 'SYSTEM',
    severity: verified ? 'info' : 'warn',
    payload: {
      function: FN,
      provider: 'STRIPE',
      stripe_event_id: input.event.id,
      stripe_event_type: input.event.type,
      stripe_connect_account_id: input.account.id,
      tailor_profile_id: profile.id,
      charges_enabled: input.account.charges_enabled,
      payouts_enabled: input.account.payouts_enabled,
      details_submitted: input.account.details_submitted ?? null,
    },
  })

  if (shouldNotify && profile.user_id) {
    const title = verified ? 'Stripe payouts are ready' : 'Stripe payout setup needs attention'
    const body = verified
      ? 'Your Stripe payout account is verified. Eligible earnings can now be released to Stripe and tracked through bank arrival.'
      : 'Stripe says this payout account is not ready. Open Payout setup to finish the requested verification; eligible earnings remain protected.'
    EdgeRuntime.waitUntil(Promise.all([
      enqueuePushJob(supabase, {
        userId: profile.user_id,
        source: FN,
        idempotencyKey: `stripe-connect:${input.event.id}:push`,
        priority: verified ? 30 : 5,
        notification: {
          title,
          body,
          preferenceKey: 'paymentReleased',
          data: { url: '/profile/payout-setup', tailorProfileId: profile.id },
        },
      }),
      enqueueTailorPayoutAccountEmail(supabase, {
        userId: profile.user_id,
        eventId: input.event.id,
        subject: title,
        headline: title,
        body,
        details: [
          { label: 'Provider', value: 'Stripe' },
          { label: 'Payout status', value: verified ? 'Verified and ready' : 'Action required' },
        ],
      }),
      verified
        ? Promise.resolve(false)
        : enqueueSmsJob(supabase, {
            userId: profile.user_id,
            audience: 'TAILOR',
            event: 'PAYOUT_SETUP_NEEDS_ATTENTION',
            body: buildPayoutSetupNeedsAttentionSms('Stripe'),
            source: FN,
            idempotencyKey: `stripe-connect:${input.event.id}:sms`,
            priority: 5,
          }),
    ]))
  }

  return { profile, verified, notified: shouldNotify }
}

async function findPayoutForStripeTransfer(supabase: SupabaseClient, transfer: StripeTransferObject) {
  const payoutId =
    typeof transfer.metadata?.payout_id === 'string' && transfer.metadata.payout_id.trim().length > 0
      ? transfer.metadata.payout_id.trim()
      : ''

  if (payoutId) {
    const { data, error } = await supabase
      .from('payouts')
      .select('id, order_id, status, provider_payout_id, material_advance_id')
      .eq('id', payoutId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data?.id) {
      return data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null; material_advance_id: string | null }
    }
  }

  const { data, error } = await supabase
    .from('payouts')
    .select('id, order_id, status, provider_payout_id, material_advance_id')
    .eq('provider', 'STRIPE')
    .eq('provider_payout_id', transfer.id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { id: string; order_id: string | null; status: string; provider_payout_id: string | null; material_advance_id: string | null } | null) ?? null
}

async function findExactPayoutForStripeBankPayout(
  supabase: SupabaseClient,
  bankPayout: StripePayoutObject,
) {
  const payoutId = bankPayout.metadata?.drapeon_payout_id?.trim()
    || bankPayout.metadata?.payout_id?.trim()
    || ''
  if (payoutId) {
    const { data, error } = await supabase
      .from('payouts')
      .select('id,order_id,status,provider_payout_id,provider_bank_payout_id,provider_destination_id,material_advance_id')
      .eq('id', payoutId)
      .eq('provider', 'STRIPE')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data?.id) return data
  }

  const { data, error } = await supabase
    .from('payouts')
    .select('id,order_id,status,provider_payout_id,provider_bank_payout_id,provider_destination_id,material_advance_id')
    .eq('provider', 'STRIPE')
    .eq('provider_bank_payout_id', bankPayout.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

function stripeArrivalIso(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null
}

function stripeBankSettlementStatus(eventType: string, payout: StripePayoutObject) {
  const status = payout.status?.trim().toLowerCase()
  if (eventType === 'payout.paid' || status === 'paid') return 'PAID'
  if (eventType === 'payout.failed' || status === 'failed') return 'FAILED'
  if (eventType === 'payout.canceled' || status === 'canceled') return 'CANCELED'
  if (status === 'in_transit') return 'IN_TRANSIT'
  return 'PENDING'
}

async function enqueueTailorPayoutAccountEmail(
  supabase: SupabaseClient,
  input: {
    userId: string
    eventId: string
    subject: string
    headline: string
    body: string
    details: Array<{ label: string; value: string }>
  },
) {
  await enqueueBackgroundJob(supabase, {
    eventType: 'STRIPE_BANK_PAYOUT_UPDATE',
    aggregateType: 'USER',
    aggregateId: input.userId,
    actorRole: 'SYSTEM',
    idempotencyKey: `stripe-bank-payout:${input.eventId}:email`,
    jobType: 'SEND_ACCOUNT_EVENT_EMAIL',
    priority: 20,
    payload: {
      userId: input.userId,
      subject: input.subject,
      headline: input.headline,
      eyebrow: 'Payout update',
      body: input.body,
      ctaLabel: 'View earnings',
      webPath: '/account/earnings',
      appUrl: 'drape://earnings',
      details: input.details,
    },
  })
}

async function handleStripeBankPayout(
  supabase: SupabaseClient,
  input: {
    event: StripeEvent
    bankPayout: StripePayoutObject
    webhookEventId: string
  },
) {
  const destinationId = input.event.account?.trim() || null
  const profile = destinationId
    ? await findTailorProfileForStripeAccount(supabase, destinationId)
    : null
  const payout = await findExactPayoutForStripeBankPayout(supabase, input.bankPayout)
  const bankStatus = stripeBankSettlementStatus(input.event.type, input.bankPayout)
  const arrivalAt = stripeArrivalIso(input.bankPayout.arrival_date)
  const nowIso = new Date().toISOString()

  const { error: providerEventError } = await supabase
    .from('provider_payout_events')
    .upsert({
      provider: 'STRIPE',
      provider_event_id: input.event.id,
      event_type: input.event.type,
      provider_destination_id: destinationId,
      provider_bank_payout_id: input.bankPayout.id,
      payout_id: payout?.id ?? null,
      tailor_profile_id: profile?.id ?? null,
      amount: typeof input.bankPayout.amount === 'number' ? input.bankPayout.amount : null,
      currency: input.bankPayout.currency?.toUpperCase() ?? null,
      status: bankStatus,
      arrival_at: arrivalAt,
      failure_code: input.bankPayout.failure_code ?? null,
      failure_message: input.bankPayout.failure_message ?? null,
      payload: input.event as Record<string, unknown>,
      processed_at: nowIso,
    }, { onConflict: 'provider,provider_event_id' })
  if (providerEventError) throw new Error(providerEventError.message)

  if (payout?.id) {
    const patch: Record<string, unknown> = {
      status: bankStatus === 'PAID'
        ? 'PAID'
        : bankStatus === 'FAILED'
          ? 'FAILED'
          : bankStatus === 'CANCELED'
            ? 'CANCELED'
            : 'PROCESSING',
      provider_bank_payout_id: input.bankPayout.id,
      provider_destination_id: destinationId ?? payout.provider_destination_id ?? null,
      bank_settlement_status: bankStatus,
      bank_settlement_expected_at: arrivalAt,
      provider_response: input.event as Record<string, unknown>,
      processed_at: nowIso,
    }
    if (bankStatus === 'PAID') {
      patch.provider_transfer_status = 'PAID_TO_BANK'
      patch.bank_settlement_completed_at = nowIso
      patch.completed_at = nowIso
      patch.failed_at = null
      patch.blocked_reason = null
    } else if (bankStatus === 'FAILED' || bankStatus === 'CANCELED') {
      patch.bank_settlement_failed_at = nowIso
      patch.bank_settlement_failure_code = input.bankPayout.failure_code ?? bankStatus
      patch.failed_at = nowIso
      patch.blocked_reason = `STRIPE_BANK_PAYOUT_${bankStatus}`
    }
    const { error } = await supabase.from('payouts').update(patch).eq('id', payout.id)
    if (error) throw new Error(error.message)
  }

  await markWebhookEventProcessed(supabase, input.webhookEventId, {
    orderId: payout?.order_id ?? null,
    paymentId: null,
    processingResult: payout?.id
      ? `stripe_bank_payout:${bankStatus.toLowerCase()}`
      : `stripe_account_payout:${bankStatus.toLowerCase()}:unlinked`,
  })

  await audit(supabase, {
    event: payout?.id ? 'payout.bank_settlement_update' : 'payout.account_settlement_update',
    actor_role: 'SYSTEM',
    order_id: payout?.order_id ?? null,
    severity: bankStatus === 'FAILED' || bankStatus === 'CANCELED' ? 'error' : 'info',
    payload: {
      function: FN,
      provider: 'STRIPE',
      stripe_event_id: input.event.id,
      stripe_event_type: input.event.type,
      stripe_connect_account_id: destinationId,
      stripe_bank_payout_id: input.bankPayout.id,
      payout_id: payout?.id ?? null,
      exact_order_link: !!payout?.id,
      bank_settlement_status: bankStatus,
    },
  })

  if (profile?.user_id) {
    const failed = bankStatus === 'FAILED' || bankStatus === 'CANCELED'
    const paid = bankStatus === 'PAID'
    const inTransit = bankStatus === 'IN_TRANSIT'
    const title = failed
      ? 'Bank payout needs attention'
      : paid
        ? 'Payout reached your bank'
        : inTransit
          ? 'Bank payout is on the way'
          : 'Stripe is preparing your bank payout'
    const body = failed
      ? 'Stripe could not complete this bank payout. Review Earnings for the reason and next step; Drapeon Ops has also been alerted.'
      : paid
        ? 'Stripe confirmed this payout reached your bank destination.'
        : inTransit
          ? `Stripe is sending your released earnings to your bank${arrivalAt ? `, with an estimated arrival of ${new Date(arrivalAt).toLocaleDateString('en-US')}` : ''}.`
          : 'Stripe created the bank payout and is preparing it for bank processing. We will confirm when it starts moving.'
    const amount = typeof input.bankPayout.amount === 'number'
      ? `${input.bankPayout.currency?.toUpperCase() ?? ''} ${(input.bankPayout.amount / 100).toFixed(2)}`.trim()
      : 'Not provided'
    await Promise.all([
      enqueuePushJob(supabase, {
        userId: profile.user_id,
        source: FN,
        orderId: payout?.order_id ?? null,
        idempotencyKey: `stripe-bank-payout:${input.event.id}:push`,
        priority: failed ? 5 : 25,
        notification: {
          title,
          body,
          preferenceKey: 'paymentReleased',
          data: { url: '/earnings', payoutId: payout?.id ?? '', bankPayoutId: input.bankPayout.id },
        },
      }),
      enqueueTailorPayoutAccountEmail(supabase, {
        userId: profile.user_id,
        eventId: input.event.id,
        subject: title,
        headline: title,
        body,
        details: [
          { label: 'Amount', value: amount },
          { label: 'Status', value: bankStatus === 'PAID' ? 'Paid to bank' : failed ? 'Needs attention' : inTransit ? 'In transit' : 'Preparing' },
          ...(arrivalAt ? [{ label: 'Estimated arrival', value: new Date(arrivalAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' }) }] : []),
        ],
      }),
      failed
        ? enqueueSmsJob(supabase, {
            userId: profile.user_id,
            audience: 'TAILOR',
            event: 'PAYOUT_FAILED',
            body: buildPayoutFailedSms({ provider: 'Stripe', reference: payout?.id ?? input.bankPayout.id }),
            source: FN,
            orderId: payout?.order_id ?? null,
            idempotencyKey: `stripe-bank-payout:${input.event.id}:sms`,
            priority: 5,
          })
        : Promise.resolve(false),
    ])
  }

  if ((bankStatus === 'FAILED' || bankStatus === 'CANCELED') && payout?.id) {
    await recordProviderPayoutFailure(supabase, {
      payoutId: payout.id,
      orderId: payout.order_id ?? null,
      providerPayoutId: input.bankPayout.id,
      eventType: input.event.type,
    })
    await Sentry.captureMessage('Stripe bank payout reached a failed terminal state', {
      level: 'error',
      tags: { function: FN, provider: 'STRIPE', event_type: input.event.type, bank_settlement_status: bankStatus },
      extra: {
        provider_event_id: input.event.id,
        provider_bank_payout_id: input.bankPayout.id,
        payout_id: payout.id,
        order_id: payout.order_id,
      },
    })
  }

  if (payout?.id && ['PAID', 'FAILED', 'CANCELED'].includes(bankStatus)) {
    await resolveOpsIssueByDedupeKey(supabase, `stripe-bank-settlement-stale:${payout.id}`, {
      payout_id: payout.id,
      provider_bank_payout_id: input.bankPayout.id,
      terminal_status: bankStatus,
      provider_event_id: input.event.id,
    })
  }

  return { payout, profile, bankStatus }
}

async function finalizeFundedFabricRelease(
  supabase: SupabaseClient,
  payout: { id: string; material_advance_id: string | null },
  reference: string,
  outcome: 'SUCCEEDED' | 'REVERSED',
  providerResponse: Record<string, unknown>,
) {
  if (!payout.material_advance_id) return
  const { data: advance } = await supabase.from('order_material_advances')
    .select('money_desk_request_id,funding_source').eq('id', payout.material_advance_id).maybeSingle()
  if (advance?.funding_source !== 'FUNDED_FABRIC_ALLOWANCE') return
  const { error } = await supabase.rpc('record_funded_fabric_provider_outcome', {
    p_advance_id: payout.material_advance_id,
    p_payout_id: payout.id,
    p_provider_reference: reference,
    p_outcome: outcome,
    p_provider_response: providerResponse,
  })
  if (error) throw new Error(error.message)
  if (advance.money_desk_request_id) {
    const { data: attempt } = await supabase.from('money_desk_execution_attempts')
      .select('id').eq('request_id', advance.money_desk_request_id).eq('status', 'PROCESSING')
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (attempt?.id) {
      const { error: completeError } = await supabase.rpc('complete_money_desk_execution', {
        p_attempt_id: attempt.id,
        p_status: outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        p_provider_reference: reference,
        p_failure_code: outcome === 'SUCCEEDED' ? null : 'PROVIDER_TRANSFER_REVERSED',
        p_failure_summary: outcome === 'SUCCEEDED' ? null : 'Stripe reported a terminal transfer reversal.',
      })
      if (completeError) throw new Error(completeError.message)
    }
  }
  if (outcome === 'REVERSED') {
    const { data: advanceOrder } = await supabase.from('order_material_advances').select('order_id').eq('id', payout.material_advance_id).maybeSingle()
    const { data: materialOrder } = advanceOrder?.order_id
      ? await supabase.from('orders').select('id,customer_id,tailor_id').eq('id', advanceOrder.order_id).maybeSingle()
      : { data: null }
    if (materialOrder?.id) {
      const title = 'Fabric release reversed'
      const customerBody = 'Stripe reversed the approved fabric release. Drapeon Ops is reconciling the protected allowance before any further money movement.'
      const tailorBody = 'Stripe reversed the fabric release. Do not make a duplicate request or purchase until Drapeon Ops confirms the next step.'
      await Promise.all([
        enqueuePushJob(supabase, { userId: materialOrder.customer_id, orderId: materialOrder.id, source: FN, idempotencyKey: `funded-fabric-reversed:customer:${payout.material_advance_id}`, priority: 8, notification: { title, body: customerBody, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: materialOrder.id, advanceId: payout.material_advance_id, action: 'RELEASE_FAILED' } } }),
        enqueuePushJob(supabase, { userId: materialOrder.tailor_id, orderId: materialOrder.id, source: FN, idempotencyKey: `funded-fabric-reversed:tailor:${payout.material_advance_id}`, priority: 8, notification: { title, body: tailorBody, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: materialOrder.id, advanceId: payout.material_advance_id, action: 'RELEASE_FAILED' } } }),
        enqueueOrderEventEmailJob(supabase, { recipientUserId: materialOrder.customer_id, audience: 'CUSTOMER', order: { id: materialOrder.id }, subject: title, headline: title, body: customerBody, ctaLabel: 'View order', materialAdvanceId: payout.material_advance_id, action: 'RELEASE_FAILED', source: FN, priority: 8, idempotencyKey: `funded-fabric-reversed:customer:${payout.material_advance_id}` }),
        enqueueOrderEventEmailJob(supabase, { recipientUserId: materialOrder.tailor_id, audience: 'TAILOR', order: { id: materialOrder.id }, subject: title, headline: title, body: tailorBody, ctaLabel: 'View order', materialAdvanceId: payout.material_advance_id, action: 'RELEASE_FAILED', source: FN, priority: 8, idempotencyKey: `funded-fabric-reversed:tailor:${payout.material_advance_id}` }),
      ])
    }
  }
}

async function recordProviderPayoutFailure(
  supabase: SupabaseClient,
  input: {
    payoutId: string
    orderId: string | null
    providerPayoutId: string
    eventType: string
  },
) {
  let tailorId: string | null = null
  let orderReference: string | null = null

  if (input.orderId) {
    const { data } = await supabase
      .from('orders')
      .select('tailor_id, reference')
      .eq('id', input.orderId)
      .maybeSingle()

    tailorId = typeof data?.tailor_id === 'string' ? data.tailor_id : null
    orderReference = typeof data?.reference === 'string' ? data.reference : null
  }

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_FAILED',
    severity: 'CRITICAL',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: input.orderId,
    userId: tailorId,
    provider: 'STRIPE',
    title: 'Stripe payout failed',
    description: input.eventType === 'transfer.reversed'
      ? `Stripe reversed a connected-account transfer for order ${orderReference ?? input.orderId ?? 'unknown'}.`
      : `Stripe could not complete a bank payout for order ${orderReference ?? input.orderId ?? 'unknown'}.`,
    recommendedAction: input.eventType === 'transfer.reversed'
      ? 'Review the Stripe transfer and reversal, reconcile any provider debit, and use Money Desk before attempting recovery.'
      : 'Review the Stripe bank-payout failure code, confirm the payout destination is usable, and retry only through the reviewed recovery path.',
    dedupeKey: `payout-failed:${input.payoutId}`,
    metadata: {
      provider: 'STRIPE',
      payout_id: input.payoutId,
      provider_payout_id: input.providerPayoutId,
      stripe_event_type: input.eventType,
    },
  })

  if (tailorId && input.orderId) {
    await sendPushToUser(supabase, tailorId, {
      title: 'Payout needs review',
      body: 'A payout release for this order needs Drapeon ops review before it can be retried.',
      data: { orderId: input.orderId },
    })
  }
}

async function findOrderForPaymentIntent(supabase: SupabaseClient, paymentIntent: StripePaymentIntent) {
  const metadataOrderId =
    typeof paymentIntent.metadata?.order_id === 'string' && paymentIntent.metadata.order_id.trim().length > 0
      ? paymentIntent.metadata.order_id.trim()
      : ''

  if (metadataOrderId) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
      .eq('id', metadataOrderId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (data?.id) return data as OrderRow
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (data?.id) return data as OrderRow

  const { data: fulfillmentData, error: fulfillmentError } = await supabase
    .from('orders')
    .select('id, reference, stage, order_kind, tailor_id, customer_id, seller_item_id, item_title, item_size, garment_type, quoted_amount, quoted_currency, currency, fulfillment_fee, consultation_fee, special_note, payment_intent_id, delivery_method, fulfillment_payment_paid_at, fulfillment_payment_intent_id')
    .eq('fulfillment_payment_intent_id', paymentIntent.id)
    .maybeSingle()

  if (fulfillmentError) {
    throw new Error(fulfillmentError.message)
  }

  return fulfillmentData as OrderRow | null
}

function paymentPhaseForIntent(order: OrderRow, paymentIntent: StripePaymentIntent): PaymentPhase {
  const metadataPhase =
    typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'CONSULTATION'
      ? 'CONSULTATION'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'FULFILLMENT'
      ? 'FULFILLMENT'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'MATERIAL_ADVANCE'
      ? 'MATERIAL_ADVANCE'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'INITIAL_ORDER'
        ? 'INITIAL_ORDER'
      : typeof paymentIntent.metadata?.payment_phase === 'string' && paymentIntent.metadata.payment_phase === 'TIP'
        ? 'TIP'
        : null

  if (metadataPhase) return metadataPhase
  if (parseOrderSupportMeta(order.special_note).consultation?.paymentIntentId === paymentIntent.id) return 'CONSULTATION'
  if (order.fulfillment_payment_intent_id === paymentIntent.id) return 'FULFILLMENT'
  return 'INITIAL_ORDER'
}

async function markMaterialAdvancePayment(
  supabase: SupabaseClient,
  order: OrderRow,
  paymentIntent: StripePaymentIntent,
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELED',
) {
  const advanceId =
    typeof paymentIntent.metadata?.material_advance_id === 'string' && paymentIntent.metadata.material_advance_id.trim().length > 0
      ? paymentIntent.metadata.material_advance_id.trim()
      : ''

  let query = supabase
    .from('order_material_advances')
    .select('id, title, status, paid_at')
    .eq('order_id', order.id)

  query = advanceId
    ? query.eq('id', advanceId)
    : query.eq('payment_provider', 'STRIPE').eq('provider_payment_id', paymentIntent.id)

  const { data: advance, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!advance?.id) return false

  if (status !== 'SUCCEEDED') {
    const { error: updateError } = await supabase
      .from('order_material_advances')
      .update({
        status: 'PAYMENT_FAILED',
      })
      .eq('id', advance.id)
      .in('status', ['PAYMENT_PENDING', 'PAYMENT_FAILED'])
    if (updateError) throw new Error(updateError.message)
    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: `Material advance payment failed for ${advance.title ?? 'materials'}.`,
    })
    return true
  }

  if (advance.paid_at || advance.status === 'OPS_REVIEW' || advance.status === 'RELEASED') return false

  const { data: updated, error: updateError } = await supabase
    .from('order_material_advances')
    .update({
      status: 'OPS_REVIEW',
      release_status: 'OPS_REVIEW',
      payment_provider: 'STRIPE',
      provider_payment_id: paymentIntent.id,
      provider_checkout_url: null,
      paid_at: new Date().toISOString(),
      release_requested_at: new Date().toISOString(),
    })
    .eq('id', advance.id)
    .in('status', ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW'])
    .select('id')
    .maybeSingle()

  if (updateError) throw new Error(updateError.message)
  if (!updated?.id) return false

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: order.stage,
    note: `Material advance paid for ${advance.title ?? 'materials'}. Drapeon ops will review release before funds move.`,
  })

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'ORDER_REVIEW',
    severity: 'HIGH',
    source: FN,
    actorRole: 'SYSTEM',
    orderId: order.id,
    userId: order.tailor_id ?? null,
    provider: 'STRIPE',
    title: 'Material advance paid',
    description: `Customer paid a material advance for order ${order.reference ?? order.id}. Ops must review before releasing this material amount to the tailor.`,
    recommendedAction: 'Confirm the expense is valid for the order, release only this material amount if appropriate, and require receipt proof after purchase.',
    dedupeKey: `material-advance:paid-release-review:${advance.id}`,
    relatedEntityType: 'order_material_advance',
    relatedEntityId: advance.id,
    metadata: {
      material_advance_id: advance.id,
      provider_payment_id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    },
  })

  return true
}

type OrderPaymentPhase = Exclude<PaymentPhase, 'MATERIAL_ADVANCE' | 'TIP'>

async function markOrderConfirmed(supabase: SupabaseClient, order: OrderRow, paymentIntent: StripePaymentIntent, phase: OrderPaymentPhase) {
  if (phase === 'INITIAL_ORDER' && order.stage === 'CONFIRMED') return false
  if (phase === 'FULFILLMENT' && order.fulfillment_payment_paid_at) {
    await finalizeDispatchShortfallFunding(supabase, {
      orderId: order.id,
      actorRole: 'SYSTEM',
      provider: 'STRIPE',
      providerPaymentId: paymentIntent.id,
    })
    return false
  }

  if (phase === 'CONSULTATION') {
    const supportMeta = parseOrderSupportMeta(order.special_note)
    const consultation = supportMeta.consultation
    if (consultation?.paidAt) {
      await supabase.from('consultation_bookings').update({ payment_status: 'PAID', paid_at: consultation.paidAt, settlement_status: 'HELD' }).eq('order_id', order.id).eq('status', 'CONFIRMED')
      return false
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        special_note: serializeOrderSupportMeta({
          ...supportMeta,
          consultation: consultation
            ? {
                ...consultation,
                paymentProvider: 'STRIPE',
                paymentIntentId: paymentIntent.id,
                paymentCheckoutUrl: null,
                paidAt: new Date().toISOString(),
              }
            : consultation,
        }),
      })
      .eq('id', order.id)
      .select('id')
      .maybeSingle()

    if (updateError) throw new Error(updateError.message)
    if (!updatedOrder?.id) return false

    await supabase.from('consultation_bookings').update({
      payment_status: 'PAID',
      paid_at: new Date().toISOString(),
      settlement_status: 'HELD',
      updated_at: new Date().toISOString(),
    }).eq('order_id', order.id).eq('status', 'CONFIRMED')

    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: 'Consultation fee paid. The consultation can start at the scheduled time.',
    })

    if (order.tailor_id) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, order.tailor_id.toString(), {
          title: 'Consultation fee paid',
          body: 'The customer paid the consultation fee. The call can start at the scheduled time.',
          preferenceKey: 'newOrders',
          data: { orderId: order.id },
        }),
      )
    }

    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase,
      source: FN,
      provider: 'STRIPE',
    })

    return true
  }

  if (phase === 'FULFILLMENT') {
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update({
        fulfillment_payment_provider: 'STRIPE',
        fulfillment_payment_intent_id: paymentIntent.id,
        fulfillment_payment_checkout_url: null,
        fulfillment_payment_paid_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .is('fulfillment_payment_paid_at', null)
      .select('id')
      .maybeSingle()

    if (updateError) {
      throw new Error(updateError.message)
    }

    if (!updatedOrder?.id) return false

    await finalizeDispatchShortfallFunding(supabase, {
      orderId: order.id,
      actorRole: 'SYSTEM',
      provider: 'STRIPE',
      providerPaymentId: paymentIntent.id,
    })

    await supabase.from('order_stage_updates').insert({
      order_id: order.id,
      stage: order.stage,
      note: fulfillmentPaymentConfirmedStageNote(order.delivery_method),
    })

    if (order.tailor_id) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, order.tailor_id.toString(), {
          ...tailorFulfillmentPaymentConfirmedNotification(order.delivery_method),
          preferenceKey: 'newOrders',
          data: { orderId: order.id },
        }),
      )
      EdgeRuntime.waitUntil(
        sendSmsToUser({
          supabase,
          userId: order.tailor_id.toString(),
          audience: 'TAILOR',
          orderId: order.id,
          event: 'order.fulfillment_payment_confirmed',
          body: buildTailorOrderPaymentSms({
            id: order.id,
            reference: order.reference,
            orderKind: order.order_kind,
            garmentType: order.garment_type,
            itemTitle: order.item_title,
            itemSize: order.item_size,
            deliveryMethod: order.delivery_method,
          }, phase),
        }),
      )
    }

    if (order.customer_id) {
      EdgeRuntime.waitUntil(
        sendSmsToUser({
          supabase,
          userId: order.customer_id.toString(),
          audience: 'CUSTOMER',
          orderId: order.id,
          event: 'order.fulfillment_payment_confirmed',
          body: buildCustomerOrderPaymentSms({
            id: order.id,
            reference: order.reference,
            orderKind: order.order_kind,
            garmentType: order.garment_type,
            itemTitle: order.item_title,
            itemSize: order.item_size,
            deliveryMethod: order.delivery_method,
          }, phase),
        }),
      )
    }

    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase,
      source: FN,
      provider: 'STRIPE',
    })

    return true
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      stage: 'CONFIRMED',
      stage_updated_at: new Date().toISOString(),
      payment_provider: 'STRIPE',
      payment_intent_id: paymentIntent.id,
      payment_checkout_url: null,
    })
    .eq('id', order.id)
    .eq('stage', order.stage)
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message)
  }

  if (!updatedOrder?.id) return false

  await supabase.from('order_stage_updates').insert({
    order_id: order.id,
    stage: 'CONFIRMED',
    note: paymentConfirmedStageNote(order.order_kind),
  })

  if (order.tailor_id) {
    EdgeRuntime.waitUntil(
      sendPushToUser(supabase, order.tailor_id.toString(), {
        ...tailorPaymentConfirmedNotification(order.order_kind),
        preferenceKey: 'newOrders',
        data: { orderId: order.id },
      }),
    )
    EdgeRuntime.waitUntil(
      sendSmsToUser({
        supabase,
        userId: order.tailor_id.toString(),
        audience: 'TAILOR',
        orderId: order.id,
        event: 'order.payment_confirmed',
        body: buildTailorOrderPaymentSms({
          id: order.id,
          reference: order.reference,
          orderKind: order.order_kind,
          garmentType: order.garment_type,
          itemTitle: order.item_title,
          itemSize: order.item_size,
          deliveryMethod: order.delivery_method,
        }, phase),
      }),
    )
    EdgeRuntime.waitUntil(
      notifyTailorAboutReadyMadeStockChange(supabase, {
        orderKind: order.order_kind,
        sellerItemId: order.seller_item_id,
        tailorId: order.tailor_id?.toString() ?? null,
        itemTitle: order.item_title,
        itemSize: order.item_size,
      }),
    )
  }

  if (order.customer_id) {
    EdgeRuntime.waitUntil(
      sendSmsToUser({
        supabase,
        userId: order.customer_id.toString(),
        audience: 'CUSTOMER',
        orderId: order.id,
        event: 'order.payment_confirmed',
        body: buildCustomerOrderPaymentSms({
          id: order.id,
          reference: order.reference,
          orderKind: order.order_kind,
          garmentType: order.garment_type,
          itemTitle: order.item_title,
          itemSize: order.item_size,
          deliveryMethod: order.delivery_method,
        }, phase),
      }),
    )
  }

  await enqueueOrderConfirmationEmailJob(supabase, {
    order,
    phase,
    source: FN,
    provider: 'STRIPE',
  })

  return true
}

function isInitialPaymentStage(stage: string) {
  return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED'].includes(stage)
}

function isFulfillmentPaymentStage(order: OrderRow) {
  return order.stage === 'FINISHING' || !!order.fulfillment_payment_paid_at
}

async function handleStripeRefundLifecycle(
  supabase: SupabaseClient,
  input: { event: StripeEvent; refund: StripeRefund; webhookEventId: string },
) {
  const refundAmount = typeof input.refund.amount === 'number' ? input.refund.amount : 0
  const metadataPaymentId = input.refund.metadata?.drapeon_payment_id?.trim() || ''
  const byMetadata = metadataPaymentId
    ? await supabase
      .from('order_payments')
      .select('id,order_id,phase,provider,currency,amount,status,provider_payment_id,provider_response,refunded_amount,partial_refund_count,correlation_id')
      .eq('id', metadataPaymentId)
      .eq('provider', 'STRIPE')
      .maybeSingle()
    : { data: null, error: null }
  if (byMetadata.error) throw byMetadata.error
  const byIntent = !byMetadata.data?.id && input.refund.payment_intent
    ? await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', input.refund.payment_intent).catch(() => null)
    : null
  const paymentId = byMetadata.data?.id ?? byIntent?.id ?? null
  const { data: payment, error: paymentError } = paymentId && !byMetadata.data?.id
    ? await supabase
      .from('order_payments')
      .select('id,order_id,phase,provider,currency,amount,status,provider_payment_id,provider_response,refunded_amount,partial_refund_count,correlation_id')
      .eq('id', paymentId)
      .maybeSingle()
    : { data: byMetadata.data, error: null }
  if (paymentError) throw paymentError

  if (!payment?.id || !payment.order_id || !Number.isFinite(refundAmount) || refundAmount <= 0) {
    await markWebhookEventProcessed(supabase, input.webhookEventId, {
      orderId: payment?.order_id ?? null,
      paymentId: payment?.id ?? null,
      processingResult: 'stripe_refund_invalid_or_unmatched',
    })
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'REFUND_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId: payment?.order_id ?? null, provider: 'STRIPE',
      title: 'Stripe refund webhook could not be matched',
      description: 'A Stripe refund lifecycle event arrived without a safe payment and amount match.',
      recommendedAction: 'Match the Stripe refund and original payment manually before changing any Drapeon payment or ledger state. Do not create another refund.',
      dedupeKey: `stripe-refund-unmatched:${input.refund.id}`,
      metadata: { stripe_event_id: input.event.id, refund_id: input.refund.id, refund_amount: refundAmount },
    })
    return { matched: false, status: input.refund.status ?? 'unknown' }
  }

  const existingProviderResponse = payment.provider_response && typeof payment.provider_response === 'object'
    ? payment.provider_response as Record<string, unknown>
    : {}
  const latestRequest = existingProviderResponse.latest_refund_request && typeof existingProviderResponse.latest_refund_request === 'object'
    ? existingProviderResponse.latest_refund_request as Record<string, unknown>
    : null
  const resolutionId = input.refund.metadata?.refund_resolution_id?.trim()
    || (typeof latestRequest?.refund_resolution_id === 'string' ? latestRequest.refund_resolution_id : null)
  const pendingExactRestoration = latestRequest?.exact_restoration && typeof latestRequest.exact_restoration === 'object'
    ? latestRequest.exact_restoration as Record<string, unknown>
    : null
  if (latestRequest && latestRequest.refund_amount !== refundAmount) {
    throw new Error('Stripe refund webhook amount does not match the pending refund request.')
  }

  const latestRefund = existingProviderResponse.latest_refund && typeof existingProviderResponse.latest_refund === 'object'
    ? existingProviderResponse.latest_refund as Record<string, unknown>
    : null
  const latestResponse = latestRefund?.response && typeof latestRefund.response === 'object'
    ? latestRefund.response as Record<string, unknown>
    : null
  if (latestResponse?.id === input.refund.id && ['REFUNDED', 'PARTIAL_REFUND'].includes(payment.status)) {
    await markWebhookEventProcessed(supabase, input.webhookEventId, {
      orderId: payment.order_id,
      paymentId: payment.id,
      processingResult: 'stripe_refund_already_finalized',
    })
    return { matched: true, duplicate: true, status: 'succeeded' }
  }

  const status = input.refund.status?.trim().toLowerCase() || (input.event.type === 'refund.failed' ? 'failed' : 'pending')
  if (['pending', 'requires_action'].includes(status)) {
    await supabase.from('order_payments').update({
      provider_response: { ...existingProviderResponse, latest_refund_event: input.event },
    }).eq('id', payment.id)
    if (status === 'requires_action') {
      await createOrRefreshOpsIssue(supabase, {
        issueType: 'REFUND_FAILED', severity: 'HIGH', source: FN, actorRole: 'SYSTEM', orderId: payment.order_id, provider: 'STRIPE',
        title: 'Stripe refund needs attention',
        description: 'Stripe requires another step before this approved refund can continue.',
        recommendedAction: 'Review the Stripe refund reason and complete the requested provider action. Do not create a duplicate refund.',
        dedupeKey: `stripe-refund-needs-attention:${input.refund.id}`,
        metadata: { payment_id: payment.id, refund_id: input.refund.id, refund_amount: refundAmount, refund_resolution_id: resolutionId },
      })
    }
    await markWebhookEventProcessed(supabase, input.webhookEventId, { orderId: payment.order_id, paymentId: payment.id, processingResult: `stripe_refund_${status}` })
    return { matched: true, pending: true, status }
  }

  const isDispatchRefund = resolutionId?.startsWith('dispatch-refund:') ?? false
  const { data: resolution, error: resolutionError } = resolutionId && !isDispatchRefund
    ? await supabase.from('order_refund_resolutions')
      .select('id,financial_case_id,money_desk_request_id,amount,tailor_work_amount,platform_fee_amount,tax_amount,fulfillment_amount,consultation_amount,promotion_amount,drapeon_funded_amount,correlation_id,order_outcome,resume_stage,outcome_applied_at')
      .eq('id', resolutionId)
      .eq('order_id', payment.order_id)
      .maybeSingle()
    : { data: null, error: null }
  if (resolutionError) throw resolutionError
  if (resolution?.id && resolution.amount !== refundAmount) {
    throw new Error('Stripe refund webhook amount does not match the approved refund resolution.')
  }

  if (status === 'failed' || status === 'canceled') {
    const failureSummary = `Stripe reported that the refund ${status}.`
    if (resolution?.id) await supabase.from('order_refund_resolutions').update({ status: 'FAILED', failure_summary: failureSummary, updated_at: new Date().toISOString() }).eq('id', resolution.id)
    if (resolution?.money_desk_request_id) {
      const { data: attempt } = await supabase.from('money_desk_execution_attempts').select('id').eq('request_id', resolution.money_desk_request_id).eq('status', 'PROCESSING').order('started_at', { ascending: false }).limit(1).maybeSingle()
      if (attempt?.id) await supabase.rpc('complete_money_desk_execution', { p_attempt_id: attempt.id, p_status: 'FAILED', p_provider_reference: input.refund.id, p_failure_code: 'PROVIDER_REFUND_FAILED', p_failure_summary: failureSummary })
    }
    await createOrRefreshOpsIssue(supabase, {
      issueType: 'REFUND_FAILED', severity: 'CRITICAL', source: FN, actorRole: 'SYSTEM', orderId: payment.order_id, provider: 'STRIPE',
      title: 'Stripe refund failed',
      description: `Stripe did not complete approved refund ${input.refund.id}.`,
      recommendedAction: 'Review the provider failure reason and approved resolution before retrying. Do not create a blind duplicate.',
      dedupeKey: `stripe-refund-failed:${input.refund.id}`,
      metadata: { payment_id: payment.id, refund_id: input.refund.id, refund_amount: refundAmount, refund_resolution_id: resolutionId, failure_reason: input.refund.failure_reason ?? null },
    })
    const { data: order } = await supabase.from('orders').select('id,reference,customer_id,tailor_id').eq('id', payment.order_id).maybeSingle()
    if (order?.id) {
      for (const recipient of [{ id: order.customer_id, audience: 'CUSTOMER' as const }, { id: order.tailor_id, audience: 'TAILOR' as const }]) {
        if (!recipient.id) continue
        const body = recipient.audience === 'CUSTOMER'
          ? 'Stripe could not complete your approved refund. Your case remains open while Drapeon Ops reviews the provider reason; do not start another request.'
          : 'Stripe could not complete the approved customer refund. The order remains under review while Drapeon Ops checks the provider reason.'
        await enqueuePushJob(supabase, { userId: recipient.id, orderId: order.id, source: FN, idempotencyKey: `stripe-refund-failed:${input.refund.id}:${recipient.audience}:push`, priority: 5, notification: { title: 'Refund needs attention', body, preferenceKey: 'orderUpdates', data: { orderId: order.id, type: 'refund_failed', refundResolutionId: resolutionId ?? '' } } })
        await enqueueOrderEventEmailJob(supabase, { order, recipientUserId: recipient.id, audience: recipient.audience, subject: 'Refund needs attention', headline: 'Refund needs attention', body, ctaLabel: 'View resolution', source: FN, idempotencyKey: `stripe-refund-failed:${input.refund.id}:${recipient.audience}:email`, priority: 5 })
        if (recipient.audience === 'CUSTOMER') {
          await enqueueSmsJob(supabase, {
            userId: recipient.id,
            audience: 'CUSTOMER',
            event: 'REFUND_FAILED',
            body: buildRefundFailedSms({ provider: 'Stripe', orderReference: order.reference }),
            source: FN,
            orderId: order.id,
            idempotencyKey: `stripe-refund-failed:${input.refund.id}:customer:sms`,
            priority: 5,
          })
        }
      }
    }
    await markWebhookEventProcessed(supabase, input.webhookEventId, { orderId: payment.order_id, paymentId: payment.id, processingResult: `stripe_refund_${status}` })
    await markDispatchRefundTerminal(supabase, { resolutionId, succeeded: false, providerReference: input.refund.id })
    return { matched: true, failed: true, status }
  }

  if (status !== 'succeeded') {
    await markWebhookEventProcessed(supabase, input.webhookEventId, { orderId: payment.order_id, paymentId: payment.id, processingResult: `ignored:stripe_refund_${status}` })
    return { matched: true, ignored: true, status }
  }
  const exactRestoration = resolution?.id ? {
    refundResolutionId: resolution.id,
    tailorWorkAmount: resolution.tailor_work_amount,
    platformFeeAmount: resolution.platform_fee_amount,
    taxAmount: resolution.tax_amount,
    fulfillmentAmount: resolution.fulfillment_amount,
    consultationAmount: resolution.consultation_amount,
    promotionAmount: resolution.promotion_amount,
    drapeonFundedAmount: resolution.drapeon_funded_amount,
  } : pendingExactRestoration && resolutionId ? {
    refundResolutionId: resolutionId,
    tailorWorkAmount: Number(pendingExactRestoration.tailorWorkAmount ?? 0),
    platformFeeAmount: Number(pendingExactRestoration.platformFeeAmount ?? 0),
    taxAmount: Number(pendingExactRestoration.taxAmount ?? 0),
    fulfillmentAmount: Number(pendingExactRestoration.fulfillmentAmount ?? 0),
    consultationAmount: Number(pendingExactRestoration.consultationAmount ?? 0),
    promotionAmount: Number(pendingExactRestoration.promotionAmount ?? 0),
    drapeonFundedAmount: Number(pendingExactRestoration.drapeonFundedAmount ?? 0),
  } : undefined
  if (resolutionId && !exactRestoration) {
    throw new Error('The successful Stripe refund is missing its exact approved refund resolution.')
  }
  if (exactRestoration && Object.entries(exactRestoration).some(([key, value]) => key !== 'refundResolutionId' && (!Number.isInteger(value) || Number(value) < 0))) {
    throw new Error('The successful Stripe refund has an invalid exact restoration contract.')
  }
  if (exactRestoration && exactRestoration.tailorWorkAmount + exactRestoration.platformFeeAmount + exactRestoration.taxAmount + exactRestoration.fulfillmentAmount + exactRestoration.consultationAmount + exactRestoration.promotionAmount + exactRestoration.drapeonFundedAmount !== refundAmount) {
    throw new Error('The successful Stripe refund does not balance to its exact restoration contract.')
  }

  await finalizeRefundOnAttempt(supabase, {
    attempt: payment as never,
    refundAmount,
    providerResponse: input.refund,
    actorRole: 'SYSTEM',
    reason: typeof latestRequest?.reason === 'string' ? latestRequest.reason : 'Stripe confirmed the approved refund.',
    exactRestoration,
  })
  await markDispatchRefundTerminal(supabase, { resolutionId, succeeded: true, providerReference: input.refund.id })
  const nowIso = new Date().toISOString()
  if (resolution?.id) {
    await supabase.from('order_refund_resolutions').update({ status: 'SUCCEEDED', provider_reference: input.refund.id, failure_summary: null, updated_at: nowIso }).eq('id', resolution.id)
  }
  if (payment.phase === 'CONSULTATION') {
    const { data: booking } = await supabase.from('consultation_bookings').select('id,earned_amount,fee_amount').eq('order_id', payment.order_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (booking?.id) {
      const fullRefund = refundAmount >= (booking.fee_amount ?? payment.amount)
      const nextSettlement = fullRefund ? 'REFUNDED' : (booking.earned_amount ?? 0) > 0 ? 'EARNED' : 'PARTIALLY_REFUNDED'
      await supabase.from('consultation_bookings').update({ payment_status: fullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED', settlement_status: nextSettlement, refunded_amount: refundAmount, settlement_eligible_at: nextSettlement === 'EARNED' ? nowIso : null, settled_at: fullRefund ? nowIso : null }).eq('id', booking.id)
      if (nextSettlement === 'EARNED') EdgeRuntime.waitUntil(supabase.functions.invoke('release-consultation-earning', { body: { bookingId: booking.id } }))
    }
  }
  if (resolution?.financial_case_id) {
    await supabase.from('financial_cases').update({ status: 'RESOLVED', money_movement_blocked: false, resolved_at: nowIso, resolution_code: 'CUSTOMER_REFUND_COMPLETED', resolution_summary: 'Stripe confirmed the approved customer refund.' }).eq('id', resolution.financial_case_id)
  }
  if (resolution?.id) {
    const { error: outcomeError } = await supabase.rpc('apply_ops_partial_refund_order_outcome', { p_resolution_id: resolution.id, p_provider_reference: input.refund.id })
    if (outcomeError) throw outcomeError
  }
  if (resolution?.money_desk_request_id) {
    const { data: attempt } = await supabase.from('money_desk_execution_attempts').select('id').eq('request_id', resolution.money_desk_request_id).eq('status', 'PROCESSING').order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (attempt?.id) await supabase.rpc('complete_money_desk_execution', { p_attempt_id: attempt.id, p_status: 'SUCCEEDED', p_provider_reference: input.refund.id, p_failure_code: null, p_failure_summary: null })
  }
  const { data: order } = await supabase.from('orders').select('id,customer_id,tailor_id').eq('id', payment.order_id).maybeSingle()
  if (order?.id) {
    for (const recipient of [{ id: order.customer_id, audience: 'CUSTOMER' as const }, { id: order.tailor_id, audience: 'TAILOR' as const }]) {
      if (!recipient.id) continue
      const body = `${refundTimingMessage('STRIPE', recipient.audience)} ${resolution?.id ? refundOutcomeMessage(resolution.order_outcome, resolution.resume_stage) : ''}`.trim()
      const notificationKey = resolution?.id ?? input.refund.id
      await enqueuePushJob(supabase, { userId: recipient.id, orderId: order.id, source: FN, idempotencyKey: `refund-resolution:${notificationKey}:${recipient.audience}:push`, priority: 30, notification: { title: 'Order refund is complete', body, preferenceKey: 'orderUpdates', data: { orderId: order.id, type: 'refund_completed', refundResolutionId: resolution?.id ?? '' } } })
      await enqueueOrderEventEmailJob(supabase, { order, recipientUserId: recipient.id, audience: recipient.audience, subject: 'Order refund is complete', headline: 'Order refund is complete', body, ctaLabel: 'View order', source: FN, idempotencyKey: `refund-resolution:${notificationKey}:${recipient.audience}:email`, priority: 30 })
    }
  }
  await markWebhookEventProcessed(supabase, input.webhookEventId, { orderId: payment.order_id, paymentId: payment.id, processingResult: 'stripe_refund_succeeded' })
  return { matched: true, processed: true, status }
}

async function handleStripeDisputeLifecycle(
  supabase: SupabaseClient,
  input: { event: StripeEvent; dispute: StripeDisputeObject; webhookEventId: string },
) {
  const chargeId = typeof input.dispute.charge === 'string'
    ? input.dispute.charge
    : input.dispute.charge?.id ?? null
  const charge = chargeId ? await retrieveStripeCharge(chargeId).catch(() => null) : null
  const paymentIntentId = input.dispute.payment_intent ?? charge?.payment_intent ?? null
  const payment = paymentIntentId
    ? await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntentId).catch(() => null)
    : null
  const metadataOrderId = input.dispute.metadata?.order_id?.trim()
    || charge?.metadata?.order_id?.trim()
    || null
  const orderId = payment?.order_id ?? metadataOrderId
  const { data: order } = orderId
    ? await supabase.from('orders').select('id,reference,customer_id,tailor_id').eq('id', orderId).maybeSingle()
    : { data: null }
  const status = stripeDisputeStatus(input.dispute.status)
  const terminalRelease = status === 'WON' || status === 'WARNING_CLOSED'
  const closed = terminalRelease || status === 'LOST'
  const dueAt = typeof input.dispute.evidence_details?.due_by === 'number'
    ? new Date(input.dispute.evidence_details.due_by * 1000).toISOString()
    : null
  const amount = typeof input.dispute.amount === 'number' ? input.dispute.amount : 0
  const currency = input.dispute.currency?.trim().toUpperCase() || null
  if (amount <= 0 || !currency) throw new Error('Stripe dispute is missing amount or currency.')

  const { error: disputeError } = await supabase.from('provider_disputes').upsert({
    provider: 'STRIPE',
    provider_dispute_id: input.dispute.id,
    provider_charge_id: chargeId,
    provider_payment_id: paymentIntentId,
    payment_id: payment?.id ?? null,
    order_id: order?.id ?? orderId,
    customer_id: order?.customer_id ?? null,
    tailor_id: order?.tailor_id ?? null,
    amount,
    currency,
    status,
    reason: input.dispute.reason ?? null,
    evidence_due_at: dueAt,
    money_movement_blocked: !terminalRelease,
    provider_event_id: input.event.id,
    metadata: { stripe_event_type: input.event.type },
    closed_at: closed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,provider_dispute_id' })
  if (disputeError) throw disputeError

  if (order?.id) {
    const { error: refreshError } = await supabase.rpc('refresh_order_settlement', { p_order_id: order.id })
    if (refreshError) throw refreshError
  }

  const issueKey = `stripe-dispute:${input.dispute.id}`
  if (terminalRelease) {
    await resolveOpsIssueByDedupeKey(supabase, issueKey, {
      provider_dispute_id: input.dispute.id,
      terminal_status: status,
      provider_event_id: input.event.id,
    })
  } else {
    await createOrRefreshOpsIssue(supabase, {
      issueType: status === 'LOST' ? 'PAYOUT_BLOCKED' : 'PAYMENT_BLOCKED',
      severity: status === 'LOST' ? 'CRITICAL' : 'HIGH',
      source: FN,
      actorRole: 'SYSTEM',
      orderId: order?.id ?? orderId,
      userId: order?.customer_id ?? null,
      provider: 'STRIPE',
      relatedEntityType: 'provider_dispute',
      relatedEntityId: input.dispute.id,
      title: status === 'LOST' ? 'Stripe dispute was lost' : 'Stripe dispute needs review',
      description: status === 'LOST'
        ? `Stripe closed dispute ${input.dispute.id} against Drapeon. Unreleased order settlement remains frozen.`
        : `Stripe opened or updated dispute ${input.dispute.id}. Unreleased order settlement is frozen while evidence is reviewed.`,
      recommendedAction: status === 'LOST'
        ? 'Reconcile the provider debit and ledger, review any released tailor funds, then prepare any recovery through Money Desk.'
        : 'Open the Stripe dispute, review the order evidence before the provider deadline, and record the response in the case trail.',
      dedupeKey: issueKey,
      notifyOps: status === 'LOST',
      metadata: {
        provider_dispute_id: input.dispute.id,
        provider_payment_id: paymentIntentId,
        status,
        reason_code: input.dispute.reason ?? null,
        evidence_due_at: dueAt,
        amount,
        currency,
        correlation_id: payment?.correlation_id ?? null,
      },
    })
  }

  if (order?.id) {
    const title = terminalRelease
      ? 'Payment dispute closed'
      : status === 'LOST'
        ? 'Payment dispute requires Drapeon review'
        : 'Order payment is under review'
    const body = terminalRelease
      ? 'Stripe closed the payment dispute in Drapeon’s favor. Any eligible order settlement can continue after the normal checks.'
      : status === 'LOST'
        ? 'Stripe completed the payment dispute. Drapeon is reconciling the result before any further money moves.'
        : 'A payment dispute is open. Unreleased order funds are paused while Drapeon reviews the provider evidence.'
    for (const recipient of [
      { id: order.customer_id, audience: 'CUSTOMER' as const },
      { id: order.tailor_id, audience: 'TAILOR' as const },
    ]) {
      if (!recipient.id) continue
      await enqueuePushJob(supabase, {
        userId: recipient.id,
        orderId: order.id,
        source: FN,
        idempotencyKey: `stripe-dispute:${input.event.id}:${recipient.audience}:push`,
        priority: terminalRelease ? 25 : 5,
        notification: {
          title,
          body,
          preferenceKey: 'orderUpdates',
          data: { orderId: order.id, type: 'payment_dispute', disputeId: input.dispute.id },
        },
      })
      await enqueueOrderEventEmailJob(supabase, {
        recipientUserId: recipient.id,
        audience: recipient.audience,
        order,
        subject: title,
        headline: title,
        body,
        ctaLabel: 'View order',
        source: FN,
        priority: terminalRelease ? 25 : 5,
        idempotencyKey: `stripe-dispute:${input.event.id}:${recipient.audience}:email`,
      })
    }
  }

  await markWebhookEventProcessed(supabase, input.webhookEventId, {
    orderId: order?.id ?? orderId,
    paymentId: payment?.id ?? null,
    processingResult: `stripe_dispute:${status.toLowerCase()}`,
  })
  await Sentry.captureMessage('Stripe dispute lifecycle updated', {
    level: status === 'LOST' ? 'error' : terminalRelease ? 'info' : 'warning',
    tags: { function: FN, provider: 'STRIPE', event_type: input.event.type, dispute_status: status },
    extra: {
      provider_event_id: input.event.id,
      provider_dispute_id: input.dispute.id,
      order_id: order?.id ?? orderId,
      payment_id: payment?.id ?? null,
      correlation_id: payment?.correlation_id ?? null,
    },
  })
  return { matched: !!order?.id, status, blocked: !terminalRelease }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  const supabase: SupabaseClient = createClient(getSupabaseUrl(), getServiceRoleKey())
  const queuedWebhookEventId = req.headers.get('x-drape-webhook-event-id')?.trim() || null
  let payload: string

  if (queuedWebhookEventId) {
    const unauthorized = await authorizeCronRequest(req, `${FN}:queued-replay`, cors)
    if (unauthorized) return unauthorized
    const queued = await loadQueuedPaymentWebhook(supabase, {
      webhookEventId: queuedWebhookEventId,
      provider: 'STRIPE',
    })
    if (queued.processed_at) {
      return new Response(JSON.stringify({ ok: true, duplicate: true, processed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    payload = JSON.stringify(queued.payload)
  } else {
  const clientIp = getClientIp(req)
  const limit = await rateLimit(
    supabase,
    clientIp,
    FN,
    RATE_LIMITS.webhook.limit,
    RATE_LIMITS.webhook.windowMs,
    { ip: clientIp, userAgent: req.headers.get('user-agent') },
  )
  if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter)

  const signature = req.headers.get('Stripe-Signature')
  payload = await req.text()

  if (!signature) {
    await recordRejectedWebhook(supabase, {
      provider: 'STRIPE',
      functionName: FN,
      rawPayload: payload,
      reason: 'missing_signature',
      signatureHeader: null,
      sourceIp: clientIp,
      userAgent: req.headers.get('user-agent'),
      endpointPath: '/v1/webhooks/stripe',
    })
    return new Response('Missing Stripe-Signature header', { status: 401, headers: cors })
  }

  try {
    await verifyStripeWebhookSignature({
      payload,
      signatureHeader: signature,
      webhookSecret: getStripeWebhookSecrets(),
    })
  } catch (error) {
    await recordRejectedWebhook(supabase, {
      provider: 'STRIPE',
      functionName: FN,
      rawPayload: payload,
      reason: 'invalid_signature',
      signatureHeader: signature,
      verificationError: error instanceof Error ? error.message : String(error),
      sourceIp: clientIp,
      userAgent: req.headers.get('user-agent'),
      endpointPath: '/v1/webhooks/stripe',
    })
    return new Response('Invalid Stripe signature', { status: 401, headers: cors })
  }

    try {
      const event = JSON.parse(payload) as StripeEvent
      if (!event?.id || !event?.type) {
        return new Response('Invalid event payload', { status: 400, headers: cors })
      }
      const queued = await enqueueVerifiedPaymentWebhook(supabase, {
        provider: 'STRIPE',
        providerEventId: event.id,
        eventType: event.type,
        payload: event as Record<string, unknown>,
        rawPayload: payload,
      })
      return new Response(JSON.stringify({
        ok: true,
        accepted: true,
        duplicate: queued.duplicate,
        alreadyProcessed: queued.alreadyProcessed,
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof SyntaxError) {
        return new Response('Invalid JSON payload', { status: 400, headers: cors })
      }
      const message = error instanceof Error ? error.message : String(error)
      log('error', FN, 'webhook.enqueue_failed', { error: message })
      await Sentry.captureMessage('Stripe webhook durable enqueue failed', {
        level: 'error',
        tags: { function: FN, provider: 'STRIPE', failure_class: 'durable_enqueue' },
        extra: { safe_error: message.slice(0, 500) },
      })
      return new Response('Webhook intake unavailable', { status: 503, headers: cors })
    }
  }

  try {
    const event = JSON.parse(payload) as StripeEvent

    if (!event?.id || !event?.type) {
      return new Response('Invalid event payload', { status: 400, headers: cors })
    }

    const paymentIntent = isStripePaymentIntent(event.data?.object) ? event.data?.object : null
    const paymentIntentId = paymentIntent?.id ?? null
    const paymentAttempt = paymentIntentId
      ? await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntentId).catch(() => null)
      : null
    const webhookEvent = await createWebhookEvent(supabase, {
      provider: 'STRIPE',
      providerEventId: event.id,
      eventType: event.type,
      idempotencyKey:
        paymentAttempt?.idempotency_key
        ?? (typeof paymentIntent?.metadata?.idempotency_key === 'string' ? paymentIntent.metadata.idempotency_key : null),
      orderId: paymentAttempt?.order_id ?? null,
      paymentId: paymentAttempt?.id ?? null,
      signatureValid: true,
      payload: event as Record<string, unknown>,
    })

    if (webhookEvent.duplicate && webhookEvent.alreadyProcessed) {
      await audit(supabase, {
        event: 'payment.webhook_duplicate',
        actor_role: 'SYSTEM',
        order_id: paymentAttempt?.order_id ?? null,
        payload: {
          function: FN,
          provider: 'STRIPE',
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntentId,
          processing_result: webhookEvent.processingResult,
        },
      })

      return new Response(JSON.stringify({ ok: true, duplicate: true, processed: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'].includes(event.type)) {
      const dispute = isStripeDisputeObject(event.data?.object) ? event.data.object : null
      if (!dispute?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_dispute_id',
        })
        return new Response('Missing dispute payload', { status: 400, headers: cors })
      }
      const result = await handleStripeDisputeLifecycle(supabase, {
        event,
        dispute,
        webhookEventId: webhookEvent.id,
      })
      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.type, ...result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
      const refund = isStripeRefundObject(event.data?.object) ? event.data.object : null
      if (!refund?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_refund_id',
        })
        return new Response('Missing refund payload', { status: 400, headers: cors })
      }
      const result = await handleStripeRefundLifecycle(supabase, {
        event,
        refund,
        webhookEventId: webhookEvent.id,
      })
      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.type, ...result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (event.type === 'account.updated' || event.type === 'account.external_account.updated') {
      const eventAccount = isStripeConnectAccount(event.data?.object) ? event.data.object : null
      const connectAccountId = eventAccount?.id ?? event.account?.trim() ?? null
      const account = eventAccount ?? (connectAccountId
        ? await retrieveStripeConnectAccount(connectAccountId).catch(() => null)
        : null)
      if (!account?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_account_id',
        })
        return new Response('Missing account payload', { status: 400, headers: cors })
      }

      const result = await handleStripeConnectAccountUpdated(supabase, {
        event,
        account,
        webhookEventId: webhookEvent.id,
      })

      await Sentry.captureMessage('Stripe connected-account payout readiness updated', {
        level: result.verified ? 'info' : 'warning',
        tags: {
          function: FN,
          provider: 'STRIPE',
          event_type: event.type,
          payout_ready: result.verified ? 'true' : 'false',
        },
        extra: {
          provider_event_id: event.id,
          provider_account_id: account.id,
          tailor_profile_id: result.profile?.id ?? null,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        recorded: true,
        type: event.type,
        verified: result.verified,
        profileMatched: !!result.profile,
        notified: result.notified,
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (['payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled'].includes(event.type)) {
      const bankPayout = isStripePayoutObject(event.data?.object) ? event.data.object : null
      if (!bankPayout?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_bank_payout_id',
        })
        return new Response('Missing payout payload', { status: 400, headers: cors })
      }
      const result = await handleStripeBankPayout(supabase, {
        event,
        bankPayout,
        webhookEventId: webhookEvent.id,
      })
      return new Response(JSON.stringify({
        ok: true,
        recorded: true,
        type: event.type,
        exactPayoutMatched: !!result.payout,
        bankSettlementStatus: result.bankStatus,
      }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (event.type === 'transfer.created' || event.type === 'transfer.reversed') {
      const transfer = isStripeTransferObject(event.data?.object) ? event.data?.object : null
      if (!transfer?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'invalid_payload:missing_transfer_id',
        })
        return new Response('Missing transfer payload', { status: 400, headers: cors })
      }

      const payout = await findPayoutForStripeTransfer(supabase, transfer)
      if (!payout?.id) {
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: null,
          paymentId: null,
          processingResult: 'missing_payout',
        })
        await audit(supabase, {
          event: 'payout.webhook_missing',
          actor_role: 'SYSTEM',
          severity: 'warn',
          payload: {
            function: FN,
            provider: 'STRIPE',
            stripe_event_id: event.id,
            stripe_event_type: event.type,
            provider_payout_id: transfer.id,
          },
        })
        return new Response(JSON.stringify({ ok: true, missingPayout: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const nowIso = new Date().toISOString()
      const nextStatus = event.type === 'transfer.created' ? 'PROCESSING' : 'REVERSED'
      const payoutPatch: Record<string, unknown> = {
        status: nextStatus,
        provider_transfer_status: event.type === 'transfer.created' ? 'AVAILABLE_IN_PROVIDER_BALANCE' : 'REVERSED',
        bank_settlement_status: event.type === 'transfer.created' ? 'PENDING' : 'FAILED',
        provider_response: event as Record<string, unknown>,
        processed_at: nowIso,
      }
      if (nextStatus === 'PROCESSING') {
        payoutPatch.completed_at = null
        payoutPatch.provider_destination_id = event.account?.trim() || null
      }
      if (nextStatus === 'REVERSED') {
        payoutPatch.failed_at = nowIso
        payoutPatch.bank_settlement_failed_at = nowIso
        payoutPatch.bank_settlement_failure_code = 'PROVIDER_TRANSFER_REVERSED'
        payoutPatch.blocked_reason = 'PROVIDER_TRANSFER_REVERSED'
      }

      const { error: payoutError } = await supabase
        .from('payouts')
        .update(payoutPatch)
        .eq('id', payout.id)

      if (payoutError) {
        throw new Error(payoutError.message)
      }

      await finalizeFundedFabricRelease(
        supabase,
        payout,
        transfer.id,
        nextStatus === 'PROCESSING' ? 'SUCCEEDED' : 'REVERSED',
        event as Record<string, unknown>,
      )

      if (nextStatus === 'REVERSED' && payout.order_id) {
        await supabase
          .from('orders')
          .update({
            escrow_released: false,
            escrow_released_at: null,
          })
          .eq('id', payout.order_id)
      }

      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: payout.order_id ?? null,
        paymentId: null,
        processingResult: nextStatus === 'PROCESSING' ? 'payout_available_in_provider_balance' : 'payout_reversed',
      })

      await audit(supabase, {
        event: nextStatus === 'PROCESSING' ? 'payout.available_in_provider_balance' : 'payout.failed',
        actor_role: 'SYSTEM',
        order_id: payout.order_id ?? null,
        severity: nextStatus === 'PROCESSING' ? 'info' : 'error',
        payload: {
          function: FN,
          provider: 'STRIPE',
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          provider_payout_id: transfer.id,
          payout_id: payout.id,
        },
      })

      if (nextStatus === 'REVERSED') {
        await recordProviderPayoutFailure(supabase, {
          payoutId: payout.id,
          orderId: payout.order_id ?? null,
          providerPayoutId: transfer.id,
          eventType: event.type,
        })
        const orderReference = payout.order_id ?? payout.id
        const { data: reversedOrder } = payout.order_id
          ? await supabase.from('orders').select('tailor_id').eq('id', payout.order_id).maybeSingle()
          : { data: null }
        if (reversedOrder?.tailor_id) {
          await enqueueSmsJob(supabase, {
            userId: reversedOrder.tailor_id,
            audience: 'TAILOR',
            event: 'PAYOUT_REVERSED',
            body: buildPayoutReversedSms({ provider: 'Stripe', reference: orderReference }),
            source: FN,
            orderId: payout.order_id ?? null,
            idempotencyKey: `stripe-transfer-reversed:${event.id}:sms`,
            priority: 5,
          })
        }
        await Sentry.captureMessage('Stripe connected-account transfer reversed', {
          level: 'error',
          tags: { function: FN, provider: 'STRIPE', event_type: event.type },
          extra: {
            provider_event_id: event.id,
            provider_transfer_id: transfer.id,
            payout_id: payout.id,
            order_id: payout.order_id ?? null,
          },
        })
      }

      return new Response(JSON.stringify({ ok: true, recorded: true, type: event.type }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (
      event.type !== 'payment_intent.succeeded' &&
      event.type !== 'payment_intent.payment_failed' &&
      event.type !== 'payment_intent.canceled'
    ) {
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: `ignored:${event.type}`,
      })

      return new Response(JSON.stringify({ ok: true, ignored: true, type: event.type }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (!paymentIntent?.id) {
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: 'invalid_payload:missing_payment_intent',
      })
      return new Response('Missing payment intent payload', { status: 400, headers: cors })
    }

    const order = await findOrderForPaymentIntent(supabase, paymentIntent)

    if (!order?.id) {
      await audit(supabase, {
        event: 'payment.webhook_order_missing',
        actor_role: 'SYSTEM',
        severity: 'warn',
        payload: {
          function: FN,
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntent.id,
          metadata_order_id: paymentIntent.metadata?.order_id ?? null,
        },
      })

      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: paymentAttempt?.order_id ?? null,
        paymentId: paymentAttempt?.id ?? null,
        processingResult: 'missing_order',
      })

      return new Response(JSON.stringify({ ok: true, missingOrder: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const phase = paymentPhaseForIntent(order, paymentIntent)

    if (event.type === 'payment_intent.succeeded') {
      if (phase === 'MATERIAL_ADVANCE') {
        const changed = await markMaterialAdvancePayment(supabase, order, paymentIntent, 'SUCCEEDED')
        const matchedAttempt = await markPaymentAttemptStatus(supabase, {
          provider: 'STRIPE',
          providerPaymentId: paymentIntent.id,
          status: 'SUCCEEDED',
          providerResponse: event as Record<string, unknown>,
        }).catch(() => null)
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: order.id,
          paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
          processingResult: changed ? 'material_advance_paid' : 'material_advance_already_recorded',
        })

        await audit(supabase, {
          event: 'payment.material_advance_confirmed',
          actor_role: 'SYSTEM',
          order_id: order.id,
          payload: {
            function: FN,
            stripe_event_id: event.id,
            stripe_event_type: event.type,
            payment_intent_id: paymentIntent.id,
            payment_phase: phase,
            changed,
          },
        })

        return new Response(JSON.stringify({ ok: true, confirmed: true, changed, phase }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      if (phase === 'TIP') {
        const matchedAttempt = await markPaymentAttemptStatus(supabase, { provider: 'STRIPE', providerPaymentId: paymentIntent.id, status: 'SUCCEEDED', providerResponse: event as Record<string, unknown> })
        const { data: tip } = matchedAttempt?.id ? await supabase.from('order_tips').select('id, order_id, customer_id, tailor_id, amount, currency').eq('payment_id', matchedAttempt.id).maybeSingle() : { data: null }
        if (tip) await enqueueTipConfirmedSideEffects(supabase, tip)
        await markWebhookEventProcessed(supabase, webhookEvent.id, { orderId: order.id, paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null, processingResult: 'tip_confirmed' })
        await audit(supabase, { event: 'tip.confirmed', actor_role: 'SYSTEM', order_id: order.id, payload: { function: FN, tip_id: tip?.id ?? null, stripe_event_id: event.id, payment_intent_id: paymentIntent.id } })
        return new Response(JSON.stringify({ ok: true, confirmed: true, phase }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }

      if (phase === 'INITIAL_ORDER' && !isInitialPaymentStage(order.stage)) {
        await markPaymentAttemptStatus(supabase, {
          provider: 'STRIPE',
          providerPaymentId: paymentIntent.id,
          status: 'SUCCEEDED',
          providerResponse: event as Record<string, unknown>,
        }).catch(() => null)
        const matchedAttempt = await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntent.id).catch(() => null)
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: order.id,
          paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
          processingResult: 'ignored:stage_not_payable',
        })
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      if (phase === 'FULFILLMENT' && !isFulfillmentPaymentStage(order)) {
        await markPaymentAttemptStatus(supabase, {
          provider: 'STRIPE',
          providerPaymentId: paymentIntent.id,
          status: 'SUCCEEDED',
          providerResponse: event as Record<string, unknown>,
        }).catch(() => null)
        const matchedAttempt = await findPaymentAttemptByProviderPaymentId(supabase, 'STRIPE', paymentIntent.id).catch(() => null)
        await markWebhookEventProcessed(supabase, webhookEvent.id, {
          orderId: order.id,
          paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
          processingResult: 'ignored:stage_not_payable',
        })
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: 'stage_not_payable' }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const changed = await markOrderConfirmed(supabase, order, paymentIntent, phase)
      const matchedAttempt = await markPaymentAttemptStatus(supabase, {
        provider: 'STRIPE',
        providerPaymentId: paymentIntent.id,
        status: 'SUCCEEDED',
        providerResponse: event as Record<string, unknown>,
      }).catch(() => null)
      await markWebhookEventProcessed(supabase, webhookEvent.id, {
        orderId: order.id,
        paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
        processingResult: changed ? 'confirmed' : 'already_confirmed',
      })

      await audit(supabase, {
        event: phase === 'FULFILLMENT' ? 'payment.fulfillment_confirmed' : 'payment.confirmed',
        actor_role: 'SYSTEM',
        order_id: order.id,
        payload: {
          function: FN,
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          payment_intent_id: paymentIntent.id,
          payment_phase: phase,
          from_stage: order.stage,
          to_stage: phase === 'FULFILLMENT' ? order.stage : 'CONFIRMED',
          changed,
        },
      })

      return new Response(JSON.stringify({ ok: true, confirmed: true, changed }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const failureStatus = event.type === 'payment_intent.payment_failed' ? 'FAILED' : 'CANCELED'
    const failure = phase === 'MATERIAL_ADVANCE'
      ? {
          changed: await markMaterialAdvancePayment(supabase, order, paymentIntent, failureStatus),
          stage: order.stage,
        }
      : phase === 'TIP' ? { changed: false as const, stage: order.stage } : await markInitialOrderPaymentFailed(supabase, order, {
          provider: 'STRIPE',
          paymentIntentId: paymentIntent.id,
          phase,
        }).catch(() => ({ changed: false as const, stage: order.stage }))
    const matchedAttempt = await markPaymentAttemptStatus(supabase, {
      provider: 'STRIPE',
      providerPaymentId: paymentIntent.id,
      status: failureStatus,
      providerResponse: event as Record<string, unknown>,
    }).catch(() => null)
    await markWebhookEventProcessed(supabase, webhookEvent.id, {
      orderId: order.id,
      paymentId: matchedAttempt?.id ?? paymentAttempt?.id ?? null,
      processingResult: failureStatus === 'FAILED'
        ? (failure.changed ? 'payment_failed' : 'recorded_failure')
        : (failure.changed ? 'payment_failed' : 'recorded_canceled'),
    })

    await audit(supabase, {
      event: event.type === 'payment_intent.payment_failed' ? 'payment.failed' : 'payment.canceled',
      actor_role: 'SYSTEM',
      order_id: order.id,
      severity: 'warn',
      payload: {
        function: FN,
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        payment_intent_id: paymentIntent.id,
        stage: order.stage,
        next_stage: failure.stage,
        status: paymentIntent.status,
        message: paymentIntent.last_payment_error?.message ?? null,
      },
    })

    return new Response(JSON.stringify({ ok: true, recorded: true, type: event.type }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'webhook.failed', { error: error instanceof Error ? error.message : String(error) })
    await Sentry.captureMessage('Stripe webhook processing failed', {
      level: 'error',
      tags: { function: FN, provider: 'STRIPE', failure_class: 'webhook_processing' },
      extra: { error: error instanceof Error ? error.message : String(error) },
    })
    if (error instanceof SyntaxError) {
      return new Response('Invalid JSON payload', { status: 400, headers: cors })
    }
    return new Response('Webhook error', { status: 500, headers: cors })
  }
})
