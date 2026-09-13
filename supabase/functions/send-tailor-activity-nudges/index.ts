import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { audit, log } from '../_shared/logger.ts'
import { Sentry } from '../_shared/sentry.ts'
import {
  chooseTailorActivityNudge,
  type TailorActivityCandidate,
} from '../_shared/tailor-activity-nudges.ts'

const FN = 'send-tailor-activity-nudges'
const MAX_PROFILES_PER_RUN = 500

type CandidateRow = {
  profile_id: string
  user_id: string
  display_name: string | null
  is_live: boolean
  availability: string | null
  supports_ready_made: boolean
  last_sign_in_at: string | null
  verified_at: string | null
  created_at: string
  oldest_draft_created_at: string | null
  draft_item_count: number | string
  live_item_count: number | string
  saves_count: number | string
  orders_last_30_days: number | string
  total_orders: number | string
  total_reviews: number | string
  avg_rating: number | string
  last_activity_nudge_at: string | null
}

function count(value: number | string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toCandidate(row: CandidateRow): TailorActivityCandidate {
  return {
    profileId: row.profile_id,
    displayName: row.display_name?.trim() || 'your Drapeon profile',
    isLive: row.is_live,
    availability: row.availability,
    supportsReadyMade: row.supports_ready_made,
    lastSignInAt: row.last_sign_in_at,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    oldestDraftCreatedAt: row.oldest_draft_created_at,
    draftItemCount: count(row.draft_item_count),
    liveItemCount: count(row.live_item_count),
    savesCount: count(row.saves_count),
    ordersLast30Days: count(row.orders_last_30_days),
    totalOrders: count(row.total_orders),
    totalReviews: count(row.total_reviews),
    avgRating: count(row.avg_rating),
    lastActivityNudgeAt: row.last_activity_nudge_at,
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const unauthorized = await authorizeCronRequest(req, FN, cors)
  if (unauthorized) return unauthorized

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  try {
    const { data, error } = await supabase.rpc('tailor_activity_nudge_candidates', {
      p_limit: MAX_PROFILES_PER_RUN,
    })
    if (error) throw error

    let eligible = 0
    let pushQueued = 0
    let emailQueued = 0
    const selected: Record<string, number> = {}

    for (const row of (data ?? []) as CandidateRow[]) {
      const candidate = toCandidate(row)
      const nudge = chooseTailorActivityNudge(candidate)
      if (!nudge) continue
      eligible += 1
      selected[nudge.kind] = (selected[nudge.kind] ?? 0) + 1

      const dedupeBase = `tailor-activity:${candidate.profileId}:${nudge.kind}:${nudge.stage}`
      const push = await enqueueBackgroundJob(supabase, {
        eventType: 'TAILOR_ACTIVITY_NUDGE',
        aggregateType: 'TAILOR_PROFILE',
        aggregateId: candidate.profileId,
        actorId: row.user_id,
        actorRole: 'TAILOR',
        idempotencyKey: `${dedupeBase}:push`,
        jobType: 'SEND_PUSH',
        priority: 70,
        payload: {
          userId: row.user_id,
          notification: {
            title: nudge.title,
            body: nudge.body,
            data: {
              type: `tailor_${nudge.kind.replaceAll('-', '_')}`,
              url: nudge.webPath,
              profileId: candidate.profileId,
            },
            preferenceKey: nudge.emailOptional ? 'platformUpdates' : 'orderUpdates',
            communication: {
              category: nudge.emailOptional ? 'PRODUCT_UPDATE' : 'ACCOUNT',
              purpose: 'OPERATIONAL',
              severity: 'INFO',
              inApp: true,
              destinationKey: nudge.destinationKey,
              destinationParams: { profileId: candidate.profileId },
              deduplicationKey: dedupeBase,
            },
          },
        },
      })
      if (push) pushQueued += 1

      const email = await enqueueBackgroundJob(supabase, {
        eventType: 'TAILOR_ACTIVITY_NUDGE',
        aggregateType: 'TAILOR_PROFILE',
        aggregateId: candidate.profileId,
        actorId: row.user_id,
        actorRole: 'TAILOR',
        idempotencyKey: `${dedupeBase}:email`,
        jobType: 'SEND_ACCOUNT_EVENT_EMAIL',
        priority: 75,
        payload: {
          userId: row.user_id,
          subject: nudge.emailSubject,
          eyebrow: nudge.eyebrow,
          headline: nudge.title,
          body: nudge.body,
          ctaLabel: nudge.ctaLabel,
          webPath: nudge.webPath,
          appUrl: nudge.appUrl,
          details: nudge.details,
          ...(nudge.emailOptional
            ? {
                optionalCommunication: {
                  category: 'PRODUCT_UPDATE',
                  purpose: 'OPERATIONAL',
                },
              }
            : {}),
        },
      })
      if (email) emailQueued += 1
    }

    await audit(supabase, {
      event: 'tailor.activity_nudges_queued',
      actor_role: 'SYSTEM',
      payload: {
        function: FN,
        scanned: data?.length ?? 0,
        eligible,
        push_queued: pushQueued,
        email_queued: emailQueued,
        selected,
      },
    })

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: data?.length ?? 0,
        eligible,
        pushQueued,
        emailQueued,
        selected,
      }),
      {
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', FN, 'failed', { error: message })
    await Sentry.captureMessage('Tailor activity nudges failed', {
      level: 'error',
      tags: { function: FN },
      extra: { safe_error: message },
    })
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Tailor activity nudges failed.',
      }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    )
  }
})
