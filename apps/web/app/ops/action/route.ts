import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../lib/server-supabase'
import { hasOpsAccess } from '../../../lib/ops-auth'

const APPLICATION_STATUSES = new Set(['PENDING', 'REVIEWING', 'CONTACTED', 'APPROVED', 'REJECTED'])
const DISPUTE_STATUSES = new Set(['OPEN', 'UNDER_REVIEW'])
const DISPUTE_OUTCOMES = new Set(['REFUND', 'RELEASE'])
const VERIFICATION_DECISIONS = new Set(['APPROVE', 'REJECT'])
const DELETION_STATUSES = new Set(['PENDING', 'ACKNOWLEDGED', 'COMPLETED', 'REJECTED'])
const REVIEW_VISIBILITY_ACTIONS = new Set(['PUBLISH', 'HOLD'])
const CONVERSATION_ACCESS_ACTIONS = new Set(['BLOCK', 'UNBLOCK'])
const DISPATCH_TARGETS = new Set(['OUT_FOR_DELIVERY', 'SHIPPED'])
const ORDER_REVIEW_TYPES = new Set(['CANCELLATION', 'DELIVERY'])
const ORDER_REVIEW_OUTCOMES = new Set(['REFUND', 'CONTINUE'])

type OrderReviewMeta = {
  status?: 'OPEN' | 'RESOLVED' | null
  requestedFromStage?: string | null
  resolvedAt?: string | null
}

type OrderSupportMeta = {
  cancellationReview?: OrderReviewMeta | null
  deliveryReview?: OrderReviewMeta | null
}

function sanitizeRedirect(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.startsWith('/ops')) return '/ops'
  return value
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function isConflictError(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false
  }

  return (
    error.message.includes('no longer open for review') ||
    error.message.includes('no longer in dispute') ||
    error.message.includes('no longer pending')
  )
}

function parseOrderSupportMeta(value: string | null | undefined): OrderSupportMeta {
  if (!value?.trim()) return {}

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as OrderSupportMeta
  } catch {
    return {}
  }
}

function serializeOrderSupportMeta(meta: OrderSupportMeta | null | undefined) {
  if (!meta || typeof meta !== 'object') return null
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
}

function restoreStageForReview(reviewType: 'CANCELLATION' | 'DELIVERY', requestedFromStage: string | null | undefined) {
  const normalized = typeof requestedFromStage === 'string' ? requestedFromStage.trim().toUpperCase() : ''
  if (normalized && normalized !== 'IN_DISPUTE') return normalized
  return reviewType === 'CANCELLATION' ? 'CONFIRMED' : 'READY_FOR_DRAPE_DISPATCH'
}

function redirectWithMessage(
  request: Request,
  redirectTo: string,
  key: 'notice' | 'error',
  value: string,
) {
  const url = new URL(redirectTo, request.url)
  url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

export async function POST(request: Request) {
  const access = await hasOpsAccess()
  const formData = await request.formData()
  const redirectTo = sanitizeRedirect(formData.get('redirectTo'))

  if (!access) {
    return redirectWithMessage(request, redirectTo, 'error', 'locked')
  }

  const client = createServiceRoleClient()
  if (!client) {
    return redirectWithMessage(request, redirectTo, 'error', 'service-role-missing')
  }

  const kind = readString(formData, 'kind')

  try {
    if (kind === 'dispute-status') {
      const disputeId = readString(formData, 'disputeId')
      const status = readString(formData, 'status').toUpperCase()

      if (!disputeId || !DISPUTE_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client
        .from('disputes')
        .update({ status })
        .eq('id', disputeId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.dispute_status_updated',
        severity: 'info',
        payload: { dispute_id: disputeId, status },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'dispute-saved')
    }

    if (kind === 'dispute-resolution') {
      const disputeId = readString(formData, 'disputeId')
      const outcome = readString(formData, 'outcome').toUpperCase()
      const resolution = readString(formData, 'resolution')

      if (!disputeId || !DISPUTE_OUTCOMES.has(outcome)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client.rpc('ops_resolve_dispute', {
        p_dispute_id: disputeId,
        p_outcome: outcome,
        p_resolution: resolution.length > 0 ? resolution : null,
      })

      if (error) {
        return redirectWithMessage(
          request,
          redirectTo,
          'error',
          isConflictError(error) ? 'conflict' : 'save-failed',
        )
      }

      return redirectWithMessage(request, redirectTo, 'notice', 'dispute-resolved')
    }

    if (kind === 'bypass-review') {
      const logId = readString(formData, 'logId')
      const reviewed = readString(formData, 'reviewed') === 'true'

      if (!logId) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client
        .from('contact_bypass_logs')
        .update({
          reviewed,
          reviewed_at: reviewed ? new Date().toISOString() : null,
          reviewed_by: null,
        })
        .eq('id', logId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.contact_bypass_review_updated',
        severity: 'info',
        payload: { log_id: logId, reviewed },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'bypass-saved')
    }

    if (kind === 'application-status') {
      const applicationId = readString(formData, 'applicationId')
      const status = readString(formData, 'status').toUpperCase()

      if (!applicationId || !APPLICATION_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client
        .from('tailor_applications')
        .update({ status })
        .eq('id', applicationId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.tailor_application_status_updated',
        severity: 'info',
        payload: { application_id: applicationId, status },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'application-saved')
    }

    if (kind === 'verification-decision') {
      const tailorUserId = readString(formData, 'tailorUserId')
      const decision = readString(formData, 'decision').toUpperCase()

      if (!tailorUserId || !VERIFICATION_DECISIONS.has(decision)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { error } = await client.rpc('ops_decide_verification', {
        p_tailor_user_id: tailorUserId,
        p_decision: decision,
      })

      if (error) {
        return redirectWithMessage(
          request,
          redirectTo,
          'error',
          isConflictError(error) ? 'conflict' : 'save-failed',
        )
      }

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        decision === 'APPROVE' ? 'verification-approved' : 'verification-rejected',
      )
    }

    if (kind === 'deletion-status') {
      const deletionRequestId = readString(formData, 'deletionRequestId')
      const status = readString(formData, 'status').toUpperCase()

      if (!deletionRequestId || !DELETION_STATUSES.has(status)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existing, error: existingError } = await client
        .from('account_deletion_requests')
        .select('id, status, acknowledged_at, processed_at')
        .eq('id', deletionRequestId)
        .maybeSingle()

      if (existingError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      if (!existing?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const now = new Date().toISOString()
      const acknowledgedAt =
        status === 'PENDING'
          ? null
          : existing.acknowledged_at ?? now
      const processedAt =
        status === 'COMPLETED' || status === 'REJECTED'
          ? existing.processed_at ?? now
          : null

      const { error } = await client
        .from('account_deletion_requests')
        .update({
          status,
          acknowledged_at: acknowledgedAt,
          processed_at: processedAt,
        })
        .eq('id', deletionRequestId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.account_deletion_status_updated',
        severity: status === 'REJECTED' ? 'warn' : 'info',
        payload: {
          deletion_request_id: deletionRequestId,
          previous_status: existing.status,
          status,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'deletion-saved')
    }

    if (kind === 'review-visibility') {
      const reviewId = readString(formData, 'reviewId')
      const visibility = readString(formData, 'visibility').toUpperCase()

      if (!reviewId || !REVIEW_VISIBILITY_ACTIONS.has(visibility)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const publishNow = visibility === 'PUBLISH'
      const now = new Date().toISOString()
      const { error } = await client
        .from('reviews')
        .update({
          published_at: publishNow ? now : null,
          flagged: !publishNow,
        })
        .eq('id', reviewId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        event: 'ops.review_visibility_updated',
        severity: publishNow ? 'info' : 'warn',
        payload: {
          review_id: reviewId,
          visibility: publishNow ? 'PUBLISHED' : 'HELD',
        },
      })

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        publishNow ? 'review-published' : 'review-held',
      )
    }

    if (kind === 'conversation-access') {
      const orderId = readString(formData, 'orderId')
      const accessAction = readString(formData, 'accessAction').toUpperCase()
      const reason = readString(formData, 'reason')

      if (!orderId || !CONVERSATION_ACCESS_ACTIONS.has(accessAction)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existingOrder, error: orderError } = await client
        .from('orders')
        .select('id, stage')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !existingOrder?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const { error } = await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: accessAction === 'BLOCK' ? 'conversation.blocked' : 'conversation.unblocked',
        severity: accessAction === 'BLOCK' ? 'warn' : 'info',
        payload: {
          source: 'ops-dashboard',
          surface: 'messages',
          reason: reason.length > 0 ? reason : null,
          order_stage: existingOrder.stage,
        },
      })

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        accessAction === 'BLOCK' ? 'conversation-blocked' : 'conversation-unblocked',
      )
    }

    if (kind === 'order-review-resolution') {
      const orderId = readString(formData, 'orderId')
      const reviewType = readString(formData, 'reviewType').toUpperCase()
      const outcome = readString(formData, 'outcome').toUpperCase()
      const resolution = readString(formData, 'resolution')

      if (!orderId || !ORDER_REVIEW_TYPES.has(reviewType) || !ORDER_REVIEW_OUTCOMES.has(outcome)) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existingOrder, error: orderError } = await client
        .from('orders')
        .select('id, reference, stage, special_note')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !existingOrder?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      if (existingOrder.stage !== 'IN_DISPUTE') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const reviewMeta = parseOrderSupportMeta(existingOrder.special_note)
      const review =
        reviewType === 'CANCELLATION'
          ? reviewMeta.cancellationReview
          : reviewMeta.deliveryReview

      if (review?.status !== 'OPEN') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      const now = new Date().toISOString()
      const restoreStage = restoreStageForReview(
        reviewType === 'CANCELLATION' ? 'CANCELLATION' : 'DELIVERY',
        review.requestedFromStage,
      )
      const nextStage = outcome === 'REFUND' ? 'REFUNDED' : restoreStage
      const nextMeta: OrderSupportMeta =
        reviewType === 'CANCELLATION'
          ? {
              ...reviewMeta,
              cancellationReview: {
                ...reviewMeta.cancellationReview,
                status: 'RESOLVED',
                resolvedAt: now,
              },
            }
          : {
              ...reviewMeta,
              deliveryReview: {
                ...reviewMeta.deliveryReview,
                status: 'RESOLVED',
                resolvedAt: now,
              },
            }

      const { error: updateError } = await client
        .from('orders')
        .update({
          stage: nextStage,
          stage_updated_at: now,
          special_note: serializeOrderSupportMeta(nextMeta),
        })
        .eq('id', orderId)

      if (updateError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const reviewLabel = reviewType === 'CANCELLATION' ? 'cancellation review' : 'delivery review'
      const stageNote =
        outcome === 'REFUND'
          ? `Drape approved the ${reviewLabel}. This order will be refunded.${resolution ? ` Note: ${resolution}` : ''}`
          : `Drape reviewed the ${reviewLabel}. The order will continue from ${restoreStage}.${resolution ? ` Note: ${resolution}` : ''}`

      const { error: stageUpdateError } = await client.from('order_stage_updates').insert({
        order_id: orderId,
        stage: nextStage,
        note: stageNote,
      })

      if (stageUpdateError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: 'ops.order_review_resolved',
        severity: outcome === 'REFUND' ? 'warn' : 'info',
        payload: {
          review_type: reviewType,
          outcome,
          restored_stage: outcome === 'CONTINUE' ? restoreStage : null,
          resolution: resolution.length > 0 ? resolution : null,
        },
      })

      return redirectWithMessage(
        request,
        redirectTo,
        'notice',
        outcome === 'REFUND' ? 'order-review-refunded' : 'order-review-continued',
      )
    }

    if (kind === 'dispatch-stage') {
      const orderId = readString(formData, 'orderId')
      const targetStage = readString(formData, 'targetStage').toUpperCase()
      const provider = readString(formData, 'provider')
      const reference = readString(formData, 'reference')
      const contactName = readString(formData, 'contactName')
      const contactPhone = readString(formData, 'contactPhone')
      const trackingNumber = readString(formData, 'trackingNumber')
      const note = readString(formData, 'note')

      if (!orderId || !DISPATCH_TARGETS.has(targetStage) || !provider || !contactName || !contactPhone) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const { data: existingOrder, error: orderError } = await client
        .from('orders')
        .select('id, stage, delivery_method, recipient_name, recipient_phone, delivery_address')
        .eq('id', orderId)
        .maybeSingle()

      if (orderError || !existingOrder?.id) {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      if (existingOrder.stage !== 'READY_FOR_DRAPE_DISPATCH') {
        return redirectWithMessage(request, redirectTo, 'error', 'conflict')
      }

      if (existingOrder.delivery_method === 'LOCAL_COLLECTION') {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      if (!existingOrder.delivery_address?.trim() || !existingOrder.recipient_name?.trim() || !existingOrder.recipient_phone?.trim()) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const isLocalDelivery = existingOrder.delivery_method === 'LOCAL_DELIVERY'
      const isShipping = existingOrder.delivery_method === 'SHIPPING'

      if ((isLocalDelivery && targetStage !== 'OUT_FOR_DELIVERY') || (isShipping && targetStage !== 'SHIPPED')) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      if (isShipping && !trackingNumber && !reference) {
        return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
      }

      const now = new Date().toISOString()
      const stageNote =
        note ||
        (targetStage === 'OUT_FOR_DELIVERY'
          ? `${provider} is handling this local delivery now.`
          : `${provider} accepted this shipment for dispatch.`)

      const updatePayload: Record<string, string | null> = {
        stage: targetStage,
        stage_updated_at: now,
        fulfillment_provider: provider,
        fulfillment_reference: reference || null,
        fulfillment_contact_name: contactName,
        fulfillment_contact_phone: contactPhone,
        tracking_number: isShipping ? trackingNumber || null : null,
        carrier: isShipping ? provider : null,
      }

      const { error } = await client
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)

      if (error) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      const { error: stageUpdateError } = await client.from('order_stage_updates').insert({
        order_id: orderId,
        stage: targetStage,
        note: stageNote,
      })

      if (stageUpdateError) {
        return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
      }

      await client.from('audit_logs').insert({
        actor_role: 'OPS',
        order_id: orderId,
        event: 'ops.dispatch_stage_updated',
        severity: 'info',
        payload: {
          target_stage: targetStage,
          delivery_method: existingOrder.delivery_method,
          provider,
          reference: reference || null,
          tracking_number: isShipping ? trackingNumber || null : null,
        },
      })

      return redirectWithMessage(request, redirectTo, 'notice', 'dispatch-saved')
    }

    return redirectWithMessage(request, redirectTo, 'error', 'invalid-action')
  } catch {
    return redirectWithMessage(request, redirectTo, 'error', 'save-failed')
  }
}
