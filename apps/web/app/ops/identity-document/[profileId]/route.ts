import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa, isNamedOpsWorkforceSession } from '../../../../lib/ops-auth'
import { canAccessOpsSection } from '../../../../lib/ops-console'
import { validateOpsMutationOrigin } from '../../../../lib/ops-request-security'
import { checkPublicRateLimit } from '../../../../lib/request-security'
import { createServiceRoleClient } from '../../../../lib/server-supabase'

const TRUST_VIDEO_BUCKET = 'trust-verification'
const TRUST_VIDEO_URL_TTL_SECONDS = 5 * 60
const EVIDENCE_ACCESS_LIMIT_PER_HOUR = 30
const EVIDENCE_ACCESS_ALERT_THRESHOLD = 10

const EVIDENCE_ACCESS_REASONS = new Set([
  'INITIAL_TRUST_REVIEW',
  'TRUST_APPEAL_REVIEW',
  'SAFETY_INVESTIGATION',
  'QUALITY_ASSURANCE',
])

function normalizeStoragePath(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const marker = `/${TRUST_VIDEO_BUCKET}/`
  const markerIndex = trimmed.indexOf(marker)
  return markerIndex >= 0
    ? trimmed.slice(markerIndex + marker.length)
    : trimmed.replace(/^\/+/, '').replace(/^trust-verification\//u, '')
}

function noStoreJson(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
      },
    },
  )
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function videoContentType(storagePath: string, reportedType: string) {
  if (reportedType.startsWith('video/')) return reportedType
  const extension = storagePath.split('?')[0]?.split('.').pop()?.toLowerCase()
  if (extension === 'mov') return 'video/quicktime'
  if (extension === 'webm') return 'video/webm'
  if (extension === 'm4v') return 'video/x-m4v'
  return 'video/mp4'
}

function evidencePlayerHtml(input: {
  caseNumber: string
  contentType: string
  nonce: string
  signedUrl: string
}) {
  const caseHref = `/ops/cases/${encodeURIComponent(input.caseNumber)}?protected=verified`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Private challenge video · Drapeon Ops</title>
    <style nonce="${input.nonce}">
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1511; color: #f7f4ed; padding: 24px; }
      main { width: min(100%, 960px); }
      .eyebrow { margin: 0 0 8px; color: #8fc6a9; font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
      h1 { margin: 0 0 8px; font-family: Georgia, serif; font-size: clamp(30px, 5vw, 52px); font-weight: 500; }
      .intro { margin: 0 0 22px; color: #b8c1bb; }
      video { display: block; width: 100%; max-height: 70vh; border: 1px solid #31443a; border-radius: 18px; background: #000; box-shadow: 0 22px 70px rgba(0, 0, 0, .38); }
      .actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 18px; }
      button, a { min-height: 44px; border-radius: 999px; padding: 11px 20px; font: inherit; font-weight: 750; cursor: pointer; }
      button { border: 0; background: #dff4e7; color: #10231a; }
      a { display: inline-flex; align-items: center; border: 1px solid #496456; color: #f7f4ed; text-decoration: none; }
      .notice { margin: 18px 0 0; color: #91a097; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Drapeon Ops · Private evidence</p>
      <h1>Challenge video</h1>
      <p class="intro">Review the submitted clip, then close this tab and continue the case.</p>
      <video controls playsinline preload="metadata">
        <source src="${escapeHtml(input.signedUrl)}" type="${escapeHtml(input.contentType)}" />
        This browser could not play the submitted video.
      </video>
      <div class="actions">
        <button id="close-tab" type="button">Close tab</button>
        <a href="${escapeHtml(caseHref)}">Return to case</a>
      </div>
      <p class="notice">Access to this private evidence is audited. The media link expires in five minutes.</p>
    </main>
    <script nonce="${input.nonce}">
      document.getElementById('close-tab')?.addEventListener('click', () => window.close())
    </script>
  </body>
</html>`
}

function evidenceMetadata(input: {
  event: 'REQUESTED' | 'FAILED' | 'SERVED'
  requestId: string
  caseNumber: string
  accessMode: string
  contentType?: string | null
  contentLength?: number | null
  failure?: string | null
}) {
  return {
    event: input.event,
    request_id: input.requestId,
    case_number: input.caseNumber,
    access_mode: input.accessMode,
    evidence_type: 'CHALLENGE_VIDEO',
    ...(input.contentType ? { content_type: input.contentType } : {}),
    ...(typeof input.contentLength === 'number' ? { content_length: input.contentLength } : {}),
    ...(input.failure ? { failure: input.failure.slice(0, 180) } : {}),
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const originCheck = validateOpsMutationOrigin(request)
  const isSameOriginUserNavigation =
    originCheck.receivedOrigin === null &&
    originCheck.fetchSite === 'same-origin' &&
    request.headers.get('sec-fetch-mode')?.trim().toLowerCase() === 'navigate' &&
    request.headers.get('sec-fetch-dest')?.trim().toLowerCase() === 'document' &&
    request.headers.get('sec-fetch-user')?.trim() === '?1'
  if (!originCheck.ok && !isSameOriginUserNavigation) {
    return noStoreJson('Trust evidence request origin was rejected.', 403)
  }

  const session = await getOpsSession()
  if (
    !session ||
    !session.email ||
    !isNamedOpsWorkforceSession(session) ||
    !hasFreshOpsMfa(session) ||
    !canAccessOpsSection(session.role, 'verification')
  ) {
    return noStoreJson('Trust evidence access requires a named workforce session.', 403)
  }

  const client = createServiceRoleClient()
  if (!client) {
    return noStoreJson('Trust evidence service is unavailable.', 503)
  }

  const formData = await request.formData().catch(() => null)
  const caseNumber = typeof formData?.get('caseNumber') === 'string'
    ? formData.get('caseNumber')?.toString().trim().slice(0, 80) ?? ''
    : ''
  const accessReason = typeof formData?.get('accessReason') === 'string'
    ? formData.get('accessReason')?.toString().trim().toUpperCase() ?? ''
    : ''
  if (!/^[A-Z0-9][A-Z0-9_-]{3,79}$/iu.test(caseNumber) || !EVIDENCE_ACCESS_REASONS.has(accessReason)) {
    return noStoreJson('A valid case reference and access reason are required.', 400)
  }

  const { profileId } = await context.params
  const { data: profile, error: profileError } = await client
    .from('tailor_profiles')
    .select('id, user_id, trust_verification_video_path')
    .eq('id', profileId)
    .maybeSingle()

  const videoPath = normalizeStoragePath(profile?.trust_verification_video_path)
  if (profileError || !profile?.id || !videoPath) {
    return noStoreJson('Trust evidence was not found.', 404)
  }

  const actorHash = createHash('sha256').update(session.email).digest('hex').slice(0, 24)
  const rateLimit = await checkPublicRateLimit(
    client,
    `ops-evidence:${actorHash}`,
    60 * 60,
    EVIDENCE_ACCESS_LIMIT_PER_HOUR,
  )
  if (!rateLimit.ok) return noStoreJson('Trust evidence rate limiting is unavailable.', 503)
  if (!rateLimit.allowed) return noStoreJson('Trust evidence access limit reached. Contact an administrator.', 429)

  const { data: actor } = await client
    .from('users')
    .select('id')
    .eq('email', session.email)
    .maybeSingle()
  const actorId = actor?.id ?? null
  const requestId = randomUUID()
  const baseAccessLog = {
    tailor_user_id: profile.user_id,
    tailor_profile_id: profile.id,
    actor_id: actorId,
    actor_identifier: session.email,
    actor_role: session.role.toUpperCase(),
    access_reason: accessReason,
    document_path: videoPath,
  }

  const { error: requestLogError } = await client
    .from('identity_document_access_log')
    .insert({
      ...baseAccessLog,
      metadata: evidenceMetadata({
        event: 'REQUESTED',
        requestId,
        caseNumber,
        accessMode: session.mode,
      }),
    })

  if (requestLogError) {
    return noStoreJson('Trust evidence access could not be audited.', 503)
  }

  const { data: evidence, error: evidenceError } = await client.storage
    .from(TRUST_VIDEO_BUCKET)
    .download(videoPath)

  if (evidenceError || !evidence) {
    await client.from('identity_document_access_log').insert({
      ...baseAccessLog,
      metadata: evidenceMetadata({
        event: 'FAILED',
        requestId,
        caseNumber,
        accessMode: session.mode,
        failure: evidenceError?.message ?? 'Storage download returned no evidence.',
      }),
    })
    return noStoreJson('Trust evidence could not be loaded.', 503)
  }

  const contentType = videoContentType(videoPath, evidence.type || 'application/octet-stream')
  const { data: signedEvidence, error: signedEvidenceError } = await client.storage
    .from(TRUST_VIDEO_BUCKET)
    .createSignedUrl(videoPath, TRUST_VIDEO_URL_TTL_SECONDS)

  if (signedEvidenceError || !signedEvidence?.signedUrl) {
    await client.from('identity_document_access_log').insert({
      ...baseAccessLog,
      metadata: evidenceMetadata({
        event: 'FAILED',
        requestId,
        caseNumber,
        accessMode: session.mode,
        failure: signedEvidenceError?.message ?? 'Storage did not return a signed evidence URL.',
      }),
    })
    return noStoreJson('Trust evidence could not be prepared for review.', 503)
  }

  const { error: servedLogError } = await client
    .from('identity_document_access_log')
    .insert({
      ...baseAccessLog,
      metadata: evidenceMetadata({
        event: 'SERVED',
        requestId,
        caseNumber,
        accessMode: session.mode,
        contentType,
        contentLength: evidence.size,
      }),
    })

  if (servedLogError) {
    return noStoreJson('Trust evidence delivery could not be audited.', 503)
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentAccessCount } = await client
    .from('identity_document_access_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_identifier', session.email)
    .contains('metadata', { event: 'SERVED' })
    .gte('accessed_at', oneHourAgo)

  if ((recentAccessCount ?? 0) >= EVIDENCE_ACCESS_ALERT_THRESHOLD) {
    const hourBucket = new Date().toISOString().slice(0, 13)
    await client.from('ops_issues').upsert({
      issue_type: 'ELEVATED_TRUST_EVIDENCE_ACCESS',
      severity: 'HIGH',
      status: 'OPEN',
      source: 'ops-evidence-proxy',
      actor_id: actorId ?? session.subject,
      actor_role: session.role.toUpperCase(),
      tailor_profile_id: profile.id,
      related_entity_type: 'identity_document_access_log',
      related_entity_id: requestId,
      title: 'Elevated trust-evidence access volume',
      description: 'A named operator crossed the hourly trust-evidence review threshold.',
      recommended_action: 'Confirm the reviews are assigned and expected. Revoke access and investigate if the volume is not authorized.',
      dedupe_key: `elevated-trust-evidence-access:${actorHash}:${hourBucket}`,
      metadata: {
        actor_hash: actorHash,
        recent_access_count: recentAccessCount,
        threshold: EVIDENCE_ACCESS_ALERT_THRESHOLD,
        case_number: caseNumber,
      },
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'dedupe_key' })
  }

  const nonce = randomUUID().replaceAll('-', '')
  const mediaOrigin = new URL(signedEvidence.signedUrl).origin
  return new NextResponse(evidencePlayerHtml({
    caseNumber,
    contentType,
    nonce,
    signedUrl: signedEvidence.signedUrl,
  }), {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': `default-src 'none'; media-src ${mediaOrigin}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  })
}
