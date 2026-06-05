import 'server-only'

import { CONTACTS } from '@drape/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

const RESEND_API = 'https://api.resend.com/emails'

type RefundEmailOrderContext = {
  id: string
  reference: string | null
  order_kind?: string | null
  customer_id?: string | null
  tailor_id?: string | null
  garment_type?: string | null
  item_title?: string | null
  item_size?: string | null
  delivery_method?: string | null
  currency?: string | null
}

function getResendFrom() {
  return process.env.RESEND_FROM ?? `Drapeon Support <${CONTACTS.noreply}>`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.trim().toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amountMinor / 100)
  } catch {
    return `${currency.toUpperCase()} ${(amountMinor / 100).toFixed(2)}`
  }
}

export async function sendOpsCustomerRefundEmail(input: {
  client?: SupabaseClient
  order?: RefundEmailOrderContext
  idempotencyKey?: string
  to: string
  customerUserId?: string | null
  customerName: string
  orderReference: string
  amount: number
  currency: string
  reason: string
  partial: boolean
}) {
  const subject = input.partial
    ? `A partial refund was issued for order #${input.orderReference}`
    : `A refund was issued for order #${input.orderReference}`
  const amount = formatMoney(input.amount, input.currency)
  const bodyLines = [
    `Drapeon has ${input.partial ? 'issued a partial refund' : 'issued a refund'} for order #${input.orderReference}.`,
    `Amount: ${amount}`,
    `Reason: ${input.reason}`,
    'Refund timing depends on your bank or card provider.',
  ]

  if (input.client && input.order?.id && input.customerUserId && input.idempotencyKey) {
    const { error } = await input.client.rpc('enqueue_domain_event', {
      p_event_type: 'ops.customer_refund_email_requested',
      p_aggregate_type: 'order',
      p_idempotency_key: input.idempotencyKey,
      p_payload: {
        order: {
          id: input.order.id,
          reference: input.order.reference,
          order_kind: input.order.order_kind ?? null,
          customer_id: input.order.customer_id ?? input.customerUserId,
          tailor_id: input.order.tailor_id ?? null,
          garment_type: input.order.garment_type ?? null,
          item_title: input.order.item_title ?? null,
          item_size: input.order.item_size ?? null,
          delivery_method: input.order.delivery_method ?? null,
          currency: input.order.currency ?? input.currency,
        },
        recipientUserId: input.customerUserId,
        audience: 'CUSTOMER',
        subject,
        headline: input.partial ? 'Your partial refund is on the way' : 'Your refund is on the way',
        body: bodyLines.join(' '),
        ctaLabel: 'View order',
        evidenceImageUrl: null,
      },
      p_aggregate_id: input.order.id,
      p_actor_id: null,
      p_actor_role: 'OPS',
      p_order_id: input.order.id,
      p_metadata: { source: 'ops-web', order_reference: input.orderReference },
      p_jobs: ['SEND_ORDER_EVENT_EMAIL'],
      p_priority: 20,
      p_max_attempts: 8,
      p_run_at: new Date().toISOString(),
    })

    if (!error) {
      return { ok: true as const, skipped: false as const, queued: true as const }
    }

    console.error('[ops customer email] Failed to enqueue refund email.', {
      orderReference: input.orderReference,
      error: error.message,
    })
  }

  const apiKey = process.env.RESEND_API_KEY ?? null
  if (!apiKey) {
    console.warn('[ops customer email] Missing RESEND_API_KEY and queue fallback was unavailable; skipping refund email.', {
      orderReference: input.orderReference,
    })
    return { ok: false as const, skipped: true as const, queued: false as const }
  }

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2c2c2a">
      <p style="margin:0 0 10px;color:#2d6a4f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Drapeon support</p>
      <h1 style="margin:0 0 14px;font-size:30px;line-height:1.1">${escapeHtml(input.partial ? 'Your partial refund is on the way' : 'Your refund is on the way')}</h1>
      <p style="margin:0 0 16px;font:16px/1.7 Calibri,Arial,sans-serif;color:#4a4a47">Hi ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 16px;font:16px/1.7 Calibri,Arial,sans-serif;color:#4a4a47">
        Drapeon has ${escapeHtml(input.partial ? 'issued a partial refund' : 'issued a refund')} for order <strong>#${escapeHtml(input.orderReference)}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;font:15px/1.6 Calibri,Arial,sans-serif">
        <tr><td style="padding:6px 0;color:#888780">Order</td><td style="padding:6px 0;font-weight:600">#${escapeHtml(input.orderReference)}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Amount</td><td style="padding:6px 0;font-weight:600">${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Reason</td><td style="padding:6px 0">${escapeHtml(input.reason)}</td></tr>
      </table>
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#f9f7f3;font:15px/1.7 Calibri,Arial,sans-serif">
        Refund timing depends on your bank or card provider. If you need help, reply to support at ${escapeHtml(CONTACTS.support)}.
      </div>
    </div>
  `.trim()

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [input.to],
      subject,
      html,
      text: [
        `Hi ${input.customerName},`,
        '',
        `Drapeon has ${input.partial ? 'issued a partial refund' : 'issued a refund'} for order #${input.orderReference}.`,
        `Amount: ${amount}`,
        `Reason: ${input.reason}`,
        '',
        `Refund timing depends on your bank or card provider. For help, contact ${CONTACTS.support}.`,
      ].join('\n'),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('[ops customer email] Failed to send refund email.', {
      orderReference: input.orderReference,
      status: response.status,
      body,
    })
    return { ok: false as const, skipped: false as const }
  }

  return { ok: true as const, skipped: false as const }
}
