/**
 * Drape — send-email Edge Function
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
 *   4. id-verification-email
 *      Table: tailor_profiles  |  Event: UPDATE  (id_verified_at field changes)
 *      → Approval / rejection notice to tailor
 *
 * Deploy:
 *   supabase functions deploy send-email --project-ref <ref>
 *
 * Set secrets:
 *   supabase secrets set RESEND_API_KEY=re_xxxx --project-ref <ref>
 *   supabase secrets set RESEND_FROM=noreply@drape.app --project-ref <ref>
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key> --project-ref <ref>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API = 'https://api.resend.com/emails'
const FROM = Deno.env.get('RESEND_FROM') ?? 'Drape <noreply@drape.app>'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ─── Email sender ─────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('Resend error:', res.status, body)
  }
}

// ─── Email templates ──────────────────────────────────────────────────────────

function welcomeEmail(displayName: string, role: string): string {
  const roleBlurb = role === 'TAILOR'
    ? 'Complete your tailor profile to start receiving briefs from customers.'
    : 'Browse talented tailors and place your first brief today.'

  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="https://drape.app/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">Welcome to Drape, ${displayName}!</h1>
  <p style="color:#555;line-height:1.6">${roleBlurb}</p>
  <a href="https://drape.app" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Drape</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">You're receiving this because you created a Drape account. © Drape Ltd.</p>
</div>`
}

function paymentReceiptEmail(displayName: string, ref: string, amountPence: number, currency: string): string {
  const amount = (amountPence / 100).toFixed(2)
  const symbol: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', NGN: '₦', GHS: '₵', KES: 'KSh' }
  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="https://drape.app/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">Payment received</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName}, your payment for order <strong>#${ref}</strong> has been received and held in escrow.</p>
  <table style="border-collapse:collapse;width:100%;margin:24px 0">
    <tr><td style="padding:8px 0;color:#555">Order</td><td style="padding:8px 0;font-weight:600">#${ref}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Amount</td><td style="padding:8px 0;font-weight:600">${symbol[currency] ?? currency}${amount}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Status</td><td style="padding:8px 0;color:#2d6a4f;font-weight:600">Held in escrow — released when you confirm delivery</td></tr>
  </table>
  <a href="https://drape.app" style="display:inline-block;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Track your order</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd. Questions? Reply to this email.</p>
</div>`
}

function disputeOpenedEmail(displayName: string, ref: string, isCustomer: boolean): string {
  const roleNote = isCustomer
    ? 'Your dispute has been logged. Our team will review it within 2 business days.'
    : 'A dispute has been opened on your order. Our team will contact you within 2 business days.'
  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="https://drape.app/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">Dispute opened — Order #${ref}</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">${roleNote}</p>
  <p style="color:#555;line-height:1.6">No funds will be released while the dispute is under review.</p>
  <a href="https://drape.app" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#c0392b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">View dispute</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd.</p>
</div>`
}

function disputeResolvedEmail(displayName: string, ref: string, resolution: string, refunded: boolean): string {
  const outcome = refunded
    ? 'The payment has been refunded to the customer.'
    : 'The payment has been released to the tailor.'
  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="https://drape.app/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">Dispute resolved — Order #${ref}</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">The dispute on order <strong>#${ref}</strong> has been resolved.</p>
  <p style="color:#555;line-height:1.6"><strong>Outcome:</strong> ${outcome}</p>
  ${resolution ? `<p style="color:#555;line-height:1.6"><strong>Resolution note:</strong> ${resolution}</p>` : ''}
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd. If you have questions, reply to this email.</p>
</div>`
}

function idVerifiedEmail(displayName: string, approved: boolean): string {
  const headline = approved ? 'ID verification approved' : 'ID verification — action required'
  const body = approved
    ? 'Your ID has been verified. Your profile is now eligible to go live on Drape.'
    : 'We were unable to verify your ID document. Please re-submit a clear photo of a valid government-issued ID in your profile settings.'
  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <img src="https://drape.app/logo.png" alt="Drape" width="80" style="margin:32px 0 16px"/>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 8px">${headline}</h1>
  <p style="color:#555;line-height:1.6">Hi ${displayName},</p>
  <p style="color:#555;line-height:1.6">${body}</p>
  <a href="https://drape.app" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#2d6a4f;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open Drape</a>
  <p style="margin-top:32px;font-size:12px;color:#aaa">© Drape Ltd.</p>
</div>`
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
          'Welcome to Drape',
          welcomeEmail(user.display_name ?? 'there', user.role ?? 'CUSTOMER'),
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
          .from('users').select('email, display_name').eq('id', order.customer_id).single()
        if (customer?.email) {
          await sendEmail(
            customer.email,
            `Payment confirmed — Order #${order.reference}`,
            paymentReceiptEmail(
              customer.display_name ?? 'there',
              order.reference ?? order.id.slice(0, 8).toUpperCase(),
              order.quoted_amount ?? 0,
              order.currency ?? 'GBP',
            ),
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
        .from('tailor_profiles').select('user_id').eq('id', order.tailor_profile_id).single()

      const [{ data: customer }, { data: tailor }] = await Promise.all([
        supabase.from('users').select('email, display_name').eq('id', order.customer_id).single(),
        tailorProfile
          ? supabase.from('users').select('email, display_name').eq('id', tailorProfile.user_id).single()
          : Promise.resolve({ data: null }),
      ])

      const ref = order.reference ?? order.order_id?.slice(0, 8).toUpperCase() ?? ''

      if (customer?.email) {
        await sendEmail(
          customer.email,
          `Dispute opened — Order #${ref}`,
          disputeOpenedEmail(customer.display_name ?? 'there', ref, true),
        )
      }
      if (tailor?.email) {
        await sendEmail(
          tailor.email,
          `Dispute opened on your order #${ref}`,
          disputeOpenedEmail(tailor.display_name ?? 'there', ref, false),
        )
      }
      return new Response('ok')
    }

    // ── Dispute UPDATE — resolved ─────────────────────────────────────────────
    if (table === 'disputes' && type === 'UPDATE') {
      const dispute = record
      const prevStatus = old_record?.status
      if (dispute.status === prevStatus) return new Response('ok')

      const isResolved = dispute.status === 'RESOLVED_REFUNDED' || dispute.status === 'RESOLVED_RELEASED'
      if (!isResolved) return new Response('ok')

      const refunded = dispute.status === 'RESOLVED_REFUNDED'

      const { data: order } = await supabase
        .from('orders')
        .select('customer_id, tailor_profile_id, reference')
        .eq('id', dispute.order_id)
        .single()
      if (!order) return new Response('ok')

      const { data: tailorProfile } = await supabase
        .from('tailor_profiles').select('user_id').eq('id', order.tailor_profile_id).single()

      const [{ data: customer }, { data: tailor }] = await Promise.all([
        supabase.from('users').select('email, display_name').eq('id', order.customer_id).single(),
        tailorProfile
          ? supabase.from('users').select('email, display_name').eq('id', tailorProfile.user_id).single()
          : Promise.resolve({ data: null }),
      ])

      const ref = order.reference ?? ''

      if (customer?.email) {
        await sendEmail(
          customer.email,
          `Dispute resolved — Order #${ref}`,
          disputeResolvedEmail(customer.display_name ?? 'there', ref, dispute.resolution ?? '', refunded),
        )
      }
      if (tailor?.email) {
        await sendEmail(
          tailor.email,
          `Dispute resolved — Order #${ref}`,
          disputeResolvedEmail(tailor.display_name ?? 'there', ref, dispute.resolution ?? '', refunded),
        )
      }
      return new Response('ok')
    }

    // ── Tailor profile UPDATE — ID verification status changed ────────────────
    if (table === 'tailor_profiles' && type === 'UPDATE') {
      const profile = record
      const prevVerified = old_record?.id_verified_at
      const nowVerified = profile.id_verified_at

      // Only fire when id_verified_at transitions (null → value = approved, value → null = rejected)
      if (prevVerified === nowVerified) return new Response('ok')

      const approved = !!nowVerified && !prevVerified
      const rejected = !nowVerified && !!prevVerified

      if (!approved && !rejected) return new Response('ok')

      const { data: user } = await supabase
        .from('users').select('email, display_name').eq('id', profile.user_id).single()
      if (user?.email) {
        await sendEmail(
          user.email,
          approved ? 'Your ID has been verified — Drape' : 'ID verification — action needed',
          idVerifiedEmail(user.display_name ?? 'there', approved),
        )
      }
      return new Response('ok')
    }

    return new Response('ok')
  } catch (err) {
    console.error('send-email error:', err)
    return new Response('error', { status: 500 })
  }
})
