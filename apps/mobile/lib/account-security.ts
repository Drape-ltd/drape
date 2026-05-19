import { invokeFunction } from './supabase'

type AccountSecurityNoticeEvent = 'PASSWORD_CHANGED' | 'EMAIL_CHANGE_STARTED'

export async function sendAccountSecurityNotice(input: {
  event: AccountSecurityNoticeEvent
  newEmail?: string
}) {
  const { error } = await invokeFunction<{ ok?: boolean; emailQueued?: boolean }>(
    'account-security-notification',
    {
      body: {
        event: input.event,
        newEmail: input.newEmail?.trim() || undefined,
      },
    },
  )

  return { error }
}
