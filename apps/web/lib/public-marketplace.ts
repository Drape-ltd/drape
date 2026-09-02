import { cache } from 'react'
import type { MarketplaceMedia } from '@drape/shared'
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
  media: MarketplaceMedia[]
  languages: string[]
  averageRating: number
  totalReviews: number
  totalOrders: number
  responseHours: number | null
  currency: string | null
  priceRangeMin: number | null
  priceRangeMax: number | null
  fulfillment: Array<'Pickup' | 'Local delivery' | 'Shipping'>
  reviews: PublicTailorReview[]
}

export type PublicTailorReview = {
  id: string
  rating: number
  body: string | null
  tags: string[]
  reviewerName: string
  response: string | null
  createdAt: string
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
  media?: MarketplaceMedia[] | null
  avg_rating?: number | null
  total_reviews?: number | null
  total_orders?: number | null
  avg_response_hours?: number | null
  currency?: string | null
  price_range_min?: number | null
  price_range_max?: number | null
  pickup_available?: boolean | null
  delivery_available?: boolean | null
  shipping_available?: boolean | null
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
    media?: MarketplaceMedia[] | null
    languages?: string[] | null
    avgRating?: number | null
    totalReviews?: number | null
    totalOrders?: number | null
    avgResponseHours?: number | null
    currency?: string | null
    priceRangeMin?: number | null
    priceRangeMax?: number | null
    pickupAvailable?: boolean | null
    deliveryAvailable?: boolean | null
    shippingAvailable?: boolean | null
  } | null
  reviews?: Array<{
    id?: string
    rating?: number
    body?: string | null
    tags?: string[] | null
    reviewerName?: string | null
    response?: string | null
    createdAt?: string | null
  }> | null
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

function safeMarketplaceMedia(values: MarketplaceMedia[] | null | undefined): MarketplaceMedia[] {
  return (values ?? []).flatMap((item, index) => {
    const url = safeMediaUrls([item?.url])[0]
    if (!url || (item.kind !== 'IMAGE' && item.kind !== 'VIDEO')) return []
    return [{
      id: safeText(item.id, `legacy-${index}-${url}`),
      kind: item.kind,
      url,
      posterUrl: safeMediaUrls(item.posterUrl ? [item.posterUrl] : [])[0] ?? null,
      width: typeof item.width === 'number' && item.width > 0 ? item.width : null,
      height: typeof item.height === 'number' && item.height > 0 ? item.height : null,
      focalX: typeof item.focalX === 'number' ? Math.min(1, Math.max(0, item.focalX)) : 0.5,
      focalY: typeof item.focalY === 'number' ? Math.min(1, Math.max(0, item.focalY)) : 0.5,
      altText: safeText(item.altText) || null,
      isPrimary: item.isPrimary === true,
      position: typeof item.position === 'number' ? item.position : index,
    }]
  }).sort((left, right) => left.position - right.position)
}

function legacyMarketplaceMedia(photos: string[], videos: string[]): MarketplaceMedia[] {
  return [...videos.map((url, index): MarketplaceMedia => ({
    id: `legacy-video-${index}-${url}`,
    kind: 'VIDEO',
    url,
    posterUrl: null,
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    altText: null,
    isPrimary: index === 0,
    position: index,
  })), ...photos.map((url, index): MarketplaceMedia => ({
    id: `legacy-image-${index}-${url}`,
    kind: 'IMAGE',
    url,
    posterUrl: null,
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    altText: null,
    isPrimary: videos.length === 0 && index === 0,
    position: videos.length + index,
  }))]
}

function fulfillmentLabels(input: { pickup?: boolean | null; delivery?: boolean | null; shipping?: boolean | null }) {
  return [
    input.pickup ? 'Pickup' as const : null,
    input.delivery ? 'Local delivery' as const : null,
    input.shipping ? 'Shipping' as const : null,
  ].filter((value): value is 'Pickup' | 'Local delivery' | 'Shipping' => value !== null)
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
  const media = safeMarketplaceMedia(row.media)
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
    media: media.length > 0 ? media : legacyMarketplaceMedia(portfolioPhotos, portfolioVideos),
    languages: [],
    averageRating: typeof row.avg_rating === 'number' ? row.avg_rating : 0,
    totalReviews: typeof row.total_reviews === 'number' ? row.total_reviews : 0,
    totalOrders: typeof row.total_orders === 'number' ? row.total_orders : 0,
    responseHours: typeof row.avg_response_hours === 'number' ? row.avg_response_hours : null,
    currency: safeText(row.currency) || null,
    priceRangeMin: typeof row.price_range_min === 'number' ? row.price_range_min : null,
    priceRangeMax: typeof row.price_range_max === 'number' ? row.price_range_max : null,
    fulfillment: fulfillmentLabels({ pickup: row.pickup_available, delivery: row.delivery_available, shipping: row.shipping_available }),
    reviews: [],
  }
}

async function readApprovedPublicTailors(limit = 40, offset = 0, query = ''): Promise<PublicTailor[]> {
  const safeLimit = Math.max(1, Math.min(40, Math.trunc(limit)))
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeQuery = query.trim().slice(0, 80)
  const cacheKey = `approved-tailors-v5:${safeLimit}:${safeOffset}:${encodeURIComponent(safeQuery)}`
  return cachedPublicRead(cacheKey, 60, async () => {
    const rows = await invokePublicReadGateway<PublicTailorGatewayRow[]>({
      action: 'explore-tailors',
      limit: safeLimit,
      offset: safeOffset,
      ...(safeQuery ? { query: safeQuery } : {}),
    })
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
    const media = safeMarketplaceMedia(profile.media)
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
      media: media.length > 0 ? media : legacyMarketplaceMedia(portfolioPhotos, portfolioVideos),
      languages: (profile.languages ?? []).map((language) => safeText(language)).filter(Boolean).slice(0, 12),
      averageRating: typeof profile.avgRating === 'number' ? profile.avgRating : 0,
      totalReviews: typeof profile.totalReviews === 'number' ? profile.totalReviews : 0,
      totalOrders: typeof profile.totalOrders === 'number' ? profile.totalOrders : 0,
      responseHours: typeof profile.avgResponseHours === 'number' ? profile.avgResponseHours : null,
      currency: safeText(profile.currency) || null,
      priceRangeMin: typeof profile.priceRangeMin === 'number' ? profile.priceRangeMin : null,
      priceRangeMax: typeof profile.priceRangeMax === 'number' ? profile.priceRangeMax : null,
      fulfillment: fulfillmentLabels({ pickup: profile.pickupAvailable, delivery: profile.deliveryAvailable, shipping: profile.shippingAvailable }),
      reviews: (data?.reviews ?? []).map((review, index) => ({
        id: safeText(review.id, `review-${index}`),
        rating: typeof review.rating === 'number' ? Math.min(5, Math.max(0, review.rating)) : 0,
        body: safeText(review.body) || null,
        tags: (review.tags ?? []).map((tag) => safeText(tag)).filter(Boolean).slice(0, 8),
        reviewerName: safeText(review.reviewerName, 'Customer'),
        response: safeText(review.response) || null,
        createdAt: safeText(review.createdAt),
      })),
    }
  })
}

// React cache deduplicates generateMetadata + page reads during one render;
// Cloudflare's regional Cache API protects Supabase across requests in a region.
export const getApprovedPublicTailor = cache(readApprovedPublicTailor)
