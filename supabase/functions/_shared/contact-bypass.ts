import { audit, log } from './logger.ts'

const CONTACT_BYPASS_PATTERN =
  /(https?:\/\/|www\.|\b\w+\.(com|co|io|ng|co\.uk|net|org|info|biz|app|dev|me)\b|instagram|whatsapp|facebook|messenger|telegram|signal|viber|line|kik|tiktok|snapchat|@\w+|\b(find me on|dm me|message me on|reach me at|same handle|my @ is|look me up|hit me up on|slide into|call me|text me|email me|send me your number|drop me your number)\b|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\+?\d[\d\s().-]{6,}\d)/i

export function hasBlockedContact(text: string): boolean {
  return CONTACT_BYPASS_PATTERN.test(text)
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

    const { error: insertError } = await options.supabase
      .from('contact_bypass_logs')
      .insert({
        user_id: options.actorId,
        surface: options.surface,
        content,
        attempt,
      })

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
