import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log } from '../_shared/logger.ts'

const FN = 'read-gateway'

type ReadAction = 'tailor-shop' | 'seller-item' | 'explore-tailors'

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

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
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
        .select('display_name, availability, is_live, supports_custom_orders')
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

  return {
    tailorName: asString(profile.display_name) ?? 'This seller',
    sellerAvailability: asString(profile.availability),
    sellerLive: profile.is_live === true,
    supportsCustomOrders: profile.supports_custom_orders !== false,
    items,
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
      tailor_profiles(display_name, user_id, location, availability, is_live)
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
  const detail = {
    id: row.id,
    tailorProfileId: row.tailor_profile_id,
    tailorUserId: sellerProfile ? asString(asRecord(sellerProfile).user_id) : null,
    sellerName: sellerProfile ? asString(asRecord(sellerProfile).display_name) ?? 'This seller' : 'This seller',
    sellerLocation: sellerProfile ? asString(asRecord(sellerProfile).location) : null,
    sellerAvailability: sellerProfile ? asString(asRecord(sellerProfile).availability) : null,
    sellerLive: sellerProfile ? asRecord(sellerProfile).is_live === true : false,
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
    photoUrls: asStringList(row.photo_urls),
    stockStatus,
    inventoryQuantity,
    pickupAvailable: row.pickup_available === true,
    deliveryAvailable: row.delivery_available === true,
    shippingAvailable: row.shipping_available === true,
  }

  return isPubliclyAvailableReadyMade(detail) ? detail : null
}

async function fetchExploreTailors(supabase: any, payload: Record<string, unknown>) {
  const limit = Math.max(1, Math.min(40, Number(payload.limit) || 20))
  const query = asString(payload.query)
  let builder = supabase
    .from('tailor_profiles')
    .select('id, display_name, location, seller_type, tier, avg_rating, total_reviews, total_orders, availability, specialty_tags, avatar_url, portfolio_photo_urls, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available')
    .eq('is_live', true)
    .order('avg_rating', { ascending: false, nullsFirst: false })
    .order('total_reviews', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (query) {
    const safeQuery = query.replace(/[%_,]/gu, ' ').trim()
    builder = builder.or(`display_name.ilike.%${safeQuery}%,location.ilike.%${safeQuery}%`)
  }

  const { data, error } = await builder
  if (error) throw error
  return data ?? []
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
      return jsonResponse({ ok: true, data: await fetchTailorShop(supabase, tailorId) }, 200, cors)
    }

    if (action === 'seller-item') {
      const itemId = asString(payload.itemId)
      if (!itemId) return jsonResponse({ error: 'ITEM_REQUIRED', message: 'Item id is required.' }, 400, cors)
      return jsonResponse({ ok: true, data: await fetchSellerItem(supabase, itemId) }, 200, cors)
    }

    if (action === 'explore-tailors') {
      return jsonResponse({ ok: true, data: await fetchExploreTailors(supabase, payload) }, 200, cors)
    }

    return jsonResponse({ error: 'UNKNOWN_READ_ACTION', message: 'This read action is not supported.' }, 400, cors)
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ error: 'READ_GATEWAY_FAILED', message: 'Could not load this data right now.' }, 500, cors)
  }
})
