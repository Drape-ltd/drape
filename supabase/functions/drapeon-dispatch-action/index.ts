import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit } from '../_shared/logger.ts'
import { finalizeDispatchShortfallFunding } from '../_shared/drapeon-dispatch.ts'
import { enqueueDispatchRefundIfDue } from '../_shared/drapeon-dispatch-refund.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { Sentry } from '../_shared/sentry.ts'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueSmsJob } from '../_shared/side-effect-jobs.ts'
import { sendOpsActionRequiredNotification } from '../_shared/ops-notifications.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { normalizeStoredPhone, validateRecipientPhone } from '../_shared/phone.ts'

const FN = 'drapeon-dispatch-action'
const EVIDENCE_URL_TTL_SECONDS = 10 * 60
type EvidenceStorageBucket = 'commercial-evidence' | 'order-photos'
const ALLOWED_EVIDENCE_BUCKETS = new Set<EvidenceStorageBucket>(['commercial-evidence', 'order-photos'])
const AUTO_INITIALIZE_DELIVERY_METHODS = new Set(['LOCAL_DELIVERY', 'SHIPPING'])
const AUTO_INITIALIZE_STAGES = new Set([
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COMPLETE',
])
const CLOSED_METHOD_CHANGE_STAGES = new Set([
  'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED',
  'COMPLETE', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED',
  'CANCELLED', 'DECLINED', 'EXPIRED',
])
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get-state'), orderId: uuid }),
  z.object({
    action: z.literal('request-method-change'),
    orderId: uuid,
    method: z.enum(['LOCAL_DELIVERY', 'SHIPPING']),
    note: z.string().trim().max(1000).nullable().optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
    deliveryDetails: z.object({
      recipientName: z.string().trim().min(1).max(160),
      recipientPhone: z.string().trim().min(5).max(40),
      address: z.string().trim().min(5).max(1200),
      city: z.string().trim().max(160).nullable().optional(),
      region: z.string().trim().max(160).nullable().optional(),
      postalCode: z.string().trim().max(40).nullable().optional(),
      countryCode: z.string().trim().length(2),
    }).optional(),
  }),
  z.object({
    action: z.literal('decide-quote'),
    orderId: uuid,
    decision: z.enum(['PAY_SHORTFALL', 'REQUEST_CHEAPER_OPTION', 'SWITCH_TO_PICKUP', 'DECLINE_DISPATCH']),
    note: z.string().trim().max(1000).nullable().optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }),
])

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

type EvidenceRecord = Record<string, unknown>
type EvidenceSigner = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, expiresIn: number) => Promise<{
        data: { signedUrl?: string } | null
        error: unknown
      }>
    }
  }
}

function evidenceField(item: EvidenceRecord, camel: string, snake: string) {
  const value = item[camel] ?? item[snake]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatMinorMoney(amount: number, currency: string | null | undefined) {
  const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'NGN'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amount / 100)
  } catch {
    return `${code} ${(amount / 100).toFixed(2)}`
  }
}

async function signedEvidence(
  supabase: EvidenceSigner,
  value: unknown,
) {
  if (!Array.isArray(value)) return []
  const signed = await Promise.all(value.map(async (raw, index) => {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as EvidenceRecord
    const bucket = evidenceField(item, 'storageBucket', 'storage_bucket')
    const path = evidenceField(item, 'storageObjectPath', 'storage_object_path')
      ?? evidenceField(item, 'objectPath', 'object_path')
    if (!bucket || !path || !ALLOWED_EVIDENCE_BUCKETS.has(bucket as EvidenceStorageBucket)) return null
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, EVIDENCE_URL_TTL_SECONDS)
    if (error || !data?.signedUrl) return null
    const mimeType = evidenceField(item, 'mimeType', 'mime_type') ?? 'image/jpeg'
    return {
      id: evidenceField(item, 'id', 'id') ?? `${bucket}:${path}:${index}`,
      signedUrl: data.signedUrl,
      mimeType,
      mediaType: evidenceField(item, 'mediaType', 'media_type')
        ?? (mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE'),
      label: evidenceField(item, 'label', 'label') ?? 'Delivery proof',
      expiresInSeconds: EVIDENCE_URL_TTL_SECONDS,
    }
  }))
  return signed.filter((item): item is NonNullable<typeof item> => !!item)
}

function decisionCopy(
  decision: string,
  orderReference: string,
  audience: 'CUSTOMER' | 'TAILOR',
  dueAmount: number,
  currency: string | null | undefined,
  capturedAllowanceAmount: number,
) {
  if (decision === 'PAY_SHORTFALL') {
    const isTopUp = capturedAllowanceAmount > 0
    return audience === 'CUSTOMER' ? {
      title: isTopUp ? 'Extra delivery payment required' : 'Delivery payment required',
      body: isTopUp
        ? `${formatMinorMoney(dueAmount, currency)} is due for order ${orderReference}. Review the provider proof and exact breakdown, then pay the delivery difference to continue.`
        : `${formatMinorMoney(dueAmount, currency)} is due for delivery on order ${orderReference}. No delivery amount was paid at checkout; review the provider proof and exact breakdown, then pay to continue.`,
    } : {
      title: 'Customer accepted the delivery price',
      body: isTopUp
        ? `The customer accepted the ${formatMinorMoney(dueAmount, currency)} delivery difference for order ${orderReference}. Drapeon will notify you when payment is confirmed.`
        : `The customer accepted the ${formatMinorMoney(dueAmount, currency)} delivery payment for order ${orderReference}. Drapeon will notify you when payment is confirmed.`,
    }
  }
  if (decision === 'SWITCH_TO_PICKUP') return {
    title: 'Order switched to pickup',
    body: `Order ${orderReference} will use pickup. Any unused delivery amount is being returned automatically.`,
  }
  if (decision === 'DECLINE_DISPATCH') return {
    title: 'Delivery option declined',
    body: `The quoted delivery option for order ${orderReference} was declined. Drapeon will not book it and will confirm another option or pickup next.`,
  }
  if (decision === 'REQUEST_CHEAPER_OPTION') return {
    title: 'Cheaper delivery requested',
    body: `The customer requested a lower-cost delivery option for order ${orderReference}. Drapeon Dispatch is getting another quote.`,
  }
  return {
    title: 'New delivery option requested',
    body: `The customer requested another delivery option for order ${orderReference}.`,
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, cors)
  const caller = await getAuthUser(req)
  if (!caller) return json({ error: 'UNAUTHORIZED' }, 401, cors)
  const parsed = parseBody(BodySchema, await req.json().catch(() => null))
  if (!parsed.ok) return json({ error: 'INVALID_REQUEST', message: parsed.error }, 400, cors)

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  try {
    const { data: order, error: orderError } = await supabase.from('orders')
      .select('id,reference,customer_id,tailor_id,stage,order_kind,item_title,garment_type,currency,total_amount,delivery_method,delivery_address,delivery_city,delivery_region,delivery_postal_code,delivery_country_code,recipient_name,recipient_phone,fulfillment_payment_paid_at,fulfillment_payment_provider,fulfillment_payment_intent_id')
      .eq('id', parsed.data.orderId)
      .maybeSingle()
    if (orderError) throw orderError
    if (!order?.id || ![order.customer_id, order.tailor_id].includes(caller.id)) {
      return json({ error: 'ORDER_FORBIDDEN' }, 403, cors)
    }

    if (parsed.data.action === 'get-state') {
      const { data: existingRun, error: existingRunError } = await supabase
        .from('order_fulfillment_runs')
        .select('id,status,correlation_id')
        .eq('order_id', order.id)
        .maybeSingle()
      if (existingRunError) throw existingRunError

      const shouldInitialize =
        !existingRun?.id
        && AUTO_INITIALIZE_DELIVERY_METHODS.has(order.delivery_method ?? '')
        && AUTO_INITIALIZE_STAGES.has(order.stage ?? '')
      if (shouldInitialize) {
        const { error: ensureError } = await supabase.rpc('ensure_order_fulfillment_run', {
          p_order_id: order.id,
        })
        if (ensureError) throw ensureError
      }

      let paymentReconciliationPending = false
      const provider = order.fulfillment_payment_provider
      const providerPaymentId = order.fulfillment_payment_intent_id?.trim()
      if (
        order.fulfillment_payment_paid_at
        && existingRun?.status === 'AWAITING_SHORTFALL_PAYMENT'
        && (provider === 'PAYSTACK' || provider === 'STRIPE')
        && providerPaymentId
      ) {
        try {
          await finalizeDispatchShortfallFunding(supabase, {
            orderId: order.id,
            actorId: null,
            actorRole: 'SYSTEM',
            provider,
            providerPaymentId,
          })
        } catch (cause) {
          paymentReconciliationPending = true
          const message = cause instanceof Error ? cause.message : String(cause)
          await createOrRefreshOpsIssue(supabase, {
            issueType: 'FULFILLMENT_RECONCILIATION_FAILED',
            severity: 'HIGH',
            source: FN,
            actorRole: 'SYSTEM',
            orderId: order.id,
            relatedEntityType: 'ORDER_FULFILLMENT_RUN',
            relatedEntityId: existingRun.id,
            provider,
            stage: order.stage,
            title: 'Confirmed delivery payment needs reconciliation',
            description: `The provider-confirmed delivery payment for order ${order.reference} could not advance the dispatch funding state.`,
            recommendedAction: 'Verify the fulfillment payment and dispatch run, then replay the idempotent shortfall-paid event. Never ask the customer to pay again.',
            dedupeKey: `dispatch-shortfall-reconciliation:${existingRun.id}`,
            metadata: { correlation_id: existingRun.correlation_id, error: message },
          })
          await Sentry.captureMessage('Confirmed dispatch payment did not advance funding state', {
            level: 'error',
            tags: { function: FN, provider, operation: 'shortfall-reconciliation' },
            extra: { order_id: order.id, run_id: existingRun.id, correlation_id: existingRun.correlation_id, error: message },
          })
        }
      }
      const [runResult, parcelResult, eventResult] = await Promise.all([
        supabase.from('order_fulfillment_runs').select('*').eq('order_id', order.id).maybeSingle(),
        supabase.from('order_fulfillment_parcels').select('*').eq('order_id', order.id).order('parcel_number'),
        supabase.from('order_fulfillment_events').select('*').eq('order_id', order.id).order('occurred_at', { ascending: false }).limit(50),
      ])
      if (runResult.error || parcelResult.error || eventResult.error) {
        throw runResult.error ?? parcelResult.error ?? eventResult.error
      }
      const run = runResult.data
      const events = await Promise.all((eventResult.data ?? []).map(async (event) => ({
        ...event,
        evidence_media: await signedEvidence(supabase, event.evidence_media),
      })))
      return json({
        ok: true,
        role: caller.id === order.customer_id ? 'CUSTOMER' : 'TAILOR',
        paymentConfirmed: !!order.fulfillment_payment_paid_at,
        paymentReconciliationPending,
        currentMethod: order.delivery_method,
        deliveryDetails: {
          recipientName: order.recipient_name ?? '',
          recipientPhone: order.recipient_phone ?? '',
          address: order.delivery_address ?? '',
          city: order.delivery_city ?? '',
          region: order.delivery_region ?? '',
          postalCode: order.delivery_postal_code ?? '',
          countryCode: order.delivery_country_code ?? '',
        },
        canRequestDelivery: caller.id === order.customer_id
          && !CLOSED_METHOD_CHANGE_STAGES.has((order.stage ?? '').toUpperCase()),
        run: run ? {
          ...run,
          provider_quote_evidence: await signedEvidence(supabase, run.provider_quote_evidence),
        } : null,
        parcels: parcelResult.data ?? [],
        events,
      }, 200, cors)
    }

    if (caller.id !== order.customer_id) return json({ error: 'CUSTOMER_ONLY' }, 403, cors)
    if (parsed.data.action === 'request-method-change') {
      if (CLOSED_METHOD_CHANGE_STAGES.has((order.stage ?? '').toUpperCase())) {
        return json({
          error: 'FULFILLMENT_ALREADY_COMPLETE',
          message: 'This handoff is complete. Delivery can no longer be changed; open aftercare if you need help with the completed order.',
          recoveryAction: 'OPEN_AFTERCARE',
        }, 409, cors)
      }
      const supplied = parsed.data.deliveryDetails
      const recipientPhone = normalizeStoredPhone(supplied?.recipientPhone ?? order.recipient_phone)
      const recipientPhoneError = validateRecipientPhone(recipientPhone)
      if (recipientPhoneError) {
        return json({ error: 'RECIPIENT_PHONE_INVALID', message: recipientPhoneError, recoveryAction: 'EDIT_DELIVERY_DETAILS' }, 409, cors)
      }
      const details = {
        recipientName: supplied?.recipientName?.trim() || order.recipient_name?.trim() || '',
        recipientPhone,
        address: supplied?.address?.trim() || order.delivery_address?.trim() || '',
        city: supplied?.city?.trim() || order.delivery_city?.trim() || null,
        region: supplied?.region?.trim() || order.delivery_region?.trim() || null,
        postalCode: supplied?.postalCode?.trim() || order.delivery_postal_code?.trim() || null,
        countryCode: (supplied?.countryCode?.trim() || order.delivery_country_code?.trim() || '').toUpperCase(),
      }
      if (!details.recipientName || !details.recipientPhone || !details.address || details.countryCode.length !== 2) {
        return json({ error: 'DELIVERY_DETAILS_REQUIRED', message: 'Add the recipient, phone number, destination, and country before requesting delivery.', recoveryAction: 'EDIT_DELIVERY_DETAILS' }, 409, cors)
      }
      const { data, error } = await supabase.rpc('request_order_fulfillment_method_change_with_details', {
        p_order_id: order.id,
        p_customer_id: caller.id,
        p_method: parsed.data.method,
        p_note: parsed.data.note ?? null,
        p_idempotency_key: parsed.data.idempotencyKey,
        p_recipient_name: details.recipientName,
        p_recipient_phone: details.recipientPhone,
        p_delivery_address: details.address,
        p_delivery_city: details.city,
        p_delivery_region: details.region,
        p_delivery_postal_code: details.postalCode,
        p_delivery_country_code: details.countryCode,
      })
      if (error) {
        if (error.message.includes('FULFILLMENT_ALREADY_COMPLETE')) {
          return json({
            error: 'FULFILLMENT_ALREADY_COMPLETE',
            message: 'This handoff is complete. Delivery can no longer be changed; open aftercare if you need help with the completed order.',
            recoveryAction: 'OPEN_AFTERCARE',
          }, 409, cors)
        }
        if (error.message.includes('DELIVERY_DETAILS_REQUIRED')) {
          return json({ error: 'DELIVERY_DETAILS_REQUIRED', message: 'Confirm the recipient, phone number, destination, and country before requesting delivery.', recoveryAction: 'EDIT_DELIVERY_DETAILS' }, 409, cors)
        }
        if (error.message.includes('FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED')) {
          return json({
            error: 'FULFILLMENT_METHOD_CHANGE_REVIEW_REQUIRED',
            message: 'This dispatch already has a booking or money record. Drapeon must preserve it while reviewing the requested change.',
            recoveryAction: 'OPEN_DELIVERY_SUPPORT',
          }, 409, cors)
        }
        if (error.message.includes('FULFILLMENT_ALREADY_IN_PROGRESS')) {
          return json({ error: 'FULFILLMENT_ALREADY_IN_PROGRESS', message: 'The parcel is already moving. Contact Drapeon to review the safest available option.', recoveryAction: 'OPEN_DELIVERY_SUPPORT' }, 409, cors)
        }
        throw error
      }
      const methodLabel = parsed.data.method === 'SHIPPING' ? 'shipping' : 'local delivery'
      const methodChangeResult = data as Record<string, unknown>
      const runId = typeof methodChangeResult.runId === 'string' ? methodChangeResult.runId : ''
      const eventId = typeof methodChangeResult.eventId === 'string' ? methodChangeResult.eventId : ''

      // Ops intake is authoritative workflow state, not a best-effort alert.
      // The email/web-push notification below may fail independently without
      // making this quote request disappear from Dispatch Queue.
      const opsIssue = runId
        ? await createOrRefreshOpsIssue(supabase, {
            issueType: 'DELIVERY_REVIEW',
            severity: 'MEDIUM',
            source: FN,
            actorId: caller.id,
            actorRole: 'CUSTOMER',
            orderId: order.id,
            relatedEntityType: 'ORDER_FULFILLMENT_RUN',
            relatedEntityId: runId,
            stage: order.stage,
            title: `${parsed.data.method === 'SHIPPING' ? 'Shipping' : 'Local delivery'} quote required`,
            description: `Order ${order.reference} changed from pickup to ${methodLabel}. The pickup credential was retired and the replacement now needs a provider quote and private proof.`,
            recommendedAction: 'Open Dispatch Queue, confirm destination eligibility, record the provider quote and private proof, then continue the replacement workflow.',
            dedupeKey: `dispatch-method-change:${runId}`,
            metadata: {
              method: parsed.data.method,
              event_id: eventId || null,
              idempotency_key: parsed.data.idempotencyKey,
              pickup_credential_retired: methodChangeResult.pickupCredentialRetired === true,
            },
            notifyOps: false,
          })
        : null

      if (!opsIssue) {
        await Sentry.captureMessage('Dispatch method change Ops intake failed', {
          level: 'error',
          tags: { function: FN, operation: 'method-change-ops-intake' },
          extra: { order_id: order.id, method: parsed.data.method, run_id: runId || null, event_id: eventId || null },
        })
        return json({
          error: 'OPS_INTAKE_PENDING',
          requestPersisted: true,
          message: `Your ${methodLabel} request replaced pickup, but its Ops work item is still syncing. Refresh this order before trying again.`,
          recoveryAction: 'REFRESH_DISPATCH_STATUS',
        }, 503, cors)
      }
      const customerBody = `Your request to switch order ${order.reference} to ${methodLabel} is saved. Drapeon Dispatch is confirming the provider price and proof.`
      const tailorBody = `The customer requested ${methodLabel} for order ${order.reference}. Keep the parcel ready while Drapeon Dispatch confirms the provider.`
      await Promise.all([
        enqueuePushJob(supabase, { userId: order.customer_id, orderId: order.id, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:customer:push`, notification: { title: 'Delivery request saved', body: customerBody, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' } } }),
        enqueueOrderEventEmailJob(supabase, { order, recipientUserId: order.customer_id, audience: 'CUSTOMER', subject: 'Delivery request saved', headline: 'Drapeon Dispatch is confirming your delivery', body: customerBody, ctaLabel: 'View delivery status', action: parsed.data.method, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:customer:email` }),
        enqueuePushJob(supabase, { userId: order.tailor_id, orderId: order.id, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:tailor:push`, notification: { title: 'Customer requested delivery', body: tailorBody, preferenceKey: 'newOrders', data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' } } }),
        enqueueOrderEventEmailJob(supabase, { order, recipientUserId: order.tailor_id, audience: 'TAILOR', subject: 'Customer requested delivery', headline: 'Drapeon Dispatch is confirming the handoff', body: tailorBody, ctaLabel: 'View order', action: parsed.data.method, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:tailor:email` }),
      ])
      const opsDelivery = await sendOpsActionRequiredNotification({
        title: `${methodLabel === 'shipping' ? 'Shipping' : 'Local delivery'} quote required`,
        description: `Order ${order.reference} changed from pickup to ${methodLabel}. Confirm destination eligibility, add the provider quote and private proof, then continue from Dispatch Queue.`,
        orderId: order.id,
        orderReference: order.reference,
        source: FN,
        actionPath: `/ops?view=dispatch&order=${encodeURIComponent(order.id)}`,
        idempotencyKey: parsed.data.idempotencyKey,
      })
      if (!opsDelivery.ok) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'SYSTEM_ALERT',
          severity: 'HIGH',
          source: FN,
          actorId: caller.id,
          actorRole: 'CUSTOMER',
          orderId: order.id,
          relatedEntityType: 'ORDER_FULFILLMENT_RUN',
          relatedEntityId: runId,
          stage: order.stage,
          title: 'Dispatch method change needs Ops attention',
          description: `Order ${order.reference} moved to ${methodLabel}, but the direct Ops notification did not reach a terminal successful outcome.`,
          recommendedAction: 'Open Dispatch Queue, confirm destination eligibility, add the provider quote and private proof, and verify Ops notification delivery.',
          dedupeKey: `dispatch-method-change-notification:${eventId || parsed.data.idempotencyKey}`,
          metadata: { method: parsed.data.method, notification_skipped: opsDelivery.skipped, idempotency_key: parsed.data.idempotencyKey },
        })
        await Sentry.captureMessage('Dispatch method change Ops notification failed', {
          level: 'error',
          tags: { function: FN, operation: 'method-change-ops-notification' },
          extra: { order_id: order.id, method: parsed.data.method, run_id: runId, event_id: eventId, skipped: opsDelivery.skipped },
        })
      }
      await audit(supabase, { event: 'dispatch.method_change_requested', actor_id: caller.id, actor_role: 'CUSTOMER', order_id: order.id, payload: { method: parsed.data.method, result: data, ops_issue_id: opsIssue.id, ops_issue_number: opsIssue.issue_number, ops_notification: opsDelivery } })
      return json({ ok: true, ...methodChangeResult, opsIssueId: opsIssue.id, acknowledgement: customerBody }, 200, cors)
    }

    const { data: decisionRun } = await supabase.from('order_fulfillment_runs')
      .select('provider_quote_evidence,captured_allowance_amount').eq('order_id', order.id).maybeSingle()
    const decisionEvidence = Array.isArray(decisionRun?.provider_quote_evidence)
      ? decisionRun.provider_quote_evidence[0] as Record<string, unknown> | undefined
      : undefined
    const evidenceImageUrl = decisionEvidence
      ? evidenceField(decisionEvidence, 'storageObjectPath', 'storage_object_path')
      : null
    const rawEvidenceStorageBucket = decisionEvidence
      ? evidenceField(decisionEvidence, 'storageBucket', 'storage_bucket')
      : null
    const evidenceStorageBucket: EvidenceStorageBucket | null = rawEvidenceStorageBucket
      && ALLOWED_EVIDENCE_BUCKETS.has(rawEvidenceStorageBucket as EvidenceStorageBucket)
      ? rawEvidenceStorageBucket as EvidenceStorageBucket
      : null
    const { data, error } = await supabase.rpc('decide_order_fulfillment_quote', {
      p_order_id: order.id,
      p_customer_id: caller.id,
      p_decision: parsed.data.decision,
      p_note: parsed.data.note ?? null,
      p_idempotency_key: parsed.data.idempotencyKey,
    })
    if (error) throw error
    const result = data as Record<string, unknown>
    const runId = String(result.runId ?? '')
    if (parsed.data.decision === 'SWITCH_TO_PICKUP' && runId) {
      await resolveOpsIssueByDedupeKey(supabase, `dispatch-method-change:${runId}`, {
        resolution: 'CUSTOMER_SWITCHED_BACK_TO_PICKUP',
        resolved_by: caller.id,
        fulfillment_event_id: result.eventId ?? null,
      })
    }
    const refund = runId ? await enqueueDispatchRefundIfDue(supabase, { runId, orderId: order.id, actorId: caller.id, actorRole: 'CUSTOMER' }) : { queued: false, refundTotal: 0 }
    const customerDueAmount = typeof result.customerDueAmount === 'number' ? result.customerDueAmount : 0
    const capturedAllowanceAmount = Number(decisionRun?.captured_allowance_amount ?? 0)
    const customerCopy = parsed.data.decision === 'SWITCH_TO_PICKUP'
      ? {
          title: 'Pickup restored',
          body: refund.refundTotal > 0
            ? `Order ${order.reference} will use pickup. ${formatMinorMoney(refund.refundTotal, order.currency)} is being returned automatically; pickup details will appear on the order.`
            : `Order ${order.reference} will use pickup. Delivery was cancelled and pickup details will appear on the order.`,
        }
      : decisionCopy(parsed.data.decision, order.reference, 'CUSTOMER', customerDueAmount, order.currency, capturedAllowanceAmount)
    const tailorCopy = parsed.data.decision === 'SWITCH_TO_PICKUP'
      ? {
          title: 'Order switched to pickup',
          body: `Order ${order.reference} will use pickup. Do not hand the parcel to a rider; use the fresh collection code when the customer collects it.`,
        }
      : decisionCopy(parsed.data.decision, order.reference, 'TAILOR', customerDueAmount, order.currency, capturedAllowanceAmount)
    await Promise.all([
      enqueuePushJob(supabase, { userId: order.customer_id, orderId: order.id, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:customer:push`, notification: { title: customerCopy.title, body: customerCopy.body, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' } } }),
      enqueueOrderEventEmailJob(supabase, { order, recipientUserId: order.customer_id, audience: 'CUSTOMER', subject: customerCopy.title, headline: customerCopy.title, body: customerCopy.body, ctaLabel: 'View delivery status', action: parsed.data.decision, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:customer:email`, evidenceImageUrl, evidenceStorageBucket }),
      enqueueSmsJob(supabase, { userId: order.customer_id, audience: 'CUSTOMER', event: 'DISPATCH_DECISION', body: customerCopy.body, source: FN, orderId: order.id, idempotencyKey: `${parsed.data.idempotencyKey}:customer:sms`, priority: 20 }),
      enqueuePushJob(supabase, { userId: order.tailor_id, orderId: order.id, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:tailor:push`, notification: { title: tailorCopy.title, body: tailorCopy.body, preferenceKey: 'orderUpdates', data: { destination: 'ORDER', orderId: order.id, section: 'dispatch' } } }),
      enqueueOrderEventEmailJob(supabase, { order, recipientUserId: order.tailor_id, audience: 'TAILOR', subject: tailorCopy.title, headline: tailorCopy.title, body: tailorCopy.body, ctaLabel: 'View delivery status', action: parsed.data.decision, source: FN, idempotencyKey: `${parsed.data.idempotencyKey}:tailor:email`, evidenceImageUrl, evidenceStorageBucket }),
    ])
    await audit(supabase, { event: 'dispatch.customer_decision', actor_id: caller.id, actor_role: 'CUSTOMER', order_id: order.id, payload: { decision: parsed.data.decision, run_id: runId, refund_queued: refund.queued, refund_total: refund.refundTotal } })
    return json({ ok: true, ...result, refund, acknowledgement: customerCopy.body }, 200, cors)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (message.includes('FULFILLMENT_ALREADY_IN_PROGRESS')) {
      return json({
        error: 'FULFILLMENT_ALREADY_IN_PROGRESS',
        message: 'Pickup can no longer replace this delivery because the provider handoff has started. Open delivery support for a reviewed recovery.',
        recoveryAction: 'OPEN_DELIVERY_SUPPORT',
      }, 409, cors)
    }
    return json({ error: 'DISPATCH_ACTION_FAILED', message, recoveryAction: 'REFRESH_DISPATCH_STATUS' }, 409, cors)
  }
})
