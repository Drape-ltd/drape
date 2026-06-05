#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const DEFAULT_PASSWORD = process.env.STRIPE_QA_PASSWORD ?? 'DrapeStripeQA2026'
const QA_TAILOR_EMAIL = process.env.STRIPE_QA_TAILOR_EMAIL ?? 'stripe.qa.tailor@drapeon.co'
const QA_CUSTOMER_EMAIL = process.env.STRIPE_QA_CUSTOMER_EMAIL ?? 'stripe.qa.customer@drapeon.co'
const QA_TAILOR_NAME = 'Stripe QA Atelier'
const QA_CUSTOMER_NAME = 'Stripe QA Customer'
const QA_ITEM_TITLE = 'Stripe QA Ready-Made Kaftan'
const QA_ITEM_PRICE_AMOUNT = 12500 // USD cents
const NETWORK_TIMEOUT_MS = 60_000

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

async function fetchJson(url, options, label) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  })
  const text = await response.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Keep raw body for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }

  return body
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function createTextilePng(width, height, palette, variant = 0) {
  const rows = []
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4)
    row[0] = 0
    for (let x = 0; x < width; x += 1) {
      const diagonal = Math.floor((x + y + variant * 23) / 34) % palette.length
      const vertical = Math.floor((x + variant * 17) / 92) % palette.length
      const stitch = (x + y + variant * 11) % 47 === 0
      const fold = Math.abs(x - width * 0.56 - Math.sin(y / 55) * 42) < 6
      const color = palette[stitch || fold ? palette.length - 1 : (diagonal + vertical) % palette.length]
      const offset = 1 + x * 4
      row[offset] = color[0]
      row[offset + 1] = color[1]
      row[offset + 2] = color[2]
      row[offset + 3] = 255
    }
    rows.push(row)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

async function uploadQaImage(baseUrl, headers, bucket, path, imageBuffer) {
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    headers: {
      apikey: headers.apikey,
      authorization: headers.authorization,
      'content-type': 'image/png',
      'cache-control': '3600',
      'x-upsert': 'true',
    },
    body: imageBuffer,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Upload ${bucket}/${path} failed (${response.status}): ${text}`)
  }

  return `${baseUrl}/storage/v1/object/public/${bucket}/${path}`
}

async function ensureAuthUser(baseUrl, headers, input) {
  const email = input.email
  const existingPublicUsers = await fetchJson(
    `${baseUrl}/rest/v1/users?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers },
    `Find public user ${email}`,
  )

  const existingId = existingPublicUsers?.[0]?.id
  if (existingId) {
    await fetchJson(
      `${baseUrl}/auth/v1/admin/users/${existingId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          password: input.password ?? DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            role: input.role,
            display_name: input.displayName,
            qa_seed: 'stripe-ready-made',
          },
        }),
      },
      `Refresh auth user ${email}`,
    )
    return existingId
  }

  const created = await fetchJson(
    `${baseUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password: input.password ?? DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: input.role,
          display_name: input.displayName,
          qa_seed: 'stripe-ready-made',
        },
      }),
    },
    `Create auth user ${email}`,
  )

  if (!created.id) throw new Error(`Could not create auth user ${email}`)
  return created.id
}

async function upsert(baseUrl, headers, table, rows, onConflict) {
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

const env = {
  ...loadEnv('apps/mobile/.env.local'),
  ...loadEnv('apps/web/.env.local'),
  ...process.env,
}

const supabaseUrl = env.STORE_DEMO_SUPABASE_URL
  ?? env.NEXT_PUBLIC_SUPABASE_URL
  ?? env.EXPO_PUBLIC_SUPABASE_URL
  ?? env.SUPABASE_URL
const serviceRoleKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY
  ?? env.SUPABASE_SERVICE_ROLE_KEY
const supabaseEnv = env.EXPO_PUBLIC_SUPABASE_ENV ?? env.NEXT_PUBLIC_SUPABASE_ENV ?? 'unknown'

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase URL/service role. Use apps/web/.env.local or env vars.')
}

if (supabaseEnv.toLowerCase() === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error('Refusing to seed Stripe QA data into production without --allow-production.')
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
}

const now = new Date().toISOString()
const tailorUserId = await ensureAuthUser(supabaseUrl, headers, {
  email: QA_TAILOR_EMAIL,
  role: 'TAILOR',
  displayName: QA_TAILOR_NAME,
})
const customerUserId = await ensureAuthUser(supabaseUrl, headers, {
  email: QA_CUSTOMER_EMAIL,
  role: 'CUSTOMER',
  displayName: QA_CUSTOMER_NAME,
})
const tailorProfileId = stableUuid('stripe-qa-tailor-profile')
const sellerItemId = stableUuid('stripe-qa-ready-made-item')

const portfolioPalette = [
  [38, 106, 79],
  [232, 222, 203],
  [93, 112, 101],
  [22, 39, 31],
]
const itemPalette = [
  [221, 83, 47],
  [246, 238, 224],
  [38, 106, 79],
  [29, 29, 27],
]
const portfolioUrls = await Promise.all(
  [0, 1, 2, 3].map((index) =>
    uploadQaImage(
      supabaseUrl,
      headers,
      'portfolio-photos',
      `qa/stripe/${tailorUserId}/portfolio-${index + 1}.png`,
      createTextilePng(720, 960, portfolioPalette, index),
    )
  )
)
const itemPhotoUrls = [
  await uploadQaImage(
    supabaseUrl,
    headers,
    'seller-item-media',
    `qa/stripe/${tailorUserId}/ready-made-kaftan.png`,
    createTextilePng(720, 960, itemPalette, 5),
  ),
]
const itemSizeGuide = {
  version: 1,
  unit: 'in',
  fields: ['chest', 'waist', 'hips', 'height'],
  sizeRanges: {
    M: {
      chest: { min: 38, max: 40 },
      waist: { min: 31, max: 33 },
      hips: { min: 38, max: 41 },
      height: { min: 66, max: 70 },
    },
    L: {
      chest: { min: 42, max: 44 },
      waist: { min: 34, max: 37 },
      hips: { min: 42, max: 45 },
      height: { min: 68, max: 73 },
    },
  },
  fitNotes: 'Relaxed kaftan cut. Choose your usual size for an easy fit.',
  stretchNotes: 'Woven fabric with little stretch.',
  sizeAdvice: 'ASK_SELLER',
}

await upsert(
  supabaseUrl,
  headers,
  'users',
  [
    {
      id: tailorUserId,
      email: QA_TAILOR_EMAIL,
      display_name: QA_TAILOR_NAME,
      role: 'TAILOR',
      phone: '+15550109090',
      default_currency: 'USD',
      currency_source: 'USER_SELECTED',
      region_code: 'US',
      updated_at: now,
    },
    {
      id: customerUserId,
      email: QA_CUSTOMER_EMAIL,
      display_name: QA_CUSTOMER_NAME,
      role: 'CUSTOMER',
      phone: '+14155550123',
      default_currency: 'USD',
      currency_source: 'USER_SELECTED',
      region_code: 'US',
      updated_at: now,
    },
  ],
  'id',
)

await upsert(
  supabaseUrl,
  headers,
  'customer_profiles',
  [
    {
      user_id: customerUserId,
      display_name: QA_CUSTOMER_NAME,
      phone: '+14155550123',
      unit_preference: 'in',
      garment_context: 'MENSWEAR',
      measurements: {
        unit: 'in',
        garmentContext: 'MENSWEAR',
        height: 68,
        chest: 38,
        waist: 32,
        hips: 39,
        shoulderWidth: 17,
        sleeveLength: 24,
        inseam: 30,
        fitStyle: 'Relaxed',
        fitPreference: 'RELAXED',
        measurementSource: 'STRIPE_QA_SEED',
      },
      updated_at: now,
    },
  ],
  'user_id',
)

await upsert(
  supabaseUrl,
  headers,
  'tailor_profiles',
  [
    {
      id: tailorProfileId,
      user_id: tailorUserId,
      display_name: QA_TAILOR_NAME,
      business_name: QA_TAILOR_NAME,
      seller_type: 'TAILOR',
      bio: 'Dev-only Stripe QA profile for checkout and webhook verification.',
      location: 'New York, USA',
      languages: ['English'],
      specialty_tags: ['Kaftan', 'Ready-made', 'Occasion wear'],
      price_range_min: 12500,
      price_range_max: 45000,
      currency: 'USD',
      payout_currency: 'USD',
      payout_provider: 'STRIPE',
      payout_account_type: 'STRIPE_CONNECT',
      payout_account_verified: true,
      payout_account_verified_at: now,
      stripe_connect_account_id: 'acct_drape_stripe_qa',
      tier: 'VERIFIED',
      availability: 'OPEN',
      is_verified: true,
      is_live: true,
      profile_completed: true,
      id_verification_status: 'APPROVED',
      id_verified_at: now,
      avg_rating: 4.9,
      total_reviews: 12,
      total_orders: 24,
      avg_response_hours: 2,
      ranking_score: 999,
      supports_custom_orders: true,
      supports_ready_made: true,
      pickup_available: true,
      delivery_available: true,
      shipping_available: true,
      delivery_fee: 1500,
      shipping_fee: 2500,
      ships_internationally: true,
      avatar_url: portfolioUrls[0],
      portfolio_photo_urls: portfolioUrls,
      updated_at: now,
    },
  ],
  'user_id',
)

await upsert(
  supabaseUrl,
  headers,
  'tailor_pickup_details',
  [
    {
      user_id: tailorUserId,
      pickup_address: '123 Stripe QA Studio, New York, NY 10001',
      pickup_instructions: 'Dev QA pickup only. Use the in-app collection code before marking collected.',
      updated_at: now,
    },
  ],
  'user_id',
)

await upsert(
  supabaseUrl,
  headers,
  'seller_items',
  [
    {
      id: sellerItemId,
      tailor_profile_id: tailorProfileId,
      title: QA_ITEM_TITLE,
      description: 'Dev-only Stripe QA ready-made item. Safe to buy in test mode.',
      category: 'Ready-made',
      sizes: ['M', 'L'],
      size_guide: itemSizeGuide,
      size_inventory: { M: 2, L: 2 },
      price_amount: QA_ITEM_PRICE_AMOUNT,
      currency: 'USD',
      photo_urls: itemPhotoUrls,
      is_ready_made: true,
      is_live: true,
      stock_status: 'IN_STOCK',
      inventory_quantity: 4,
      pickup_available: true,
      delivery_available: true,
      shipping_available: true,
      updated_at: now,
    },
  ],
  'id',
)

console.log(JSON.stringify({
  ok: true,
  supabaseEnv,
  tailor: {
    id: tailorProfileId,
    userId: tailorUserId,
    email: QA_TAILOR_EMAIL,
    password: DEFAULT_PASSWORD,
    currency: 'USD',
    payoutProvider: 'STRIPE',
  },
  customer: {
    id: customerUserId,
    email: QA_CUSTOMER_EMAIL,
    password: DEFAULT_PASSWORD,
    currency: 'USD',
  },
  item: {
    id: sellerItemId,
    title: QA_ITEM_TITLE,
    priceAmount: QA_ITEM_PRICE_AMOUNT,
    currency: 'USD',
  },
}, null, 2))
