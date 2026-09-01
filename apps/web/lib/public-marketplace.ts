import { cache } from 'react'
import { getSupabasePublishableKey, getSupabaseUrl } from './supabase-config'

export type PublicTailor = {
  id: string
  displayName: string
  businessName: string | null
  bio: string | null
  location: string | null
  specialties: string[]
  availability: string | null
  acceptsCustomOrders: boolean
  supportsReadyMade: boolean
  portfolioPhotos: string[]
  portfolioVideos: string[]
  coverVideoUrl: string | null
  avatarUrl: string | null
}

type PublicTailorGatewayRow = {
  id: string
  display_name: string | null
  location: string | null
  specialty_tags: string[] | null
  availability: string | null
  accepts_custom_orders_now: boolean | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  portfolio_photo_urls: string[] | null
  portfolio_video_urls?: string[] | null
  avatar_url: string | null
  explore_image_url?: string | null
  explore_video_url?: string | null
}

type PublicTailorProfileGateway = {
  profile?: {
    id?: string
    displayName?: string | null
    bio?: string | null
    location?: string | null
    specialtyTags?: string[] | null
    availability?: string | null
    acceptsCustomOrdersNow?: boolean | null
    supportsCustomOrders?: boolean | null
    supportsReadyMade?: boolean | null
    portfolioPhotos?: string[] | null
    portfolioVideos?: string[] | null
    avatarUrl?: string | null
  } | null
}

function safeText(value: string | null | undefined, fallback = '') {
  const clean = value?.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean || fallback
}

function safeMediaUrls(values: string[] | null | undefined) {
  return Array.from(new Set((values ?? []).filter((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:'
    } catch {
      return false
    }
  }))).slice(0, 40)
}

type RegionalCache = {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

type RegionalCacheStorage = {
  open(name: string): Promise<RegionalCache>
}

const publicReadInFlight = new Map<string, Promise<unknown>>()
const publicLastKnownGood = new Map<string, { value: unknown; storedAt: number }>()
const PUBLIC_LAST_KNOWN_GOOD_MAX_AGE_MS = 15 * 60_000

class PublicReadGatewayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicReadGatewayError'
  }
}

function publicCacheKind(key: string) {
  return key.startsWith('approved-tailor-v2:') ? 'tailor-profile' : 'tailor-list'
}

function getRegionalCacheStorage() {
  return (globalThis as typeof globalThis & { caches?: RegionalCacheStorage }).caches
}

async function cachedPublicRead<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cacheStorage = getRegionalCacheStorage()
  if (!cacheStorage) return loader()

  let regionalCache: RegionalCache | null = null
  const cacheKey = new Request(`https://drapeon.co/__drape-public-data-cache/${encodeURIComponent(key)}`)
  try {
    regionalCache = await cacheStorage.open('drapeon-public-data-v1')
    const cachedResponse = await regionalCache.match(cacheKey)
    if (cachedResponse) {
      const value = await cachedResponse.json() as T
      publicLastKnownGood.set(key, { value, storedAt: Date.now() })
      return value
    }
  } catch (error) {
    console.warn('[public-marketplace] Regional cache read failed; using the gateway.', {
      cacheKind: publicCacheKind(key),
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const existingRead = publicReadInFlight.get(key) as Promise<T> | undefined
  if (existingRead) return existingRead

  console.info('[public-marketplace] Regional cache miss; loading public data.', {
    cacheKind: publicCacheKind(key),
  })

  const pendingRead = loader().then(async (value) => {
    publicLastKnownGood.set(key, { value, storedAt: Date.now() })
    if (regionalCache) {
      try {
        await regionalCache.put(
          cacheKey,
          new Response(JSON.stringify(value), {
            headers: {
              'Cache-Control': `public, max-age=${ttlSeconds}`,
              'Content-Type': 'application/json',
            },
          }),
        )
      } catch (error) {
        console.warn('[public-marketplace] Regional cache write failed; returning fresh data.', {
          cacheKind: publicCacheKind(key),
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return value
  }).catch((error) => {
    const fallback = publicLastKnownGood.get(key)
    if (fallback && Date.now() - fallback.storedAt <= PUBLIC_LAST_KNOWN_GOOD_MAX_AGE_MS) {
      console.warn('[public-marketplace] Public gateway failed; returning bounded last-known-good data.', {
        cacheKind: publicCacheKind(key),
        message: error instanceof Error ? error.message : String(error),
      })
      return fallback.value as T
    }
    throw error
  }).finally(() => {
    publicReadInFlight.delete(key)
  })

  publicReadInFlight.set(key, pendingRead)
  return pendingRead
}

async function invokePublicReadGateway<T>(body: Record<string, unknown>): Promise<T | null> {
  const url = getSupabaseUrl()
  const key = getSupabasePublishableKey()
  if (!url || !key) {
    throw new PublicReadGatewayError('Public read gateway configuration is unavailable.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${url}/functions/v1/read-gateway`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; message?: string } | null
    if (!response.ok || !payload?.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new PublicReadGatewayError(
        `Public read gateway returned ${response.status}: ${payload?.message ?? 'Invalid gateway response'}`,
      )
    }
    return payload.data ?? null
  } catch (error) {
    console.error('[public-marketplace] Public read gateway unavailable.', {
      action: body.action,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error instanceof Error ? error : new PublicReadGatewayError(String(error))
  } finally {
    clearTimeout(timeout)
  }
}

function mapGatewayTailor(row: PublicTailorGatewayRow): PublicTailor | null {
  const portfolioPhotos = safeMediaUrls([
    ...(row.explore_image_url ? [row.explore_image_url] : []),
    ...(row.portfolio_photo_urls ?? []),
  ])
  const avatarUrl = safeMediaUrls(row.avatar_url ? [row.avatar_url] : [])[0] ?? null
  const portfolioVideos = safeMediaUrls(row.portfolio_video_urls)
  const coverVideoUrl = safeMediaUrls(row.explore_video_url ? [row.explore_video_url] : [])[0] ?? portfolioVideos[0] ?? null
  const displayName = safeText(row.display_name)
  if (!displayName || (portfolioPhotos.length === 0 && portfolioVideos.length === 0 && !avatarUrl)) return null
  return {
    id: row.id,
    displayName,
    businessName: null,
    bio: null,
    location: safeText(row.location) || null,
    specialties: (row.specialty_tags ?? []).map((tag) => safeText(tag)).filter(Boolean).slice(0, 6),
    availability: safeText(row.availability) || null,
    acceptsCustomOrders: row.supports_custom_orders === true && row.accepts_custom_orders_now === true,
    supportsReadyMade: row.supports_ready_made === true,
    portfolioPhotos,
    portfolioVideos,
    coverVideoUrl,
    avatarUrl,
  }
}

async function readApprovedPublicTailors(): Promise<PublicTailor[]> {
  return cachedPublicRead('approved-tailors-v4', 60, async () => {
    const rows = await invokePublicReadGateway<PublicTailorGatewayRow[]>({ action: 'explore-tailors', limit: 40 })
    if (!rows) throw new PublicReadGatewayError('Public tailor list response did not contain data.')
    return rows.flatMap((row) => {
      const tailor = mapGatewayTailor(row)
      return tailor ? [tailor] : []
    })
  })
}

export const getApprovedPublicTailors = cache(readApprovedPublicTailors)

async function readApprovedPublicTailor(profileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return null
  return cachedPublicRead(`approved-tailor-v2:${profileId}`, 60, async () => {
    const data = await invokePublicReadGateway<PublicTailorProfileGateway>({ action: 'tailor-profile', tailorId: profileId })
    const profile = data?.profile
    if (!profile?.id || !profile.displayName) return null
    const portfolioPhotos = safeMediaUrls(profile.portfolioPhotos)
    const portfolioVideos = safeMediaUrls(profile.portfolioVideos)
    const avatarUrl = safeMediaUrls(profile.avatarUrl ? [profile.avatarUrl] : [])[0] ?? null
    if (portfolioPhotos.length === 0 && portfolioVideos.length === 0 && !avatarUrl) return null
    return {
      id: profile.id,
      displayName: safeText(profile.displayName),
      businessName: null,
      bio: safeText(profile.bio) || null,
      location: safeText(profile.location) || null,
      specialties: (profile.specialtyTags ?? []).map((tag) => safeText(tag)).filter(Boolean).slice(0, 6),
      availability: safeText(profile.availability) || null,
      acceptsCustomOrders: profile.supportsCustomOrders === true && profile.acceptsCustomOrdersNow === true,
      supportsReadyMade: profile.supportsReadyMade === true,
      portfolioPhotos,
      portfolioVideos,
      coverVideoUrl: portfolioVideos[0] ?? null,
      avatarUrl,
    }
  })
}

// React cache deduplicates generateMetadata + page reads during one render;
// Cloudflare's regional Cache API protects Supabase across requests in a region.
export const getApprovedPublicTailor = cache(readApprovedPublicTailor)
