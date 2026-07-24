import { NextResponse } from 'next/server'
import { getOpsSession } from '../../../../lib/ops-auth'
import { canAccessOpsSection } from '../../../../lib/ops-console'
import { createServiceRoleClient } from '../../../../lib/server-supabase'

const TRUST_VIDEO_BUCKET = 'trust-verification'
const SIGNED_URL_TTL_SECONDS = 5 * 60

function normalizeStoragePath(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const marker = `/${TRUST_VIDEO_BUCKET}/`
  const markerIndex = trimmed.indexOf(marker)
  return markerIndex >= 0
    ? trimmed.slice(markerIndex + marker.length)
    : trimmed.replace(/^\/+/, '').replace(/^trust-verification\//u, '')
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const session = await getOpsSession()
  if (!session || !canAccessOpsSection(session.role, 'verification')) {
    return NextResponse.json({ error: 'Trust evidence access is restricted.' }, { status: 403 })
  }

  const client = createServiceRoleClient()
  if (!client) {
    return NextResponse.json({ error: 'Trust evidence service is unavailable.' }, { status: 503 })
  }

  const { profileId } = await context.params
  const { data: profile, error: profileError } = await client
    .from('tailor_profiles')
    .select('id, user_id, trust_verification_video_path')
    .eq('id', profileId)
    .maybeSingle()

  const videoPath = normalizeStoragePath(profile?.trust_verification_video_path)
  if (profileError || !profile?.id || !videoPath) {
    return NextResponse.json({ error: 'Trust evidence was not found.' }, { status: 404 })
  }

  let actorId: string | null = null
  if (session.email) {
    const { data: actor } = await client
      .from('users')
      .select('id')
      .eq('email', session.email)
      .maybeSingle()
    actorId = actor?.id ?? null
  }

  const { error: accessLogError } = await client
    .from('identity_document_access_log')
    .insert({
      tailor_user_id: profile.user_id,
      tailor_profile_id: profile.id,
      actor_id: actorId,
      actor_identifier: session.email ?? `bootstrap:${session.role}`,
      actor_role: session.role.toUpperCase(),
      access_reason: 'IDENTITY_VERIFICATION_REVIEW',
      document_path: videoPath,
      metadata: {
        access_mode: session.mode,
        evidence_type: 'CHALLENGE_VIDEO',
        signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      },
    })

  if (accessLogError) {
    return NextResponse.json({ error: 'Trust evidence access could not be audited.' }, { status: 503 })
  }

  const { data: signed, error: signedError } = await client.storage
    .from(TRUST_VIDEO_BUCKET)
    .createSignedUrl(videoPath, SIGNED_URL_TTL_SECONDS)

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Trust evidence link could not be created.' }, { status: 503 })
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 })
}
