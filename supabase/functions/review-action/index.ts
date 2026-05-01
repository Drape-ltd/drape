import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'review-action'
const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
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

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit-tailor-review'),
    orderId: uuid,
    reviewerName: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(300).optional(),
    tags: ReviewTags,
  }),
  z.object({
    action: z.literal('upsert-customer-review'),
    orderId: uuid,
    customerId: uuid.optional(),
    reviewerName: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(300).optional(),
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
      return jsonError(cors, 429, 'RATE_LIMITED', 'Too many review attempts right now. Please wait a moment before trying again.')
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
      if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
        return jsonError(cors, 409, 'ORDER_NOT_READY_FOR_REVIEW', 'This order is not ready for review yet.')
      }
      if (reviewWindowClosed(order.stage_updated_at ?? null)) {
        return jsonError(cors, 409, 'REVIEW_WINDOW_CLOSED', 'This review window has closed. Reviews can only be added within 14 days of delivery, collection, or completion.')
      }

      const { data: dispute, error: disputeError } = await supabase
        .from('disputes')
        .select('status')
        .eq('order_id', body.orderId)
        .maybeSingle()

      if (disputeError) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: disputeError.message })
        return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this order review right now.')
      }

      const holdReasons = [
        ...reviewHoldReasons(reviewBody),
        ...(dispute && ['OPEN', 'UNDER_REVIEW'].includes(dispute.status) ? ['OPEN_DISPUTE'] : []),
      ]
      const publicationStatus = holdReasons.length > 0 ? 'held' : 'published'
      const publishedAt = publicationStatus === 'published' ? new Date().toISOString() : null

      const { data: savedReview, error } = await supabase
        .from('reviews')
        .upsert({
          order_id: body.orderId,
          tailor_id: order.tailor_id,
          tailor_profile_id: order.tailor_profile_id,
          reviewer_name: body.reviewerName,
          rating: body.rating,
          body: reviewBody || null,
          tags: body.tags,
          published_at: publishedAt,
          flagged: publicationStatus === 'held',
        }, { onConflict: 'order_id' })
        .select('id')
        .single()

      if (error) {
        log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: error.message })
        return jsonError(cors, 500, 'REVIEW_SAVE_FAILED', error.message ?? 'Could not submit review.')
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
            publication_status: publicationStatus,
          },
        })
      }

      await audit(supabase, {
        event: 'review.tailor_submitted',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: body.orderId,
        payload: { rating: body.rating, tag_count: body.tags.length, publication_status: publicationStatus },
      })

      return jsonResponse({ ok: true, publicationStatus }, 200, cors)
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, stage, stage_updated_at, customer_id, tailor_id')
      .eq('id', body.orderId)
      .single()

    if (orderError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: orderError.message })
      return jsonError(cors, 500, 'DATABASE_ERROR', 'Could not load this customer review right now.')
    }
    if (!order) return jsonError(cors, 404, 'ORDER_NOT_FOUND', 'This order review could not be found anymore.')
    if (order.tailor_id?.toString() !== caller.id) return jsonError(cors, 403, 'FORBIDDEN', 'This review is not available from your account.')
    if (!order.customer_id?.toString()) return jsonError(cors, 409, 'CUSTOMER_MISSING', 'This order is missing the customer details needed for review.')
    if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
      return jsonError(cors, 409, 'ORDER_NOT_READY_FOR_REVIEW', 'You can review a customer after delivery or collection.')
    }
    if (reviewWindowClosed(order.stage_updated_at ?? null)) {
      return jsonError(cors, 409, 'REVIEW_WINDOW_CLOSED', 'This review window has closed. Reviews can only be added within 14 days of delivery, collection, or completion.')
    }

    const { error } = await supabase
      .from('customer_reviews')
      .upsert({
        order_id: body.orderId,
        customer_id: order.customer_id,
        tailor_id: caller.id,
        reviewer_name: body.reviewerName,
        rating: body.rating,
        body: reviewBody || null,
        tags: body.tags,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'order_id' })

    if (error) {
      log('error', FN, 'db.error', { actor_id: caller.id, order_id: body.orderId, error: error.message })
      return jsonError(cors, 500, 'REVIEW_SAVE_FAILED', error.message ?? 'Could not save review.')
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
