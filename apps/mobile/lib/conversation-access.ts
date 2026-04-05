import { invokeFunction } from '@/lib/supabase'

export type ConversationAccessState = {
  blocked: boolean
  blockedAt: string | null
  blockedByRole: string | null
  reason: string | null
  userMessage: string | null
}

function emptyState(): ConversationAccessState {
  return {
    blocked: false,
    blockedAt: null,
    blockedByRole: null,
    reason: null,
    userMessage: null,
  }
}

export async function getConversationAccessStatus(orderId: string): Promise<ConversationAccessState> {
  const { data, error } = await invokeFunction<ConversationAccessState>('conversation-access', {
    body: { action: 'get-status', orderId },
  })

  if (error || !data) {
    throw error ?? new Error('Could not load conversation safety status.')
  }

  return {
    blocked: data.blocked === true,
    blockedAt: typeof data.blockedAt === 'string' ? data.blockedAt : null,
    blockedByRole: typeof data.blockedByRole === 'string' ? data.blockedByRole : null,
    reason: typeof data.reason === 'string' ? data.reason : null,
    userMessage: typeof data.userMessage === 'string' ? data.userMessage : null,
  }
}

export async function blockConversation(orderId: string, reason: 'ABUSIVE_LANGUAGE' | 'OFF_PLATFORM_PRESSURE' | 'UNSAFE_BEHAVIOR') {
  const { data, error } = await invokeFunction<ConversationAccessState>('conversation-access', {
    body: { action: 'block', orderId, reason, surface: 'messages' },
  })

  if (error || !data) {
    throw error ?? new Error('Could not pause this conversation right now.')
  }

  return {
    blocked: data.blocked === true,
    blockedAt: typeof data.blockedAt === 'string' ? data.blockedAt : null,
    blockedByRole: typeof data.blockedByRole === 'string' ? data.blockedByRole : null,
    reason: typeof data.reason === 'string' ? data.reason : null,
    userMessage: typeof data.userMessage === 'string' ? data.userMessage : null,
  }
}

export function getEmptyConversationAccessState() {
  return emptyState()
}
