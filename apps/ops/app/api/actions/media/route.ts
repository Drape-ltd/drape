import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../../web/lib/ops-auth'
import { canPerformOpsAction } from '../../../../../web/lib/ops-console'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { createServiceRoleClient } from '../../../../../web/lib/server-supabase'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'

export const dynamic = 'force-dynamic'

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

function issueMediaIds(issue: { related_entity_type: string | null; related_entity_id: string | null; metadata: unknown }) {
  const metadata = issue.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata) ? issue.metadata as Record<string, unknown> : {}
  const listed = Array.isArray(metadata.media_asset_ids) ? metadata.media_asset_ids.filter((value): value is string => typeof value === 'string') : []
  return [...new Set([...listed, issue.related_entity_type === 'media_asset' ? issue.related_entity_id : null].filter((value): value is string => Boolean(value)))]
}

async function enqueueOutcome(client: NonNullable<ReturnType<typeof createServiceRoleClient>>, input: { mediaAssetId: string; ownerUserId: string; decision: 'APPROVE' | 'BLOCK'; reason: string }) {
  const approved = input.decision === 'APPROVE'
  return client.rpc('enqueue_domain_event', {
    p_event_type: 'media.moderation_decided',
    p_aggregate_type: 'media_asset',
    p_aggregate_id: input.mediaAssetId,
    p_actor_id: null,
    p_actor_role: 'OPS',
    p_order_id: null,
    p_idempotency_key: `media-moderation:${input.mediaAssetId}:${input.decision.toLowerCase()}`,
    p_payload: {
      userId: input.ownerUserId,
      subject: approved ? 'Portfolio media approved' : 'Portfolio media removed',
      eyebrow: 'Portfolio safety',
      headline: approved ? 'Your portfolio media is approved' : 'One portfolio item was removed',
      body: approved ? 'Drapeon Trust completed its review. The media is available on your public profile.' : `Drapeon Trust removed the media from public surfaces. ${input.reason}`,
      ctaLabel: 'Review portfolio',
      webPath: '/account/profile',
      appUrl: 'drapeon://tailor/profile/edit',
      details: [{ label: 'Media reference', value: input.mediaAssetId.slice(0, 8).toUpperCase() }],
      notification: {
        title: approved ? 'Portfolio media approved' : 'Portfolio media removed',
        body: approved ? 'The reviewed media is visible on your public profile.' : 'Drapeon Trust removed one item from your public profile.',
        preferenceKey: 'accountUpdates',
        data: { destination: 'TAILOR_PROFILE_EDIT', mediaAssetId: input.mediaAssetId },
      },
    },
    p_metadata: { source: 'ops-media-moderation' },
    p_jobs: ['SEND_PUSH', 'SEND_ACCOUNT_EVENT_EMAIL'],
    p_priority: 20,
    p_max_attempts: 8,
    p_run_at: new Date().toISOString(),
  })
}

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID()
  if (!validateOpsMutationOrigin(request).ok) return json({ error: 'invalid-origin', correlationId }, 403)
  if (isRestrictedOpsPhoneHeaders(request.headers)) return json({ error: 'desktop-only-action', correlationId }, 403)

  const session = await getOpsSession()
  if (!session?.allowed || !session.email || !isNamedOpsWorkforceSession(session)) return json({ error: 'named-workforce-session-required', correlationId }, 401)
  if (!hasFreshOpsMfa(session)) return json({ error: 'protected-access-required', correlationId }, 401)
  if (!canPerformOpsAction(session.role, 'media-moderation')) return json({ error: 'media-moderation-not-authorized', correlationId }, 403)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const issueId = typeof body?.issueId === 'string' ? body.issueId.trim() : ''
  const mediaAssetId = typeof body?.mediaAssetId === 'string' ? body.mediaAssetId.trim() : ''
  const decision = typeof body?.decision === 'string' ? body.decision.trim().toUpperCase() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!issueId || !mediaAssetId || (decision !== 'APPROVE' && decision !== 'BLOCK') || (decision === 'BLOCK' && reason.length < 8)) {
    return json({ error: decision === 'BLOCK' ? 'A removal reason of at least 8 characters is required.' : 'invalid-media-decision', correlationId }, 400)
  }

  const client = createServiceRoleClient()
  if (!client) return json({ error: 'media-moderation-unavailable', correlationId }, 503)
  const { data: issue, error: issueError } = await client
    .from('ops_issues')
    .select('id,status,canonical_status,assigned_to,resolved_at,related_entity_type,related_entity_id,metadata')
    .eq('id', issueId)
    .maybeSingle()
  if (issueError || !issue?.id) return json({ error: issueError?.message ?? 'case-not-found', correlationId }, 404)
  const mediaIds = issueMediaIds(issue)
  if (!mediaIds.includes(mediaAssetId)) return json({ error: 'media-is-not-linked-to-this-case', correlationId }, 403)

  const { data: asset, error: assetError } = await client
    .from('media_assets')
    .select('id,owner_user_id,moderation_status')
    .eq('id', mediaAssetId)
    .maybeSingle()
  if (assetError || !asset?.id || !asset.owner_user_id) return json({ error: assetError?.message ?? 'media-asset-not-found', correlationId }, 404)
  const desiredStatus = decision === 'APPROVE' ? 'APPROVED' : 'BLOCKED'
  if (asset.moderation_status === desiredStatus) return json({ ok: true, alreadyCompleted: true, correlationId }, 200)
  if (['APPROVED', 'AUTO_ALLOWED', 'BLOCKED'].includes(String(asset.moderation_status))) return json({ error: 'media-decision-already-completed', correlationId }, 409)

  const { error: moderationError } = await client.rpc('set_media_asset_moderation_status', {
    p_media_asset_id: mediaAssetId,
    p_status: desiredStatus,
    p_risk_level: decision === 'APPROVE' ? 'LOW' : 'HIGH',
    p_reasons: decision === 'APPROVE' ? [] : [`OPS_BLOCK:${reason}`],
    p_reviewed_by: session.email,
  })
  if (moderationError) return json({ error: moderationError.message, correlationId }, 409)

  await client.from('media_safety_reports').update({
    status: decision === 'APPROVE' ? 'DISMISSED' : 'RESOLVED',
    resolved_at: new Date().toISOString(),
    resolved_by: session.email,
  }).eq('media_asset_id', mediaAssetId).eq('status', 'OPEN')

  const { data: linkedAssets } = await client.from('media_assets').select('id,moderation_status').in('id', mediaIds)
  const remaining = (linkedAssets ?? []).filter((entry) => !['APPROVED', 'AUTO_ALLOWED', 'BLOCKED'].includes(String(entry.moderation_status))).length
  const resolvedAt = remaining === 0 ? new Date().toISOString() : null
  const nextLegacyStatus = remaining === 0 ? 'RESOLVED' : 'IN_REVIEW'
  const nextCanonicalStatus = remaining === 0 ? 'RESOLVED' : 'IN_PROGRESS'
  const { error: issueUpdateError } = await client.from('ops_issues').update({
    status: nextLegacyStatus,
    canonical_status: nextCanonicalStatus,
    assigned_to: session.email,
    resolved_at: resolvedAt,
    recommended_action: remaining === 0 ? 'No action. Every media asset linked to this safety review has a terminal decision.' : `Review the ${remaining} remaining media item${remaining === 1 ? '' : 's'} linked to this case.`,
  }).eq('id', issueId)

  await client.from('ops_audit_logs').insert({
    issue_id: issueId,
    action_taken: decision === 'APPROVE' ? 'MEDIA_APPROVED' : 'MEDIA_BLOCKED',
    performed_by: session.email,
    performed_role: session.role.toUpperCase(),
    reason: reason || decision,
    before_state: { status: issue.status, canonical_status: issue.canonical_status, assigned_to: issue.assigned_to, resolved_at: issue.resolved_at, media_asset_id: mediaAssetId, moderation_status: asset.moderation_status },
    after_state: { status: nextLegacyStatus, canonical_status: nextCanonicalStatus, assigned_to: session.email, resolved_at: resolvedAt, media_asset_id: mediaAssetId, moderation_status: desiredStatus, remaining_media_assets: remaining },
  })
  await client.from('audit_logs').insert({
    actor_role: 'OPS',
    event: 'ops.media_moderation_updated',
    severity: decision === 'APPROVE' ? 'info' : 'warn',
    payload: { issue_id: issueId, media_asset_id: mediaAssetId, previous_status: asset.moderation_status, decision, reason: reason || null, correlation_id: correlationId },
  })
  const delivery = await enqueueOutcome(client, { mediaAssetId, ownerUserId: asset.owner_user_id, decision, reason })
  if (issueUpdateError || delivery.error) {
    return json({
      ok: true,
      warning: issueUpdateError ? 'Media changed, but the case status needs reconciliation.' : 'Media changed, but the owner notification needs reconciliation.',
      correlationId,
    }, 207)
  }
  return json({ ok: true, remaining, correlationId }, 200)
}
