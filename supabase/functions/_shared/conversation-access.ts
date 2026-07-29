import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type AuditLogRow = {
  event: string
  created_at: string
  actor_role: string | null
  payload: Record<string, unknown> | null
}

export type ConversationAccessState = {
  blocked: boolean
  blockedAt: string | null
  blockedByRole: string | null
  reason: string | null
}

function payloadStringValue(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function readConversationAccessState(
  supabase: SupabaseClient,
  orderId: string,
): Promise<ConversationAccessState> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('event, created_at, actor_role, payload')
    .eq('order_id', orderId)
    .in('event', ['conversation.blocked', 'conversation.unblocked'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    return {
      blocked: false,
      blockedAt: null,
      blockedByRole: null,
      reason: null,
    }
  }

  const latest = data as AuditLogRow
  return {
    blocked: latest.event === 'conversation.blocked',
    blockedAt: latest.created_at,
    blockedByRole: latest.actor_role,
    reason: payloadStringValue(latest.payload, 'reason'),
  }
}

export function buildConversationBlockedMessage(state: ConversationAccessState) {
  const reason =
    state.reason === 'OFF_PLATFORM_PRESSURE'
      ? 'after off-platform pressure was reported'
      : state.reason === 'ABUSIVE_LANGUAGE'
        ? 'after abusive language was reported'
        : state.reason === 'UNSAFE_BEHAVIOR'
          ? 'after unsafe behavior was reported'
          : 'while Drapeon reviews a safety concern'

  return `This conversation is paused ${reason}. Keep the existing thread intact as evidence and use Drapeon support if you still need help.`
}
