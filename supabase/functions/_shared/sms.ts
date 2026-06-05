import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { audit, log } from './logger.ts'
import { normalizeStoredPhone } from './phone.ts'

const FN = 'sms'
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'
const TERMII_API_BASE = 'https://api.ng.termii.com/api'

type SmsAudience = 'CUSTOMER' | 'TAILOR'

type SendSmsToUserInput = {
  supabase: SupabaseClient
  userId: string | null | undefined
  audience: SmsAudience
  orderId?: string | null
  event: string
  body: string
  fallbackPhone?: string | null
}

function getTwilioAccountSid() {
  return Deno.env.get('TWILIO_ACCOUNT_SID')?.trim() ?? ''
}

function getTwilioAuthToken() {
  return Deno.env.get('TWILIO_AUTH_TOKEN')?.trim() ?? ''
}

function getTwilioFromNumber() {
  return Deno.env.get('TWILIO_FROM_NUMBER')?.trim() ?? ''
}

function getTermiiApiKey() {
  return Deno.env.get('TERMII_API_KEY')?.trim() ?? ''
}

function getTermiiSenderId() {
  return (
    Deno.env.get('TERMII_SENDER_ID') ??
    Deno.env.get('TERMII_FROM') ??
    'Drape'
  ).trim()
}

function getTermiiChannel() {
  return (Deno.env.get('TERMII_CHANNEL') ?? 'generic').trim().toLowerCase()
}

function getTermiiMessageType() {
  return (Deno.env.get('TERMII_MESSAGE_TYPE') ?? 'plain').trim().toLowerCase()
}

function getTermiiBaseUrl() {
  return (Deno.env.get('TERMII_API_BASE_URL') ?? TERMII_API_BASE).replace(/\/+$/u, '')
}

export type SmsProvider = 'TERMII' | 'TWILIO' | 'NONE'

export function getSmsProvider(): SmsProvider {
  const configured = Deno.env.get('SMS_PROVIDER')?.trim().toLowerCase()
  if (configured === 'termii') return 'TERMII'
  if (configured === 'twilio') return 'TWILIO'
  if (configured === 'none' || configured === 'off' || configured === 'disabled') return 'NONE'
  if (getTermiiApiKey()) return 'TERMII'
  if (getTwilioAccountSid() && getTwilioAuthToken() && getTwilioFromNumber()) return 'TWILIO'
  return 'NONE'
}

export function hasSmsConfig(provider = getSmsProvider()) {
  if (provider === 'TERMII') return !!(getTermiiApiKey() && getTermiiSenderId())
  if (provider === 'TWILIO') return !!(getTwilioAccountSid() && getTwilioAuthToken() && getTwilioFromNumber())
  return false
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D+/g, '')
  if (digits.length <= 4) return phone
  return `${phone.slice(0, Math.max(0, phone.length - 4)).replace(/[0-9]/g, '•')}${phone.slice(-4)}`
}

function toSmsE164(value: string | null | undefined) {
  const normalized = normalizeStoredPhone(value)
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

async function lookupPhoneFromAuthMetadata(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) {
    log('warn', FN, 'auth.lookup_failed', { user_id: userId, error: error.message })
    return null
  }

  const phone = data.user?.user_metadata?.phone
  return typeof phone === 'string' ? phone.trim() : null
}

async function lookupCustomerPhone(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('phone')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    log('warn', FN, 'customer_profile.lookup_failed', { user_id: userId, error: error.message })
  }

  const profilePhone = typeof data?.phone === 'string' ? data.phone.trim() : ''
  if (profilePhone) return profilePhone
  return await lookupPhoneFromAuthMetadata(supabase, userId)
}

async function lookupTailorPhone(supabase: SupabaseClient, userId: string) {
  return await lookupPhoneFromAuthMetadata(supabase, userId)
}

async function resolveUserPhone(supabase: SupabaseClient, audience: SmsAudience, userId: string) {
  return audience === 'CUSTOMER'
    ? await lookupCustomerPhone(supabase, userId)
    : await lookupTailorPhone(supabase, userId)
}

function toTermiiPhone(value: string) {
  return value.replace(/^\+/u, '')
}

async function sendTwilioSmsDirect(to: string, body: string) {
  const sid = getTwilioAccountSid()
  const token = getTwilioAuthToken()
  const from = getTwilioFromNumber()
  const auth = btoa(`${sid}:${token}`)
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

  const sidValue = typeof payload?.sid === 'string' ? payload.sid : null
  return { sid: sidValue }
}

async function sendTermiiSmsDirect(to: string, body: string) {
  const response = await fetch(`${getTermiiBaseUrl()}/sms/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'drape-termii-sms/1.0',
    },
    body: JSON.stringify({
      api_key: getTermiiApiKey(),
      to: toTermiiPhone(to),
      from: getTermiiSenderId(),
      sms: body,
      type: getTermiiMessageType(),
      channel: getTermiiChannel(),
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : `Termii request failed with status ${response.status}`
    throw new Error(message)
  }

  const providerId =
    typeof payload?.message_id === 'string'
      ? payload.message_id
      : typeof payload?.sms_id === 'string'
        ? payload.sms_id
        : typeof payload?.id === 'string'
          ? payload.id
          : null
  return { sid: providerId }
}

export async function sendSmsDirect(to: string, body: string) {
  const provider = getSmsProvider()
  if (!hasSmsConfig(provider)) {
    throw new Error('SMS provider is not configured.')
  }

  if (provider === 'TERMII') {
    return { provider, ...(await sendTermiiSmsDirect(to, body)) }
  }

  if (provider === 'TWILIO') {
    return { provider, ...(await sendTwilioSmsDirect(to, body)) }
  }

  throw new Error('SMS provider is disabled.')
}

export async function sendSmsToUser(input: SendSmsToUserInput) {
  const { supabase, userId, audience, orderId, event, body, fallbackPhone } = input

  if (!userId || !body.trim()) return

  const provider = getSmsProvider()
  if (!hasSmsConfig(provider)) {
    await audit(supabase, {
      event: 'notification.sms_skipped',
      actor_id: userId,
      actor_role: audience,
      order_id: orderId ?? null,
      severity: 'warn',
      payload: {
        channel: 'sms',
        notification_event: event,
        provider,
        reason: provider === 'NONE' ? 'sms_disabled' : 'missing_provider_config',
      },
    })
    return
  }

  const phoneCandidate = fallbackPhone?.trim() || await resolveUserPhone(supabase, audience, userId)
  const destination = toSmsE164(phoneCandidate)

  if (!destination) {
    await audit(supabase, {
      event: 'notification.sms_skipped',
      actor_id: userId,
      actor_role: audience,
      order_id: orderId ?? null,
      severity: 'warn',
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
    await audit(supabase, {
      event: 'notification.sms_sent',
      actor_id: userId,
      actor_role: audience,
      order_id: orderId ?? null,
      payload: {
        channel: 'sms',
        notification_event: event,
        provider: result.provider,
        destination: maskPhone(destination),
        provider_sid: result.sid,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('warn', FN, 'send.failed', {
      event,
      order_id: orderId ?? null,
      audience,
      user_id: userId,
      error: message,
    })
    await audit(supabase, {
      event: 'notification.sms_failed',
      actor_id: userId,
      actor_role: audience,
      order_id: orderId ?? null,
      severity: 'warn',
      payload: {
        channel: 'sms',
        notification_event: event,
        provider,
        destination: maskPhone(destination),
        error: message,
      },
    })
  }
}
