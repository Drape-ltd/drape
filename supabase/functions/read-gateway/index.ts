import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'
import { filterBlockedMediaUrls, findBlockedMediaUrls } from '../_shared/media-safety.ts'

const FN = 'read-gateway'

type ReadAction = 'tailor-shop' | 'seller-item' | 'explore-tailors' | 'tailor-profile'

type TailorDiscoveryGatewayRow = Record<string, unknown> & {
  id?: string
  avatar_url?: string | null
  portfolio_photo_urls?: unknown
}

type PortfolioCoverRow = {
  tailor_profile_id?: string | null
  image_url?: string | null
}

type GatewayCacheEntry<T> = {
  expiresAt: number
  data: T
}

const gatewayCache = new Map<string, GatewayCacheEntry<unknown>>()
const MAX_CACHE_ENTRIES = 250

function getCached<T>(key: string): T | null {
  const cached = gatewayCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    gatewayCache.delete(key)
    return null
  }
  return cached.data as T
}

function setCached<T>(key: string, data: T, ttlMs: number): T {
  if (gatewayCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = gatewayCache.keys().next().value
    if (firstKey) gatewayCache.delete(firstKey)
  }
  gatewayCache.set(key, { data, expiresAt: Date.now() + ttlMs })
  return data
}

async function cachedRead<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = getCached<T>(key)
  if (cached) return cached
  return setCached(key, await loader(), ttlMs)
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
  cacheControl = 'public, s-maxage=30, stale-while-revalidate=120',
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? cacheControl : 'no-store',
    },
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function safeSearchTerm(value: unknown) {
  const term = asString(value)
  if (!term) return null
  return term.replace(/[%_,{}()"']/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function safeArrayLiteralItem(value: string | null) {
  if (!value) return null
  const sanitized = value.replace(/[{}"\\,]/gu, ' ').replace(/\s+/gu, ' ').trim()
  return sanitized.length > 0 ? sanitized : null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function resolveAuthenticatedUserId(req: Request, supabase: any) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) return null
  return data.user.id as string
}

function fallbackInventoryQuantity(stockStatus: string | null | undefined, isLive = true) {
  if (!isLive || stockStatus === 'SOLD_OUT' || stockStatus === 'HIDDEN') return 0
  if (stockStatus === 'LOW_STOCK') return 1
  return 1
}

function isPubliclyAvailableReadyMade(input: {
  stockStatus: string | null | undefined
  inventoryQuantity: number | null | undefined
}) {
  return (
    input.stockStatus !== 'HIDDEN' &&
    input.stockStatus !== 'SOLD_OUT' &&
    (input.inventoryQuantity ?? 0) > 0
  )
}

function normalizeSizeInventory(
  sizes: string[],
  rawInventory: unknown,
  fallbackQuantity: number,
) {
  const inventory = asRecord(rawInventory)
  if (sizes.length === 0) return {}

  return sizes.reduce<Record<string, number>>((acc, size) => {
    const value = inventory[size]
    acc[size] = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : fallbackQuantity
    return acc
  }, {})
}

async function fetchTailorShop(supabase: any, tailorId: string) {
  const [{ data: profileData, error: profileError }, { data: itemsData, error: itemsError }] =
    await Promise.all([
      supabase
        .from('tailor_profiles')
        .select('display_name, availability, accepts_custom_orders_now, shop_paused, is_live, supports_custom_orders')
        .eq('id', tailorId)
        .maybeSingle(),
      supabase
        .from('seller_items')
        .select('id, title, category, price_amount, currency, photo_urls, stock_status, inventory_quantity, pickup_available, delivery_available, shipping_available')
        .eq('tailor_profile_id', tailorId)
        .eq('is_live', true)
        .gt('inventory_quantity', 0)
        .neq('stock_status', 'SOLD_OUT')
        .neq('stock_status', 'HIDDEN')
        .order('updated_at', { ascending: false })
        .limit(60),
    ])

  if (profileError && itemsError) throw profileError
  if (itemsError) throw itemsError

  const profile = asRecord(profileData)
  const items = ((itemsData ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const stockStatus = asString(row.stock_status) ?? 'IN_STOCK'
      const inventoryQuantity =
        typeof row.inventory_quantity === 'number'
          ? row.inventory_quantity
          : fallbackInventoryQuantity(stockStatus, true)

      return {
        id: row.id,
        title: row.title,
        category: row.category ?? null,
        priceAmount: row.price_amount,
        currency: row.currency,
        photoUrls: asStringList(row.photo_urls),
        stockStatus,
        inventoryQuantity,
        pickupAvailable: row.pickup_available === true,
        deliveryAvailable: row.delivery_available === true,
        shippingAvailable: row.shipping_available === true,
      }
    })
    .filter((item) =>
      isPubliclyAvailableReadyMade({
        stockStatus: item.stockStatus,
        inventoryQuantity: item.inventoryQuantity,
      })
    )
  const blockedPhotoUrls = await findBlockedMediaUrls(
    supabase,
    items.flatMap((item) => item.photoUrls),
  )
  const safeItems = blockedPhotoUrls.size === 0
    ? items
    : items.map((item) => ({
        ...item,
        photoUrls: item.photoUrls.filter((url) => !blockedPhotoUrls.has(url)),
      }))

  return {
    tailorName: asString(profile.display_name) ?? 'This seller',
    sellerAvailability: asString(profile.availability),
    sellerLive: profile.is_live === true,
    supportsCustomOrders: profile.supports_custom_orders !== false,
    acceptsCustomOrdersNow: profile.accepts_custom_orders_now !== false,
    shopPaused: profile.shop_paused === true,
    items: safeItems,
  }
}

async function fetchSellerItem(supabase: any, itemId: string) {
  const { data, error } = await supabase
    .from('seller_items')
    .select(`
      id,
      tailor_profile_id,
      title,
      description,
      category,
      sizes,
      size_guide,
      size_inventory,
      currency,
      price_amount,
      photo_urls,
      stock_status,
      inventory_quantity,
      pickup_available,
      delivery_available,
      shipping_available,
      tailor_profiles(display_name, user_id, location, availability, shop_paused, is_live)
    `)
    .eq('id', itemId)
    .eq('is_live', true)
    .gt('inventory_quantity', 0)
    .neq('stock_status', 'HIDDEN')
    .neq('stock_status', 'SOLD_OUT')
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as Record<string, unknown>
  const sellerProfile = firstJoinedRow(row.tailor_profiles as Record<string, unknown> | Record<string, unknown>[] | null)
  const stockStatus = asString(row.stock_status) ?? 'IN_STOCK'
  const inventoryQuantity =
    typeof row.inventory_quantity === 'number'
      ? row.inventory_quantity
      : fallbackInventoryQuantity(stockStatus, true)
  const sizes = asStringList(row.sizes)
  const photoUrls = await filterBlockedMediaUrls(supabase, asStringList(row.photo_urls))
  const detail = {
    id: row.id,
    tailorProfileId: row.tailor_profile_id,
    tailorUserId: sellerProfile ? asString(asRecord(sellerProfile).user_id) : null,
    sellerName: sellerProfile ? asString(asRecord(sellerProfile).display_name) ?? 'This seller' : 'This seller',
    sellerLocation: sellerProfile ? asString(asRecord(sellerProfile).location) : null,
    sellerAvailability: sellerProfile ? asString(asRecord(sellerProfile).availability) : null,
    sellerLive: sellerProfile ? asRecord(sellerProfile).is_live === true : false,
    shopPaused: sellerProfile ? asRecord(sellerProfile).shop_paused === true : false,
    title: row.title,
    description: row.description ?? null,
    category: row.category ?? null,
    sizes,
    sizeGuide: row.size_guide && typeof row.size_guide === 'object' && !Array.isArray(row.size_guide)
      ? row.size_guide
      : null,
    sizeInventory: normalizeSizeInventory(sizes, row.size_inventory, inventoryQuantity),
    currency: row.currency,
    priceAmount: row.price_amount,
    photoUrls,
    stockStatus,
    inventoryQuantity,
    pickupAvailable: row.pickup_available === true,
    deliveryAvailable: row.delivery_available === true,
    shippingAvailable: row.shipping_available === true,
  }

  return isPubliclyAvailableReadyMade(detail) ? detail : null
}

async function attachExploreCovers(supabase: any, rows: TailorDiscoveryGatewayRow[]) {
  const ids = rows
    .map((row) => typeof row.id === 'string' ? row.id : null)
    .filter((value): value is string => !!value)

  if (ids.length === 0) return rows

  const { data, error } = await supabase
    .from('portfolio_items')
    .select('tailor_profile_id, image_url, sort_order')
    .in('tailor_profile_id', ids)
    .order('sort_order', { ascending: true })

  if (error) return rows
  const coverCandidateUrls = [
    ...((data ?? []) as PortfolioCoverRow[])
      .map((row) => (typeof row.image_url === 'string' ? row.image_url.trim() : null))
      .filter((value): value is string => !!value),
    ...rows.flatMap((row) => [
      typeof row.avatar_url === 'string' ? row.avatar_url.trim() : null,
      ...asStringList(row.portfolio_photo_urls),
    ]),
  ].filter((value): value is string => !!value)
  const blockedUrls = await findBlockedMediaUrls(
    supabase,
    coverCandidateUrls,
  )

  const coverByTailor = new Map<string, string>()
  for (const row of (data ?? []) as PortfolioCoverRow[]) {
    const tailorId = typeof row.tailor_profile_id === 'string' ? row.tailor_profile_id : null
    const imageUrl =
      typeof row.image_url === 'string' && row.image_url.trim().length > 0
        ? row.image_url.trim()
        : null
    if (!tailorId || !imageUrl || blockedUrls.has(imageUrl) || coverByTailor.has(tailorId)) continue
    coverByTailor.set(tailorId, imageUrl)
  }

  return rows.map((row) => {
    const cover = typeof row.id === 'string' ? coverByTailor.get(row.id) : null
    if (cover) {
      return {
        ...row,
        explore_image_url: cover,
        explore_image_bucket: 'portfolio-photos',
      }
    }

    const avatarUrl = typeof row.avatar_url === 'string' && row.avatar_url.trim().length > 0
      ? row.avatar_url.trim()
      : null
    const safeAvatarUrl = avatarUrl && !blockedUrls.has(avatarUrl) ? avatarUrl : null
    const fallbackPhotos = asStringList(row.portfolio_photo_urls).filter((url) => !blockedUrls.has(url))
    return {
      ...row,
      explore_image_url: safeAvatarUrl ?? fallbackPhotos[0] ?? null,
      explore_image_bucket: safeAvatarUrl ? 'avatars' : fallbackPhotos[0] ? 'portfolio-photos' : null,
    }
  })
}

async function fetchExploreTailors(supabase: any, payload: Record<string, unknown>) {
  const limit = Math.max(1, Math.min(40, Number(payload.limit) || 20))
  const offset = Math.max(0, Number(payload.offset) || 0)
  const query = safeSearchTerm(payload.query)
  const specialty = safeSearchTerm(payload.specialty)
  const general = safeSearchTerm(payload.general)
  const location = safeSearchTerm(payload.location)
  const strictLocation = payload.strictLocation === true
  let builder = supabase
    .from('tailor_profiles')
    .select('id, display_name, location, seller_type, tier, avg_rating, total_reviews, total_orders, availability, accepts_custom_orders_now, shop_paused, specialty_tags, avatar_url, portfolio_photo_urls, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, price_range_min, price_range_max, avg_response_hours, ranking_score')
    .eq('is_live', true)
    .order('ranking_score', { ascending: false, nullsFirst: false })
    .order('avg_rating', { ascending: false, nullsFirst: false })
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (strictLocation && location) {
    builder = builder.ilike('location', `%${location}%`)
  }

  const searchTerm = specialty ?? general ?? query
  const arrayTerm = safeArrayLiteralItem(searchTerm)
  if (searchTerm && arrayTerm) {
    const searchClauses = [
      `display_name.ilike.%${searchTerm}%`,
      `location.ilike.%${searchTerm}%`,
    ]

    // PostgREST array literals are picky about spaces; multi-word text still searches
    // name/location, while exact specialty chips continue to use the indexed array.
    if (!arrayTerm.includes(' ')) {
      searchClauses.push(`specialty_tags.cs.{${arrayTerm}}`)
    }

    builder = builder.or(searchClauses.join(','))
  }

  const { data, error } = await builder
  if (error) throw error
  return attachExploreCovers(supabase, ((data ?? []) as TailorDiscoveryGatewayRow[]))
}

async function fetchTailorProfilePublic(supabase: any, tailorId: string) {
  const [profileRes, reviewsRes, portfolioRes] = await Promise.allSettled([
    supabase
      .from('tailor_profiles')
      .select('id, user_id, display_name, location, seller_type, tier, avg_rating, total_reviews, total_orders, avg_response_hours, availability, accepts_custom_orders_now, shop_paused, bio, specialty_tags, languages, currency, price_range_min, price_range_max, avatar_url, portfolio_photo_urls, portfolio_video_urls, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available')
      .eq('id', tailorId)
      .eq('is_live', true)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id, rating, body, tags, media_urls, created_at, reviewer_name, tailor_response, orders!order_id(customer_profiles!customer_id(avatar_url))')
      .eq('tailor_profile_id', tailorId)
      .eq('flagged', false)
      .not('published_at', 'is', null)
      .lte('published_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('portfolio_items')
      .select('image_url, sort_order')
      .eq('tailor_profile_id', tailorId)
      .order('sort_order', { ascending: true }),
  ])

  if (profileRes.status === 'rejected' || profileRes.value.error) {
    throw profileRes.status === 'rejected' ? profileRes.reason : profileRes.value.error
  }

  const profileRow = asRecord(profileRes.value.data)
  if (!profileRow.id) return null

  const reviewsData = reviewsRes.status === 'fulfilled' && !reviewsRes.value.error
    ? ((reviewsRes.value.data ?? []) as Array<Record<string, unknown>>)
    : []
  const portfolioData = portfolioRes.status === 'fulfilled' && !portfolioRes.value.error
    ? ((portfolioRes.value.data ?? []) as Array<Record<string, unknown>>)
    : []

  const portfolioPhotosFromItems = portfolioData
    .map((row) => asString(row.image_url))
    .filter((value): value is string => !!value)
  const profileAvatarUrl = asString(profileRow.avatar_url)
  const profilePortfolioPhotos = asStringList(profileRow.portfolio_photo_urls)
  const profilePortfolioVideos = asStringList(profileRow.portfolio_video_urls)
  const blockedProfileMedia = await findBlockedMediaUrls(supabase, [
    profileAvatarUrl,
    ...portfolioPhotosFromItems,
    ...profilePortfolioPhotos,
    ...profilePortfolioVideos,
  ].filter((value): value is string => !!value))
  const safePortfolioPhotosFromItems = portfolioPhotosFromItems.filter((url) => !blockedProfileMedia.has(url))
  const safeProfilePortfolioPhotos = profilePortfolioPhotos.filter((url) => !blockedProfileMedia.has(url))
  const safeProfilePortfolioVideos = profilePortfolioVideos.filter((url) => !blockedProfileMedia.has(url))
  const reviewerAvatarUrls = reviewsData
    .map((row) => {
      const orderRow = firstJoinedRow(row.orders as Record<string, unknown> | Record<string, unknown>[] | null)
      const customerProfile = firstJoinedRow(asRecord(orderRow).customer_profiles as Record<string, unknown> | Record<string, unknown>[] | null)
      return asString(asRecord(customerProfile).avatar_url)
    })
    .filter((value): value is string => !!value)
  const blockedReviewerAvatarUrls = await findBlockedMediaUrls(supabase, reviewerAvatarUrls)
  const derivedReviewCount = reviewsData.length
  const derivedAverageRating = derivedReviewCount > 0
    ? reviewsData.reduce((sum, row) => sum + (typeof row.rating === 'number' ? row.rating : 0), 0) / derivedReviewCount
    : null

  return {
    profile: {
      id: profileRow.id,
      userId: asString(profileRow.user_id),
      displayName: asString(profileRow.display_name) ?? 'Drape tailor',
      location: asString(profileRow.location) ?? 'Location not listed',
      sellerType: asString(profileRow.seller_type) ?? 'TAILOR',
      tier: asString(profileRow.tier) ?? 'BRONZE',
      avgRating: derivedAverageRating ?? (typeof profileRow.avg_rating === 'number' ? profileRow.avg_rating : 0),
      totalReviews: derivedReviewCount || (typeof profileRow.total_reviews === 'number' ? profileRow.total_reviews : 0),
      totalOrders: typeof profileRow.total_orders === 'number' ? profileRow.total_orders : 0,
      avgResponseHours: typeof profileRow.avg_response_hours === 'number' ? profileRow.avg_response_hours : null,
      availability: asString(profileRow.availability) ?? 'OPEN',
      acceptsCustomOrdersNow: profileRow.accepts_custom_orders_now !== false,
      shopPaused: profileRow.shop_paused === true,
      bio: asString(profileRow.bio),
      specialtyTags: asStringList(profileRow.specialty_tags),
      languages: asStringList(profileRow.languages),
      currency: asString(profileRow.currency) ?? 'USD',
      priceRangeMin: typeof profileRow.price_range_min === 'number' ? profileRow.price_range_min : null,
      priceRangeMax: typeof profileRow.price_range_max === 'number' ? profileRow.price_range_max : null,
      avatarUrl: profileAvatarUrl && !blockedProfileMedia.has(profileAvatarUrl) ? profileAvatarUrl : null,
      portfolioPhotos: safePortfolioPhotosFromItems.length > 0
        ? safePortfolioPhotosFromItems
        : safeProfilePortfolioPhotos,
      portfolioVideos: safeProfilePortfolioVideos,
      supportsCustomOrders: profileRow.supports_custom_orders !== false,
      supportsReadyMade: profileRow.supports_ready_made === true,
      pickupAvailable: profileRow.pickup_available === true,
      deliveryAvailable: profileRow.delivery_available === true,
      shippingAvailable: profileRow.shipping_available === true,
    },
    reviews: reviewsData.map((row) => {
      const orderRow = firstJoinedRow(row.orders as Record<string, unknown> | Record<string, unknown>[] | null)
      const customerProfile = firstJoinedRow(asRecord(orderRow).customer_profiles as Record<string, unknown> | Record<string, unknown>[] | null)
      const reviewerAvatarUrl = asString(asRecord(customerProfile).avatar_url)
      return {
        id: row.id,
        rating: typeof row.rating === 'number' ? row.rating : 0,
        body: asString(row.body),
        tags: asStringList(row.tags),
        reviewerName: asString(row.reviewer_name) ?? 'Customer',
        reviewerAvatarUrl: reviewerAvatarUrl && !blockedReviewerAvatarUrls.has(reviewerAvatarUrl) ? reviewerAvatarUrl : null,
        response: asString(row.tailor_response),
        mediaUrls: asStringList(row.media_urls),
        createdAt: asString(row.created_at) ?? new Date().toISOString(),
      }
    }),
  }
}

async function fetchTailorProfile(supabase: any, req: Request, tailorId: string) {
  const publicData = await cachedRead(`tailor-profile-public:${tailorId}`, 120_000, () =>
    fetchTailorProfilePublic(supabase, tailorId)
  )
  if (!publicData) return null

  const authUserId = await resolveAuthenticatedUserId(req, supabase)
  let isSaved = false
  if (authUserId) {
    const { data: savedData } = await supabase
      .from('saved_tailors')
      .select('id')
      .eq('user_id', authUserId)
      .eq('tailor_profile_id', tailorId)
      .maybeSingle()
    isSaved = !!savedData
  }

  return {
    ...asRecord(publicData),
    isSaved,
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', message: 'Use POST for read gateway requests.' }, 405, cors)
  }

  try {
    const payload = asRecord(await req.json().catch(() => ({})))
    const action = asString(payload.action) as ReadAction | null
    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    if (action === 'tailor-shop') {
      const tailorId = asString(payload.tailorId)
      if (!tailorId) return jsonResponse({ error: 'TAILOR_REQUIRED', message: 'Tailor id is required.' }, 400, cors)
      return jsonResponse({
        ok: true,
        data: await cachedRead(`tailor-shop:${tailorId}`, 120_000, () =>
          fetchTailorShop(supabase, tailorId)
        ),
      }, 200, cors)
    }

    if (action === 'seller-item') {
      const itemId = asString(payload.itemId)
      if (!itemId) return jsonResponse({ error: 'ITEM_REQUIRED', message: 'Item id is required.' }, 400, cors)
      return jsonResponse({
        ok: true,
        data: await cachedRead(`seller-item:${itemId}`, 120_000, () =>
          fetchSellerItem(supabase, itemId)
        ),
      }, 200, cors)
    }

    if (action === 'explore-tailors') {
      const limit = Math.max(1, Math.min(40, Number(payload.limit) || 20))
      const offset = Math.max(0, Number(payload.offset) || 0)
      const query = safeSearchTerm(payload.query) ?? ''
      const specialty = safeSearchTerm(payload.specialty) ?? ''
      const general = safeSearchTerm(payload.general) ?? ''
      const location = safeSearchTerm(payload.location) ?? ''
      const strictLocation = payload.strictLocation === true ? '1' : '0'
      const key = `explore:${limit}:${offset}:${query}:${specialty}:${general}:${location}:${strictLocation}`
      return jsonResponse({
        ok: true,
        data: await cachedRead(key, 90_000, () => fetchExploreTailors(supabase, payload)),
      }, 200, cors)
    }

    if (action === 'tailor-profile') {
      const tailorId = asString(payload.tailorId)
      if (!tailorId) return jsonResponse({ error: 'TAILOR_REQUIRED', message: 'Tailor id is required.' }, 400, cors)
      return jsonResponse({ ok: true, data: await fetchTailorProfile(supabase, req, tailorId) }, 200, cors)
    }

    return jsonResponse({ error: 'UNKNOWN_READ_ACTION', message: 'This read action is not supported.' }, 400, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'READ_GATEWAY_FAILED', message: 'Could not load this data right now.' }, 500, cors)
  }
})
