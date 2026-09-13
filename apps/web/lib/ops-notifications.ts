import 'server-only'

import { CONTACTS } from '@drape/shared'
import { createServiceRoleClient } from './server-supabase'
import { sendOpsWebPush } from './web-push-server'

const RESEND_API = 'https://api.resend.com/emails'

function parseEmailList(value: string | undefined) {
  if (!value) return []

  const seen = new Set<string>()
  const emails: string[] = []

  for (const raw of value.split(',')) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }

  return emails
}

function getOpsRecipients() {
  const configured = parseEmailList(process.env.OPS_NOTIFICATION_EMAILS)
  if (configured.length > 0) return configured
  return [CONTACTS.ops]
}

function getOpsNotificationFrom() {
  return process.env.RESEND_FROM ?? `Drapeon Ops <${CONTACTS.noreply}>`
}

function getMoneyApproverRecipients() {
  const configured = parseEmailList(process.env.OPS_MONEY_APPROVER_EMAILS)
  return configured.length > 0 ? configured : ['founders@drapeon.co']
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

type CriticalOpsIssueEmailInput = {
  issueNumber: number
  issueType: string
  severity: string
  title: string
  description: string
  recommendedAction: string
  source: string
  orderId?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  provider?: string | null
  stage?: string | null
}

export async function sendCriticalOpsIssueEmail(input: CriticalOpsIssueEmailInput) {
  const webPushPromise = (async () => {
    const client = createServiceRoleClient()
    if (!client) return null
    return sendOpsWebPush(client)
  })().catch(() => {
    console.warn('[ops notification] Critical issue web push skipped.', {
      issueType: input.issueType,
      issueNumber: input.issueNumber,
    })
    return null
  })

  const apiKey = process.env.RESEND_API_KEY ?? null
  if (!apiKey) {
    console.warn('[ops notification] Missing RESEND_API_KEY; skipping critical issue email.', {
      issueType: input.issueType,
      issueNumber: input.issueNumber,
    })
    await webPushPromise
    return { ok: false as const, skipped: true as const }
  }

  const recipients = getOpsRecipients()
  if (recipients.length === 0) {
    console.warn('[ops notification] No recipients configured; skipping critical issue email.', {
      issueType: input.issueType,
      issueNumber: input.issueNumber,
    })
    await webPushPromise
    return { ok: false as const, skipped: true as const }
  }

  const subject = `Critical ops issue ${String(input.issueNumber).padStart(4, '0')}: ${input.title}`
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2c2c2a">
      <p style="margin:0 0 10px;color:#d85a30;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Critical ops issue</p>
      <h1 style="margin:0 0 14px;font-size:30px;line-height:1.1">${escapeHtml(input.title)}</h1>
      <p style="margin:0 0 20px;font:16px/1.7 Calibri,Arial,sans-serif;color:#4a4a47">${escapeHtml(input.description)}</p>
      <table style="width:100%;border-collapse:collapse;font:15px/1.6 Calibri,Arial,sans-serif">
        <tr><td style="padding:6px 0;color:#888780">Issue</td><td style="padding:6px 0;font-weight:600">#${String(input.issueNumber).padStart(4, '0')}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Type</td><td style="padding:6px 0">${escapeHtml(input.issueType)}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Severity</td><td style="padding:6px 0">${escapeHtml(input.severity)}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Source</td><td style="padding:6px 0">${escapeHtml(input.source)}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Order</td><td style="padding:6px 0">${escapeHtml(input.orderId ?? '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Related entity</td><td style="padding:6px 0">${escapeHtml(input.relatedEntityType && input.relatedEntityId ? `${input.relatedEntityType}:${input.relatedEntityId}` : '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Provider</td><td style="padding:6px 0">${escapeHtml(input.provider ?? '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#888780">Stage</td><td style="padding:6px 0">${escapeHtml(input.stage ?? '—')}</td></tr>
      </table>
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#e1f5ee;font:15px/1.7 Calibri,Arial,sans-serif">
        <strong style="display:block;margin-bottom:8px;color:#2d6a4f">Recommended action</strong>
        ${escapeHtml(input.recommendedAction)}
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
      from: getOpsNotificationFrom(),
      to: recipients,
      subject,
      html,
      text: [
        `Critical ops issue #${String(input.issueNumber).padStart(4, '0')}`,
        '',
        `Title: ${input.title}`,
        `Type: ${input.issueType}`,
        `Severity: ${input.severity}`,
        `Source: ${input.source}`,
        `Order: ${input.orderId ?? '—'}`,
        `Related entity: ${input.relatedEntityType && input.relatedEntityId ? `${input.relatedEntityType}:${input.relatedEntityId}` : '—'}`,
        `Provider: ${input.provider ?? '—'}`,
        `Stage: ${input.stage ?? '—'}`,
        '',
        `Description: ${input.description}`,
        '',
        `Recommended action: ${input.recommendedAction}`,
      ].join('\n'),
    }),
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    console.error('[ops notification] Failed to send critical issue email.', {
      issueType: input.issueType,
      issueNumber: input.issueNumber,
      status: response.status,
    })
    await webPushPromise
    return { ok: false as const, skipped: false as const }
  }

  await webPushPromise
  return { ok: true as const, skipped: false as const }
}

type MoneyApprovalRequiredEmailInput = {
  requestId: string
  reference: string
  actionLabel: string
  riskLevel: string
  preparedBy: string
  reason: string
}

export async function sendMoneyApprovalRequiredEmail(input: MoneyApprovalRequiredEmailInput) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) return { ok: false as const, skipped: true as const }
  const recipients = getMoneyApproverRecipients()
  if (recipients.length === 0) return { ok: false as const, skipped: true as const }

  const opsBaseUrl = (process.env.OPS_WEB_BASE_URL ?? process.env.NEXT_PUBLIC_OPS_URL ?? 'https://ops.drapeon.co').replace(/\/+$/u, '')
  const actionUrl = `${opsBaseUrl}/ops/money?view=approval#money-${encodeURIComponent(input.requestId)}`
  const subject = `Founder approval needed · ${input.reference}`
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `money-approval:${input.requestId}`,
    },
    body: JSON.stringify({
      from: getOpsNotificationFrom(),
      to: recipients,
      subject,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#17211c"><p style="color:#287253;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Money Desk · founder action required</p><h1 style="font-family:Georgia,serif">${escapeHtml(input.actionLabel)}</h1><p>A protected Money Desk request is waiting for your decision.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:6px 0;color:#777">Request</td><td style="padding:6px 0;font-weight:700">${escapeHtml(input.reference)}</td></tr><tr><td style="padding:6px 0;color:#777">Risk</td><td style="padding:6px 0">${escapeHtml(input.riskLevel)}</td></tr><tr><td style="padding:6px 0;color:#777">Prepared by</td><td style="padding:6px 0">${escapeHtml(input.preparedBy)}</td></tr></table><p style="font-size:15px;line-height:1.6">${escapeHtml(input.reason)}</p><p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;border-radius:999px;background:#287253;color:white;padding:12px 20px;text-decoration:none;font-weight:700">Review in Money Desk</a></p><p style="color:#777;font-size:13px">Sign in with the configured founder account. No payout credentials or bank details are included in this email.</p></div>`,
      text: `Founder action required\n\n${input.actionLabel}\nRequest: ${input.reference}\nRisk: ${input.riskLevel}\nPrepared by: ${input.preparedBy}\n\n${input.reason}\n\nReview in Money Desk: ${actionUrl}`,
    }),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return { ok: false as const, skipped: false as const }
  }
  const payload = await response.json().catch(() => ({})) as { id?: unknown }
  return { ok: true as const, skipped: false as const, deliveryId: typeof payload.id === 'string' ? payload.id : null }
}
