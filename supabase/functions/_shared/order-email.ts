import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { log } from './logger.ts'
import { normalizeDrapeonSender, renderDrapeonTransactionalEmail } from './email-template.ts'

const FN = 'order-email'
const RESEND_API = 'https://api.resend.com/emails'

type PaymentPhase = 'INITIAL_ORDER' | 'FULFILLMENT' | 'CONSULTATION'
type OrderEventAudience = 'CUSTOMER' | 'TAILOR'

type OrderEmailContext = {
  id: string
  reference?: string | null
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  garment_type?: string | null
  item_title?: string | null
  item_size?: string | null
  delivery_method?: string | null
  quoted_amount?: number | null
  quoted_currency?: string | null
  currency?: string | null
  consultation_fee?: number | null
  fulfillment_fee?: number | null
}

function getSiteUrl() {
  return (
    Deno.env.get('SITE_URL') ??
    Deno.env.get('NEXT_PUBLIC_SITE_URL') ??
    'https://drapeon.co'
  ).replace(/\/+$/u, '')
}

function getResendFrom() {
  return normalizeDrapeonSender(Deno.env.get('RESEND_FROM'))
}

function getResendApiKey() {
  return Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
}

function moneySymbol(currency: string) {
  const normalized = currency.trim().toUpperCase()
  if (normalized === 'GBP') return '£'
  if (normalized === 'USD') return '$'
  if (normalized === 'EUR') return '€'
  if (normalized === 'NGN') return '₦'
  if (normalized === 'GHS') return '₵'
  if (normalized === 'KES') return 'KSh '
  if (normalized === 'CAD') return 'CA$'
  return normalized || 'USD'
}

function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined) {
  const safeCurrency = (currency ?? 'USD').trim().toUpperCase()
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) {
    return `${moneySymbol(safeCurrency)}0.00`
  }

  return `${moneySymbol(safeCurrency)}${(amountMinor / 100).toFixed(2)}`
}

function orderLabel(order: Pick<OrderEmailContext, 'order_kind' | 'item_title' | 'garment_type'>) {
  if (order.order_kind === 'READY_MADE') {
    return order.item_title?.trim() || order.garment_type?.trim() || 'Ready-made order'
  }

  return order.garment_type?.trim() || 'Custom order'
}

function orderReference(order: Pick<OrderEmailContext, 'reference' | 'id'>) {
  return (order.reference?.trim() || order.id.slice(0, 8).toUpperCase()).toUpperCase()
}

function fulfillmentLabel(method: string | null | undefined) {
  if (method === 'LOCAL_DELIVERY') return 'Delivery'
  if (method === 'LOCAL_COLLECTION') return 'Collection'
  return 'Shipping'
}

function customerOrderConfirmationEmail(input: {
  customerName: string
  order: OrderEmailContext
  phase: PaymentPhase
}) {
  const ref = orderReference(input.order)
  const label = orderLabel(input.order)
  const appUrl = getSiteUrl()
  const currency = input.order.currency ?? input.order.quoted_currency ?? 'USD'
  const amount =
    input.phase === 'CONSULTATION'
      ? formatMoney(input.order.consultation_fee, currency)
      : input.phase === 'FULFILLMENT'
        ? formatMoney(input.order.fulfillment_fee, currency)
        : formatMoney(input.order.quoted_amount, currency)
  const subject =
    input.phase === 'CONSULTATION'
      ? `Consultation payment confirmed - #${ref}`
      : input.phase === 'FULFILLMENT'
        ? `${fulfillmentLabel(input.order.delivery_method)} payment confirmed - #${ref}`
        : `Order confirmed - #${ref}`
  const headline =
    input.phase === 'CONSULTATION'
      ? 'Consultation payment confirmed'
      : input.phase === 'FULFILLMENT'
        ? `${fulfillmentLabel(input.order.delivery_method)} payment confirmed`
        : 'Your order is confirmed'
  const nextStep =
    input.phase === 'CONSULTATION'
      ? 'Drapeon has received your consultation payment. Join from your order or messages when the scheduled time arrives.'
      : input.phase === 'FULFILLMENT'
        ? `Drapeon has received your ${fulfillmentLabel(
            input.order.delivery_method
          ).toLowerCase()} payment and the order can move into dispatch once the handoff is arranged.`
        : input.order.order_kind === 'READY_MADE'
          ? 'Your order is now placed. You will keep seeing progress inside Drapeon as the tailor prepares it.'
          : 'Your order is now funded. The tailor can continue production inside Drapeon and you will see updates in your timeline.'

  return {
    subject,
    ...renderDrapeonTransactionalEmail({
      preheader: `${headline} for order #${ref}.`,
      eyebrow: 'Order update',
      headline,
      recipientName: input.customerName,
      body: nextStep,
      details: [
        { label: 'Order', value: `#${ref}` },
        { label: 'Item', value: label },
        ...(input.order.item_size ? [{ label: 'Size', value: input.order.item_size }] : []),
        {
          label:
            input.phase === 'CONSULTATION'
              ? 'Consultation fee'
              : input.phase === 'FULFILLMENT'
                ? fulfillmentLabel(input.order.delivery_method)
                : 'Amount',
          value: amount,
        },
        ...(input.phase === 'INITIAL_ORDER' && input.order.delivery_method
          ? [
              {
                label: 'Fulfillment',
                value: fulfillmentLabel(input.order.delivery_method),
              },
            ]
          : []),
      ],
      ctaLabel: 'Open order',
      ctaUrl: `${appUrl}/account/orders/${encodeURIComponent(input.order.id)}`,
    }),
  }
}

function tailorOrderConfirmationEmail(input: {
  tailorName: string
  customerName: string
  order: OrderEmailContext
  phase: PaymentPhase
}) {
  const ref = orderReference(input.order)
  const label = orderLabel(input.order)
  const appUrl = getSiteUrl()
  const currency = input.order.currency ?? input.order.quoted_currency ?? 'USD'
  const amount =
    input.phase === 'CONSULTATION'
      ? formatMoney(input.order.consultation_fee, currency)
      : input.phase === 'FULFILLMENT'
        ? formatMoney(input.order.fulfillment_fee, currency)
        : formatMoney(input.order.quoted_amount, currency)
  const subject =
    input.phase === 'CONSULTATION'
      ? `Consultation payment received - #${ref}`
      : input.phase === 'FULFILLMENT'
        ? `${fulfillmentLabel(input.order.delivery_method)} payment received - #${ref}`
        : input.order.order_kind === 'READY_MADE'
          ? `New paid order - #${ref}`
          : `Order funded - #${ref}`
  const headline =
    input.phase === 'CONSULTATION'
      ? 'Consultation fee paid'
      : input.phase === 'FULFILLMENT'
        ? `${fulfillmentLabel(input.order.delivery_method)} payment received`
        : input.order.order_kind === 'READY_MADE'
          ? 'A ready-made order is paid'
          : 'A custom order is funded'
  const nextStep =
    input.phase === 'CONSULTATION'
      ? 'The customer paid the consultation fee. Start the call from Drapeon at the scheduled time.'
      : input.phase === 'FULFILLMENT'
        ? `Drapeon has received the ${fulfillmentLabel(
            input.order.delivery_method
          ).toLowerCase()} payment, so you can move the order forward once dispatch is arranged.`
        : input.order.order_kind === 'READY_MADE'
          ? 'This order is now paid and ready for fulfillment inside Drapeon.'
          : 'This order is now paid and ready for production inside Drapeon.'

  return {
    subject,
    ...renderDrapeonTransactionalEmail({
      preheader: `${headline} for order #${ref}.`,
      eyebrow: 'Order update',
      headline,
      recipientName: input.tailorName,
      body: nextStep,
      details: [
        { label: 'Order', value: `#${ref}` },
        { label: 'Customer', value: input.customerName },
        { label: 'Item', value: label },
        ...(input.order.item_size ? [{ label: 'Size', value: input.order.item_size }] : []),
        {
          label:
            input.phase === 'CONSULTATION'
              ? 'Consultation fee'
              : input.phase === 'FULFILLMENT'
                ? fulfillmentLabel(input.order.delivery_method)
                : 'Amount paid',
          value: amount,
        },
      ],
      ctaLabel: 'Open order',
      ctaUrl: `${appUrl}/account/orders/${encodeURIComponent(input.order.id)}`,
    }),
  }
}

async function lookupUserEmail(supabase: SupabaseClient, userId: string | null | undefined) {
  if (!userId) return null
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) {
    log('warn', FN, 'auth.lookup_failed', {
      user_id: userId,
      error: error.message,
    })
    return null
  }
  return data.user?.email?.trim() || null
}

async function lookupCustomerName(supabase: SupabaseClient, userId: string | null | undefined) {
  if (!userId) return 'there'
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    log('warn', FN, 'customer_profile.lookup_failed', {
      user_id: userId,
      error: error.message,
    })
    return 'there'
  }

  return data?.display_name?.trim() || 'there'
}

async function lookupTailorName(supabase: SupabaseClient, userId: string | null | undefined) {
  if (!userId) return 'there'
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select('display_name,business_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    log('warn', FN, 'tailor_profile.lookup_failed', {
      user_id: userId,
      error: error.message,
    })
    return 'there'
  }

  return data?.display_name?.trim() || data?.business_name?.trim() || 'there'
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    log('warn', FN, 'resend.missing_api_key')
    throw new Error('RESEND_API_KEY is not configured.')
  }

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drape-order-email/1.0',
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [to],
      subject,
      html,
      text,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    log('warn', FN, 'resend.send_failed', {
      to,
      subject,
      status: response.status,
      body,
    })
    throw new Error(`Resend email failed with ${response.status}${body ? `: ${body}` : ''}`)
  }
}

function orderEventEmail(input: {
  recipientName: string
  order: OrderEmailContext
  headline: string
  body: string
  ctaLabel?: string
  evidenceImageUrl?: string | null
}) {
  const ref = orderReference(input.order)
  const label = orderLabel(input.order)
  const appUrl = getSiteUrl()
  const ctaLabel = input.ctaLabel?.trim() || 'Open Drapeon'
  const evidenceImageUrl = input.evidenceImageUrl?.trim()
  return renderDrapeonTransactionalEmail({
    preheader: `${input.headline} for order #${ref}.`,
    eyebrow: 'Order update',
    headline: input.headline,
    recipientName: input.recipientName,
    body: input.body,
    details: [
      { label: 'Order', value: `#${ref}` },
      { label: 'Item', value: label },
      ...(input.order.item_size ? [{ label: 'Size', value: input.order.item_size }] : []),
    ],
    ctaLabel,
    ctaUrl: `${appUrl}/account/orders/${encodeURIComponent(input.order.id)}`,
    evidenceImageUrl,
    evidenceImageAlt: `Latest production photo for order #${ref}`,
  })
}

export async function sendOrderEventEmail(
  supabase: SupabaseClient,
  input: {
    order: OrderEmailContext
    recipientUserId: string | null | undefined
    audience: OrderEventAudience
    subject: string
    headline?: string
    body: string
    ctaLabel?: string
    evidenceImageUrl?: string | null
  }
) {
  const email = await lookupUserEmail(supabase, input.recipientUserId)
  if (!email) return

  const recipientName =
    input.audience === 'CUSTOMER'
      ? await lookupCustomerName(supabase, input.recipientUserId)
      : await lookupTailorName(supabase, input.recipientUserId)

  const payload = orderEventEmail({
    recipientName,
    order: input.order,
    headline: input.headline ?? input.subject,
    body: input.body,
    ctaLabel: input.ctaLabel,
    evidenceImageUrl: input.evidenceImageUrl,
  })
  await sendEmail(email, input.subject, payload.html, payload.text)
}

export async function sendOrderConfirmationEmails(
  supabase: SupabaseClient,
  order: OrderEmailContext,
  phase: PaymentPhase
) {
  const [customerEmail, tailorEmail, customerName, tailorName] = await Promise.all([
    lookupUserEmail(supabase, order.customer_id),
    lookupUserEmail(supabase, order.tailor_id),
    lookupCustomerName(supabase, order.customer_id),
    lookupTailorName(supabase, order.tailor_id),
  ])

  if (customerEmail) {
    const customerEmailPayload = customerOrderConfirmationEmail({
      customerName,
      order,
      phase,
    })
    await sendEmail(
      customerEmail,
      customerEmailPayload.subject,
      customerEmailPayload.html,
      customerEmailPayload.text
    )
  }

  if (tailorEmail) {
    const tailorEmailPayload = tailorOrderConfirmationEmail({
      tailorName,
      customerName,
      order,
      phase,
    })
    await sendEmail(
      tailorEmail,
      tailorEmailPayload.subject,
      tailorEmailPayload.html,
      tailorEmailPayload.text
    )
  }
}
