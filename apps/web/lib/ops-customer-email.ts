import 'server-only'

import { CONTACTS } from '@drape/shared'

const RESEND_API = 'https://api.resend.com/emails'

function getResendFrom() {
  return process.env.RESEND_FROM ?? `Drape Support <${CONTACTS.noreply}>`
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
  to: string
  customerName: string
  orderReference: string
  amount: number
  currency: string
  reason: string
  partial: boolean
}) {
  const apiKey = process.env.RESEND_API_KEY ?? null
  if (!apiKey) {
    console.warn('[ops customer email] Missing RESEND_API_KEY; skipping refund email.', {
      orderReference: input.orderReference,
    })
    return { ok: false as const, skipped: true as const }
  }

  const subject = input.partial
    ? `A partial refund was issued for order #${input.orderReference}`
    : `A refund was issued for order #${input.orderReference}`
  const amount = formatMoney(input.amount, input.currency)
  const html = `
    <div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#2c2c2a">
      <p style="margin:0 0 10px;color:#1d9e75;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Drape support</p>
      <h1 style="margin:0 0 14px;font-size:30px;line-height:1.1">${escapeHtml(input.partial ? 'Your partial refund is on the way' : 'Your refund is on the way')}</h1>
      <p style="margin:0 0 16px;font:16px/1.7 Calibri,Arial,sans-serif;color:#4a4a47">Hi ${escapeHtml(input.customerName)},</p>
      <p style="margin:0 0 16px;font:16px/1.7 Calibri,Arial,sans-serif;color:#4a4a47">
        Drape has ${escapeHtml(input.partial ? 'issued a partial refund' : 'issued a refund')} for order <strong>#${escapeHtml(input.orderReference)}</strong>.
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
        `Drape has ${input.partial ? 'issued a partial refund' : 'issued a refund'} for order #${input.orderReference}.`,
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
