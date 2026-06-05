#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const NETWORK_TIMEOUT_MS = 60_000
const CUSTOMER_EMAIL = process.env.STRIPE_QA_CUSTOMER_EMAIL ?? 'stripe.qa.customer@drapeon.co'
const TAILOR_EMAIL = process.env.STRIPE_QA_TAILOR_EMAIL ?? 'stripe.qa.tailor@drapeon.co'
const QA_PASSWORD = process.env.STRIPE_QA_PASSWORD ?? 'DrapeStripeQA2026'

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
const anonKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ?? env.SUPABASE_ANON_KEY
const supabaseEnv = env.EXPO_PUBLIC_SUPABASE_ENV ?? env.NEXT_PUBLIC_SUPABASE_ENV ?? 'unknown'
const QA_CUSTOM_MATERIAL_REFERENCE = 'QA-MATERIAL-ADVANCE-USD-001'

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Missing Supabase URL/service role/anon key. Use apps/mobile/.env.local, apps/web/.env.local, or env vars.')
}

if (supabaseEnv.toLowerCase() === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error('Refusing to run QA against production without --allow-production.')
}

const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
}

function encodeFilter(value) {
  return encodeURIComponent(value)
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
    const message = `${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`
    if (optional) return { __optionalError: message, status: response.status, body }
    throw new Error(message)
  }
  return body
}

async function rest(path, label, optional = false) {
  return fetchJson(`${supabaseUrl}/rest/v1/${path}`, { headers: serviceHeaders }, label, optional)
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

async function invokeFunction(name, token, payload, label, optional = false) {
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

async function invokeServiceFunction(name, payload, label, optional = false) {
  return fetchJson(
    `${supabaseUrl}/functions/v1/${name}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    label,
    optional,
  )
}

async function publicUser(email) {
  const rows = await rest(`users?select=*&email=eq.${encodeFilter(email)}&limit=1`, `Find user ${email}`)
  const user = rows?.[0]
  if (!user?.id) throw new Error(`No public user found for ${email}`)
  return user
}

function latestOrderFor(customerId, kind) {
  return rest(
    `orders?select=*&customer_id=eq.${encodeFilter(customerId)}&order_kind=eq.${kind}&order=created_at.desc&limit=10`,
    `Find latest ${kind} order`,
  )
}

function recentRows(table, query, label, optional = false) {
  return rest(`${table}?${query}`, label, optional)
}

function parseSupportMeta(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function ensureMaterialAdvanceCustomOrder(customer, tailor) {
  const existing = await rest(
    `orders?select=*&reference=eq.${encodeFilter(QA_CUSTOM_MATERIAL_REFERENCE)}&limit=1`,
    'Find QA custom material order',
  )
  if (existing?.[0]?.id) return existing[0]

  const tailorProfiles = await rest(
    `tailor_profiles?select=*&user_id=eq.${encodeFilter(tailor.id)}&limit=1`,
    'Find QA tailor profile',
  )
  const tailorProfile = tailorProfiles?.[0]
  if (!tailorProfile?.id) throw new Error(`No tailor profile found for ${tailor.email}`)

  const now = new Date().toISOString()
  const orderPayload = {
    customer_id: customer.id,
    tailor_profile_id: tailorProfile.id,
    tailor_id: tailor.id,
    reference: QA_CUSTOM_MATERIAL_REFERENCE,
    order_kind: 'CUSTOM',
    garment_type: 'Agbada',
    garment_description: 'QA custom order for material advance verification.',
    occasion: 'Launch QA',
    deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    fabric_source: 'TAILOR_SOURCES',
    delivery_method: 'SHIPPING',
    special_note: JSON.stringify({
      orderContract: {
        version: 'qa-material-advance',
        orderKind: 'CUSTOM',
        createdAt: now,
      },
      styleAlignment: {
        requiredBeforeCutting: true,
        status: 'NEEDS_TAILOR_CONFIRMATION',
        instruction: 'QA order used only for launch material advance verification.',
      },
    }),
    currency: 'USD',
    quoted_currency: 'USD',
    quoted_amount: 20000,
    subtotal_amount: 20000,
    platform_fee_amount: 3000,
    tax_amount: 0,
    tax_rate_bps: 0,
    shipping_amount: 0,
    total_amount: 20000,
    payment_provider: 'STRIPE',
    payment_intent_id: `pi_qa_material_${Date.now()}`,
    escrow_released: false,
    stage: 'CONFIRMED',
    stage_updated_at: now,
  }

  const inserted = await fetchJson(
    `${supabaseUrl}/rest/v1/orders?select=*`,
    {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(orderPayload),
    },
    'Create QA custom material order',
  )
  const order = inserted?.[0]
  if (!order?.id) throw new Error('QA custom material order insert did not return an order')

  await fetchJson(
    `${supabaseUrl}/rest/v1/order_payments`,
    {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        order_id: order.id,
        phase: 'INITIAL_ORDER',
        provider: 'STRIPE',
        currency: 'USD',
        amount: 20000,
        status: 'SUCCEEDED',
        idempotency_key: `QA-MATERIAL-ADVANCE-PAY-${order.id}`,
        provider_payment_id: `pi_qa_material_paid_${order.id}`,
        provider_response: {
          qa: true,
          purpose: 'material-advance-launch-qa',
        },
        confirmed_at: now,
      }),
    },
    'Create QA custom material order payment',
  )

  return order
}

const [customerToken, tailorToken, customer, tailor] = await Promise.all([
  signIn(CUSTOMER_EMAIL),
  signIn(TAILOR_EMAIL),
  publicUser(CUSTOMER_EMAIL),
  publicUser(TAILOR_EMAIL),
])

const readyMadeOrders = await latestOrderFor(customer.id, 'READY_MADE')
const readyMadeOrder = readyMadeOrders?.[0]
if (!readyMadeOrder?.id) throw new Error(`No ready-made order found for ${CUSTOMER_EMAIL}`)

const startedAt = new Date().toISOString()
const normalMessage = await invokeFunction(
  'message-action',
  customerToken,
  {
    action: 'send-message',
    orderId: readyMadeOrder.id,
    type: 'TEXT',
    body: 'Thanks, please keep both medium kaftans together for shipping.',
  },
  'Send normal ready-made message',
)

const blockedContact = await invokeFunction(
  'message-action',
  customerToken,
  {
    action: 'send-message',
    orderId: readyMadeOrder.id,
    type: 'TEXT',
    body: 'Call me directly at +14155550123 so we can talk outside Drape.',
  },
  'Block contact-sharing message',
  true,
)

const scheduledStartAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
const readyMadeCall = await invokeFunction(
  'order-call-action',
  customerToken,
  {
    action: 'schedule-ready-made-call',
    orderId: readyMadeOrder.id,
    scheduledStartAt,
    timezone: 'America/Chicago',
    reason: 'SIZE_OR_FIT',
    note: 'Quick fit check before dispatch. No phone numbers needed.',
  },
  'Schedule ready-made clarification call',
)

const blockedReadyMadeAdvance = await invokeFunction(
  'material-advance-action',
  tailorToken,
  {
    action: 'request-advance',
    orderId: readyMadeOrder.id,
    title: 'Aso-oke embroidery deposit',
    description: 'Launch QA should block material advances on ready-made orders.',
    amount: 2500,
    currency: readyMadeOrder.currency ?? 'USD',
  },
  'Block ready-made material advance',
  true,
)

let customOrders = await rest(
  `orders?select=*&customer_id=eq.${encodeFilter(customer.id)}&tailor_id=eq.${encodeFilter(tailor.id)}&order_kind=eq.CUSTOM&stage=in.(CONFIRMED,DESIGNING,SOURING,SOURCING,CUTTING,SEWING,FINISHING,READY_FOR_COLLECTION,READY_FOR_DRAPE_DISPATCH)&order=created_at.desc&limit=10`,
  'Find paid active custom order',
  true,
)
let customOrder = Array.isArray(customOrders)
  ? customOrders.find((order) => ['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage))
  : null

if (!customOrder?.id) {
  customOrder = await ensureMaterialAdvanceCustomOrder(customer, tailor)
  customOrders = [customOrder]
}

let materialAdvance = null
if (customOrder?.id) {
  const requested = await invokeFunction(
    'material-advance-action',
    tailorToken,
    {
      action: 'request-advance',
      orderId: customOrder.id,
      title: 'Lining and beading materials',
      description: 'Need lining and beading supplies before continuing this custom order.',
      amount: Math.min(1000, Math.max(100, Math.floor(Number(customOrder.total_amount ?? 0) * 0.05))),
      currency: customOrder.currency ?? 'USD',
    },
    'Request custom material advance',
    true,
  )
  materialAdvance = { customOrderId: customOrder.id, request: requested }

  const advanceId = requested?.advance?.id ?? requested?.id
  if (advanceId) {
    const declined = await invokeFunction(
      'material-advance-action',
      customerToken,
      {
        action: 'respond-advance',
        advanceId,
        decision: 'DECLINE',
        note: 'Declined during launch QA so no additional money moves.',
      },
      'Decline custom material advance QA request',
      true,
    )
    materialAdvance.response = declined
  }
}

const processedJobs = await invokeServiceFunction(
  'process-job-queue',
  { limit: 40, jobTypes: ['SEND_PUSH', 'SEND_SMS'] },
  'Process QA notification jobs',
  true,
)

const [
  messagesAfter,
  jobsAfter,
  materialAdvances,
  refunds,
  payoutRows,
  payoutIssues,
  callOrderRows,
] = await Promise.all([
  recentRows(
    'messages',
    `select=*&order_id=eq.${encodeFilter(readyMadeOrder.id)}&created_at=gte.${encodeFilter(startedAt)}&order=created_at.desc&limit=20`,
    'Find QA messages',
    true,
  ),
  recentRows(
    'job_queue',
    `select=*&created_at=gte.${encodeFilter(startedAt)}&order=created_at.desc&limit=80`,
    'Find QA side-effect jobs',
    true,
  ),
  recentRows(
    'order_material_advances',
    `select=*&created_at=gte.${encodeFilter(startedAt)}&order=created_at.desc&limit=20`,
    'Find QA material advances',
    true,
  ),
  recentRows(
    'order_payments',
    `select=*&refunded_amount=gt.0&order=updated_at.desc&limit=10`,
    'Find recent partial refunds',
    true,
  ),
  recentRows(
    'payouts',
    `select=*&order=processed_at.desc&limit=20`,
    'Find recent payout rows',
    true,
  ),
  recentRows(
    'ops_issues',
    `select=*&issue_type=ilike.%25PAYOUT%25&order=created_at.desc&limit=20`,
    'Find payout ops issues',
    true,
  ),
  recentRows(
    'orders',
    `select=id,special_note&id=eq.${encodeFilter(readyMadeOrder.id)}&limit=1`,
    'Read order call metadata',
    true,
  ),
])

const jobsForReadyMade = Array.isArray(jobsAfter)
  ? jobsAfter.filter((job) => JSON.stringify(job).includes(readyMadeOrder.id))
  : jobsAfter

const result = {
  ok: true,
  supabaseEnv,
  qaStartedAt: startedAt,
  accounts: {
    customer: { id: customer.id, email: customer.email },
    tailor: { id: tailor.id, email: tailor.email },
  },
  readyMadeOrder: {
    id: readyMadeOrder.id,
    reference: readyMadeOrder.reference,
    stage: readyMadeOrder.stage,
    orderKind: readyMadeOrder.order_kind,
    currency: readyMadeOrder.currency,
    totalAmount: readyMadeOrder.total_amount,
  },
  messaging: {
    normalMessageOk: normalMessage?.ok === true,
    blockedContactStatus: blockedContact?.status ?? null,
    blockedContactCode: blockedContact?.body?.code ?? blockedContact?.body?.error ?? null,
    blockedContactMessage: blockedContact?.body?.error ?? blockedContact?.body?.message ?? null,
    createdMessages: messagesAfter,
  },
  calls: {
    scheduledOk: readyMadeCall?.ok === true,
    scheduledStartAt,
    orderCall: readyMadeCall?.orderCall ?? null,
    persistedOrderCall: Array.isArray(callOrderRows) ? parseSupportMeta(callOrderRows[0]?.special_note).orderCall ?? null : null,
  },
  materialAdvance: {
    readyMadeBlockedStatus: blockedReadyMadeAdvance?.status ?? null,
    readyMadeBlockedCode: blockedReadyMadeAdvance?.body?.error ?? blockedReadyMadeAdvance?.body?.code ?? null,
    readyMadeBlockedMessage: blockedReadyMadeAdvance?.body?.message ?? blockedReadyMadeAdvance?.body?.error ?? null,
    customOrderFound: !!customOrder?.id,
    customAdvance: materialAdvance,
    recentAdvances: materialAdvances,
  },
  refunds: {
    recentRefundedPayments: refunds,
    note: 'This verifier does not create a new refund against the fresh ready-made QA order.',
  },
  payoutRelease: {
    recentPayoutRows: payoutRows,
    payoutIssues,
    note: 'Fresh ready-made order is confirmed, not handoff-confirmed and not 72h eligible yet.',
  },
  notifications: {
    processedJobs,
    recentReadyMadeJobs: jobsForReadyMade,
    durablePushJobsQueued: Array.isArray(jobsForReadyMade)
      ? jobsForReadyMade.some((job) => job.job_type === 'SEND_PUSH')
      : null,
    durableSmsJobsQueued: Array.isArray(jobsForReadyMade)
      ? jobsForReadyMade.some((job) => job.job_type === 'SEND_SMS')
      : null,
  },
}

console.log(JSON.stringify(result, null, 2))
