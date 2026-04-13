import 'server-only'

import { CONTACTS } from '@drape/shared'

const RESEND_API = 'https://api.resend.com/emails'

type WaitlistRole = 'CUSTOMER' | 'TAILOR'
type WaitlistNotificationMode = 'created' | 'updated'
type TailorApplicationNotificationMode = 'created' | 'updated'

type WaitlistLeadNotificationInput = {
  mode: WaitlistNotificationMode
  role: WaitlistRole
  name: string
  email: string
  location: string | null
  specialty: string | null
  notes: string | null
  source: string
  createdAt: string | null
}

type NotificationResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: 'missing-api-key' | 'missing-recipients' }
  | { ok: false; skipped: false; reason: 'send-failed' }

type TailorApplicationNotificationInput = {
  mode: TailorApplicationNotificationMode
  businessName: string
  displayName: string
  email: string
  location: string
  specialty: string
  portfolioUrl: string | null
  instagramUrl: string | null
  notes: string
  source: string
  status: string
  createdAt: string | null
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatValue(value: string | null) {
  if (!value) return '—'
  return escapeHtml(value)
}

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

function getWaitlistRecipients(role: WaitlistRole) {
  const roleSpecificEnv =
    role === 'TAILOR'
      ? process.env.WAITLIST_TAILOR_NOTIFICATION_EMAILS
      : process.env.WAITLIST_CUSTOMER_NOTIFICATION_EMAILS

  const roleSpecific = parseEmailList(roleSpecificEnv)
  if (roleSpecific.length) return roleSpecific

  const sharedRecipients = parseEmailList(process.env.WAITLIST_NOTIFICATION_EMAILS)
  if (sharedRecipients.length) return sharedRecipients

  return role === 'TAILOR'
    ? [CONTACTS.tailors, CONTACTS.ops]
    : [CONTACTS.support, CONTACTS.ops]
}

function getLeadNotificationFrom() {
  return process.env.RESEND_FROM ?? `Drape Leads <${CONTACTS.noreply}>`
}

async function sendLeadEmail(args: {
  recipients: string[]
  subject: string
  html: string
  text: string
  context: Record<string, unknown>
}): Promise<NotificationResult> {
  const apiKey = process.env.RESEND_API_KEY ?? null
  if (!apiKey) {
    console.warn('[lead notification] Missing RESEND_API_KEY; skipping lead email.', args.context)
    return { ok: false, skipped: true, reason: 'missing-api-key' }
  }

  if (!args.recipients.length) {
    console.warn('[lead notification] No recipients configured; skipping lead email.', args.context)
    return { ok: false, skipped: true, reason: 'missing-recipients' }
  }

  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getLeadNotificationFrom(),
      to: args.recipients,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('[lead notification] Resend request failed', {
      ...args.context,
      status: response.status,
      body,
    })
    return { ok: false, skipped: false, reason: 'send-failed' }
  }

  return { ok: true }
}

function buildWaitlistSubject(input: WaitlistLeadNotificationInput) {
  const prefix = input.mode === 'created' ? 'New' : 'Updated'
  const queue = input.role === 'TAILOR' ? 'tailor waitlist signup' : 'customer waitlist signup'
  return `${prefix} ${queue}: ${input.name}`
}

function buildWaitlistText(input: WaitlistLeadNotificationInput) {
  return [
    input.mode === 'created' ? 'New Drape waitlist signup' : 'Updated Drape waitlist signup',
    '',
    `Role: ${input.role}`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Location: ${input.location ?? '—'}`,
    `Specialty: ${input.specialty ?? '—'}`,
    `Notes: ${input.notes ?? '—'}`,
    `Source: ${input.source}`,
    `Submitted at: ${input.createdAt ?? '—'}`,
  ].join('\n')
}

function buildWaitlistHtml(input: WaitlistLeadNotificationInput) {
  const heading = input.mode === 'created' ? 'New waitlist signup' : 'Updated waitlist signup'

  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <p style="margin:0 0 8px;color:#2d6a4f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Drape waitlist</p>
  <h1 style="margin:0 0 16px;font-size:28px;line-height:1.1">${heading}</h1>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;color:#666">Role</td><td style="padding:8px 0;font-weight:600">${escapeHtml(input.role)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Name</td><td style="padding:8px 0;font-weight:600">${escapeHtml(input.name)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0"><a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a></td></tr>
    <tr><td style="padding:8px 0;color:#666">Location</td><td style="padding:8px 0">${formatValue(input.location)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Specialty</td><td style="padding:8px 0">${formatValue(input.specialty)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Notes</td><td style="padding:8px 0;white-space:pre-wrap">${formatValue(input.notes)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Source</td><td style="padding:8px 0">${escapeHtml(input.source)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Submitted at</td><td style="padding:8px 0">${formatValue(input.createdAt)}</td></tr>
  </table>
</div>`.trim()
}

export async function sendWaitlistSignupNotification(
  input: WaitlistLeadNotificationInput,
): Promise<NotificationResult> {
  const recipients = getWaitlistRecipients(input.role)
  return sendLeadEmail({
    recipients,
    subject: buildWaitlistSubject(input),
    html: buildWaitlistHtml(input),
    text: buildWaitlistText(input),
    context: {
      kind: 'waitlist',
      role: input.role,
      email: input.email,
    },
  })
}

function getTailorApplicationRecipients() {
  const roleSpecific = parseEmailList(process.env.TAILOR_APPLICATION_NOTIFICATION_EMAILS)
  if (roleSpecific.length) return roleSpecific

  const sharedRecipients = parseEmailList(process.env.WAITLIST_TAILOR_NOTIFICATION_EMAILS)
  if (sharedRecipients.length) return sharedRecipients

  return [CONTACTS.tailors, CONTACTS.ops]
}

function buildTailorApplicationSubject(input: TailorApplicationNotificationInput) {
  const prefix = input.mode === 'created' ? 'New' : 'Updated'
  return `${prefix} tailor application: ${input.businessName}`
}

function buildTailorApplicationText(input: TailorApplicationNotificationInput) {
  return [
    input.mode === 'created' ? 'New Drape tailor application' : 'Updated Drape tailor application',
    '',
    `Business: ${input.businessName}`,
    `Display name: ${input.displayName}`,
    `Email: ${input.email}`,
    `Location: ${input.location}`,
    `Specialty: ${input.specialty}`,
    `Portfolio: ${input.portfolioUrl ?? '—'}`,
    `Instagram: ${input.instagramUrl ?? '—'}`,
    `Notes: ${input.notes}`,
    `Source: ${input.source}`,
    `Status: ${input.status}`,
    `Submitted at: ${input.createdAt ?? '—'}`,
  ].join('\n')
}

function buildLinkRow(label: string, value: string | null) {
  if (!value) {
    return `<tr><td style="padding:8px 0;color:#666">${escapeHtml(label)}</td><td style="padding:8px 0">—</td></tr>`
  }

  const escapedValue = escapeHtml(value)
  return `<tr><td style="padding:8px 0;color:#666">${escapeHtml(label)}</td><td style="padding:8px 0"><a href="${escapedValue}">${escapedValue}</a></td></tr>`
}

function buildTailorApplicationHtml(input: TailorApplicationNotificationInput) {
  const heading = input.mode === 'created' ? 'New tailor application' : 'Updated tailor application'

  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <p style="margin:0 0 8px;color:#2d6a4f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Drape applications</p>
  <h1 style="margin:0 0 16px;font-size:28px;line-height:1.1">${heading}</h1>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;color:#666">Business</td><td style="padding:8px 0;font-weight:600">${escapeHtml(input.businessName)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Display name</td><td style="padding:8px 0">${escapeHtml(input.displayName)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0"><a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a></td></tr>
    <tr><td style="padding:8px 0;color:#666">Location</td><td style="padding:8px 0">${escapeHtml(input.location)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Specialty</td><td style="padding:8px 0">${escapeHtml(input.specialty)}</td></tr>
    ${buildLinkRow('Portfolio', input.portfolioUrl)}
    ${buildLinkRow('Instagram', input.instagramUrl)}
    <tr><td style="padding:8px 0;color:#666">Notes</td><td style="padding:8px 0;white-space:pre-wrap">${escapeHtml(input.notes)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Source</td><td style="padding:8px 0">${escapeHtml(input.source)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Status</td><td style="padding:8px 0">${escapeHtml(input.status)}</td></tr>
    <tr><td style="padding:8px 0;color:#666">Submitted at</td><td style="padding:8px 0">${formatValue(input.createdAt)}</td></tr>
  </table>
</div>`.trim()
}

export async function sendTailorApplicationNotification(
  input: TailorApplicationNotificationInput,
): Promise<NotificationResult> {
  return sendLeadEmail({
    recipients: getTailorApplicationRecipients(),
    subject: buildTailorApplicationSubject(input),
    html: buildTailorApplicationHtml(input),
    text: buildTailorApplicationText(input),
    context: {
      kind: 'tailor-application',
      email: input.email,
      businessName: input.businessName,
    },
  })
}
