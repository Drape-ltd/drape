/**
 * request-data-access
 *
 * Lets authenticated users submit a durable in-app request for a copy of their
 * account data. V1 export handling stays request-based, but this keeps the path
 * more concrete than a generic mailto link and gives ops an audit trail.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { optionalNote, parseBody, z } from '../_shared/validate.ts'

const FN = 'request-data-access'
const REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const BodySchema = z.object({
  note: optionalNote,
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  if (typeof body.error === 'string' && typeof body.message !== 'string') {
    body.message = body.error
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

async function safeQuery<T>(
  label: string,
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
) {
  const result = await query
  if (result.error) {
    return { label, data: null, error: result.error.message }
  }
  return { label, data: result.data ?? null, error: null }
}

async function buildTailorExportPackage(
  supabase: any,
  tailorUserId: string,
  tailorProfileId: string,
) {
  const generatedAt = new Date().toISOString()

  const [
    profile,
    portfolio,
    shopItems,
    orders,
    reviews,
    payouts,
  ] = await Promise.all([
    safeQuery(
      'profile',
      supabase
        .from('tailor_profiles')
        .select('id, user_id, display_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, availability, is_verified, is_live, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, created_at, updated_at')
        .eq('id', tailorProfileId)
        .maybeSingle(),
    ),
    safeQuery(
      'portfolio',
      supabase
        .from('portfolio_photos')
        .select('id, public_url, caption, display_order, created_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('display_order', { ascending: true }),
    ),
    safeQuery(
      'shop_items',
      supabase
        .from('seller_items')
        .select('id, title, description, category, sizes, price_amount, currency, photo_urls, is_live, stock_status, inventory_quantity, size_inventory, pickup_available, delivery_available, shipping_available, created_at, updated_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('updated_at', { ascending: false }),
    ),
    safeQuery(
      'orders',
      supabase
        .from('orders')
        .select('id, reference, order_kind, garment_type, item_title, item_size, item_quantity, stage, quoted_amount, currency, quoted_currency, delivery_method, fulfillment_option, tailor_payout_currency_locked, tailor_payout_provider_locked, created_at, updated_at, stage_updated_at')
        .eq('tailor_id', tailorUserId)
        .order('created_at', { ascending: false })
        .limit(500),
    ),
    safeQuery(
      'reviews',
      supabase
        .from('reviews')
        .select('id, order_id, rating, body, content, tags, reviewer_name, tailor_response, published_at, created_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('created_at', { ascending: false })
        .limit(500),
    ),
    safeQuery(
      'payouts',
      supabase
        .from('payouts')
        .select('id, order_id, amount, currency, provider, status, blocked_reason, provider_payout_id, initiated_at, completed_at, failed_at, processed_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('processed_at', { ascending: false })
        .limit(500),
    ),
  ])

  const queryResults = [profile, portfolio, shopItems, orders, reviews, payouts]
  const errors = queryResults
    .filter((result) => result.error)
    .map((result) => ({ section: result.label, error: result.error }))

  return {
    version: 'tailor-portability-v1',
    generatedAt,
    expiresAt: new Date(Date.now() + REQUEST_WINDOW_MS).toISOString(),
    scope: 'TAILOR_PORTABILITY',
    privacyNotes: [
      'Customer contact details and measurements are not exported unless a customer has an explicit sharing path.',
      'Payment provider secrets, raw identity documents, and internal risk signals are excluded.',
      'Internal audit logs are excluded from this self-service package and remain available only to ops for compliance review.',
      'Order records are included as platform history so the tailor can understand their own business activity.',
    ],
    sections: {
      profile: profile.data,
      portfolio: portfolio.data ?? [],
      shopItems: shopItems.data ?? [],
      orderHistory: orders.data ?? [],
      reviews: reviews.data ?? [],
      payouts: payouts.data ?? [],
    },
    generationWarnings: errors,
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({ error: 'Please sign in again before requesting your data.' }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const allowed = await checkRateLimit(supabase, `request-data-access:${caller.id}`, 86400, 5)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const recentThreshold = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString()
    const { data: existing, error: existingError } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('actor_id', caller.id)
      .eq('event', 'privacy.data_access_requested')
      .gte('created_at', recentThreshold)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingError.message })
      return jsonResponse({ error: 'We could not check your existing data requests right now. Please try again.' }, 500, cors)
    }

    if (existing?.id) {
      return jsonResponse({ ok: true, alreadyPending: true }, 200, cors)
    }

    const [{ data: tailorProfile }, { data: customerProfile }] = await Promise.all([
      supabase.from('tailor_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
      supabase.from('customer_profiles').select('id').eq('user_id', caller.id).maybeSingle(),
    ])

    const actorRole = tailorProfile ? 'TAILOR' : customerProfile ? 'CUSTOMER' : 'UNKNOWN'
    const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null
    let tailorExportId: string | null = null

    if (actorRole === 'TAILOR') {
      const tailorProfileId = (tailorProfile as { id?: string } | null)?.id
      if (!tailorProfileId) {
        return jsonResponse({ error: 'We could not find your tailor profile for export. Please try again after reopening Drapeon.' }, 409, cors)
      }
      const exportPackage = await buildTailorExportPackage(supabase, caller.id, tailorProfileId)
      const { data: exportRow, error: exportError } = await supabase
        .from('tailor_data_exports')
        .insert({
          tailor_user_id: caller.id,
          status: exportPackage.generationWarnings.length > 0 ? 'IN_REVIEW' : 'READY',
          export_scope: 'TAILOR_PORTABILITY',
          generated_at: exportPackage.generatedAt,
          expires_at: exportPackage.expiresAt,
          metadata: {
            note,
            requested_from: 'MOBILE_APP',
            package_version: exportPackage.version,
            export_package: exportPackage,
            includes: [
              'profile',
              'portfolio',
              'order_history',
              'reviews',
              'payout_summary',
            ],
          },
        })
        .select('id')
        .maybeSingle()

      if (exportError) {
        log('error', FN, 'tailor_export.create_failed', { actor_id: caller.id, error: exportError.message })
        return jsonResponse({ error: 'We could not start your tailor data export right now. Please try again.' }, 500, cors)
      }
      tailorExportId = exportRow?.id ?? null
    }

    await audit(supabase, {
      event: 'privacy.data_access_requested',
      actor_id: caller.id,
      actor_role: actorRole,
      payload: {
        function: FN,
        source: 'MOBILE_APP',
        account_email: caller.email ?? null,
        note,
        reason: note,
        tailor_export_id: tailorExportId,
      },
    })

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'DATA_ACCESS_REQUEST',
      severity: 'MEDIUM',
      source: FN,
      actorId: caller.id,
      actorRole,
      userId: caller.id,
      title: 'Data access request',
      description: `${actorRole.toLowerCase()} requested an in-app copy of their account data.`,
      recommendedAction: 'Acknowledge the privacy request, verify identity if needed, and coordinate the export response.',
      dedupeKey: `data-access:${caller.id}`,
      metadata: {
        account_email: caller.email ?? null,
        note,
        source: 'MOBILE_APP',
        tailor_export_id: tailorExportId,
        export_scope: actorRole === 'TAILOR' ? 'TAILOR_PORTABILITY' : 'ACCOUNT_ACCESS',
      },
    })

    log('info', FN, 'privacy.data_access_requested', {
      actor_id: caller.id,
      actor_role: actorRole,
    })

    return jsonResponse({ ok: true, alreadyPending: false, tailorExportId }, 200, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'We could not submit your data request right now. Please try again.' }, 500, cors)
  }
})
