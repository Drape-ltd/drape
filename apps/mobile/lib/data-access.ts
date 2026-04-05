import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export async function requestDataAccess(note?: string): Promise<{
  error: string | null
  alreadyPending?: boolean
}> {
  const payload = note?.trim() ? { note: note.trim() } : {}
  const { data, error } = await invokeFunction<{ ok?: boolean; alreadyPending?: boolean }>(
    'request-data-access',
    { body: payload }
  )

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not submit your data request yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not submit your data request right now.'),
    }
  }

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
  }
}
