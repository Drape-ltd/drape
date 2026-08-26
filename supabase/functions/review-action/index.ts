import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'

const FN = 'review-action'
const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const REVIEW_PUBLICATION_HOLD_MS = 10 * 60 * 1000
const THREATENING_LANGUAGE_PATTERNS = [
  /\b(i('ll| will|'m going to| am going to)) (kill|hurt|harm|beat|attack|destroy|ruin) (you|u|your|ur)\b/i,
  /\b(you('re| are) (dead|finished|done)|watch your back|i know where you live)\b/i,
]
const REVIEW_HOLD_RULES = [
  {
    reason: 'ABUSIVE_LANGUAGE',
    pattern: /\b(fuck|fucking|shit|bullshit|bitch|bastard|asshole|idiot|stupid|useless)\b/i,
  },
  {
    reason: 'SERIOUS_ALLEGATION',
    pattern: /\b(scammer|fraud(?:ster)?|thief|criminal)\b/i,
  },
] as const

const ReviewTags = z.array(z.string().trim().min(1).max(40)).max(8)
const ReviewMediaUrls = z.array(z.string().trim().min(1).max(1000)).max(6).default([])

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit-tailor-review'),
    orderId: uuid,
    reviewerName: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(1000).optional(),
    tags: ReviewTags,
    mediaUrls: ReviewMediaUrls.optional(),
  }),
  z.object({
    action: z.literal('upsert-customer-review'),
    orderId: uuid,
    customerId: uuid.optional(),
    reviewerName: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(1000).optional(),
    tags: ReviewTags,
  }),
])

function jsonResponse(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, code: string, error: string) {
  return jsonResponse({ code, error }, status, cors)
}

function hasThreateningLanguage(text: string) {
  return THREATENING_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text))
}

function reviewWindowClosed(stageUpdatedAt: string | null) {
  if (!stageUpdatedAt) return false
  const reviewClock = new Date(stageUpdatedAt).getTime()
  if (Number.isNaN(reviewClock)) return false
  return Date.now() - reviewClock > REVIEW_WINDOW_MS
}

function reviewHoldReasons(text: string) {
  return REVIEW_HOLD_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.reason)
}

function encodeStoragePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function reviewMediaObjectPath(value: string, supabaseUrl: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  let rawPath = trimmed
  try {
    const parsed = new URL(trimmed)
    const expectedHost = new URL(supabaseUrl).host
    if (parsed.host !== expectedHost) return null
    const marker = '/storage/v1/object/public/review-media/'
    if (!parsed.pathname.startsWith(marker)) return null
    rawPath = parsed.pathname.slice(marker.length)
  } catch {
    rawPath = trimmed.replace(/^\/+/, '')
    if (rawPath.startsWith('review-media/')) rawPath = rawPath.slice('review-media/'.length)
  }

  try {
    return rawPath
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
      .join('/')
  } catch {
    return null
  }
}

function canonicalReviewMediaUrl(objectPath: string, supabaseUrl: string) {
  return `${supabaseUrl.replace(/\/+$/u, '')}/storage/v1/object/public/review-media/${encodeStoragePath(objectPath)}`
}

function validateReviewMediaUrls(input: string[] | undefined, params: { orderId: string; customerId: string; supabaseUrl: string }) {
  const urls = input ?? []
  const next: string[] = []
  for (const value of urls) {
    const objectPath = reviewMediaObjectPath(value, params.supabaseUrl)
    const parts = objectPath?.split('/').filter(Boolean) ?? []
    if (
      !objectPath ||
      parts.length < 4 ||
      parts[0] !== 'reviews' ||
      parts[1] !== params.orderId ||
      parts[2] !== params.customerId
    ) {
      return { ok: false as const, urls: [], error: 'Review media must be uploaded from this order before submitting.' }
    }
    const canonicalUrl = canonicalReviewMediaUrl(objectPath, params.supabaseUrl)
    if (!next.includes(canonicalUrl)) next.push(canonicalUrl)
  }
  return { ok: true as const, urls: next }
}

async function completeReviewedOrder(
  supabase: any,
  order: { id: string; stage: string; customer_id?: string | null },
) {
  if (order.stage === 'COMPLETE') return { ok: true as const, duplicate: true }
  if (!['DELIVERED', 'COLLECTED'].includes(order.stage)) {
    return { ok: false as const, error: `Order stage ${order.stage} cannot be completed from a review.` }
  }

  const nowIso = new Date().toISOString()
  const { error: handoffError } = await supabase
    .from('orders')
    .update({
      handoff_completed_at: nowIso,
      customer_handoff_confirmed_at: nowIso,
      // Keep the persisted source inside the established payout/handoff
      // contract. The audit event below preserves that the completion was
      // specifically driven by a submitted review.
      handoff_confirmation_source: 'CUSTOMER_COMPLETE',
    })
    .eq('id', order.id)
    .eq('stage', order.stage)

  if (handoffError) return { ok: false as const, error: handoffError.message }

  try {
    const result = await finalizeOrderTerminal(supabase, order.id, {
      p_target_stage: 'COMPLETE',
      p_actor_id: order.customer_id?.toString() ?? null,
      p_actor_role: 'CUSTOMER',
      p_event: 'order.completed_after_review',
      p_note: 'Customer submitted their review and completed the order.',
      p_payload: { completion_source: 'CUSTOMER_REVIEW' },
      p_expected_stages: ['DELIVERED', 'COLLECTED'],
    })
    return { ok: true as const, duplicate: result.idempotent === true }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonError(cors, 401, 'UNAUTHORIZED', 'You need to sign in again before submitting a review.')
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonError(cors, 400, 'VALIDATION_FAILED', parsed.error)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 30)
    if (!allowed) {
      return rateLimitExceededResponse(cors)
    }

    const body = parsed.data
    const reviewBody = body.body?.trim() ?? ''
    const blockedReview = await rejectIfBlockedContact({
      supabase,
      fn: FN,
      cors,
      actorId: caller.id,
      actorRole: body.action === 'submit-tailor-review' ? 'CUSTOMER' : 'TAILOR',
      surface: body.action === 'submit-tailor-review' ? 'reviews.tailor.body' : 'reviews.customer.body',
      text: reviewBody,
      message: "Contact details can't be included in reviews.",
      orderId: body.orderId,
      extra: { action: body.action },
    })
    if (blockedReview) return blockedReview

    if (reviewBody && hasThreateningLanguage(reviewBody)) {
      await audit(supabase, {
        event: 'review.blocked',
        actor_id: caller.id,
        actor_role: body.action === 'submit-tailor-review' ? 'CUSTOMER' : 'TAILOR',
        order_id: body.orderId,
        severity: 'warn',
        payload: {
          function: FN,
          action: body.action,
          reason: 'THREATENING_LANGUAGE',
        },
      })

      log('warn', FN, 'review.blocked', {
        actor_id: caller.id,
        order_id: body.orderId,
        action: body.action,
        reason: 'THREATENING_LANGUAGE',
      })

      return jsonError(
        cors,
        400,
        'THREATENING_LANGUAGE',
        "That review can't be submitted. Keep the wording respectful — our team reviews flagged submissions.",
      )
    }

    if (body.action === 'submit-tailor-review') {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, stage, stage_updated_at, customer_id, tailor_id, tailor_profile_id')
        .eq('id', body.orderId)
        .single()

      if (orderError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: orderError.message })
        return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this order review right now.')
      }
      if (!order) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order review could not be found anymore.')
      if (order.customer_id?.toString() !== caller.id) return jsonError(cors, 403, 'FORBIDDEN', 'This review is not available from your account.')

      const { data: dispute, error: disputeError } = await supabase
        .from('disputes')
        .select('status')
        .eq('order_id', body.orderId)
        .maybeSingle()

      if (disputeError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: disputeError.message })
        return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this order review right now.')
      }

      const { data: existingReview, error: existingReviewError } = await supabase
        .from('reviews')
        .select('id, flagged, published_at')
        .eq('order_id', body.orderId)
        .maybeSingle()

      if (existingReviewError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: existingReviewError.message, surface: 'reviews.existing' })
        return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this order review right now.')
      }

      // Recover a prior half-finished attempt without creating a second review.
      // This can happen when the review persisted but the old client made a
      // separate completion request that timed out or was rate limited.
      if (existingReview?.id) {
        const completion = await completeReviewedOrder(supabase, order)
        if (!completion.ok) {
          log('error', FN, 'review.completion_failed', {
            actor_id: caller.id,
            order_id: body.orderId,
            existing_review_id: existingReview.id,
            error: completion.error,
          })
          return jsonError(cors, 500, 'ORDER_COMPLETION_FAILED', 'Your review is saved. Drapeon is still finishing the order record.')
        }
        await audit(supabase, {
          event: 'order.completed_after_review',
          actor_id: caller.id,
          actor_role: 'CUSTOMER',
          order_id: body.orderId,
          payload: { review_id: existingReview.id, recovered: true },
        })
        return jsonResponse({
          ok: true,
          duplicate: true,
          orderCompleted: true,
          publicationStatus: existingReview.flagged ? 'held' : 'published',
        }, 200, cors)
      }

      const reviewPreflight = runPreflight([
        {
          name: 'order_ready_for_review',
          condition: ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage),
          errorCode: 'ORDER_NOT_READY_FOR_REVIEW',
          message: 'This order is not ready for review yet.',
          field: 'stage',
          severity: 'BLOCKING',
          actual: { stage: order.stage },
        },
        {
          name: 'review_window_open',
          condition: !reviewWindowClosed(order.stage_updated_at ?? null),
          errorCode: 'REVIEW_WINDOW_CLOSED',
          message: 'This review window has closed. Reviews can only be added within 14 days of delivery, collection, or completion.',
          field: 'stage_updated_at',
          severity: 'BLOCKING',
          actual: { stage_updated_at: order.stage_updated_at ?? null },
        },
        {
          name: 'one_review_per_order',
          condition: !existingReview?.id,
          errorCode: 'REVIEW_ALREADY_SUBMITTED',
          message: 'You already reviewed this order.',
          field: 'order_id',
          severity: 'BLOCKING',
          actual: { existingReviewId: existingReview?.id ?? null },
        },
      ])

      if (!reviewPreflight.passed) {
        await logPreflightFailure(supabase, reviewPreflight, {
          operation: 'submit_tailor_review',
          entityType: 'order',
          entityId: body.orderId,
          orderId: body.orderId,
          actorId: caller.id,
          actorRole: 'CUSTOMER',
          userId: caller.id,
          source: FN,
          metadata: { rating: body.rating },
        })
        return preflightFailureResponse(reviewPreflight, cors, 409)
      }

      const mediaValidation = validateReviewMediaUrls(body.mediaUrls, {
        orderId: body.orderId,
        customerId: caller.id,
        supabaseUrl: getSupabaseUrl(),
      })
      if (!mediaValidation.ok) {
        return jsonError(cors, 400, 'INVALID_REVIEW_MEDIA', mediaValidation.error)
      }

      const holdReasons = [
        ...reviewHoldReasons(reviewBody),
        ...(dispute && ['OPEN', 'UNDER_REVIEW'].includes(dispute.status) ? ['OPEN_DISPUTE'] : []),
      ]
      const publicationStatus = holdReasons.length > 0 ? 'held' : 'pending'
      const publishedAt = publicationStatus === 'pending'
        ? new Date(Date.now() + REVIEW_PUBLICATION_HOLD_MS).toISOString()
        : null

      const { data: savedReview, error } = await supabase
        .from('reviews')
        .insert({
          order_id: body.orderId,
          tailor_id: order.tailor_id,
          tailor_profile_id: order.tailor_profile_id,
          reviewer_name: body.reviewerName,
          rating: body.rating,
          body: reviewBody || null,
          tags: body.tags,
          media_urls: mediaValidation.urls,
          published_at: publishedAt,
          flagged: publicationStatus === 'held',
        })
        .select('id')
        .single()

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: error.message })
        return jsonError(cors, 500, 'REVIEW_SAVE_FAILED', 'We could not save your review right now. Please try again in a moment.')
      }

      if (publicationStatus === 'held') {
        await audit(supabase, {
          event: 'review.held',
          actor_id: caller.id,
          actor_role: 'CUSTOMER',
          order_id: body.orderId,
          severity: 'warn',
          payload: {
            rating: body.rating,
            reasons: holdReasons,
            media_count: mediaValidation.urls.length,
          },
        })

        await createOrRefreshOpsIssue(supabase, {
          issueType: 'CONTENT_FLAG',
          severity: 'MEDIUM',
          source: FN,
          actorId: caller.id,
          actorRole: 'CUSTOMER',
          orderId: body.orderId,
          userId: caller.id,
          relatedEntityType: 'review',
          relatedEntityId: (savedReview as { id?: string } | null)?.id ?? null,
          title: 'Review held for moderation',
          description: 'A customer review was held before publication and needs trust moderation.',
          recommendedAction: 'Review the text, hold reasons, and dispute context, then either publish the review or keep it held with a documented moderation note.',
          dedupeKey: `review-held:${(savedReview as { id?: string } | null)?.id ?? body.orderId}`,
          metadata: {
            reasons: holdReasons,
            rating: body.rating,
            tag_count: body.tags.length,
            media_count: mediaValidation.urls.length,
            publication_status: publicationStatus,
          },
        })
      }

      await audit(supabase, {
        event: 'review.tailor_submitted',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: body.orderId,
        payload: { rating: body.rating, tag_count: body.tags.length, media_count: mediaValidation.urls.length, publication_status: publicationStatus },
      })

      const completion = await completeReviewedOrder(supabase, order)
      if (!completion.ok) {
        log('error', FN, 'review.completion_failed', {
          actor_id: caller.id,
          order_id: body.orderId,
          review_id: (savedReview as { id?: string } | null)?.id ?? null,
          error: completion.error,
        })
        return jsonError(cors, 500, 'ORDER_COMPLETION_FAILED', 'Your review is saved. Drapeon is still finishing the order record.')
      }

      await audit(supabase, {
        event: 'order.completed_after_review',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: body.orderId,
        payload: {
          review_id: (savedReview as { id?: string } | null)?.id ?? null,
          recovered: false,
          media_count: mediaValidation.urls.length,
        },
      })

      return jsonResponse({ ok: true, publicationStatus, orderCompleted: true }, 200, cors)
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, stage, stage_updated_at, customer_id, tailor_id')
      .eq('id', body.orderId)
      .maybeSingle()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: orderError.message })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this customer review right now.')
    }

    const { data: existingCustomerReview, error: existingCustomerReviewError } = await supabase
      .from('customer_reviews')
      .select('id')
      .eq('order_id', body.orderId)
      .maybeSingle()

    if (existingCustomerReviewError) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: existingCustomerReviewError.message, surface: 'customer_reviews.existing' })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this customer review right now.')
    }

    const customerReviewPreflight = runPreflight([
      {
        name: 'order_exists',
        condition: !!order?.id,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'This order review could not be found anymore.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { orderId: body.orderId },
      },
      {
        name: 'tailor_owns_order',
        condition: order?.tailor_id?.toString() === caller.id,
        errorCode: 'REVIEW_FORBIDDEN',
        message: 'This review is not available from your account.',
        field: 'orderId',
        severity: 'BLOCKING',
        actual: { callerId: caller.id, tailorId: order?.tailor_id ?? null },
      },
      {
        name: 'customer_present',
        condition: !!order?.customer_id?.toString(),
        errorCode: 'CUSTOMER_MISSING',
        message: 'This order is missing the customer details needed for review.',
        field: 'customer_id',
        severity: 'BLOCKING',
        actual: { customerId: order?.customer_id ?? null },
      },
      {
        name: 'order_ready_for_review',
        condition: !!order?.stage && ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage),
        errorCode: 'ORDER_NOT_READY_FOR_REVIEW',
        message: 'You can review a customer after delivery or collection.',
        field: 'stage',
        severity: 'BLOCKING',
        actual: { stage: order?.stage ?? null },
      },
      {
        name: 'review_window_open',
        condition: !reviewWindowClosed(order?.stage_updated_at ?? null),
        errorCode: 'REVIEW_WINDOW_CLOSED',
        message: 'This review window has closed. Reviews can only be added within 14 days of delivery, collection, or completion.',
        field: 'stage_updated_at',
        severity: 'BLOCKING',
        actual: { stage_updated_at: order?.stage_updated_at ?? null },
      },
      {
        name: 'one_review_per_order',
        condition: !existingCustomerReview?.id,
        errorCode: 'REVIEW_ALREADY_SUBMITTED',
        message: 'You already reviewed this customer for this order.',
        field: 'order_id',
        severity: 'BLOCKING',
        actual: { existingReviewId: existingCustomerReview?.id ?? null },
      },
    ])

    if (!customerReviewPreflight.passed) {
      await logPreflightFailure(supabase, customerReviewPreflight, {
        operation: 'submit_customer_review',
        entityType: 'order',
        entityId: body.orderId,
        orderId: body.orderId,
        actorId: caller.id,
        actorRole: 'TAILOR',
        userId: caller.id,
        source: FN,
        metadata: { rating: body.rating },
      })
      return preflightFailureResponse(
        customerReviewPreflight,
        cors,
        !order?.id ? 404 : order.tailor_id?.toString() !== caller.id ? 403 : 409,
      )
    }
    if (!order?.id || !order.customer_id) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order review could not be found anymore.')

    const { error } = await supabase
      .from('customer_reviews')
      .insert({
        order_id: body.orderId,
        customer_id: order.customer_id,
        tailor_id: caller.id,
        reviewer_name: body.reviewerName,
        rating: body.rating,
        body: reviewBody || null,
        tags: body.tags,
        updated_at: new Date().toISOString(),
      })

    if (error) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: error.message })
      return jsonError(cors, 500, 'REVIEW_SAVE_FAILED', 'We could not save your review right now. Please try again in a moment.')
    }

    await audit(supabase, {
      event: 'review.customer_submitted',
      actor_id: caller.id,
      actor_role: 'TAILOR',
      order_id: body.orderId,
      payload: { rating: body.rating, tag_count: body.tags.length },
    })

    return jsonResponse({ ok: true }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'INTERNAL_ERROR', 'Could not submit this review right now.')
  }
})
