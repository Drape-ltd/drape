import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

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
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not submit your deletion request yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not submit your deletion request right now.'),
    }
  }

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
  }
}
