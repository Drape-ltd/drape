import { audit, log } from './logger.ts'
import { createOrRefreshOpsIssue } from './ops-issues.ts'

const URL_OR_WEB_PATTERN =
  /(https?:\/\/|www\.|\b\w+\.(com|co|io|ng|co\.uk|net|org|info|biz|app|dev|me)\b)/i
const PLATFORM_PATTERN =
  /\b(instagram|whatsapp|facebook|messenger|telegram|signal|viber|line|kik|tiktok|snapchat)\b/i
const SOCIAL_HANDLE_PATTERN = /@[a-zA-Z0-9_.]{2,}\b/
const REDIRECT_PATTERN =
  /\b(find me on|dm me|message me on|reach me at|same handle|my @ is|look me up|hit me up on|slide into|call me|text me|email me|send me your number|drop me your number)\b/i
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i
const PHONE_CANDIDATE_PATTERN = /\+?\d[\d\s()./-]{5,}\d/g

function isLikelyDateCandidate(value: string): boolean {
  return /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(value) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(value)
}

function isLikelyMeasurementTuple(value: string): boolean {
  const groups = value.match(/\d+/g) ?? []
  const digitCount = groups.join('').length
  if (groups.length < 2) return false
  return groups.every((group) => group.length <= 2) && digitCount <= 8
}

function isLikelyPhoneCandidate(value: string): boolean {
  const candidate = value.trim()
  if (!candidate) return false
  if (isLikelyDateCandidate(candidate)) return false
  if (isLikelyMeasurementTuple(candidate)) return false

  const groups = candidate.match(/\d+/g) ?? []
  const digitsOnly = groups.join('')
  if (digitsOnly.length < 7) return false

  if (candidate.startsWith('+')) return true
  if (groups.some((group) => group.length >= 3)) return true

  return digitsOnly.length >= 9
}

export function hasBlockedContact(text: string): boolean {
  if (
    URL_OR_WEB_PATTERN.test(text) ||
    PLATFORM_PATTERN.test(text) ||
    SOCIAL_HANDLE_PATTERN.test(text) ||
    REDIRECT_PATTERN.test(text) ||
    EMAIL_PATTERN.test(text)
  ) {
    return true
  }

  const phoneCandidates = text.match(PHONE_CANDIDATE_PATTERN) ?? []
  return phoneCandidates.some((candidate) => isLikelyPhoneCandidate(candidate))
}

export async function logContactBypassAttempt(options: {
  supabase: any
  fn: string
  actorId: string
  actorRole: string
  surface: string
  content: string
  orderId?: string | null
  extra?: Record<string, unknown>
}) {
  const content = options.content.trim().slice(0, 2000)
  let attempt = 1

  try {
    const { count, error: countError } = await options.supabase
      .from('contact_bypass_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', options.actorId)
      .eq('surface', options.surface)

    if (countError) {
      log('error', options.fn, 'contact_bypass.count_failed', {
        actor_id: options.actorId,
        surface: options.surface,
        error: countError.message,
      })
    } else {
      attempt = (count ?? 0) + 1
    }

    const { data: insertedLog, error: insertError } = await options.supabase
      .from('contact_bypass_logs')
      .insert({
        user_id: options.actorId,
        surface: options.surface,
        content,
        attempt,
      })
      .select('id')
      .single()

    if (insertError) {
      log('error', options.fn, 'contact_bypass.insert_failed', {
        actor_id: options.actorId,
        surface: options.surface,
        error: insertError.message,
      })
      return
    }

    await audit(options.supabase, {
      event: 'contact_bypass.logged',
      actor_id: options.actorId,
      actor_role: options.actorRole,
      order_id: options.orderId ?? null,
      severity: 'warn',
      payload: {
        function: options.fn,
        surface: options.surface,
        attempt,
        content_length: content.length,
        ...(options.extra ?? {}),
      },
    })

    await createOrRefreshOpsIssue(options.supabase, {
      issueType: 'CONTACT_BYPASS',
      severity: attempt >= 3 ? 'HIGH' : 'MEDIUM',
      source: options.fn,
      actorId: options.actorId,
      actorRole: options.actorRole,
      orderId: options.orderId ?? null,
      userId: options.actorId,
      relatedEntityType: 'contact_bypass_log',
      relatedEntityId: (insertedLog as { id?: string } | null)?.id ?? null,
      title: 'Contact bypass attempt blocked',
      description: `${options.actorRole.toLowerCase()} tried to move contact off Drapeon on ${options.surface}.`,
      recommendedAction: 'Review the blocked content, decide whether this needs a warning or trust follow-up, and mark the attempt reviewed in ops.',
      dedupeKey: `contact-bypass:${(insertedLog as { id?: string } | null)?.id ?? `${options.actorId}:${options.surface}:${attempt}`}`,
      metadata: {
        surface: options.surface,
        attempt,
        content_length: content.length,
        ...(options.extra ?? {}),
      },
    })

    log('warn', options.fn, 'contact_bypass.blocked', {
      actor_id: options.actorId,
      actor_role: options.actorRole,
      order_id: options.orderId ?? null,
      surface: options.surface,
      attempt,
    })
  } catch (error) {
    log('error', options.fn, 'contact_bypass.unhandled', {
      actor_id: options.actorId,
      surface: options.surface,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function rejectIfBlockedContact(options: {
  supabase: any
  fn: string
  cors: Record<string, string>
  actorId: string
  actorRole: string
  surface: string
  text?: string | null
  message: string
  orderId?: string | null
  extra?: Record<string, unknown>
}): Promise<Response | null> {
  const text = options.text?.trim() ?? ''
  if (!text || !hasBlockedContact(text)) return null

  await logContactBypassAttempt({
    supabase: options.supabase,
    fn: options.fn,
    actorId: options.actorId,
    actorRole: options.actorRole,
    surface: options.surface,
    content: text,
    orderId: options.orderId,
    extra: options.extra,
  })

  return new Response(options.message, { status: 400, headers: options.cors })
}
