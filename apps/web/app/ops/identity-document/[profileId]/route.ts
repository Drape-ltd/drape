import { NextResponse } from 'next/server'
import { getOpsSession } from '../../../../lib/ops-auth'
import { canAccessOpsSection } from '../../../../lib/ops-console'
import { createServiceRoleClient } from '../../../../lib/server-supabase'

const ID_DOCUMENT_BUCKET = 'id-documents'
const SIGNED_URL_TTL_SECONDS = 5 * 60

function normalizeStoragePath(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const marker = `/${ID_DOCUMENT_BUCKET}/`
  const markerIndex = trimmed.indexOf(marker)
  return markerIndex >= 0
    ? trimmed.slice(markerIndex + marker.length)
    : trimmed.replace(/^\/+/, '').replace(/^id-documents\//u, '')
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const session = await getOpsSession()
  if (!session || !canAccessOpsSection(session.role, 'verification')) {
    return NextResponse.json({ error: 'Identity evidence access is restricted.' }, { status: 403 })
  }

  const client = createServiceRoleClient()
  if (!client) {
    return NextResponse.json({ error: 'Identity evidence service is unavailable.' }, { status: 503 })
  }

  const { profileId } = await context.params
  const { data: profile, error: profileError } = await client
    .from('tailor_profiles')
    .select('id, user_id, id_document_url, id_selfie_document_url')
    .eq('id', profileId)
    .maybeSingle()

  const documentPath = normalizeStoragePath(
    profile?.id_selfie_document_url ?? profile?.id_document_url,
  )
  if (profileError || !profile?.id || !documentPath) {
    return NextResponse.json({ error: 'Identity evidence was not found.' }, { status: 404 })
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
      document_path: documentPath,
      metadata: {
        access_mode: session.mode,
        signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      },
    })

  if (accessLogError) {
    return NextResponse.json({ error: 'Identity evidence access could not be audited.' }, { status: 503 })
  }

  const { data: signed, error: signedError } = await client.storage
    .from(ID_DOCUMENT_BUCKET)
    .createSignedUrl(documentPath, SIGNED_URL_TTL_SECONDS)

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Identity evidence link could not be created.' }, { status: 503 })
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 })
}
