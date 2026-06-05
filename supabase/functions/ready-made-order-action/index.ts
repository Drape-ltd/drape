import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { log, audit } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { sendOrderEventEmail } from '../_shared/order-email.ts'
import { finalizeOrderTerminal } from '../_shared/order-terminal.ts'
import { serializeOrderSupportMeta } from '../_shared/order-support.ts'
import { logPreflightFailure, preflightFailureResponse, runPreflight } from '../_shared/preflight.ts'
import {
  deriveReadyMadeStockStatus,
  normalizeReadyMadeSizeInventory,
  readyMadeSizeQuantity,
  sumReadyMadeSizeInventory,
} from '../_shared/ready-made-inventory.ts'
import { normalizeStoredPhone, validateRecipientPhone } from '../_shared/phone.ts'
import { parseBody, uuid, z } from '../_shared/validate.ts'
import { fetchFxQuote, convertMinorUnitsWithFx } from '../_shared/fx.ts'
import { calculateLockedOrderAmountsWithTaxBase, resolveOrderTax } from '../_shared/tax.ts'
import { resolveDrapeManagedFulfillmentFee } from '../../../packages/shared/src/fulfillment-fees.ts'
import { buildReadyMadeInquiryClosedTerminalRequest } from '../../../packages/shared/src/order-terminal.ts'
import {
  hasSellerPayoutCurrencyMismatch,
  normalizeAccountCurrency,
  resolvePaymentProviderForCurrency,
  resolveSellerOrderCurrency,
  type AccountCurrencyCode,
} from '../../../packages/shared/src/currency-config.ts'
import { ORDER_CANCELLATION_POLICY_VERSION } from '../../../packages/shared/src/checkout-policy.ts'
import { normalizeTaxCountryCode } from '../../../packages/shared/src/tax.ts'

const FN = 'ready-made-order-action'
const ORDER_CONTRACT_VERSION = 1
const MAX_READY_MADE_CHECKOUT_QUANTITY = 3

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start-inquiry'),
    sellerItemId: uuid,
  }),
  z.object({
    action: z.literal('preview-checkout'),
    sellerItemId: uuid,
    size: z.string().trim().max(40).optional(),
    quantity: z.number().int().min(1).max(MAX_READY_MADE_CHECKOUT_QUANTITY),
    fulfillment: z.enum(['PICKUP', 'DELIVERY', 'SHIPPING']),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().max(40).optional(),
    countryCode: z.string().trim().max(32).optional(),
  }),
  z.object({
    action: z.literal('create-checkout'),
    sellerItemId: uuid,
    size: z.string().trim().max(40).optional(),
    quantity: z.number().int().min(1).max(MAX_READY_MADE_CHECKOUT_QUANTITY),
    fulfillment: z.enum(['PICKUP', 'DELIVERY', 'SHIPPING']),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().max(40).optional(),
    countryCode: z.string().trim().max(32).optional(),
    recipientName: z.string().trim().max(120).optional(),
    recipientPhone: z.string().trim().max(40).optional(),
    cancellationPolicyAcknowledged: z.boolean().optional(),
  }),
])

function buildReference() {
  return `DRP${Date.now().toString(36).toUpperCase().slice(-6)}`
}

function jsonResponse(payload: Record<string, unknown>, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(cors: HeadersInit, status: number, message: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, message, ...extra }, status, cors)
}

async function resolveCheckoutPricing(input: {
  supabase: any
  callerId: string
  sellerItemId: string
  quantity: number
  fulfillment: 'PICKUP' | 'DELIVERY' | 'SHIPPING'
  address: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  countryCode?: string | null
  orderCurrency: AccountCurrencyCode
  accountRegionCode: string
  item: {
    id: string
    currency: string | null
    price_amount: number
  }
  sellerProfileLocation: string | null
}) {
  const sourceSubtotal = input.item.price_amount * input.quantity
  let fxQuote = null as Awaited<ReturnType<typeof fetchFxQuote>> | null
  let subtotal = sourceSubtotal
  const itemCurrency = normalizeAccountCurrency(input.item.currency) ?? input.orderCurrency

  if (itemCurrency !== input.orderCurrency) {
    fxQuote = await fetchFxQuote(itemCurrency, input.orderCurrency)
    subtotal = convertMinorUnitsWithFx(sourceSubtotal, fxQuote.rate)
  }

  const fulfillmentFee = resolveDrapeManagedFulfillmentFee({
    fulfillment: input.fulfillment,
    orderCurrency: input.orderCurrency,
    sellerLocation: input.sellerProfileLocation,
    destinationAddress: input.address,
  }).feeMinorUnits

  const tax = await resolveOrderTax({
    supabase: input.supabase,
    orderId: null,
    currency: input.orderCurrency,
    regionCode: input.accountRegionCode,
    countryCode: input.countryCode,
    address: input.address,
    postalCode: input.postalCode,
    stateRegion: input.region,
    city: input.city,
  })

  const lockedAmounts = calculateLockedOrderAmountsWithTaxBase({
    subtotalAmount: subtotal,
    platformFeeAmount: 0,
    shippingAmount: fulfillmentFee,
    taxRateBps: tax.rateBps,
    shippingTaxable: tax.shippingTaxable,
    platformFeeTaxable: tax.platformFeeTaxable,
  })

  return {
    itemCurrency,
    sourceSubtotal,
    fxQuote,
    fulfillmentFee,
    tax,
    lockedAmounts,
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonError(cors, 401, 'Please sign in again before starting this order.')
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonError(cors, 400, 'Check the checkout details and try again.')
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

    const { data: accountRow, error: accountError } = await supabase
      .from('users')
      .select('default_currency, region_code')
      .eq('id', caller.id)
      .maybeSingle()

    if (accountError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: accountError.message, surface: 'users.default_currency' })
      return jsonError(cors, 500, 'Could not resolve account currency.')
    }

    const accountCurrency = normalizeAccountCurrency((accountRow as any)?.default_currency) ?? 'USD'
    const accountRegionCode =
      typeof (accountRow as any)?.region_code === 'string' && (accountRow as any).region_code.trim().length > 0
        ? (accountRow as any).region_code.trim().toUpperCase()
        : 'ZZ'

    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 30)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const body = parsed.data

    const rejectRequest = (
      status: 400 | 409 | 503,
      message: string,
      detail?: Record<string, unknown>,
    ) => {
      log(status === 503 ? 'warn' : 'warn', FN, 'request.rejected', {
        actor_id: caller.id,
        seller_item_id: 'sellerItemId' in body ? body.sellerItemId : null,
        action: body.action,
        status,
        reason: message,
        ...detail,
      })
      return jsonError(cors, status, message, detail)
    }

    const { data: sellerItem, error: itemError } = await supabase
      .from('seller_items')
      .select(`
        id,
        title,
        description,
        sizes,
        size_inventory,
        currency,
        price_amount,
        is_live,
        stock_status,
        inventory_quantity,
        pickup_available,
        delivery_available,
        shipping_available,
        tailor_profile_id,
        tailor_profiles!tailor_profile_id(id, user_id, is_live, availability, display_name, location, currency, payout_currency, payout_provider, payout_account_type, paystack_recipient_code, paystack_account_id, stripe_connect_account_id, stripe_account_id)
      `)
      .eq('id', body.sellerItemId)
      .maybeSingle()

    if (itemError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: itemError.message })
      return jsonError(cors, 500, 'We could not load this item right now. Please try again.')
    }

    const item = sellerItem as any
    const sellerProfile = item?.tailor_profiles ?? null
    const sellerPreflight = runPreflight([
      {
        name: 'item_exists',
        condition: !!item?.id,
        errorCode: 'ITEM_NOT_FOUND',
        message: 'This item is no longer available.',
        field: 'sellerItemId',
        severity: 'BLOCKING',
        actual: { sellerItemId: body.sellerItemId },
      },
      {
        name: 'seller_profile_exists',
        condition: !!sellerProfile?.id && !!sellerProfile?.user_id,
        errorCode: 'SELLER_UNAVAILABLE',
        message: 'This seller is unavailable right now.',
        field: 'tailor_profile_id',
        severity: 'BLOCKING',
        actual: { sellerProfileId: sellerProfile?.id ?? null, sellerUserId: sellerProfile?.user_id ?? null },
      },
      {
        name: 'seller_not_self',
        condition: sellerProfile?.user_id !== caller.id,
        errorCode: 'CANNOT_ORDER_FROM_SELF',
        message: 'You cannot buy your own ready-made item.',
        field: 'sellerItemId',
        severity: 'BLOCKING',
        actual: { callerId: caller.id, sellerUserId: sellerProfile?.user_id ?? null },
      },
      {
        name: 'item_live',
        condition: item?.is_live === true,
        errorCode: 'ITEM_NOT_LIVE',
        message: 'This item is not available for checkout.',
        field: 'is_live',
        severity: 'BLOCKING',
        actual: { itemLive: item?.is_live ?? null },
      },
      {
        name: 'seller_live',
        condition: sellerProfile?.is_live === true,
        errorCode: 'SELLER_NOT_LIVE',
        message: 'This seller is not accepting ready-made orders right now.',
        field: 'tailor_profile.is_live',
        severity: 'BLOCKING',
        actual: { sellerLive: sellerProfile?.is_live ?? null },
      },
      {
        name: 'seller_available',
        condition: sellerProfile?.availability !== 'FULLY_BOOKED',
        errorCode: 'SELLER_UNAVAILABLE',
        message: 'This seller is on a break and is not accepting new orders right now.',
        field: 'availability',
        severity: 'BLOCKING',
        actual: { availability: sellerProfile?.availability ?? null },
      },
    ])

    if (!sellerPreflight.passed) {
      await logPreflightFailure(supabase, sellerPreflight, {
        operation: 'ready_made_order_start',
        entityType: 'seller_item',
        entityId: body.sellerItemId,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        source: FN,
        metadata: { action: body.action },
      })
      return preflightFailureResponse(sellerPreflight, cors, item?.id ? 409 : 404)
    }

    const itemSizes = Array.isArray(item.sizes) ? item.sizes.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0) : []
    const sizeInventory = normalizeReadyMadeSizeInventory({
      sizes: itemSizes,
      sizeInventory: item.size_inventory,
      fallbackInventoryQuantity: typeof item.inventory_quantity === 'number' ? item.inventory_quantity : 0,
    })
    const currentInventoryQuantity =
      typeof item.inventory_quantity === 'number'
        ? item.inventory_quantity
        : sumReadyMadeSizeInventory(sizeInventory)
    const currentStockStatus = deriveReadyMadeStockStatus({
      isLive: !!item.is_live,
      inventoryQuantity: currentInventoryQuantity,
    })

    const stockPreflight = runPreflight([
      {
        name: 'item_in_stock',
        condition: !['SOLD_OUT', 'HIDDEN'].includes(currentStockStatus),
        errorCode: 'ITEM_OUT_OF_STOCK',
        message: 'This item just sold out. Please refresh the shop and try another piece.',
        field: 'stock_status',
        severity: 'BLOCKING',
        actual: { stockStatus: currentStockStatus, inventoryQuantity: currentInventoryQuantity },
      },
    ])

    if (!stockPreflight.passed) {
      await logPreflightFailure(supabase, stockPreflight, {
        operation: 'ready_made_order_stock',
        entityType: 'seller_item',
        entityId: item.id,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        source: FN,
        metadata: { action: body.action, requestedQuantity: 'quantity' in body ? body.quantity : null },
      })
      return preflightFailureResponse(stockPreflight, cors, 409)
    }

    const lockedTailorPayoutCurrency =
      resolveSellerOrderCurrency({
        tailorCurrency: sellerProfile?.currency,
        payoutCurrency: sellerProfile?.payout_currency,
        payoutProvider: sellerProfile?.payout_provider,
        payoutAccountType: sellerProfile?.payout_account_type,
        hasPaystackRecipient: !!(sellerProfile?.paystack_recipient_code ?? sellerProfile?.paystack_account_id),
        hasStripeConnectAccount: !!(sellerProfile?.stripe_connect_account_id ?? sellerProfile?.stripe_account_id),
        customerCurrency: accountCurrency,
      })
    const lockedTailorPayoutProvider = resolvePaymentProviderForCurrency(lockedTailorPayoutCurrency)
    const orderCurrency = resolveSellerOrderCurrency({
      itemCurrency: item?.currency,
      tailorCurrency: sellerProfile?.currency,
      payoutCurrency: sellerProfile?.payout_currency,
      payoutProvider: sellerProfile?.payout_provider,
      payoutAccountType: sellerProfile?.payout_account_type,
      hasPaystackRecipient: !!(sellerProfile?.paystack_recipient_code ?? sellerProfile?.paystack_account_id),
      hasStripeConnectAccount: !!(sellerProfile?.stripe_connect_account_id ?? sellerProfile?.stripe_account_id),
      customerCurrency: accountCurrency,
    })

    const payoutCurrencyPreflight = runPreflight([
      {
        name: 'seller_item_currency_matches_payout',
        condition: !hasSellerPayoutCurrencyMismatch({
          itemCurrency: item?.currency,
          payoutCurrency: sellerProfile?.payout_currency,
          payoutProvider: sellerProfile?.payout_provider,
          payoutAccountType: sellerProfile?.payout_account_type,
          hasPaystackRecipient: !!(sellerProfile?.paystack_recipient_code ?? sellerProfile?.paystack_account_id),
          hasStripeConnectAccount: !!(sellerProfile?.stripe_connect_account_id ?? sellerProfile?.stripe_account_id),
          fallbackCurrency: sellerProfile?.currency,
        }),
        errorCode: 'SELLER_PAYMENT_SETUP_NEEDS_REVIEW',
        message: 'This item cannot be checked out until the seller updates its currency to match their payout account.',
        field: 'currency',
        severity: 'BLOCKING',
        actual: {
          itemCurrency: item?.currency ?? null,
          sellerCurrency: sellerProfile?.currency ?? null,
          payoutCurrency: sellerProfile?.payout_currency ?? null,
          orderCurrency,
        },
      },
    ])

    if (!payoutCurrencyPreflight.passed) {
      await logPreflightFailure(supabase, payoutCurrencyPreflight, {
        operation: 'ready_made_order_currency',
        entityType: 'seller_item',
        entityId: body.sellerItemId,
        actorId: caller.id,
        actorRole: 'CUSTOMER',
        source: FN,
        metadata: { action: body.action },
      })
      return preflightFailureResponse(payoutCurrencyPreflight, cors, 409)
    }

    if (body.action === 'start-inquiry') {
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', caller.id)
        .eq('seller_item_id', item.id)
        .eq('order_kind', 'READY_MADE')
        .eq('stage', 'PENDING_QUOTE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing?.id) {
        return new Response(JSON.stringify({ ok: true, orderId: existing.id, existing: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      const orderReference = buildReference()
      const { data: created, error: createError } = await supabase
        .from('orders')
        .insert({
          customer_id: caller.id,
          tailor_profile_id: sellerProfile.id,
          tailor_id: sellerProfile.user_id,
          tailor_payout_currency_locked: lockedTailorPayoutCurrency,
          tailor_payout_provider_locked: lockedTailorPayoutProvider,
          tailor_paystack_recipient_code_locked:
            lockedTailorPayoutProvider === 'PAYSTACK'
              ? (sellerProfile.paystack_recipient_code ?? sellerProfile.paystack_account_id ?? null)
              : null,
          tailor_stripe_connect_account_id_locked:
            lockedTailorPayoutProvider === 'STRIPE'
              ? (sellerProfile.stripe_connect_account_id ?? sellerProfile.stripe_account_id ?? null)
              : null,
          reference: orderReference,
          order_kind: 'READY_MADE',
          seller_item_id: item.id,
          garment_type: item.title,
          garment_description: item.description,
          item_title: item.title,
          currency: orderCurrency,
          quoted_currency: orderCurrency,
          stage: 'PENDING_QUOTE',
          stage_updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (createError || !created?.id) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: createError?.message ?? 'create inquiry failed' })
        return jsonError(cors, 500, 'We could not start this inquiry right now. Please try again.')
      }

      await audit(supabase, {
        event: 'ready_made.inquiry_started',
        actor_id: caller.id,
        actor_role: 'CUSTOMER',
        order_id: created.id,
        payload: { function: FN, seller_item_id: item.id },
      })

      const inquiryTitle = 'New ready-made inquiry'
      const inquiryBody = `A customer asked about ${item.title}. Reply from Drape so the full order trail stays protected.`
      const orderNotificationContext = {
        id: created.id,
        reference: orderReference,
        order_kind: 'READY_MADE',
        customer_id: caller.id,
        tailor_id: sellerProfile.user_id,
        garment_type: item.title,
        item_title: item.title,
        quoted_currency: orderCurrency,
        currency: orderCurrency,
      }

      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, sellerProfile.user_id.toString(), {
          title: inquiryTitle,
          body: inquiryBody,
          preferenceKey: 'newOrders',
          data: { orderId: created.id, type: 'ready_made_inquiry_started' },
        }),
      )

      EdgeRuntime.waitUntil(
        sendOrderEventEmail(supabase, {
          order: orderNotificationContext,
          recipientUserId: sellerProfile.user_id.toString(),
          audience: 'TAILOR',
          subject: inquiryTitle,
          headline: 'A customer asked about your ready-made item',
          body: inquiryBody,
          ctaLabel: 'Reply in Drape',
        }),
      )

      return new Response(JSON.stringify({ ok: true, orderId: created.id, existing: false }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const fulfillmentAllowed =
      (body.fulfillment === 'PICKUP' && item.pickup_available) ||
      (body.fulfillment === 'DELIVERY' && item.delivery_available) ||
      (body.fulfillment === 'SHIPPING' && item.shipping_available)

    if (!fulfillmentAllowed) {
      return rejectRequest(400, 'This fulfillment option is not available for the item.', {
        fulfillment: body.fulfillment,
        item_pickup_available: !!item.pickup_available,
        item_delivery_available: !!item.delivery_available,
        item_shipping_available: !!item.shipping_available,
      })
    }

    const availableSizes = itemSizes
    const nextSize = body.size?.trim() ?? ''
    if (availableSizes.length > 0 && !nextSize) {
      return rejectRequest(400, 'Choose a size before checkout.', {
        available_sizes: availableSizes,
      })
    }
    if (nextSize && availableSizes.length > 0 && !availableSizes.includes(nextSize)) {
      return rejectRequest(400, 'Selected size is not available for this item.', {
        requested_size: nextSize,
        available_sizes: availableSizes,
      })
    }
    const selectedSizeInventory = readyMadeSizeQuantity({
      sizeInventory,
      requestedSize: nextSize || null,
      fallbackInventoryQuantity: currentInventoryQuantity,
    })
    if (nextSize && selectedSizeInventory <= 0) {
      return jsonError(cors, 409, `Size ${nextSize} just sold out. Choose another size and try again.`)
    }

    const needsAddress = body.fulfillment !== 'PICKUP'
    const normalizedAddress = needsAddress ? body.address?.trim() ?? '' : ''
    const normalizedCity = needsAddress ? body.city?.trim() ?? '' : ''
    const normalizedRegion = needsAddress ? body.region?.trim() ?? '' : ''
    const normalizedPostalCode = needsAddress ? body.postalCode?.trim() ?? '' : ''
    const normalizedCountryCode = needsAddress ? normalizeTaxCountryCode(body.countryCode) ?? '' : ''
    const recipientName = needsAddress && body.action === 'create-checkout' ? body.recipientName?.trim() ?? '' : ''
    const recipientPhone = needsAddress && body.action === 'create-checkout' ? normalizeStoredPhone(body.recipientPhone) : ''
    if (needsAddress && !normalizedAddress) {
      return rejectRequest(400, 'Delivery address is required for this fulfillment option.', {
        fulfillment: body.fulfillment,
      })
    }
    if (body.action === 'create-checkout' && needsAddress && !recipientName) {
      return rejectRequest(400, 'Recipient name is required for this fulfillment option.', {
        fulfillment: body.fulfillment,
      })
    }
    if (body.action === 'create-checkout' && needsAddress && !recipientPhone) {
      return rejectRequest(400, 'Recipient phone is required for this fulfillment option.', {
        fulfillment: body.fulfillment,
      })
    }

    if (body.action === 'create-checkout' && needsAddress) {
      const recipientPhoneError = validateRecipientPhone(recipientPhone)
      if (recipientPhoneError) {
        return rejectRequest(400, recipientPhoneError, {
          fulfillment: body.fulfillment,
          recipient_phone: recipientPhone,
        })
      }
    }

    if (body.action === 'create-checkout' && body.cancellationPolicyAcknowledged !== true) {
      return rejectRequest(400, 'Review and acknowledge the cancellation policy before starting checkout.', {
        policy_version: ORDER_CANCELLATION_POLICY_VERSION,
      })
    }

    if (body.fulfillment === 'PICKUP') {
      const { data: pickupDetails, error: pickupDetailsError } = await supabase
        .from('tailor_pickup_details')
        .select('pickup_address')
        .eq('user_id', sellerProfile.user_id)
        .maybeSingle()

      if (pickupDetailsError) {
        log('error', FN, 'db.error', { actor_id: caller.id, error: pickupDetailsError.message })
        return jsonError(cors, 500, 'We could not confirm pickup details right now. Please try again.')
      }

      if (!pickupDetails?.pickup_address?.trim()) {
        return jsonError(cors, 409, 'This seller has not finished pickup details yet. Please choose delivery or shipping, or try again later.')
      }
    }

    let pricing
    try {
      pricing = await resolveCheckoutPricing({
        supabase,
        callerId: caller.id,
        sellerItemId: item.id,
        quantity: body.quantity,
        fulfillment: body.fulfillment,
        address: needsAddress ? normalizedAddress : null,
        city: needsAddress ? normalizedCity : null,
        region: needsAddress ? normalizedRegion : null,
        postalCode: needsAddress ? normalizedPostalCode : null,
        countryCode: needsAddress ? normalizedCountryCode || null : null,
        orderCurrency,
        accountRegionCode,
        item,
        sellerProfileLocation: sellerProfile?.location ?? null,
      })
    } catch (error) {
      log('warn', FN, 'checkout_pricing.unavailable', {
        actor_id: caller.id,
        seller_item_id: item.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return jsonError(cors, 503, 'We could not calculate taxes and totals for this checkout right now. Please try again in a moment.')
    }

    if (body.action === 'preview-checkout') {
      return new Response(JSON.stringify({
        ok: true,
        pricing: {
          currency: orderCurrency,
          displayCurrency: accountCurrency,
          sourceCurrency: pricing.itemCurrency,
          sourceSubtotal: pricing.sourceSubtotal,
          fxRate: pricing.fxQuote?.rate ?? 1,
          fxRateTimestamp: pricing.fxQuote?.timestamp ?? null,
          subtotalAmount: pricing.lockedAmounts.subtotalAmount,
          platformFeeAmount: pricing.lockedAmounts.platformFeeAmount,
          taxAmount: pricing.lockedAmounts.taxAmount,
          taxRateBps: pricing.lockedAmounts.taxRateBps,
          taxRegion: pricing.tax.taxRegion,
          taxFallback: pricing.tax.fallback,
          taxFallbackReason: pricing.tax.fallbackReason,
          shippingAmount: pricing.lockedAmounts.shippingAmount,
          totalAmount: pricing.lockedAmounts.totalAmount,
          taxLabel: pricing.tax.label,
        },
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const { data: existingCheckout, error: existingCheckoutError } = await supabase
      .from('orders')
      .select('id, item_size, item_quantity, fulfillment_option, delivery_address, recipient_name, recipient_phone')
      .eq('customer_id', caller.id)
      .eq('seller_item_id', item.id)
      .eq('order_kind', 'READY_MADE')
      .eq('stage', 'PAYMENT_PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingCheckoutError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: existingCheckoutError.message })
      return jsonError(cors, 500, 'We could not check your current checkout right now. Please try again.')
    }

    if (existingCheckout?.id) {
      const existingAddress = existingCheckout.delivery_address?.trim() ?? ''
      const sameCheckout =
        (existingCheckout.item_size ?? '') === nextSize &&
        (existingCheckout.item_quantity ?? 1) === body.quantity &&
        (existingCheckout.fulfillment_option ?? '') === body.fulfillment &&
        existingAddress === normalizedAddress &&
        (existingCheckout.recipient_name?.trim() ?? '') === recipientName &&
        (existingCheckout.recipient_phone?.trim() ?? '') === recipientPhone

      if (sameCheckout) {
        return new Response(JSON.stringify({ ok: true, orderId: existingCheckout.id, existing: true }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      return new Response(
        JSON.stringify({
          error: `You already have a checkout in progress for this item. Finish it or wait for it to expire before starting another.`,
          orderId: existingCheckout.id,
        }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    if (currentInventoryQuantity <= 0) {
      return jsonError(cors, 409, 'This item just sold out. Please refresh the shop and try another piece.')
    }

    const availableInventoryForCheckout = nextSize ? selectedSizeInventory : currentInventoryQuantity

    if (body.quantity > availableInventoryForCheckout) {
      return jsonError(
        cors,
        409,
        nextSize
          ? `Only ${selectedSizeInventory} unit${selectedSizeInventory === 1 ? '' : 's'} left in size ${nextSize} right now. Adjust the quantity and try again.`
          : `Only ${currentInventoryQuantity} unit${currentInventoryQuantity === 1 ? '' : 's'} left for this item right now. Adjust the quantity and try again.`,
      )
    }

    const { data: reservedInventory, error: reserveError } = await supabase.rpc('reserve_seller_item_inventory', {
      target_item_id: item.id,
      requested_quantity: body.quantity,
      requested_size: nextSize || null,
    })

    if (reserveError) {
      log('error', FN, 'db.error', { actor_id: caller.id, error: reserveError.message })
      return jsonError(cors, 500, 'Could not hold stock for this checkout.')
    }

    const reservedRow = Array.isArray(reservedInventory) ? reservedInventory[0] : null
    if (!reservedRow) {
      const { data: latestItem } = await supabase
        .from('seller_items')
        .select('inventory_quantity, size_inventory')
        .eq('id', item.id)
        .maybeSingle()

      const latestSizeInventory = normalizeReadyMadeSizeInventory({
        sizes: availableSizes,
        sizeInventory: latestItem?.size_inventory,
        fallbackInventoryQuantity: typeof latestItem?.inventory_quantity === 'number' ? latestItem.inventory_quantity : 0,
      })
      const latestRemaining =
        nextSize
          ? readyMadeSizeQuantity({
              sizeInventory: latestSizeInventory,
              requestedSize: nextSize,
              fallbackInventoryQuantity: typeof latestItem?.inventory_quantity === 'number' ? latestItem.inventory_quantity : 0,
            })
          : (typeof latestItem?.inventory_quantity === 'number' && latestItem.inventory_quantity > 0
              ? latestItem.inventory_quantity
              : 0)

      return jsonError(
        cors,
        409,
        latestRemaining > 0
          ? nextSize
            ? `Only ${latestRemaining} unit${latestRemaining === 1 ? '' : 's'} left in size ${nextSize} right now. Adjust the quantity and try again.`
            : `Only ${latestRemaining} unit${latestRemaining === 1 ? '' : 's'} left for this item right now. Adjust the quantity and try again.`
          : nextSize
            ? `Size ${nextSize} just sold out. Please refresh the shop and try another size.`
            : 'This item just sold out. Please refresh the shop and try another piece.',
      )
    }

    const { data: checkoutOrder, error: checkoutError } = await supabase
      .from('orders')
      .insert({
        customer_id: caller.id,
        tailor_profile_id: sellerProfile.id,
        tailor_id: sellerProfile.user_id,
        tailor_payout_currency_locked: lockedTailorPayoutCurrency,
        tailor_payout_provider_locked: lockedTailorPayoutProvider,
        tailor_paystack_recipient_code_locked:
          lockedTailorPayoutProvider === 'PAYSTACK'
            ? (sellerProfile.paystack_recipient_code ?? sellerProfile.paystack_account_id ?? null)
            : null,
        tailor_stripe_connect_account_id_locked:
          lockedTailorPayoutProvider === 'STRIPE'
            ? (sellerProfile.stripe_connect_account_id ?? sellerProfile.stripe_account_id ?? null)
            : null,
        reference: buildReference(),
        order_kind: 'READY_MADE',
        seller_item_id: item.id,
        garment_type: item.title,
        garment_description: item.description,
        item_title: item.title,
        item_size: nextSize || null,
        item_quantity: body.quantity,
        item_unit_price: item.price_amount,
        item_subtotal: pricing.lockedAmounts.subtotalAmount,
        fulfillment_fee: pricing.fulfillmentFee,
        quoted_amount: pricing.lockedAmounts.totalAmount,
        currency: orderCurrency,
        quoted_currency: orderCurrency,
        source_currency: pricing.itemCurrency,
        source_amount: pricing.sourceSubtotal,
        fx_rate: pricing.fxQuote?.rate ?? 1,
        fx_rate_timestamp: pricing.fxQuote?.timestamp ?? new Date().toISOString(),
        subtotal_amount: pricing.lockedAmounts.subtotalAmount,
        platform_fee_amount: pricing.lockedAmounts.platformFeeAmount,
        tax_amount: pricing.lockedAmounts.taxAmount,
        tax_rate_bps: pricing.lockedAmounts.taxRateBps,
        tax_region: pricing.tax.taxRegion,
        tax_fallback: pricing.tax.fallback,
        tax_fallback_reason: pricing.tax.fallbackReason,
        shipping_amount: pricing.lockedAmounts.shippingAmount,
        total_amount: pricing.lockedAmounts.totalAmount,
        fulfillment_option: body.fulfillment,
        delivery_method:
          body.fulfillment === 'PICKUP'
            ? 'LOCAL_COLLECTION'
            : body.fulfillment === 'DELIVERY'
              ? 'LOCAL_DELIVERY'
              : 'SHIPPING',
        delivery_address: needsAddress ? normalizedAddress : null,
        delivery_city: needsAddress ? normalizedCity || null : null,
        delivery_region: needsAddress ? normalizedRegion || null : null,
        delivery_postal_code: needsAddress ? normalizedPostalCode || null : null,
        delivery_country_code: needsAddress ? normalizedCountryCode || null : null,
        recipient_name: needsAddress ? recipientName : null,
        recipient_phone: needsAddress ? recipientPhone : null,
        special_note: serializeOrderSupportMeta({
          orderContract: {
            version: ORDER_CONTRACT_VERSION,
            orderKind: 'READY_MADE',
            createdAt: new Date().toISOString(),
          },
          checkoutPolicy: {
            cancellationPolicyVersion: ORDER_CANCELLATION_POLICY_VERSION,
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: caller.id,
            policyName: 'order-cancellation-policy',
          },
        }),
        stage: 'PAYMENT_PENDING',
        stage_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (checkoutError || !checkoutOrder?.id) {
      await supabase.rpc('release_seller_item_inventory', {
        target_item_id: item.id,
        released_quantity: body.quantity,
        released_size: nextSize || null,
      })

      log('error', FN, 'db.error', { actor_id: caller.id, error: checkoutError?.message ?? 'checkout failed' })
      return jsonError(cors, 500, 'We could not start checkout right now. Your payment has not been charged.')
    }

    const { data: openInquiries, error: openInquiriesError } = await supabase
      .from('orders')
      .select('id')
      .eq('customer_id', caller.id)
      .eq('seller_item_id', item.id)
      .eq('order_kind', 'READY_MADE')
      .eq('stage', 'PENDING_QUOTE')
      .neq('id', checkoutOrder.id)

    if (openInquiriesError) {
      log('warn', FN, 'db.warn', {
        actor_id: caller.id,
        error: openInquiriesError.message,
        detail: 'lookup_open_inquiries_failed',
      })
    } else {
      const inquiryIds = (openInquiries ?? [])
        .map((row: { id?: string | null }) => row.id ?? '')
        .filter((value) => value.length > 0)

      if (inquiryIds.length > 0) {
        for (const inquiryId of inquiryIds) {
          try {
            await finalizeOrderTerminal(
              supabase,
              inquiryId,
              buildReadyMadeInquiryClosedTerminalRequest(caller.id),
            )
          } catch (closeInquiryError) {
            log('warn', FN, 'db.warn', {
              actor_id: caller.id,
              error: closeInquiryError instanceof Error ? closeInquiryError.message : String(closeInquiryError),
              detail: 'close_open_inquiries_failed',
              inquiry_id: inquiryId,
            })
          }
        }
      }
    }

    await audit(supabase, {
      event: 'ready_made.checkout_started',
      actor_id: caller.id,
      actor_role: 'CUSTOMER',
      order_id: checkoutOrder.id,
      payload: {
        function: FN,
        seller_item_id: item.id,
        quantity: body.quantity,
        size: nextSize || null,
        fulfillment: body.fulfillment,
        inventory_remaining: reservedRow.inventory_quantity ?? null,
      },
    })

    return new Response(JSON.stringify({ ok: true, orderId: checkoutOrder.id, existing: false }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    log('error', FN, 'unhandled', { error: error instanceof Error ? error.message : String(error) })
    return jsonError(cors, 500, 'Something went wrong starting this order. Please try again.')
  }
})
