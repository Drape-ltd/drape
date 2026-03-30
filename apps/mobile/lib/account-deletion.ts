import { invokeFunction } from './supabase'

export async function requestAccountDeletion(reason?: string): Promise<{
  error: string | null
  alreadyPending?: boolean
}> {
  const payload = reason?.trim() ? { reason: reason.trim() } : {}
  const { data, error } = await invokeFunction<{ ok?: boolean; alreadyPending?: boolean }>(
    'request-account-deletion',
    { body: payload }
  )

  if (error) {
    return { error: error.message }
  }

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
  }
}
