/**
 * Drapeon — send-email Edge Function
 *
 * Sends transactional emails via Resend. Called by Supabase Database Webhooks.
 *
 * Triggers (set up in Supabase Dashboard → Database → Webhooks):
 *
 *   1. new-user-email
 *      Table: users  |  Event: INSERT
 *      → Welcome email to new user
 *
 *   2. order-email
 *      Table: orders  |  Event: UPDATE
 *      → Payment receipt (CONFIRMED), dispute opened (IN_DISPUTE),
 *        dispute resolved (COMPLETE/REFUNDED)
 *
 *   3. dispute-email
 *      Table: disputes  |  Event: INSERT + UPDATE
 *      → Dispute opened confirmation, resolution notice
 *
 *   Verification decision emails are sent by handle-verification-decision.
 *   Do not send them from database webhooks, or ops decisions will duplicate
 *   customer-facing mail.
 *
 * Deploy:
 *   supabase functions deploy send-email --project-ref <ref>
 *
 * Set secrets:
 *   supabase secrets set RESEND_API_KEY=re_xxxx --project-ref <ref>
 *   supabase secrets set RESEND_FROM="Drapeon <noreply@drapeon.co>" --project-ref <ref>
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key> --project-ref <ref>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  normalizeDrapeonSender,
  renderDrapeonTransactionalEmail,
} from '../../../../../supabase/functions/_shared/email-template.ts'

const RESEND_API = 'https://api.resend.com/emails'

const FROM = normalizeDrapeonSender(Deno.env.get('RESEND_FROM'))
const APP_URL =
  Deno.env.get('SITE_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? 'https://drapeon.co'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ─── Email sender ─────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, payload: { html: string; text: string }) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'drape-send-email/1.0',
    },
    body: JSON.stringify({ from: FROM, to, subject, html: payload.html, text: payload.text }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('Resend error:', res.status, body)
  }
}

// ─── Email templates ──────────────────────────────────────────────────────────

function welcomeEmail(displayName: string, role: string) {
  const roleBlurb =
    role === 'TAILOR'
      ? 'Complete your tailor profile to start receiving briefs from customers.'
      : 'Browse talented tailors and place your first brief today.'

  return renderDrapeonTransactionalEmail({
    preheader: 'Welcome to Drapeon.',
    eyebrow: 'Welcome',
    headline: 'Your Drapeon account is ready',
    recipientName: displayName,
    body: roleBlurb,
    ctaLabel: 'Open Drapeon',
    ctaUrl: APP_URL,
  })
}

function paymentReceiptEmail(
  displayName: string,
  ref: string,
  amountPence: number,
  currency: string
) {
  const amount = (amountPence / 100).toFixed(2)
  const symbol: Record<string, string> = {
    GBP: '£',
    USD: '$',
    EUR: '€',
    NGN: '₦',
    GHS: '₵',
    KES: 'KSh',
    CAD: 'C$',
  }
  return renderDrapeonTransactionalEmail({
    preheader: `Payment received for order #${ref}.`,
    eyebrow: 'Payment update',
    headline: 'Payment received',
    recipientName: displayName,
    body: 'Your payment has been received and the order is now funded in Drapeon.',
    details: [
      { label: 'Order', value: `#${ref}` },
      { label: 'Amount', value: `${symbol[currency] ?? currency}${amount}` },
      { label: 'Status', value: 'Order funded' },
    ],
    ctaLabel: 'Track your order',
    ctaUrl: APP_URL,
  })
}

function disputeOpenedEmail(displayName: string, ref: string, isCustomer: boolean) {
  const roleNote = isCustomer
    ? 'Your dispute has been logged. Our team will review it within 2 business days.'
    : 'A dispute has been opened on your order. Our team will contact you within 2 business days.'
  return renderDrapeonTransactionalEmail({
    preheader: `Dispute opened for order #${ref}.`,
    eyebrow: 'Order review',
    headline: 'A dispute was opened',
    recipientName: displayName,
    body: `${roleNote}\n\nNo funds will be released while the dispute is under review.`,
    details: [{ label: 'Order', value: `#${ref}` }],
    ctaLabel: 'View dispute',
    ctaUrl: APP_URL,
  })
}

function disputeResolvedEmail(
  displayName: string,
  ref: string,
  resolution: string,
  refunded: boolean
) {
  const outcome = refunded
    ? 'The payment has been refunded to the customer.'
    : 'The payment has been released to the tailor.'
  return renderDrapeonTransactionalEmail({
    preheader: `Dispute resolved for order #${ref}.`,
    eyebrow: 'Order review',
    headline: 'The dispute was resolved',
    recipientName: displayName,
    body: `The dispute on this order has been resolved. ${outcome}${
      resolution ? `\n\nResolution note: ${resolution}` : ''
    }`,
    details: [{ label: 'Order', value: `#${ref}` }],
    ctaLabel: 'Open Drapeon',
    ctaUrl: APP_URL,
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    const { table, type, record, old_record } = payload

    // ── New user → welcome email ──────────────────────────────────────────────
    if (table === 'users' && type === 'INSERT') {
      const user = record
      if (user.email) {
        await sendEmail(
          user.email,
          'Welcome to Drapeon',
          welcomeEmail(user.display_name ?? 'there', user.role ?? 'CUSTOMER')
        )
      }
      return new Response('ok')
    }

    // ── Order stage updated ───────────────────────────────────────────────────
    if (table === 'orders' && type === 'UPDATE') {
      const order = record
      const prevStage = old_record?.stage
      if (order.stage === prevStage) return new Response('ok')

      // Payment receipt: customer just paid
      if (order.stage === 'CONFIRMED' && prevStage === 'PAYMENT_PENDING') {
        const { data: customer } = await supabase
          .from('users')
          .select('email, display_name')
          .eq('id', order.customer_id)
          .single()
        if (customer?.email) {
          await sendEmail(
            customer.email,
            `Payment confirmed — Order #${order.reference}`,
            paymentReceiptEmail(
              customer.display_name ?? 'there',
              order.reference ?? order.id.slice(0, 8).toUpperCase(),
              order.quoted_amount ?? 0,
              order.currency ?? 'GBP'
            )
          )
        }
      }

      return new Response('ok')
    }

    // ── Dispute INSERT — opened ───────────────────────────────────────────────
    if (table === 'disputes' && type === 'INSERT') {
      const dispute = record
      const { data: order } = await supabase
        .from('orders')
        .select('customer_id, tailor_id, reference, tailor_profile_id')
        .eq('id', dispute.order_id)
        .single()
      if (!order) return new Response('ok')

      // Get tailor's user_id from tailor_profiles
      const { data: tailorProfile } = await supabase
        .from('tailor_profiles')
        .select('user_id')
        .eq('id', order.tailor_profile_id)
        .single()

      const [{ data: customer }, { data: tailor }] = await Promise.all([
        supabase.from('users').select('email, display_name').eq('id', order.customer_id).single(),
        tailorProfile
          ? supabase
              .from('users')
              .select('email, display_name')
              .eq('id', tailorProfile.user_id)
              .single()
          : Promise.resolve({ data: null }),
      ])

      const ref = order.reference ?? dispute.order_id?.slice(0, 8).toUpperCase() ?? ''

      if (customer?.email) {
        await sendEmail(
          customer.email,
          `Dispute opened — Order #${ref}`,
          disputeOpenedEmail(customer.display_name ?? 'there', ref, true)
        )
      }
      if (tailor?.email) {
        await sendEmail(
          tailor.email,
          `Dispute opened on your order #${ref}`,
          disputeOpenedEmail(tailor.display_name ?? 'there', ref, false)
        )
      }
      return new Response('ok')
    }

    // ── Dispute UPDATE — resolved ─────────────────────────────────────────────
    if (table === 'disputes' && type === 'UPDATE') {
      const dispute = record
      const prevStatus = old_record?.status
      if (dispute.status === prevStatus) return new Response('ok')

      const isResolved =
        dispute.status === 'RESOLVED_REFUNDED' || dispute.status === 'RESOLVED_RELEASED'
      if (!isResolved) return new Response('ok')

      const refunded = dispute.status === 'RESOLVED_REFUNDED'

      const { data: order } = await supabase
        .from('orders')
        .select('customer_id, tailor_profile_id, reference')
        .eq('id', dispute.order_id)
        .single()
      if (!order) return new Response('ok')

      const { data: tailorProfile } = await supabase
        .from('tailor_profiles')
        .select('user_id')
        .eq('id', order.tailor_profile_id)
        .single()

      const [{ data: customer }, { data: tailor }] = await Promise.all([
        supabase.from('users').select('email, display_name').eq('id', order.customer_id).single(),
        tailorProfile
          ? supabase
              .from('users')
              .select('email, display_name')
              .eq('id', tailorProfile.user_id)
              .single()
          : Promise.resolve({ data: null }),
      ])

      const ref = order.reference ?? ''

      if (customer?.email) {
        await sendEmail(
          customer.email,
          `Dispute resolved — Order #${ref}`,
          disputeResolvedEmail(
            customer.display_name ?? 'there',
            ref,
            dispute.resolution ?? '',
            refunded
          )
        )
      }
      if (tailor?.email) {
        await sendEmail(
          tailor.email,
          `Dispute resolved — Order #${ref}`,
          disputeResolvedEmail(
            tailor.display_name ?? 'there',
            ref,
            dispute.resolution ?? '',
            refunded
          )
        )
      }
      return new Response('ok')
    }

    // ── Tailor profile UPDATE — ID verification decision ──────────────────────
    // The canonical verification workflow sends approval / rejection emails
    // directly from handle-verification-decision so the rejection reason can be
    // included and the audit trail stays attached to the ops action.
    if (table === 'tailor_profiles' && type === 'UPDATE') {
      const prevStatus = old_record?.id_verification_status
      const nextStatus = record?.id_verification_status

      if (prevStatus === nextStatus) return new Response('ok')

      const approved = nextStatus === 'VERIFIED'
      const rejected = nextStatus === 'REJECTED'

      if (!approved && !rejected) return new Response('ok')
      return new Response('ok')
    }

    return new Response('ok')
  } catch (err) {
    console.error('send-email error:', err)
    return new Response('error', { status: 500 })
  }
})
