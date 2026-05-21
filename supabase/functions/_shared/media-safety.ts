import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, log } from './logger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'UNKNOWN'

type QueueMediaSafetyReviewInput = {
  fn: string
  actorId: string
  actorRole: string
  surface: string
  publicUrls: string[]
  purpose: string
  orderId?: string | null
  tailorProfileId?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  metadata?: Record<string, unknown>
}

const PUBLIC_REVIEW_SURFACES = new Set([
  'portfolio.public',
  'ready_made_item.public',
  'avatar.public',
])

function normalizeUrl(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function uniqueUrls(values: string[]) {
  return [...new Set(values.map(normalizeUrl).filter((value): value is string => !!value))]
}

function inferMediaKind(url: string): MediaKind {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  if (/\.(jpg|jpeg|png|webp|heic|heif)$/u.test(path)) return 'IMAGE'
  if (/\.(mp4|mov|m4v|webm)$/u.test(path)) return 'VIDEO'
  if (/\.(m4a|mp3|wav|aac|ogg)$/u.test(path)) return 'AUDIO'
  return 'UNKNOWN'
}

function parsePublicStorageUrl(url: string) {
  const marker = '/storage/v1/object/public/'
  const index = url.indexOf(marker)
  if (index < 0) return null

  const storagePath = url.slice(index + marker.length).split('?')[0] ?? ''
  const [bucketId, ...pathParts] = storagePath.split('/')
  const objectPath = pathParts.join('/')
  if (!bucketId || !objectPath) return null

  try {
    return {
      bucketId: decodeURIComponent(bucketId),
      objectPath: decodeURIComponent(objectPath),
    }
  } catch {
    return { bucketId, objectPath }
  }
}

function moderationDedupeKey(input: QueueMediaSafetyReviewInput, urls: string[]) {
  const entity = input.relatedEntityId ?? input.orderId ?? input.tailorProfileId ?? input.actorId
  const suffix = entity ? `${input.surface}:${entity}` : `${input.surface}:${urls[0]?.slice(-120) ?? 'unknown'}`
  return `media-review:${suffix}`.slice(0, 480)
}

export async function queueMediaSafetyReview(
  supabase: SupabaseClient,
  input: QueueMediaSafetyReviewInput,
) {
  const urls = uniqueUrls(input.publicUrls)
  if (urls.length === 0) return

  const queuedAssetIds: string[] = []
  for (const url of urls) {
    const parts = parsePublicStorageUrl(url)
    if (!parts) {
      log('warn', input.fn, 'media_safety.unparsed_url', {
        actor_id: input.actorId,
        surface: input.surface,
        url,
      })
      continue
    }

    const { data: assetId, error } = await supabase.rpc('upsert_media_asset', {
      p_bucket_id: parts.bucketId,
      p_object_path: parts.objectPath,
      p_owner_user_id: input.actorId,
      p_order_id: input.orderId ?? null,
      p_tailor_profile_id: input.tailorProfileId ?? null,
      p_purpose: input.purpose,
      p_mime_type: null,
      p_byte_size: null,
      p_width: null,
      p_height: null,
      p_duration_ms: null,
      p_checksum_sha256: null,
      p_public_url: url,
      p_metadata: {
        ...(input.metadata ?? {}),
        mediaKind: inferMediaKind(url),
        surface: input.surface,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        queuedBy: input.fn,
      },
    })

    if (error) {
      log('error', input.fn, 'media_safety.queue_failed', {
        actor_id: input.actorId,
        surface: input.surface,
        url,
        error: error.message,
      })
      continue
    }

    if (typeof assetId === 'string') queuedAssetIds.push(assetId)
  }

  if (queuedAssetIds.length === 0) return

  await audit(supabase, {
    event: 'media_safety.review_queued',
    actor_id: input.actorId,
    actor_role: input.actorRole,
    order_id: input.orderId ?? null,
    severity: PUBLIC_REVIEW_SURFACES.has(input.surface) ? 'warn' : 'info',
    payload: {
      function: input.fn,
      surface: input.surface,
      purpose: input.purpose,
      count: queuedAssetIds.length,
      media_asset_ids: queuedAssetIds,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
      ...(input.metadata ?? {}),
    },
  })

  if (!PUBLIC_REVIEW_SURFACES.has(input.surface)) return

  await createOrRefreshOpsIssue(supabase, {
    issueType: 'CONTENT_FLAG',
    severity: 'MEDIUM',
    source: input.fn,
    actorId: input.actorId,
    actorRole: input.actorRole,
    orderId: input.orderId ?? null,
    userId: input.actorId,
    tailorProfileId: input.tailorProfileId ?? null,
    relatedEntityType: input.relatedEntityType ?? 'media_asset',
    relatedEntityId: input.relatedEntityId ?? queuedAssetIds[0] ?? null,
    title: 'Public media needs safety review',
    description: `New public media was uploaded on ${input.surface}. Review it for explicit, unsafe, or off-platform content.`,
    recommendedAction: 'Open the media asset in ops, approve it if safe, or set moderation_status to BLOCKED to remove it from public Drape surfaces.',
    dedupeKey: moderationDedupeKey(input, urls),
    metadata: {
      surface: input.surface,
      purpose: input.purpose,
      media_asset_ids: queuedAssetIds,
      url_count: urls.length,
      ...(input.metadata ?? {}),
    },
  })
}

export async function findBlockedMediaUrls(
  supabase: SupabaseClient,
  urls: string[],
) {
  const normalized = uniqueUrls(urls)
  if (normalized.length === 0) return new Set<string>()

  const { data, error } = await supabase
    .from('media_assets')
    .select('public_url, status, moderation_status')
    .in('public_url', normalized)

  if (error) {
    log('warn', 'media-safety', 'blocked_lookup_failed', { error: error.message })
    return new Set<string>()
  }

  return new Set(
    ((data ?? []) as Array<{ public_url?: string | null; status?: string | null; moderation_status?: string | null }>)
      .filter((row) =>
        row.status === 'BLOCKED' ||
        row.moderation_status === 'BLOCKED' ||
        row.moderation_status === 'AUTO_BLOCKED'
      )
      .map((row) => normalizeUrl(row.public_url))
      .filter((value): value is string => !!value),
  )
}

export async function filterBlockedMediaUrls(
  supabase: SupabaseClient,
  urls: string[],
) {
  const blocked = await findBlockedMediaUrls(supabase, urls)
  if (blocked.size === 0) return urls
  return urls.filter((url) => !blocked.has(url))
}
