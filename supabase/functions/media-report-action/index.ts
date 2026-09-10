import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { enqueuePushJob } from '../_shared/side-effect-jobs.ts'
import { deriveMediaReportModeration } from '../_shared/media-report-policy.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'

const FN = 'media-report-action'
const BodySchema = z.object({
  mediaAssetId: uuid,
  reason: z.enum(['NUDITY_OR_SEXUAL', 'VIOLENCE_OR_HATE', 'CHILD_SAFETY', 'SCAM_OR_IMPERSONATION', 'OTHER']),
  details: z.string().trim().max(1000).optional(),
})

function response(body: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) return response({ code: 'UNAUTHORIZED', error: 'Sign in before reporting portfolio media.' }, 401, cors)

    const parsed = parseBody(BodySchema, await req.json())
    if (!parsed.ok) return response({ code: 'VALIDATION_ERROR', error: parsed.error }, 400, cors)
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    if (!await checkRateLimit(supabase, `media-report:${caller.id}`, 3600, 12)) return rateLimitExceededResponse(cors)

    const { data: asset, error: assetError } = await supabase
      .from('media_assets')
      .select('id,owner_user_id,tailor_profile_id,purpose,status,moderation_status,public_url')
      .eq('id', parsed.data.mediaAssetId)
      .maybeSingle()
    if (assetError) throw assetError
    if (!asset || asset.status !== 'ACTIVE' || !asset.public_url || asset.purpose !== 'PORTFOLIO' || !asset.tailor_profile_id) {
      return response({ code: 'NOT_FOUND', error: 'This media is no longer available.' }, 404, cors)
    }
    if (asset.owner_user_id === caller.id) {
      return response({ code: 'OWN_MEDIA', error: 'Use profile editing to manage your own media.' }, 400, cors)
    }

    const { data: existingReport, error: existingReportError } = await supabase
      .from('media_safety_reports')
      .select('id,created_at')
      .eq('media_asset_id', asset.id)
      .eq('reporter_user_id', caller.id)
      .eq('status', 'OPEN')
      .maybeSingle()
    if (existingReportError) throw existingReportError

    let report = existingReport
    if (!report) {
      const { data: insertedReport, error: reportError } = await supabase
        .from('media_safety_reports')
        .insert({
        media_asset_id: asset.id,
        reporter_user_id: caller.id,
        reason_code: parsed.data.reason,
        details: parsed.data.details?.trim() || null,
        status: 'OPEN',
        })
        .select('id,created_at')
        .single()
      if (reportError) {
        if (reportError.code !== '23505') throw reportError
        const { data: racedReport, error: racedReportError } = await supabase
          .from('media_safety_reports')
          .select('id,created_at')
          .eq('media_asset_id', asset.id)
          .eq('reporter_user_id', caller.id)
          .eq('status', 'OPEN')
          .single()
        if (racedReportError) throw racedReportError
        report = racedReport
      } else {
        report = insertedReport
      }
    }

    const { count: openReportCount, error: countError } = await supabase
      .from('media_safety_reports')
      .select('id', { count: 'exact', head: true })
      .eq('media_asset_id', asset.id)
      .eq('status', 'OPEN')
    if (countError) throw countError

    const policy = deriveMediaReportModeration(parsed.data.reason, openReportCount ?? 0)
    const immediateBlock = policy.automaticallyBlocked
    const reasons = [`USER_REPORT:${parsed.data.reason}`, `OPEN_REPORTS:${openReportCount ?? 0}`]
    const { error: moderationError } = await supabase.rpc('set_media_asset_moderation_status', {
      p_media_asset_id: asset.id,
      p_status: immediateBlock ? 'AUTO_BLOCKED' : asset.moderation_status,
      p_risk_level: policy.riskLevel,
      p_reasons: reasons,
      p_reviewed_by: immediateBlock ? 'publish-first-report-threshold' : null,
    })
    if (moderationError) throw moderationError

    await createOrRefreshOpsIssue(supabase, {
      issueType: 'CONTENT_FLAG',
      severity: immediateBlock ? 'CRITICAL' : 'HIGH',
      source: FN,
      actorId: caller.id,
      actorRole: 'CUSTOMER',
      userId: asset.owner_user_id,
      title: immediateBlock ? 'Portfolio media automatically restricted' : 'Portfolio media reported',
      description: immediateBlock
        ? 'Reported portfolio media crossed the safety threshold and is hidden pending Trust review.'
        : 'Published portfolio media received a user report and needs Trust review.',
      recommendedAction: 'Inspect the media and report context, then approve or block it in Review moderation.',
      dedupeKey: `media-safety:${asset.id}`,
      relatedEntityType: 'media_asset',
      relatedEntityId: asset.id,
      metadata: { media_asset_id: asset.id, reason: parsed.data.reason, open_report_count: openReportCount ?? 0, automatically_blocked: immediateBlock },
    })

    const reportId = report?.id ?? `${asset.id}:${caller.id}`
    await Promise.all([
      enqueuePushJob(supabase, {
        userId: caller.id,
        source: FN,
        idempotencyKey: `media-report:${reportId}:receipt`,
        notification: {
          title: 'Report received',
          body: immediateBlock ? 'The media is restricted while Drapeon reviews it.' : 'Drapeon Trust will review the media. It remains visible unless the safety threshold is reached.',
          preferenceKey: 'accountUpdates',
          communication: { category: 'SAFETY', purpose: 'OPERATIONAL', severity: 'NOTICE', inApp: true, destinationKey: 'TAILOR_PROFILE', destinationParams: { tailorId: asset.tailor_profile_id } },
          data: { destination: 'TAILOR_PROFILE', tailorId: asset.tailor_profile_id ?? '', mediaAssetId: asset.id },
        },
      }),
      asset.owner_user_id ? enqueuePushJob(supabase, {
        userId: asset.owner_user_id,
        source: FN,
        idempotencyKey: `media-report:${reportId}:owner`,
        notification: {
          title: immediateBlock ? 'Portfolio media temporarily restricted' : 'Portfolio media is under review',
          body: immediateBlock ? 'A safety threshold was reached. The media is hidden while Drapeon Trust reviews it.' : 'A report was received. Your media remains visible while Drapeon Trust reviews it.',
          preferenceKey: 'accountUpdates',
          communication: { category: 'SAFETY', purpose: 'OPERATIONAL', severity: immediateBlock ? 'WARNING' : 'NOTICE', mandatory: true, inApp: true, destinationKey: 'TAILOR_PROFILE_EDIT' },
          data: { destination: 'TAILOR_PROFILE_EDIT', mediaAssetId: asset.id },
        },
      }) : Promise.resolve(false),
      asset.owner_user_id ? enqueueBackgroundJob(supabase, {
        jobType: 'SEND_ACCOUNT_EVENT_EMAIL',
        eventType: 'media.safety_email_requested',
        aggregateType: 'media_asset',
        aggregateId: asset.id,
        actorRole: 'SYSTEM',
        idempotencyKey: `media-report:${reportId}:owner:email`,
        payload: {
          userId: asset.owner_user_id,
          subject: immediateBlock ? 'Portfolio media temporarily restricted' : 'Portfolio media is under review',
          headline: immediateBlock ? 'One portfolio item is temporarily hidden' : 'One portfolio item is under review',
          body: immediateBlock ? 'A safety threshold was reached. Drapeon Trust will review the item before it can return.' : 'A report was received. The item remains visible while Drapeon Trust reviews it.',
          eyebrow: 'Portfolio safety',
          ctaLabel: 'Review portfolio',
          webPath: '/account/profile',
          appUrl: 'drapeon://tailor/profile/edit',
          details: [{ label: 'Media reference', value: asset.id.slice(0, 8).toUpperCase() }],
        },
        metadata: { source: FN },
        priority: 20,
        maxAttempts: 8,
      }) : Promise.resolve(null),
    ])

    await audit(supabase, {
      event: 'media.safety_reported', actor_id: caller.id, actor_role: 'CUSTOMER', severity: immediateBlock ? 'error' : 'warn',
      payload: { function: FN, media_asset_id: asset.id, reason: parsed.data.reason, open_report_count: openReportCount ?? 0, automatically_blocked: immediateBlock },
    })
    return response({ ok: true, reportId, status: immediateBlock ? 'RESTRICTED_PENDING_REVIEW' : 'RECEIVED', openReportCount: openReportCount ?? 0 }, 200, cors)
  } catch (error) {
    log('error', FN, 'unexpected', { error: error instanceof Error ? error.message : String(error) })
    return response({ code: 'INTERNAL_ERROR', error: 'Could not submit this report right now.' }, 500, cors)
  }
})
