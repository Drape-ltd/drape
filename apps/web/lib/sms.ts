import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneForStorage } from '@drape/shared/phone'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

type SmsAudience = 'CUSTOMER' | 'TAILOR'

type SendSmsToUserInput = {
  client: SupabaseClient
  userId: string | null | undefined
  audience: SmsAudience
  orderId?: string | null
  event: string
  body: string
  fallbackPhone?: string | null
}

function getTwilioAccountSid() {
  return process.env.TWILIO_ACCOUNT_SID?.trim() ?? ''
}

function getTwilioAuthToken() {
  return process.env.TWILIO_AUTH_TOKEN?.trim() ?? ''
}

function getTwilioFromNumber() {
  return process.env.TWILIO_FROM_NUMBER?.trim() ?? ''
}

function hasSmsConfig() {
  return !!(getTwilioAccountSid() && getTwilioAuthToken() && getTwilioFromNumber())
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D+/g, '')
  if (digits.length <= 4) return phone
  return `${phone.slice(0, Math.max(0, phone.length - 4)).replace(/[0-9]/g, '•')}${phone.slice(-4)}`
}

function toSmsE164(value: string | null | undefined) {
  const normalized = normalizePhoneForStorage(value ?? '')
  if (!normalized) return null

  if (normalized.startsWith('+')) return normalized

  const digits = normalized.replace(/\D+/g, '')
  if (!digits) return null

  if (/^0[789]\d{9}$/.test(digits)) {
    return `+234${digits.slice(1)}`
  }

  if (/^234[789]\d{9}$/.test(digits)) {
    return `+${digits}`
  }

  if (!digits.startsWith('0') && digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`
  }

  return null
}

async function auditSms(
  client: SupabaseClient,
  event: 'notification.sms_sent' | 'notification.sms_failed' | 'notification.sms_skipped',
  input: {
    userId: string
    audience: SmsAudience
    orderId?: string | null
    payload: Record<string, unknown>
    severity?: 'info' | 'warn' | 'error'
  },
) {
  await client.from('audit_logs').insert({
    actor_id: input.userId,
    actor_role: input.audience,
    order_id: input.orderId ?? null,
    event,
    severity: input.severity ?? (event === 'notification.sms_sent' ? 'info' : 'warn'),
    payload: input.payload,
  })
}

async function lookupPhoneFromAuthMetadata(client: SupabaseClient, userId: string) {
  const { data, error } = await client.auth.admin.getUserById(userId)
  if (error) return null

  const phone = data.user?.user_metadata?.phone
  return typeof phone === 'string' ? phone.trim() : null
}

async function lookupCustomerPhone(client: SupabaseClient, userId: string) {
  const { data } = await client
    .from('customer_profiles')
    .select('phone')
    .eq('user_id', userId)
    .maybeSingle()

  const profilePhone = typeof data?.phone === 'string' ? data.phone.trim() : ''
  if (profilePhone) return profilePhone
  return await lookupPhoneFromAuthMetadata(client, userId)
}

async function resolveUserPhone(client: SupabaseClient, audience: SmsAudience, userId: string) {
  return audience === 'CUSTOMER'
    ? await lookupCustomerPhone(client, userId)
    : await lookupPhoneFromAuthMetadata(client, userId)
}

async function sendSmsDirect(to: string, body: string) {
  const sid = getTwilioAccountSid()
  const token = getTwilioAuthToken()
  const from = getTwilioFromNumber()
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: from,
      Body: body,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : `Twilio request failed with status ${response.status}`
    throw new Error(message)
  }

  return {
    sid: typeof payload?.sid === 'string' ? payload.sid : null,
  }
}

export async function sendSmsToUser(input: SendSmsToUserInput) {
  const { client, userId, audience, orderId, event, body, fallbackPhone } = input

  if (!userId || !body.trim()) return
  if (!hasSmsConfig()) return

  const phoneCandidate = fallbackPhone?.trim() || await resolveUserPhone(client, audience, userId)
  const destination = toSmsE164(phoneCandidate)

  if (!destination) {
    await auditSms(client, 'notification.sms_skipped', {
      userId,
      audience,
      orderId,
      payload: {
        channel: 'sms',
        notification_event: event,
        reason: 'missing_phone',
      },
    })
    return
  }

  try {
    const result = await sendSmsDirect(destination, body)
    await auditSms(client, 'notification.sms_sent', {
      userId,
      audience,
      orderId,
      payload: {
        channel: 'sms',
        notification_event: event,
        provider: 'TWILIO',
        destination: maskPhone(destination),
        provider_sid: result.sid,
      },
    })
  } catch (error) {
    await auditSms(client, 'notification.sms_failed', {
      userId,
      audience,
      orderId,
      payload: {
        channel: 'sms',
        notification_event: event,
        provider: 'TWILIO',
        destination: maskPhone(destination),
        error: error instanceof Error ? error.message : String(error),
      },
      severity: 'warn',
    })
  }
}
