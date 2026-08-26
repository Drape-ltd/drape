#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const NETWORK_TIMEOUT_MS = 60_000
const CUSTOMER_EMAIL = process.env.STRIPE_QA_CUSTOMER_EMAIL ?? 'stripe.qa.customer@drapeon.co'
const EXPECTED_QUANTITY = Number.parseInt(process.env.STRIPE_QA_EXPECTED_QUANTITY ?? '2', 10)

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
    if (optional) {
      return { __optionalError: `${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}` }
    }
    throw new Error(`${label} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }

  return body
}

function money(amount, currency) {
  if (typeof amount !== 'number') return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
  }).format(amount / 100)
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
  throw new Error('Missing Supabase URL/service role. Use apps/web/.env.local, apps/mobile/.env.local, or env vars.')
}

if (supabaseEnv.toLowerCase() === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error('Refusing to inspect production without --allow-production.')
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
}

const publicUsers = await fetchJson(
  `${supabaseUrl}/rest/v1/users?select=*&email=eq.${encodeURIComponent(CUSTOMER_EMAIL)}&limit=1`,
  { headers },
  `Find customer ${CUSTOMER_EMAIL}`,
)
const customer = publicUsers?.[0]
if (!customer?.id) throw new Error(`No public user found for ${CUSTOMER_EMAIL}`)

const orders = await fetchJson(
  `${supabaseUrl}/rest/v1/orders?select=*&customer_id=eq.${encodeURIComponent(customer.id)}&order=created_at.desc&limit=10`,
  { headers },
  'Find recent customer orders',
)
const readyMadeOrders = orders.filter((order) => String(order.order_kind ?? '').toUpperCase() === 'READY_MADE')
const candidate = readyMadeOrders.find((order) => Number(order.item_quantity ?? 0) === EXPECTED_QUANTITY) ?? readyMadeOrders[0]
if (!candidate?.id) throw new Error(`No ready-made order found for ${CUSTOMER_EMAIL}`)

const [
  payments,
  webhooks,
  payouts,
  events,
  jobs,
  opsIssues,
  itemRows,
  benefitReservations,
  benefitRedemptions,
  pricingReservations,
  receipts,
  ledgerTransactions,
] = await Promise.all([
  fetchJson(
    `${supabaseUrl}/rest/v1/order_payments?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find order payments',
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/payment_webhook_events?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find payment webhooks',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/payouts?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=processed_at.desc`,
    { headers },
    'Find payouts',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/domain_events?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc&limit=30`,
    { headers },
    'Find domain events',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/job_queue?select=*&order=created_at.desc&limit=80`,
    { headers },
    'Find recent jobs',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/ops_issues?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find ops issues',
    true,
  ),
  candidate.seller_item_id
    ? fetchJson(
        `${supabaseUrl}/rest/v1/seller_items?select=*&id=eq.${encodeURIComponent(candidate.seller_item_id)}&limit=1`,
        { headers },
        'Find seller item',
        true,
      )
    : Promise.resolve([]),
  fetchJson(
    `${supabaseUrl}/rest/v1/commercial_benefit_reservations?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find benefit reservations',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/commercial_benefit_redemptions?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find benefit redemptions',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/commercial_pricing_reservations?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find pricing reservations',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/commercial_receipts?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=issued_at.desc`,
    { headers },
    'Find commercial receipts',
    true,
  ),
  fetchJson(
    `${supabaseUrl}/rest/v1/commercial_ledger_transactions?select=*&order_id=eq.${encodeURIComponent(candidate.id)}&order=created_at.desc`,
    { headers },
    'Find commercial ledger transactions',
    true,
  ),
])

const relevantJobs = Array.isArray(jobs)
  ? jobs.filter((job) => JSON.stringify(job).includes(candidate.id)).slice(0, 30)
  : jobs
const succeededPayments = payments.filter((payment) => String(payment.status).toUpperCase() === 'SUCCEEDED')
const payment = succeededPayments[0] ?? payments[0] ?? null
const item = Array.isArray(itemRows) ? itemRows[0] : null
const activeBenefit = Array.isArray(benefitReservations)
  ? benefitReservations.find((reservation) => String(reservation.status).toUpperCase() === 'RESERVED') ?? null
  : null
const consumedBenefit = Array.isArray(benefitReservations)
  ? benefitReservations.find((reservation) => String(reservation.status).toUpperCase() === 'CONSUMED') ?? null
  : null
const latestPricing = Array.isArray(pricingReservations) ? pricingReservations[0] ?? null : null
const promotionAmount = Number(consumedBenefit?.total_benefit_amount ?? activeBenefit?.total_benefit_amount ?? latestPricing?.breakdown?.promotionAmount ?? 0)

const expectedSubtotal =
  typeof candidate.item_unit_price === 'number'
    ? candidate.item_unit_price * Number(candidate.item_quantity ?? 1)
    : null
const expectedPayout =
  typeof candidate.total_amount === 'number'
    ? candidate.total_amount - Number(candidate.platform_fee_amount ?? 0) - Number(candidate.tax_amount ?? 0)
    : null

const result = {
  ok: true,
  supabaseEnv,
  customer: {
    id: customer.id,
    email: customer.email,
    displayName: customer.display_name,
  },
  order: {
    id: candidate.id,
    reference: candidate.reference,
    orderKind: candidate.order_kind,
    stage: candidate.stage,
    quantity: candidate.item_quantity,
    size: candidate.item_size,
    fulfillmentMode: candidate.fulfillment_mode ?? candidate.delivery_method,
    deliveryMethod: candidate.delivery_method,
    provider: candidate.payment_provider,
    currency: candidate.currency,
    itemUnitPrice: candidate.item_unit_price,
    subtotalAmount: candidate.subtotal_amount,
    shippingAmount: candidate.shipping_amount,
    taxAmount: candidate.tax_amount,
    platformFeeAmount: candidate.platform_fee_amount,
    totalAmount: candidate.total_amount,
    totalDisplay: money(candidate.total_amount, candidate.currency),
    createdAt: candidate.created_at,
    paidAt: candidate.payment_confirmed_at ?? candidate.payment_paid_at ?? null,
  },
  expectations: {
    expectedQuantity: EXPECTED_QUANTITY,
    quantityMatches: Number(candidate.item_quantity ?? 0) === EXPECTED_QUANTITY,
    expectedSubtotal,
    subtotalMatches: expectedSubtotal === null ? null : Number(candidate.subtotal_amount ?? candidate.item_subtotal ?? 0) === expectedSubtotal,
    expectedPayout,
    expectedPayoutDisplay: money(expectedPayout, candidate.currency),
  },
  payment: payment
    ? {
        id: payment.id,
        phase: payment.phase,
        provider: payment.provider,
        currency: payment.currency,
        amount: payment.amount,
        amountDisplay: money(payment.amount, payment.currency),
        status: payment.status,
        providerPaymentId: payment.provider_payment_id,
        confirmedAt: payment.confirmed_at,
        failedAt: payment.failed_at,
        createdAt: payment.created_at,
      }
    : null,
  paymentAssertions: {
    hasPayment: payments.length > 0,
    hasSucceededPayment: succeededPayments.length > 0,
    amountPlusBenefitMatchesOrderTotal: payment
      ? Number(payment.amount) + promotionAmount === Number(candidate.total_amount)
      : false,
    currencyMatchesOrder: payment ? payment.currency === candidate.currency : false,
    providerMatchesOrder: payment ? payment.provider === candidate.payment_provider : false,
  },
  benefit: activeBenefit
    ? {
        id: activeBenefit.id,
        status: activeBenefit.status,
        currency: activeBenefit.currency,
        amount: activeBenefit.total_benefit_amount,
        amountDisplay: money(activeBenefit.total_benefit_amount, activeBenefit.currency),
        customerDueAmount: activeBenefit.customer_due_amount,
        customerDueDisplay: money(activeBenefit.customer_due_amount, activeBenefit.currency),
        expiresAt: activeBenefit.expires_at,
      }
    : null,
  benefitAssertions: {
    hasActiveReservationAfterPayment: Boolean(payment?.status === 'SUCCEEDED' && activeBenefit),
    hasConsumedReservation: Boolean(consumedBenefit),
    hasRedemption: Array.isArray(benefitRedemptions) && benefitRedemptions.length > 0,
    redemptionCount: Array.isArray(benefitRedemptions) ? benefitRedemptions.length : 0,
  },
  benefitRedemptions,
  latestPricingReservation: latestPricing
    ? {
        id: latestPricing.id,
        status: latestPricing.status,
        currency: latestPricing.currency,
        totalAmount: latestPricing.total_amount,
        promotionAmount: latestPricing.breakdown?.promotionAmount ?? 0,
        idempotencyKey: latestPricing.idempotency_key,
        expiresAt: latestPricing.expires_at,
      }
    : null,
  sellerItem: item
    ? {
        id: item.id,
        title: item.title,
        inventoryQuantity: item.inventory_quantity,
        sizeInventory: item.size_inventory,
        stockStatus: item.stock_status,
      }
    : itemRows,
  payouts,
  payoutAssertions: {
    hasPayoutRow: Array.isArray(payouts) ? payouts.length > 0 : false,
    expectedPayout,
  },
  receipts,
  ledgerTransactions,
  webhooks,
  domainEvents: events,
  relevantJobs,
  opsIssues,
}

console.log(JSON.stringify(result, null, 2))
