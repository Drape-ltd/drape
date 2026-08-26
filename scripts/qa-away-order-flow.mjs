#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const NETWORK_TIMEOUT_MS = 60_000
const CUSTOMER_EMAIL = process.env.STRIPE_QA_CUSTOMER_EMAIL ?? 'stripe.qa.customer@drapeon.co'
const TAILOR_EMAIL = process.env.STRIPE_QA_TAILOR_EMAIL ?? 'stripe.qa.tailor@drapeon.co'
const QA_PASSWORD = process.env.STRIPE_QA_PASSWORD ?? 'DrapeStripeQA2026'
const OUT_DIR = process.env.QA_OUT_DIR ?? 'competition-screens/qa-reports'
const CUSTOM_TAILOR_EMAIL = process.env.AWAY_QA_CUSTOM_TAILOR_EMAIL ?? 'away.qa.tailor@drapeon.co'
const CUSTOM_TAILOR_NAME = 'Away QA Custom Atelier'

function loadEnv(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8')
    const env = {}
    for (const line of text.split(/\r?\n/u)) {
      const match = line.match(/^([^#=\s]+)=(.*)$/u)
      if (!match) continue
      env[match[1]] = match[2].replace(/^"|"$/gu, '').trim()
    }
    return env
  } catch {
    return {}
  }
}

const env = {
  ...loadEnv('apps/mobile/.env.local'),
  ...loadEnv('apps/web/.env.local'),
  ...process.env,
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ?? env.SUPABASE_ANON_KEY
const serviceRoleKey = env.STORE_DEMO_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
const supabaseEnv = env.EXPO_PUBLIC_SUPABASE_ENV ?? env.NEXT_PUBLIC_SUPABASE_ENV ?? 'unknown'

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing Supabase URL, anon/publishable key, or service role key.')
}

if (supabaseEnv.toLowerCase() === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error('Refusing to run away QA against production without --allow-production.')
}

const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
}

function plusDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
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

async function fetchJson(url, options, label, optional = false) {
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
    const failure = {
      ok: false,
      label,
      status: response.status,
      body,
    }
    if (optional) return failure
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

async function rest(pathname, label, optional = false) {
  return fetchJson(`${supabaseUrl}/rest/v1/${pathname}`, { headers: serviceHeaders }, label, optional)
}

async function restPost(pathname, body, label, optional = false, prefer = 'return=representation') {
  return fetchJson(
    `${supabaseUrl}/rest/v1/${pathname}`,
    {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: prefer },
      body: JSON.stringify(body),
    },
    label,
    optional,
  )
}

async function restPatch(pathname, body, label, optional = false) {
  return fetchJson(
    `${supabaseUrl}/rest/v1/${pathname}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(body),
    },
    label,
    optional,
  )
}

async function signIn(email) {
  const body = await fetchJson(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password: QA_PASSWORD }),
    },
    `Sign in ${email}`,
  )
  if (!body?.access_token) throw new Error(`No access token returned for ${email}`)
  return body.access_token
}

async function invoke(name, token, payload, label, optional = false) {
  return fetchJson(
    `${supabaseUrl}/functions/v1/${name}`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    label,
    optional,
  )
}

async function invokeService(name, payload, label, optional = false) {
  return fetchJson(
    `${supabaseUrl}/functions/v1/${name}`,
    {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify(payload),
    },
    label,
    optional,
  )
}

async function ensureAuthUser(input) {
  const existing = await rest(
    `users?select=id&email=eq.${encodeURIComponent(input.email)}&limit=1`,
    `Find public user ${input.email}`,
    true,
  )
  const existingId = Array.isArray(existing) ? existing[0]?.id : null
  if (existingId) {
    await fetchJson(
      `${supabaseUrl}/auth/v1/admin/users/${existingId}`,
      {
        method: 'PUT',
        headers: serviceHeaders,
        body: JSON.stringify({
          password: QA_PASSWORD,
          email_confirm: true,
          user_metadata: {
            role: input.role,
            display_name: input.displayName,
            qa_seed: 'away-order-flow',
          },
        }),
      },
      `Refresh auth user ${input.email}`,
    )
    return existingId
  }

  const created = await fetchJson(
    `${supabaseUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        email: input.email,
        password: QA_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: input.role,
          display_name: input.displayName,
          qa_seed: 'away-order-flow',
        },
      }),
    },
    `Create auth user ${input.email}`,
  )
  if (!created?.id) throw new Error(`Could not create auth user ${input.email}`)
  return created.id
}

async function upsert(table, rows, onConflict, label) {
  return restPost(
    `${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    rows,
    label,
    false,
    'resolution=merge-duplicates,return=representation',
  )
}

async function ensureCustomQaTailor() {
  const now = new Date().toISOString()
  const userId = await ensureAuthUser({
    email: CUSTOM_TAILOR_EMAIL,
    role: 'TAILOR',
    displayName: CUSTOM_TAILOR_NAME,
  })
  const profileId = stableUuid('away-qa-custom-tailor-profile')
  await upsert(
    'users',
    [{
      id: userId,
      email: CUSTOM_TAILOR_EMAIL,
      display_name: CUSTOM_TAILOR_NAME,
      role: 'TAILOR',
      phone: '+15550108888',
      default_currency: 'USD',
      currency_source: 'USER_SELECTED',
      region_code: 'US',
      updated_at: now,
    }],
    'id',
    'Upsert away QA tailor user',
  )
  await upsert(
    'tailor_profiles',
    [{
      id: profileId,
      user_id: userId,
      display_name: CUSTOM_TAILOR_NAME,
      business_name: CUSTOM_TAILOR_NAME,
      seller_type: 'TAILOR',
      bio: 'Dev-only away QA tailor for custom order flow verification.',
      location: 'Austin, USA',
      languages: ['English'],
      specialty_tags: ['Agbada', 'Aso-oke', 'Custom menswear'],
      price_range_min: 15000,
      price_range_max: 50000,
      currency: 'USD',
      payout_currency: 'USD',
      payout_provider: 'STRIPE',
      payout_account_type: 'STRIPE_CONNECT',
      payout_account_verified: true,
      payout_account_verified_at: now,
      stripe_connect_account_id: 'acct_drape_away_qa',
      tier: 'VERIFIED',
      availability: 'OPEN',
      is_verified: true,
      is_live: true,
      profile_completed: true,
      id_verification_status: 'APPROVED',
      id_verified_at: now,
      avg_rating: 4.8,
      total_reviews: 7,
      total_orders: 13,
      avg_response_hours: 2,
      ranking_score: 875,
      supports_custom_orders: true,
      supports_ready_made: false,
      pickup_available: true,
      delivery_available: true,
      shipping_available: true,
      delivery_fee: 1500,
      shipping_fee: 3000,
      ships_internationally: false,
      avatar_url: 'https://images.unsplash.com/photo-1594736797933-d0401ba2fe65?auto=format&fit=crop&w=1200&q=80',
      portfolio_photo_urls: [
        'https://images.unsplash.com/photo-1594736797933-d0401ba2fe65?auto=format&fit=crop&w=1200&q=80',
      ],
      updated_at: now,
    }],
    'user_id',
    'Upsert away QA tailor profile',
  )
  await upsert(
    'tailor_pickup_details',
    [{
      user_id: userId,
      pickup_address: '456 Away QA Studio, Austin, TX 78701',
      pickup_instructions: 'Dev QA pickup only.',
      updated_at: now,
    }],
    'user_id',
    'Upsert away QA tailor pickup details',
  )
  return { userId, profileId, email: CUSTOM_TAILOR_EMAIL }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const startedAt = new Date().toISOString()
  const customQaTailor = await ensureCustomQaTailor()
  const [customerToken, tailorToken] = await Promise.all([
    signIn(CUSTOMER_EMAIL),
    signIn(TAILOR_EMAIL),
  ])
  const customTailorToken = await signIn(CUSTOM_TAILOR_EMAIL)

  const [customerRows, tailorRows, itemRows] = await Promise.all([
    rest(`users?select=*&email=eq.${encodeURIComponent(CUSTOMER_EMAIL)}&limit=1`, 'Find QA customer'),
    rest(`users?select=*&email=eq.${encodeURIComponent(TAILOR_EMAIL)}&limit=1`, 'Find QA tailor'),
    rest(`seller_items?select=*&title=eq.${encodeURIComponent('Stripe QA Ready-Made Kaftan')}&limit=1`, 'Find QA ready-made item'),
  ])

  const customer = customerRows?.[0]
  const tailor = tailorRows?.[0]
  const tailorProfileRows = tailor?.id
    ? await rest(`tailor_profiles?select=*&user_id=eq.${encodeURIComponent(tailor.id)}&limit=1`, 'Find QA tailor profile', true)
    : []
  const seededTailorProfile = Array.isArray(tailorProfileRows) ? tailorProfileRows[0] : null
  const tailorProfileId = seededTailorProfile?.id ?? 'f6dabae3-4a5d-473d-88b4-23b0b887c40c'
  const item = itemRows?.[0]
  if (!customer?.id || !tailor?.id || !item?.id || !tailorProfileId) {
    throw new Error('QA seed data is missing customer, tailor profile, or ready-made item.')
  }

  const readyMadeCheckoutPayload = {
    action: 'create-checkout',
    sellerItemId: item.id,
    size: process.env.QA_READY_MADE_SIZE ?? 'L',
    quantity: Number.parseInt(process.env.QA_READY_MADE_QUANTITY ?? '1', 10),
    fulfillment: 'SHIPPING',
    address: '123 Launch QA Avenue',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    countryCode: 'US',
    recipientName: 'Launch QA Customer',
    recipientPhone: '+15125550199',
    cancellationPolicyAcknowledged: true,
  }

  const readyMadePreview = await invoke(
    'ready-made-order-action',
    customerToken,
    { ...readyMadeCheckoutPayload, action: 'preview-checkout' },
    'Ready-made checkout preview',
    true,
  )
  const readyMadeCheckout = await invoke(
    'ready-made-order-action',
    customerToken,
    readyMadeCheckoutPayload,
    'Ready-made checkout create',
    true,
  )
  const readyMadeDuplicate = await invoke(
    'ready-made-order-action',
    customerToken,
    readyMadeCheckoutPayload,
    'Ready-made duplicate checkout guard',
    true,
  )
  const readyMadeOrderId = readyMadeCheckout?.orderId
    ?? readyMadeCheckout?.existingOrderId
    ?? readyMadeCheckout?.body?.orderId
    ?? readyMadeDuplicate?.orderId
    ?? readyMadeDuplicate?.existingOrderId
    ?? readyMadeDuplicate?.body?.orderId
    ?? null

  const readyMadePaymentPrepare = readyMadeOrderId
    ? await invoke('payment-action', customerToken, { action: 'prepare-payment', orderId: readyMadeOrderId }, 'Ready-made payment prepare', true)
    : { ok: false, label: 'Ready-made payment prepare', skipped: true }
  const readyMadePaymentPrepareAgain = readyMadeOrderId
    ? await invoke('payment-action', customerToken, { action: 'prepare-payment', orderId: readyMadeOrderId }, 'Ready-made duplicate payment prepare guard', true)
    : { ok: false, label: 'Ready-made duplicate payment prepare guard', skipped: true }

  const customPayload = {
    action: 'create-order',
    tailorProfileId: customQaTailor.profileId,
    garmentType: 'Agbada',
    genderPresentation: 'Menswear',
    description: [
      'Competition QA brief for an agbada with clean embroidery and a relaxed fit.',
      'Use the reference fabric direction and confirm style before cutting.',
      'Customer needs shipping and prefers a neat, premium finish.',
    ].join('\n'),
    occasion: 'Competition QA',
    deadline: plusDays(24),
    referencePhotos: item.photo_urls?.slice(0, 1) ?? [],
    styleReferenceLinks: [],
    styleNotes: 'Cream and green direction, formal but not heavy.',
    customerMeasurementsSnapshot: {
      unit: 'in',
      garmentContext: 'MENSWEAR',
      height: 68,
      chest: 38,
      waist: 32,
      hips: 39,
      shoulderWidth: 17,
      sleeveLength: 24,
      inseam: 30,
      fitPreference: 'RELAXED',
      measurementSource: 'QA_AWAY_RUNNER',
    },
    fabricSource: 'TAILOR_SOURCES',
    fabricDescription: 'Tailor should source cream brocade or aso-oke accent fabric with green embroidery thread.',
    fabricBudgetAmount: 4500,
    fabricBudgetCurrency: 'USD',
    fabricSourcingDeadlineDays: 5,
    supportMeta: {
      wearerContext: 'SELF',
      measurementAgeDays: 0,
      measurementProfileLabel: 'QA menswear profile',
      styleApprovalRequiredBeforeCutting: true,
      fabricApprovalRequiredBeforeCutting: true,
    },
    deliveryMethod: 'SHIPPING',
    shippingPreference: 'STANDARD',
    deliveryAddress: '123 Launch QA Avenue',
    deliveryCity: 'Austin',
    deliveryRegion: 'TX',
    deliveryPostalCode: '78701',
    deliveryCountryCode: 'US',
    recipientName: 'Launch QA Customer',
    recipientPhone: '+15125550199',
    cancellationPolicyAcknowledged: true,
  }

  const customOrder = await invoke('custom-order-action', customerToken, customPayload, 'Custom order brief create', true)
  const duplicateCustomBlocked =
    customOrder?.status === 409
    && (customOrder?.body?.reason === 'DUPLICATE_ORDER_IN_PROGRESS' || customOrder?.body?.code === 'DUPLICATE_ORDER_IN_PROGRESS')
  const existingCustomOrders = duplicateCustomBlocked
    ? await rest(
        `orders?select=*&customer_id=eq.${encodeURIComponent(customer.id)}&order_kind=eq.CUSTOM&stage=in.(PENDING_QUOTE,CONSULTATION,QUOTE_SENT,PAYMENT_PENDING,PAYMENT_FAILED,CONFIRMED,DESIGNING,SOURCING,CUTTING,SEWING,FINISHING,READY_FOR_COLLECTION,READY_FOR_DRAPE_DISPATCH)&order=created_at.desc&limit=20`,
        'Find existing active custom order after duplicate guard',
        true,
      )
    : []
  const existingCustomOrder = Array.isArray(existingCustomOrders)
    ? existingCustomOrders.find((order) => order.tailor_profile_id === customQaTailor.profileId || order.tailor_id === customQaTailor.userId)
    : null
  const customOrderId = customOrder?.orderId ?? existingCustomOrder?.id ?? null

  const quote = customOrderId
    ? await invoke(
        'tailor-order-action',
        customTailorToken,
        {
          action: 'send-quote',
          orderReview: { acknowledged: true, version: 'quote-order-review-2026-08-14-v1' },
          orderId: customOrderId,
          amount: 22000,
          currency: 'USD',
          completionDate: plusDays(20),
          note: 'Quote includes sourcing, sewing, and fit checks before shipping.',
          breakdown: {
            laborAmount: 14500,
            sourcingAmount: 5500,
            included: ['Fabric sourcing', 'Embroidery guidance', 'Final QC photos'],
            summary: 'Launch QA custom agbada quote.',
          },
        },
        'Tailor sends custom quote',
        true,
      )
    : { ok: false, label: 'Tailor sends custom quote', skipped: true }

  const customPaymentPrepare = customOrderId
    ? await invoke('payment-action', customerToken, { action: 'prepare-payment', orderId: customOrderId }, 'Custom quote payment prepare', true)
    : { ok: false, label: 'Custom quote payment prepare', skipped: true }

  let simulatedCustomPayment = null
  if (customOrderId && process.env.QA_SIMULATE_CUSTOM_PAYMENT !== '0') {
    const now = new Date().toISOString()
    simulatedCustomPayment = await restPost(
      'order_payments',
      {
        order_id: customOrderId,
        phase: 'INITIAL_ORDER',
        provider: 'STRIPE',
        currency: 'USD',
        amount: 22000,
        status: 'SUCCEEDED',
        idempotency_key: `QA-AWAY-CUSTOM-PAY-${customOrderId}`,
        provider_payment_id: `pi_qa_away_${customOrderId.replaceAll('-', '').slice(0, 18)}`,
        provider_response: {
          qa: true,
          simulated: true,
          purpose: 'away-mode-material-advance-verification',
        },
        confirmed_at: now,
      },
      'Simulate custom order paid ledger row',
      true,
      'return=minimal',
    )
    await restPatch(
      `orders?id=eq.${encodeURIComponent(customOrderId)}`,
      {
        stage: 'CONFIRMED',
        stage_updated_at: now,
        payment_provider: 'STRIPE',
        payment_intent_id: `pi_qa_away_${customOrderId.replaceAll('-', '').slice(0, 18)}`,
        quoted_amount: 22000,
        quoted_currency: 'USD',
        source_amount: 22000,
        source_currency: 'USD',
        fx_rate: 1,
        fx_rate_timestamp: now,
        subtotal_amount: 22000,
        total_amount: 22000,
        currency: 'USD',
        payment_checkout_url: null,
      },
      'Mark custom QA order confirmed after simulated payment',
      true,
    )
  }

  const customAdvance = customOrderId
    ? await invoke(
        'material-advance-action',
        customTailorToken,
        {
          action: 'request-advance',
          orderId: customOrderId,
          title: 'Lining and beading materials',
          description: 'Need lining and beading supplies before continuing this custom order.',
          amount: 1000,
          currency: 'USD',
        },
        'Custom material advance request',
        true,
      )
    : { ok: false, label: 'Custom material advance request', skipped: true }
  const customAdvanceId = customAdvance?.advance?.id ?? customAdvance?.id ?? null
  const customAdvanceDecline = customAdvanceId
    ? await invoke(
        'material-advance-action',
        customerToken,
        {
          action: 'respond-advance',
          advanceId: customAdvanceId,
          decision: 'DECLINE',
          note: 'Declined during away QA so no additional money moves.',
        },
        'Custom material advance decline',
        true,
      )
    : { ok: false, label: 'Custom material advance decline', skipped: true }

  const messageOk = readyMadeOrderId
    ? await invoke(
        'message-action',
        customerToken,
        {
          action: 'send-message',
          orderId: readyMadeOrderId,
          type: 'TEXT',
          body: 'Please keep both medium kaftans together and share a prep update before shipping.',
        },
        'Ready-made safe message',
        true,
      )
    : { ok: false, label: 'Ready-made safe message', skipped: true }

  const messageBlocked = readyMadeOrderId
    ? await invoke(
        'message-action',
        customerToken,
        {
          action: 'send-message',
          orderId: readyMadeOrderId,
          type: 'TEXT',
          body: 'Text me on WhatsApp at +14155550123 so we can bypass Drape.',
        },
        'Ready-made contact leak block',
        true,
      )
    : { ok: false, label: 'Ready-made contact leak block', skipped: true }

  const readyMadeCall = readyMadeOrderId
    ? await invoke(
        'order-call-action',
        customerToken,
        {
          action: 'schedule-ready-made-call',
          orderId: readyMadeOrderId,
          scheduledStartAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          timezone: 'America/Chicago',
          reason: 'SIZE_OR_FIT',
          note: 'Quick sizing clarification before dispatch.',
        },
        'Ready-made call schedule',
        true,
      )
    : { ok: false, label: 'Ready-made call schedule', skipped: true }

  const readyMadeAdvanceBlocked = readyMadeOrderId
    ? await invoke(
        'material-advance-action',
        tailorToken,
        {
          action: 'request-advance',
          orderId: readyMadeOrderId,
          title: 'Aso-oke embroidery deposit',
          description: 'This should be blocked for ready-made orders.',
          amount: 2500,
          currency: 'USD',
        },
        'Ready-made material advance block',
        true,
      )
    : { ok: false, label: 'Ready-made material advance block', skipped: true }

  const processedJobs = await invokeService(
    'process-job-queue',
    { limit: 40, jobTypes: ['SEND_PUSH', 'SEND_SMS', 'SEND_ORDER_EVENT_EMAIL', 'SEND_ORDER_CONFIRMATION_EMAILS'] },
    'Process side-effect jobs',
    true,
  )

  const [readyMadeRows, customRows, payments, messages, jobs, opsIssues] = await Promise.all([
    readyMadeOrderId
      ? rest(`orders?select=*&id=eq.${encodeURIComponent(readyMadeOrderId)}&limit=1`, 'Read ready-made order', true)
      : Promise.resolve([]),
    customOrderId
      ? rest(`orders?select=*&id=eq.${encodeURIComponent(customOrderId)}&limit=1`, 'Read custom order', true)
      : Promise.resolve([]),
    rest(`order_payments?select=*&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.desc&limit=20`, 'Read QA payment attempts', true),
    rest(`messages?select=*&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.desc&limit=20`, 'Read QA messages', true),
    rest(`job_queue?select=*&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.desc&limit=80`, 'Read QA jobs', true),
    rest(`ops_issues?select=*&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.desc&limit=20`, 'Read QA ops issues', true),
  ])

  const report = {
    ok: true,
    supabaseEnv,
    startedAt,
    accounts: {
      customer: CUSTOMER_EMAIL,
      tailor: TAILOR_EMAIL,
      customTailor: CUSTOM_TAILOR_EMAIL,
    },
    readyMade: {
      itemId: item.id,
      preview: readyMadePreview,
      checkout: readyMadeCheckout,
      duplicateGuard: readyMadeDuplicate,
      orderId: readyMadeOrderId,
      order: Array.isArray(readyMadeRows) ? readyMadeRows[0] ?? null : readyMadeRows,
      paymentPrepare: readyMadePaymentPrepare,
      paymentPrepareAgain: readyMadePaymentPrepareAgain,
      materialAdvanceBlocked: readyMadeAdvanceBlocked,
      call: readyMadeCall,
    },
    custom: {
      tailorProfileId: customQaTailor.profileId,
      createBrief: customOrder,
      orderId: customOrderId,
      order: Array.isArray(customRows) ? customRows[0] ?? null : customRows,
      reusedExistingActiveOrder: Boolean(existingCustomOrder?.id),
      quote,
      paymentPrepare: customPaymentPrepare,
      simulatedPayment: simulatedCustomPayment,
      materialAdvance: customAdvance,
      materialAdvanceDecline: customAdvanceDecline,
    },
    messaging: {
      safeMessage: messageOk,
      blockedContactLeak: messageBlocked,
      recentMessages: messages,
    },
    sideEffects: {
      processedJobs,
      recentJobs: jobs,
      recentOpsIssues: opsIssues,
    },
  }

  const filename = path.join(OUT_DIR, `qa-away-order-flow-${Date.now()}.json`)
  await writeFile(filename, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: filename, summary: {
    readyMadeOrderId,
    customOrderId,
    readyMadePaymentPrepared: readyMadePaymentPrepare?.ok === true,
    readyMadeDuplicatePaymentGuarded: readyMadePaymentPrepareAgain?.ok === true && readyMadePaymentPrepareAgain?.existing === true,
    customQuoteSent: quote?.ok === true,
    customPaymentPrepared: customPaymentPrepare?.ok === true,
    customAdvanceHandled: customAdvance?.ok === true || customAdvance?.status === 409,
    contactLeakBlocked: Boolean(messageBlocked?.status && messageBlocked.status >= 400) || messageBlocked?.ok === false,
    jobsProcessed: processedJobs?.ok ?? processedJobs,
  } }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
