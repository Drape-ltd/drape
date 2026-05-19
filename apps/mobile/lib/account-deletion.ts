import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export async function requestAccountDeletion(input?: {
  reason?: string
  confirmationText?: string
  reauthProof?: string
}): Promise<{
  error: string | null
  alreadyPending?: boolean
  activeOrderCount?: number
  deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
}> {
  const payload = {
    reason: input?.reason?.trim() || undefined,
    confirmationText: input?.confirmationText?.trim() || undefined,
    reauthProof: input?.reauthProof?.trim() || undefined,
  }
  const { data, error } = await invokeFunction<{
    ok?: boolean
    alreadyPending?: boolean
    activeOrderCount?: number
    deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
  }>(
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
    activeOrderCount: data?.activeOrderCount,
    deletionPath: data?.deletionPath,
  }
}
