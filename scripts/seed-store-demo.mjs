#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const DEFAULT_PASSWORD = process.env.STORE_DEMO_PASSWORD ?? 'DrapeLaunch2026!'
const MEDIA_PREFLIGHT_BYTES = 512 * 1024
const IOS_INCOMPATIBLE_PNG_CHUNKS = new Set(['caBX', 'jumb'])

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function loadEnv(path) {
  try {
    const text = readFileSync(path, 'utf8')
    const env = {}
    for (const line of text.split(/\r?\n/u)) {
      const match = line.match(/^([^#=\s]+)=(.*)$/u)
      if (!match) continue
      env[match[1]] = match[2].replace(/^"|"$/gu, '')
    }
    return env
  } catch {
    return {}
  }
}

function stableUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

function parseManifest(path) {
  if (!path) {
    throw new Error('Pass --media <manifest.json>. Demo seeding intentionally requires approved media.')
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed.assetRoot) {
    for (const tailor of parsed.tailors ?? []) {
      const assetKey = tailor.assetKey ?? tailor.key
      tailor.avatarPath = `${parsed.assetRoot}/identity/${assetKey}-founder-v1.png`
      tailor.portfolioPaths = Array.from(
        { length: 6 },
        (_, index) => `${parsed.assetRoot}/portfolio/${assetKey}/${String(index + 1).padStart(2, '0')}.png`,
      )
    }
  }
  if (!Array.isArray(parsed.tailors) || parsed.tailors.length < 8) {
    throw new Error('Media manifest must include at least 8 globally representative showcase tailors.')
  }

  for (const tailor of parsed.tailors) {
    if (!tailor.key || !tailor.email || !tailor.displayName) {
      throw new Error('Every tailor needs key, email, and displayName.')
    }
    const portfolioMedia = tailor.portfolioPaths ?? tailor.portfolioUrls
    if (!Array.isArray(portfolioMedia) || portfolioMedia.length < 6) {
      throw new Error(`${tailor.key} needs at least 6 portfolioPaths or portfolioUrls for store screenshots.`)
    }
    if (!tailor.avatarPath && !tailor.avatarUrl) {
      throw new Error(`${tailor.key} needs avatarPath or avatarUrl.`)
    }
  }

  return parsed
}

async function fetchJson(url, options, label) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Keep the raw body for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }

  return body
}

async function findAuthUserByEmail(baseUrl, headers, email) {
  const data = await fetchJson(`${baseUrl}/auth/v1/admin/users?per_page=1000`, { headers }, 'List auth users')
  return (data.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function ensureAuthUser(baseUrl, headers, input) {
  const existing = await findAuthUserByEmail(baseUrl, headers, input.email)
  if (existing?.id) return existing.id

  const created = await fetchJson(
    `${baseUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: input.email,
        password: input.password ?? DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: input.role,
          display_name: input.displayName,
          demo_account: true,
          showcase_account: true,
        },
      }),
    },
    `Create auth user ${input.email}`,
  )

  return created.id
}

async function upsertRows(baseUrl, headers, table, rows, onConflict) {
  if (rows.length === 0) return
  await fetchJson(
    `${baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        ...headers,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    },
    `Upsert ${table}`,
  )
}

async function existingRows(baseUrl, headers, table, select, filter) {
  return fetchJson(
    `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&${filter}`,
    { headers },
    `Load existing ${table}`,
  )
}

function requireUrlList(values, label) {
  const urls = (values ?? [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
  if (urls.some((url) => !/^https?:\/\//i.test(url))) {
    throw new Error(`${label} must contain full HTTPS URLs or already-public Supabase URLs.`)
  }
  return urls
}

function manifestMediaEntries(manifest) {
  const entries = []

  for (const tailor of manifest.tailors) {
    entries.push({
      label: `${tailor.key}.avatarUrl`,
      url: tailor.avatarUrl,
      path: tailor.avatarPath,
    })
    for (const [index, value] of (tailor.portfolioPaths ?? tailor.portfolioUrls).entries()) {
      entries.push({
        label: `${tailor.key}.portfolio.${index}`,
        ...(tailor.portfolioPaths ? { path: value } : { url: value }),
      })
    }
    for (const [itemIndex, item] of (tailor.shopItems ?? []).entries()) {
      for (const [mediaIndex, value] of (item.photoPaths ?? item.photoUrls ?? []).entries()) {
        entries.push({
          label: `${tailor.key}.shopItems.${itemIndex}.photos.${mediaIndex}`,
          ...(item.photoPaths ? { path: value } : { url: value }),
        })
      }
    }
  }

  return entries
}

async function readResponsePrefix(response, maxBytes) {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer()).slice(0, maxBytes)
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const remainingBytes = maxBytes - totalBytes
      const chunk = value.byteLength > remainingBytes ? value.slice(0, remainingBytes) : value
      chunks.push(chunk)
      totalBytes += chunk.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const prefix = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    prefix.set(chunk, offset)
    offset += chunk.byteLength
  }
  return prefix
}

function isPng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return signature.every((value, index) => bytes[index] === value)
}

function pngChunkTypes(bytes) {
  if (!isPng(bytes)) return []

  const chunkTypes = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, false)
    const typeOffset = offset + 4
    const chunkEnd = offset + 12 + chunkLength
    if (chunkEnd > bytes.byteLength) break

    chunkTypes.push(String.fromCharCode(
      bytes[typeOffset],
      bytes[typeOffset + 1],
      bytes[typeOffset + 2],
      bytes[typeOffset + 3],
    ))
    offset = chunkEnd
  }
  return chunkTypes
}

async function validateManifestMedia(manifest) {
  const checkedUrls = new Map()

  for (const entry of manifestMediaEntries(manifest)) {
    if (entry.path) {
      const bytes = new Uint8Array(readFileSync(entry.path))
      if (bytes.byteLength === 0) throw new Error(`${entry.label} is empty.`)
      const incompatibleChunks = pngChunkTypes(bytes.slice(0, MEDIA_PREFLIGHT_BYTES))
        .filter((type) => IOS_INCOMPATIBLE_PNG_CHUNKS.has(type))
      if (incompatibleChunks.length > 0) {
        throw new Error(`${entry.label} contains iOS-incompatible PNG metadata (${incompatibleChunks.join(', ')}).`)
      }
      continue
    }
    const url = typeof entry.url === 'string' ? entry.url.trim() : ''
    if (!url || checkedUrls.has(url)) continue

    let response
    try {
      response = await fetch(url)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`${entry.label} could not be loaded: ${reason}`)
    }
    if (!response.ok) {
      throw new Error(`${entry.label} could not be loaded (${response.status}).`)
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      throw new Error(`${entry.label} returned ${contentType || 'an unknown content type'} instead of media.`)
    }

    const prefix = await readResponsePrefix(response, MEDIA_PREFLIGHT_BYTES)
    const incompatibleChunks = pngChunkTypes(prefix).filter((type) => IOS_INCOMPATIBLE_PNG_CHUNKS.has(type))
    if (incompatibleChunks.length > 0) {
      throw new Error(
        `${entry.label} contains PNG content-credential metadata (${incompatibleChunks.join(', ')}) that is not reliable in the iOS image decoder. Re-encode it as a baseline JPEG before seeding.`,
      )
    }

    checkedUrls.set(url, entry.label)
  }
}

async function uploadLocalMedia(baseUrl, headers, sourcePath, objectPath) {
  const bytes = readFileSync(sourcePath)
  const response = await fetch(`${baseUrl}/storage/v1/object/portfolio-photos/${objectPath}`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'image/png',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!response.ok) throw new Error(`Upload ${sourcePath} failed (${response.status}): ${await response.text()}`)
  return `${baseUrl}/storage/v1/object/public/portfolio-photos/${objectPath}`
}

async function materializeLocalMedia(manifest, baseUrl, headers) {
  for (const tailor of manifest.tailors) {
    if (tailor.avatarPath) {
      tailor.avatarUrl = await uploadLocalMedia(baseUrl, headers, tailor.avatarPath, `showcase/${tailor.key}/avatar.png`)
    }
    if (tailor.portfolioPaths) {
      tailor.portfolioUrls = []
      for (const [index, sourcePath] of tailor.portfolioPaths.entries()) {
        tailor.portfolioUrls.push(await uploadLocalMedia(
          baseUrl,
          headers,
          sourcePath,
          `showcase/${tailor.key}/portfolio-${String(index + 1).padStart(2, '0')}.png`,
        ))
      }
    }
    for (const [itemIndex, item] of (tailor.shopItems ?? []).entries()) {
      if (!item.photoPaths) continue
      item.photoUrls = []
      for (const [mediaIndex, sourcePath] of item.photoPaths.entries()) {
        item.photoUrls.push(await uploadLocalMedia(
          baseUrl,
          headers,
          sourcePath,
          `showcase/${tailor.key}/shop-${String(itemIndex + 1).padStart(2, '0')}-${String(mediaIndex + 1).padStart(2, '0')}.png`,
        ))
      }
    }
  }
}

const env = {
  ...loadEnv('apps/web/.env.local'),
  ...process.env,
}
const baseUrl = env.STORE_DEMO_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
const serviceKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
const manifestPath = argValue('--media')
const manifest = parseManifest(manifestPath)

if (!baseUrl || !serviceKey) {
  throw new Error('Missing Supabase URL/service role. Set STORE_DEMO_SUPABASE_URL and STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY, or use apps/web/.env.local.')
}

await validateManifestMedia(manifest)

const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
}

await materializeLocalMedia(manifest, baseUrl, headers)

const publicUsers = []
const customerProfiles = []
const tailorProfiles = []
const portfolioPhotos = []
const sellerItems = []
const pickupDetails = []

const showcaseOrigins = {
  'alder-rue': { line1: '18 Review Studio Lane', city: 'London', region: 'London', postalCode: 'EC1A 1BB', countryCode: 'GB' },
  'maison-elara': { line1: '24 Rue de la Démonstration', city: 'Paris', region: 'Île-de-France', postalCode: '75002', countryCode: 'FR' },
  northline: { line1: '80 Review Workshop Road', city: 'Toronto', region: 'ON', postalCode: 'M5V 2T6', countryCode: 'CA' },
  sora: { line1: '2-10 Review Atelier', city: 'Tokyo', region: 'Tokyo', postalCode: '150-0001', countryCode: 'JP' },
  'iya-dara': { line1: '14 Showcase Studio Close', city: 'Lagos', region: 'Lagos', postalCode: '101233', countryCode: 'NG' },
  'noor-form': { line1: '12 Review Design District', city: 'Dubai', region: 'Dubai', postalCode: '00000', countryCode: 'AE' },
  'studio-mare': { line1: '48 Rua Estúdio Showcase', city: 'São Paulo', region: 'SP', postalCode: '01310-100', countryCode: 'BR' },
  'common-thread': { line1: '100 Review Loft Avenue', city: 'New York', region: 'NY', postalCode: '10013', countryCode: 'US' },
}

const reviewerCustomers = manifest.reviewerCustomers ?? [manifest.reviewerCustomer ?? {
  email: 'reviewer.customer@drapeon.co',
  displayName: 'Drape Reviewer',
  phone: '+12025550110',
  defaultCurrency: 'USD',
}]

for (const [reviewerIndex, reviewerCustomer] of reviewerCustomers.entries()) {
  const reviewerPhone = reviewerCustomer.phone ?? `+1202555${String(110 + reviewerIndex).padStart(4, '0')}`
  const reviewerUnit = reviewerCustomer.unitPreference === 'cm' ? 'cm' : 'in'
  const reviewerGarmentContext =
    reviewerCustomer.garmentContext === 'MENSWEAR' ||
    reviewerCustomer.garmentContext === 'WOMENSWEAR' ||
    reviewerCustomer.garmentContext === 'PREFER_NOT_TO_SAY'
      ? reviewerCustomer.garmentContext
      : 'BOTH'
  const reviewerCustomerId = await ensureAuthUser(baseUrl, headers, {
    email: reviewerCustomer.email,
    role: 'CUSTOMER',
    displayName: reviewerCustomer.displayName,
    password: reviewerCustomer.password,
  })
  publicUsers.push({
    id: reviewerCustomerId,
    email: reviewerCustomer.email,
    display_name: reviewerCustomer.displayName,
    role: 'CUSTOMER',
    phone: reviewerPhone,
    default_currency: reviewerCustomer.defaultCurrency ?? 'USD',
    currency_source: 'USER_SELECTED',
    region_code: reviewerCustomer.regionCode ?? 'US',
    updated_at: new Date().toISOString(),
  })
  customerProfiles.push({
    user_id: reviewerCustomerId,
    display_name: reviewerCustomer.displayName,
    phone: reviewerPhone,
    unit_preference: reviewerUnit,
    garment_context: reviewerGarmentContext,
    measurements: {
      unit: reviewerUnit,
      garmentContext: reviewerGarmentContext,
      height: 68, chest: 36, waist: 29, hips: 39,
      shoulderWidth: 16, sleeveLength: 23.5, inseam: 30,
      fitStyle: 'Relaxed', fitPreference: 'RELAXED', measurementSource: 'STORE_DEMO',
    },
    updated_at: new Date().toISOString(),
  })
}

for (const [tailorIndex, tailor] of manifest.tailors.entries()) {
  const userId = await ensureAuthUser(baseUrl, headers, {
    email: tailor.email,
    role: 'TAILOR',
    displayName: tailor.displayName,
    password: tailor.password,
  })
  const profileId = stableUuid(`store-demo-tailor-profile:${tailor.key}`)
  const assetKey = tailor.assetKey ?? tailor.key
  const portfolioUrls = requireUrlList(tailor.portfolioUrls, `${tailor.key}.portfolioUrls`)
  const avatarUrl = typeof tailor.avatarUrl === 'string' ? tailor.avatarUrl.trim() : null

  publicUsers.push({
    id: userId,
    email: tailor.email,
    display_name: tailor.displayName,
    role: 'TAILOR',
    phone: tailor.phone ?? `+15550102${String(tailorIndex).padStart(4, '0')}`,
    default_currency: tailor.currency ?? 'USD',
    currency_source: 'USER_SELECTED',
    region_code: tailor.regionCode ?? 'US',
    updated_at: new Date().toISOString(),
  })

  const origin = showcaseOrigins[assetKey]
  if (!origin) throw new Error(`Missing showcase fulfillment origin for ${assetKey}`)
  pickupDetails.push({
    user_id: userId,
    pickup_address: `${origin.line1}, ${origin.city}`,
    pickup_instructions: 'Synthetic showcase location; not a customer-facing walk-in address.',
    pickup_address_line1: origin.line1,
    pickup_city: origin.city,
    pickup_region: origin.region,
    pickup_postal_code: origin.postalCode,
    pickup_country_code: origin.countryCode,
    pickup_location_verification_source: 'STORE_SHOWCASE_FIXTURE',
    pickup_location_verification_reference: `showcase:${tailor.key}`,
    pickup_location_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  tailorProfiles.push({
    id: profileId,
    user_id: userId,
    display_name: tailor.displayName,
    business_name: tailor.businessName ?? tailor.displayName,
    seller_type: tailor.sellerType ?? 'TAILOR',
    bio: tailor.bio ?? 'Independent studio available for the Drapeon store showcase.',
    location: tailor.location ?? 'New York, USA',
    languages: tailor.languages ?? ['English'],
    specialty_tags: tailor.specialtyTags ?? ['Occasion wear', 'Traditional'],
    price_range_min: tailor.priceRangeMin ?? 120,
    price_range_max: tailor.priceRangeMax ?? 480,
    currency: tailor.currency ?? 'USD',
    payout_currency: tailor.payoutCurrency ?? tailor.currency ?? 'USD',
    payout_provider: tailor.payoutProvider ?? 'STRIPE',
    payout_account_type: tailor.payoutAccountType ?? 'STRIPE_CONNECT',
    payout_account_verified: tailor.payoutAccountVerified ?? true,
    stripe_connect_account_id: tailor.stripeConnectAccountId ?? `acct_demo_${tailor.key}`,
    tier: tailor.tier ?? 'VERIFIED',
    availability: tailor.availability ?? 'OPEN',
    is_verified: true,
    is_live: true,
    avg_rating: tailor.avgRating ?? 0,
    total_reviews: tailor.totalReviews ?? 0,
    total_orders: tailor.totalOrders ?? 0,
    avg_response_hours: tailor.avgResponseHours ?? 3,
    supports_custom_orders: tailor.supportsCustomOrders ?? true,
    supports_ready_made: tailor.supportsReadyMade ?? true,
    pickup_available: tailor.pickupAvailable ?? true,
    delivery_available: tailor.deliveryAvailable ?? true,
    shipping_available: tailor.shippingAvailable ?? true,
    delivery_fee: tailor.deliveryFee ?? 1500,
    shipping_fee: tailor.shippingFee ?? 3500,
    ships_internationally: tailor.shipsInternationally ?? true,
    id_verification_status: 'VERIFIED',
    id_verified_at: new Date().toISOString(),
    portfolio_photo_urls: portfolioUrls,
    updated_at: new Date().toISOString(),
  })

  if (avatarUrl) {
    tailorProfiles[tailorProfiles.length - 1].avatar_url = avatarUrl
  }

  portfolioUrls.forEach((url, index) => {
    portfolioPhotos.push({
      id: stableUuid(`store-demo-portfolio:${tailor.key}:${index}`),
      tailor_profile_id: profileId,
      storage_path: url,
      public_url: url,
      caption: tailor.portfolioCaptions?.[index] ?? null,
      display_order: index,
    })
  })

  for (const [index, item] of (tailor.shopItems ?? []).entries()) {
    const photoUrls = requireUrlList(item.photoUrls, `${tailor.key}.shopItems.${index}.photoUrls`)
    sellerItems.push({
      id: stableUuid(`store-demo-seller-item:${tailor.key}:${item.title}`),
      tailor_profile_id: profileId,
      title: item.title,
      description: item.description ?? 'Launch demo ready-made item.',
      category: item.category ?? 'Ready-made',
      sizes: item.sizes ?? ['M', 'L'],
      price_amount: item.priceAmount ?? 18000,
      currency: item.currency ?? tailor.currency ?? 'USD',
      photo_urls: photoUrls,
      is_ready_made: true,
      is_live: item.isLive ?? true,
      stock_status: item.stockStatus ?? 'IN_STOCK',
      inventory_quantity: item.inventoryQuantity ?? 3,
      size_inventory: item.sizeInventory ?? { M: 1, L: 2 },
      size_guide: item.sizeGuide ?? {},
      pickup_available: item.pickupAvailable ?? true,
      delivery_available: item.deliveryAvailable ?? true,
      shipping_available: item.shippingAvailable ?? true,
      updated_at: new Date().toISOString(),
    })
  }
}

// Verified profile identity, public identity, and payout fields are protected by
// database triggers. Repeat runs update ordinary showcase fields while leaving
// reviewed values untouched, so rerunning this seed does not weaken that trust
// boundary or fail on a fresh id_verified_at timestamp.
const protectedExistingProfileFields = [
  'avatar_url',
  'display_name',
  'bio',
  'location',
  'languages',
  'specialty_tags',
  'currency',
  'payout_currency',
  'payout_provider',
  'payout_account_type',
  'payout_account_verified',
  'stripe_connect_account_id',
  'id_verification_status',
  'id_verified_at',
]
const existingTailorRows = await existingRows(
  baseUrl,
  headers,
  'tailor_profiles',
  `user_id,${protectedExistingProfileFields.join(',')}`,
  `user_id=in.(${tailorProfiles.map((profile) => profile.user_id).join(',')})`,
)
const existingTailorRowsByUserId = new Map(existingTailorRows.map((row) => [row.user_id, row]))
for (const profile of tailorProfiles) {
  const existing = existingTailorRowsByUserId.get(profile.user_id)
  if (!existing) continue
  for (const field of protectedExistingProfileFields) profile[field] = existing[field]
}

await upsertRows(baseUrl, headers, 'users', publicUsers, 'id')
await upsertRows(baseUrl, headers, 'customer_profiles', customerProfiles, 'user_id')
await upsertRows(baseUrl, headers, 'tailor_profiles', tailorProfiles, 'user_id')
await upsertRows(baseUrl, headers, 'tailor_pickup_details', pickupDetails, 'user_id')
await upsertRows(baseUrl, headers, 'portfolio_photos', portfolioPhotos, 'id')
await upsertRows(baseUrl, headers, 'seller_items', sellerItems, 'id')

console.log(JSON.stringify({
  ok: true,
  reviewerCustomers: reviewerCustomers.map(({ email }) => email),
  tailorCount: tailorProfiles.length,
  portfolioPhotoCount: portfolioPhotos.length,
  fulfillmentOriginCount: pickupDetails.length,
  sellerItemCount: sellerItems.length,
}, null, 2))
