import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export async function requestSellerAccessReview(note: string): Promise<{
  error: string | null
  alreadyPending?: boolean
}> {
  const { data, error } = await invokeFunction<{ ok?: boolean; alreadyPending?: boolean }>(
    'seller-access-review-request',
    { body: { note: note.trim() } }
  )

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not submit your review request yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not submit your review request right now.'),
    }
  }

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
  }
}
