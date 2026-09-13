import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { defaultCommunicationEnabled, type CommunicationCategory } from './communications.ts'
import { normalizeDrapeonSender, renderDrapeonTransactionalEmail } from './email-template.ts'

const RESEND_API = 'https://api.resend.com/emails'

async function userEmail(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) throw new Error(`Account email lookup failed: ${error.message}`)
  return data.user?.email?.trim() || null
}

async function optionalEmailAllowed(
  supabase: SupabaseClient,
  userId: string,
  category: CommunicationCategory,
  purpose: 'OPERATIONAL' | 'MARKETING',
) {
  const { data: suppressions, error: suppressionError } = await supabase
    .from('communication_suppressions')
    .select('id')
    .eq('user_id', userId)
    .eq('channel', 'EMAIL')
    .eq('active', true)
    .in('purpose', [purpose, 'ALL_OPTIONAL'])
    .limit(1)
  if (!suppressionError && (suppressions?.length ?? 0) > 0) return false

  if (purpose === 'MARKETING') {
    const { data: consent } = await supabase
      .from('communication_consents')
      .select('status')
      .eq('user_id', userId)
      .eq('purpose', 'MARKETING')
      .eq('channel', 'EMAIL')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (consent?.status !== 'GRANTED') return false
  }

  const { data: preference } = await supabase
    .from('communication_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('category', category)
    .eq('channel', 'EMAIL')
    .maybeSingle()
  return typeof preference?.enabled === 'boolean'
    ? preference.enabled
    : defaultCommunicationEnabled(category, 'EMAIL')
}

export async function sendAccountEventEmail(
  supabase: SupabaseClient,
  input: {
    userId: string
    recipientEmail?: string | null
    subject: string
    headline: string
    body: string
    eyebrow?: string
    ctaLabel: string
    webPath: string
    appUrl?: string | null
    details?: Array<{ label: string; value: string }>
    idempotencyKey?: string | null
    optionalCommunication?: {
      category: CommunicationCategory
      purpose: 'OPERATIONAL' | 'MARKETING'
    }
  },
) {
  if (
    input.optionalCommunication &&
    !await optionalEmailAllowed(
      supabase,
      input.userId,
      input.optionalCommunication.category,
      input.optionalCommunication.purpose,
    )
  ) {
    return { status: 'SKIPPED' as const, reason: 'PREFERENCE_DISABLED' }
  }
  const email = input.recipientEmail?.trim() || await userEmail(supabase, input.userId)
  if (!email) return { status: 'SKIPPED' as const, reason: 'MISSING_EMAIL' }
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim() ?? ''
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.')
  const siteUrl = (Deno.env.get('SITE_URL') ?? Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? 'https://drapeon.co').replace(/\/+$/u, '')
  const payload = renderDrapeonTransactionalEmail({
    preheader: input.body,
    recipientName: 'there',
    eyebrow: input.eyebrow?.trim() || 'Account update',
    headline: input.headline,
    body: input.body,
    details: input.details ?? [],
    ctaLabel: input.ctaLabel,
    ctaUrl: `${siteUrl}${input.webPath.startsWith('/') ? input.webPath : `/${input.webPath}`}`,
    secondaryCtaLabel: input.appUrl ? 'Open in Drapeon' : undefined,
    secondaryCtaUrl: input.appUrl ?? undefined,
  })
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (input.idempotencyKey?.trim()) headers['Idempotency-Key'] = input.idempotencyKey.trim()
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      from: normalizeDrapeonSender(Deno.env.get('RESEND_FROM')),
      to: [email],
      subject: input.subject,
      html: payload.html,
      text: payload.text,
    }),
  })
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string }
  if (!response.ok) throw new Error(result.message ?? `Account email failed with ${response.status}.`)
  return { status: 'ACCEPTED' as const, provider: 'RESEND', providerReference: result.id ?? null }
}
