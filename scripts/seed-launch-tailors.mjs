#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const DEFAULT_PASSWORD = process.env.LAUNCH_TAILOR_PASSWORD ?? 'DrapeLaunch2026!'
const NETWORK_TIMEOUT_MS = 60_000

const TAILORS = [
  {
    key: 'iya-dara',
    email: process.env.LAUNCH_TAILOR_ONE_EMAIL ?? 'iya.dara@drapeon.co',
    displayName: 'Iya Dara Atelier',
    businessName: 'Iya Dara Atelier',
    phone: '+15550107101',
    location: 'Lagos, Nigeria',
    bio: 'Bridal aso oke, occasion wraps, and hand-finished Yoruba celebration wear. Strong for aso ebi groups, ceremonies, and customers who want careful fabric guidance before a stitch is cut.',
    languages: ['English', 'Yoruba'],
    specialtyTags: ['Aso oke', 'Bridal', 'Aso ebi', 'Embroidery'],
    portfolioCaptions: [
      'Aso oke stripe direction and ceremonial wrap study.',
      'Beaded neckline and sleeve finish direction.',
      'Gele and ipele textile palette for a formal event.',
      'Soft occasion boubou fabric and trim study.',
    ],
    palette: [
      [171, 58, 42],
      [247, 218, 144],
      [38, 106, 79],
      [250, 247, 238],
      [30, 27, 22],
    ],
    shopItems: [
      {
        title: 'Aso Oke Bridal Wrap Set',
        description: 'A ceremonial gele and ipele set with a structured hand feel. Good for brides, family ceremony looks, and coordinated event styling.',
        category: 'Occasion wear',
        sizes: ['One size'],
        priceAmount: 18500,
        sizeInventory: { 'One size': 3 },
        sizeGuide: {
          version: 1,
          unit: 'in',
          fitNotes: 'Wrap styling is adjustable. Message the tailor for color matching before checkout.',
          sizeAdvice: 'ASK_SELLER',
        },
      },
      {
        title: 'Beaded Occasion Boubou',
        description: 'Relaxed boubou silhouette with beaded neckline inspiration for formal dinners, weddings, and family events.',
        category: 'Ready-made',
        sizes: ['M', 'L'],
        priceAmount: 24500,
        sizeInventory: { M: 1, L: 1 },
        sizeGuide: {
          version: 1,
          unit: 'in',
          fields: ['chest', 'hips', 'height'],
          fitNotes: 'Relaxed cut. Choose based on chest and preferred drape.',
          sizeAdvice: 'ASK_SELLER',
        },
      },
    ],
  },
  {
    key: 'kofo-menswear',
    email: process.env.LAUNCH_TAILOR_TWO_EMAIL ?? 'kofo.menswear@drapeon.co',
    displayName: 'Kofo Menswear Studio',
    businessName: 'Kofo Menswear Studio',
    phone: '+15550107102',
    location: 'Houston, USA',
    bio: 'Modern agbada, senator sets, and tailored kaftans for customers who want clean proportions, careful measurement review, and strong finishing for events.',
    languages: ['English'],
    specialtyTags: ['Agbada', 'Senator set', 'Kaftan', 'Menswear'],
    portfolioCaptions: [
      'Agbada panel balance and embroidery placement study.',
      'Senator set pocket and placket finish direction.',
      'Kaftan fabric texture and tonal stitch direction.',
      'Formal menswear color blocking and trim study.',
    ],
    palette: [
      [22, 39, 31],
      [46, 86, 105],
      [230, 222, 205],
      [102, 79, 51],
      [245, 245, 242],
    ],
    shopItems: [
      {
        title: 'Embroidered Senator Two-Piece',
        description: 'Clean senator set direction with tonal embroidery and a relaxed formal fit. Useful for tester checkout, messages, and order tracking.',
        category: 'Menswear',
        sizes: ['M', 'L', 'XL'],
        priceAmount: 22500,
        sizeInventory: { M: 1, L: 2, XL: 1 },
        sizeGuide: {
          version: 1,
          unit: 'in',
          fields: ['chest', 'waist', 'shoulderWidth', 'sleeveLength'],
          fitNotes: 'Straight fit through the body. Message the tailor if between sizes.',
          sizeAdvice: 'ASK_SELLER',
        },
      },
      {
        title: 'Soft Jacquard Kaftan',
        description: 'Simple kaftan with a soft structured hand, built for daily occasion wear and quick fit conversations.',
        category: 'Ready-made',
        sizes: ['M', 'L'],
        priceAmount: 16500,
        sizeInventory: { M: 2, L: 2 },
        sizeGuide: {
          version: 1,
          unit: 'in',
          fields: ['chest', 'height'],
          fitNotes: 'Relaxed kaftan shape. Pick usual size for an easy fit.',
          sizeAdvice: 'ASK_SELLER',
        },
      },
    ],
  },
]

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
    // Keep raw response text for diagnostics.
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
      const diagonal = Math.floor((x + y + variant * 29) / 36) % palette.length
      const vertical = Math.floor((x + variant * 19) / 88) % palette.length
      const thread = (x * 3 + y + variant * 13) % 53 === 0
      const fold = Math.abs(x - width * 0.52 - Math.sin(y / 47) * 46) < 5
      const trim = Math.abs((y % 160) - 84) < 4 || Math.abs((x % 190) - 95) < 3
      const color = palette[thread || fold || trim ? palette.length - 1 : (diagonal + vertical) % palette.length]
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

async function uploadImage(baseUrl, headers, bucket, path, imageBuffer) {
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

async function findAuthUserByEmail(baseUrl, headers, email) {
  const data = await fetchJson(`${baseUrl}/auth/v1/admin/users?per_page=1000`, { headers }, 'List auth users')
  return (data.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function ensureAuthUser(baseUrl, headers, input) {
  const existing = await findAuthUserByEmail(baseUrl, headers, input.email)
  if (existing?.id) {
    await fetchJson(
      `${baseUrl}/auth/v1/admin/users/${existing.id}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          password: input.password ?? DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: {
            role: input.role,
            display_name: input.displayName,
            launch_demo: true,
          },
        }),
      },
      `Refresh auth user ${input.email}`,
    )
    return existing.id
  }

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
          launch_demo: true,
        },
      }),
    },
    `Create auth user ${input.email}`,
  )

  if (!created.id) throw new Error(`Could not create auth user ${input.email}`)
  return created.id
}

async function upsert(baseUrl, headers, table, rows, onConflict) {
  if (!rows.length) return
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

const supabaseUrl =
  env.LAUNCH_DEMO_SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL ??
  env.SUPABASE_URL
const serviceRoleKey =
  env.LAUNCH_DEMO_SUPABASE_SERVICE_ROLE_KEY ??
  env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ??
  env.SUPABASE_SERVICE_ROLE_KEY
const supabaseEnv = env.EXPO_PUBLIC_SUPABASE_ENV ?? env.NEXT_PUBLIC_SUPABASE_ENV ?? 'unknown'

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase URL/service role. Use apps/mobile/.env.local, apps/web/.env.local, or env vars.')
}

if (supabaseEnv.toLowerCase() === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error('Refusing to seed launch tailors into production without --allow-production.')
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
}

const now = new Date().toISOString()
const publicUsers = []
const tailorProfiles = []
const portfolioPhotos = []
const sellerItems = []
const loginRows = []

for (const tailor of TAILORS) {
  const userId = await ensureAuthUser(supabaseUrl, headers, {
    email: tailor.email,
    role: 'TAILOR',
    displayName: tailor.displayName,
  })
  const profileId = stableUuid(`launch-tailor-profile:${tailor.key}`)
  const portfolioUrls = []

  for (let index = 0; index < 4; index += 1) {
    portfolioUrls.push(await uploadImage(
      supabaseUrl,
      headers,
      'portfolio-photos',
      `launch/${tailor.key}/${userId}/portfolio-${index + 1}.png`,
      createTextilePng(720, 960, tailor.palette, index),
    ))
  }

  const avatarUrl = portfolioUrls[0]

  publicUsers.push({
    id: userId,
    email: tailor.email,
    display_name: tailor.displayName,
    role: 'TAILOR',
    phone: tailor.phone,
    default_currency: 'USD',
    currency_source: 'USER_SELECTED',
    region_code: tailor.location.includes('Nigeria') ? 'NG' : 'US',
    updated_at: now,
  })

  tailorProfiles.push({
    id: profileId,
    user_id: userId,
    display_name: tailor.displayName,
    business_name: tailor.businessName,
    seller_type: 'TAILOR',
    bio: tailor.bio,
    location: tailor.location,
    languages: tailor.languages,
    specialty_tags: tailor.specialtyTags,
    price_range_min: 160,
    price_range_max: 650,
    currency: 'USD',
    payout_currency: 'USD',
    payout_provider: 'STRIPE',
    payout_account_type: 'STRIPE_CONNECT',
    payout_account_verified: true,
    payout_account_verified_at: now,
    stripe_connect_account_id: `acct_launch_demo_${tailor.key.replace(/-/gu, '_')}`,
    tier: 'VERIFIED',
    availability: 'OPEN',
    is_verified: true,
    is_live: true,
    profile_completed: true,
    id_verification_status: 'APPROVED',
    id_verified_at: now,
    avg_rating: tailor.key === 'iya-dara' ? 4.9 : 4.8,
    total_reviews: tailor.key === 'iya-dara' ? 23 : 19,
    total_orders: tailor.key === 'iya-dara' ? 64 : 51,
    avg_response_hours: tailor.key === 'iya-dara' ? 2 : 3,
    ranking_score: tailor.key === 'iya-dara' ? 980 : 960,
    supports_custom_orders: true,
    supports_ready_made: true,
    pickup_available: true,
    delivery_available: true,
    shipping_available: true,
    delivery_fee: 1500,
    shipping_fee: 2500,
    ships_internationally: true,
    avatar_url: avatarUrl,
    portfolio_photo_urls: portfolioUrls,
    updated_at: now,
  })

  portfolioUrls.forEach((url, index) => {
    portfolioPhotos.push({
      id: stableUuid(`launch-tailor-portfolio:${tailor.key}:${index}`),
      tailor_profile_id: profileId,
      storage_path: url,
      public_url: url,
      caption: tailor.portfolioCaptions[index] ?? null,
      display_order: index,
    })
  })

  for (const [itemIndex, item] of tailor.shopItems.entries()) {
    const itemUrl = await uploadImage(
      supabaseUrl,
      headers,
      'seller-item-media',
      `launch/${tailor.key}/${userId}/item-${itemIndex + 1}.png`,
      createTextilePng(720, 960, tailor.palette, itemIndex + 8),
    )

    sellerItems.push({
      id: stableUuid(`launch-tailor-item:${tailor.key}:${item.title}`),
      tailor_profile_id: profileId,
      title: item.title,
      description: item.description,
      category: item.category,
      sizes: item.sizes,
      size_guide: item.sizeGuide,
      size_inventory: item.sizeInventory,
      price_amount: item.priceAmount,
      currency: 'USD',
      photo_urls: [itemUrl],
      is_ready_made: true,
      is_live: true,
      stock_status: 'IN_STOCK',
      inventory_quantity: Object.values(item.sizeInventory).reduce((sum, value) => sum + Number(value), 0),
      pickup_available: true,
      delivery_available: true,
      shipping_available: true,
      updated_at: now,
    })
  }

  loginRows.push({
    email: tailor.email,
    password: DEFAULT_PASSWORD,
    profileId,
    displayName: tailor.displayName,
  })
}

await upsert(supabaseUrl, headers, 'users', publicUsers, 'id')
await upsert(supabaseUrl, headers, 'tailor_profiles', tailorProfiles, 'user_id')
await upsert(supabaseUrl, headers, 'portfolio_photos', portfolioPhotos, 'id')
await upsert(supabaseUrl, headers, 'seller_items', sellerItems, 'id')

console.log(JSON.stringify({
  ok: true,
  supabaseEnv,
  tailorCount: tailorProfiles.length,
  portfolioPhotoCount: portfolioPhotos.length,
  sellerItemCount: sellerItems.length,
  checkoutSafety: 'Use browsing, briefs, messages, and checkout handoff. Do not ask testers to complete payment until provider keys are confirmed test-mode.',
  logins: loginRows,
}, null, 2))
