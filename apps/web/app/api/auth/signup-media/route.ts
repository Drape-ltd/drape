import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../../lib/server-supabase'

export const runtime = 'nodejs'

const BUCKET = 'signup-media-quarantine'
const ALLOWED = new Set(['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
type Kind = 'avatar' | 'portfolio-image' | 'portfolio-video' | 'trust-video'
type Entry = { key: string; kind: Kind; contentType: string; byteLength: number; path: string; durationSeconds: number }

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function same(a: string, b: string) {
  const aa = Buffer.from(a); const bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}
function extension(type: string) {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'video/quicktime' ? 'mov' : type === 'video/webm' ? 'webm' : type.startsWith('image/') ? 'jpg' : 'mp4'
}
async function caller(request: Request, client: NonNullable<ReturnType<typeof createServiceRoleClient>>) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return null
  const { data } = await client.auth.getUser(bearer)
  return data.user ?? null
}

export async function POST(request: Request) {
  const client = createServiceRoleClient()
  if (!client) return json({ error: 'Media quarantine is unavailable.' }, 503)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  const claimToken = typeof body?.claimToken === 'string' ? body.claimToken : ''
  if (!userId || claimToken.length < 32) return json({ error: 'Invalid media claim.' }, 400)

  if (action === 'init') {
    const { data } = await client.auth.admin.getUserById(userId)
    const user = data.user
    if (!user || user.email_confirmed_at) return json({ error: 'Signup media can only be staged before confirmation.' }, 409)
    const expected = typeof user.user_metadata?.signup_media_claim_hash === 'string' ? user.user_metadata.signup_media_claim_hash : ''
    if (!expected || !same(expected, hash(claimToken))) return json({ error: 'Invalid media claim.' }, 403)
    const raw = Array.isArray(body?.entries) ? body.entries : []
    if (raw.length > 17) return json({ error: 'Too many media files.' }, 400)
    const counts: Record<Kind, number> = { avatar: 0, 'portfolio-image': 0, 'portfolio-video': 0, 'trust-video': 0 }
    const entries: Entry[] = []
    for (const value of raw) {
      const item = value as Record<string, unknown>
      const kind = item.kind as Kind
      const contentType = typeof item.contentType === 'string' ? item.contentType : ''
      const byteLength = Number(item.byteLength)
      const key = typeof item.key === 'string' ? item.key : ''
      const durationSeconds = Number(item.durationSeconds) || 0
      if (!(kind in counts) || !ALLOWED.has(contentType) || !key || !Number.isFinite(byteLength) || byteLength < 1 || byteLength > 31_457_280) return json({ error: 'Invalid media file.' }, 400)
      counts[kind] += 1
      const maxBytes = kind === 'avatar' ? 5_242_880 : kind === 'portfolio-image' ? 12_582_912 : 31_457_280
      if (byteLength > maxBytes) return json({ error: 'This media file is too large.' }, 400)
      const path = `${userId}/${kind}-${randomUUID()}.${extension(contentType)}`
      entries.push({ key, kind, contentType, byteLength, path, durationSeconds })
    }
    if (counts.avatar > 1 || counts['portfolio-image'] > 12 || counts['portfolio-video'] > 4 || counts['trust-video'] > 1) return json({ error: 'Media limits exceeded.' }, 400)
    const claimHash = hash(claimToken)
    const { error: rowError } = await client.from('signup_media_quarantine').upsert({ user_id: userId, claim_hash: claimHash, manifest: entries, completed_at: null, expires_at: new Date(Date.now() + 48 * 3600_000).toISOString() })
    if (rowError) return json({ error: 'Could not prepare private media.' }, 500)
    const uploads = []
    for (const entry of entries) {
      const { data: signed, error } = await client.storage.from(BUCKET).createSignedUploadUrl(entry.path)
      if (error || !signed) return json({ error: 'Could not prepare private media upload.' }, 500)
      uploads.push({ ...entry, token: signed.token })
    }
    return json({ uploads })
  }

  if (action === 'complete') {
    const { data } = await client.auth.admin.getUserById(userId)
    const user = data.user
    const expected = typeof user?.user_metadata?.signup_media_claim_hash === 'string' ? user.user_metadata.signup_media_claim_hash : ''
    if (!user || user.email_confirmed_at || !expected || !same(expected, hash(claimToken))) return json({ error: 'Invalid media claim.' }, 403)
    const { data: row } = await client.from('signup_media_quarantine').select('manifest,expires_at').eq('user_id', userId).maybeSingle()
    if (!row || Date.parse(String(row.expires_at)) <= Date.now()) return json({ error: 'Signup media expired or was not found.' }, 404)
    const entries = (Array.isArray(row.manifest) ? row.manifest : []) as Entry[]
    for (const entry of entries) {
      const { data: object, error } = await client.storage.from(BUCKET).createSignedUrl(entry.path, 60)
      if (error || !object?.signedUrl) return json({ error: 'A private media upload did not finish.' }, 409)
    }
    const { error } = await client.from('signup_media_quarantine').update({ completed_at: new Date().toISOString() }).eq('user_id', userId)
    return error ? json({ error: 'Private media could not be finalized.' }, 500) : json({ ok: true })
  }

  const user = await caller(request, client)
  if (!user || user.id !== userId) return json({ error: 'Sign in to claim signup media.' }, 401)
  const { data: row } = await client.from('signup_media_quarantine').select('claim_hash,manifest,expires_at,completed_at').eq('user_id', userId).maybeSingle()
  if (!row || !same(String(row.claim_hash), hash(claimToken)) || Date.parse(String(row.expires_at)) <= Date.now()) return json({ error: 'Signup media expired or was not found.' }, 404)
  const entries = (Array.isArray(row.manifest) ? row.manifest : []) as Entry[]
  if (action === 'claim') {
    if (!row.completed_at) return json({ error: 'Private signup media is still uploading.' }, 409)
    const downloads = []
    for (const entry of entries) {
      const { data: signed, error } = await client.storage.from(BUCKET).createSignedUrl(entry.path, 600)
      if (error || !signed?.signedUrl) return json({ error: 'Could not open private signup media.' }, 500)
      downloads.push({ ...entry, signedUrl: signed.signedUrl })
    }
    return json({ downloads })
  }
  if (action === 'cleanup') {
    await client.storage.from(BUCKET).remove(entries.map((entry) => entry.path))
    await client.from('signup_media_quarantine').delete().eq('user_id', userId)
    return json({ ok: true })
  }
  return json({ error: 'Unsupported action.' }, 400)
}
