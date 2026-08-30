import { invokeFunction, supabase } from './supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

const ACCOUNT_DELETION_DEVICE_MARKER = 'drape.account-deletion.pending.v1'

export async function consumeAccountDeletionDeviceMarker() {
  const marker = await AsyncStorage.getItem(ACCOUNT_DELETION_DEVICE_MARKER).catch(() => null)
  if (!marker) return false
  await AsyncStorage.removeItem(ACCOUNT_DELETION_DEVICE_MARKER).catch(() => {})
  return true
}

async function markAccountDeletionPendingOnDevice(requestId?: string | null) {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
  const userId = data.session?.user?.id ?? null
  await AsyncStorage.setItem(
    ACCOUNT_DELETION_DEVICE_MARKER,
    JSON.stringify({ requestId: requestId ?? null, userId, markedAt: new Date().toISOString() }),
  ).catch(() => {})
}

export async function requestAccountDeletion(input?: {
  reason?: string
  confirmationText?: string
  reauthProof?: string
  appleAuthorizationCode?: string
}): Promise<{
  error: string | null
  alreadyPending?: boolean
  activeOrderCount?: number
  deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
  request?: AccountDeletionRequestState | null
}> {
  const payload = {
    action: 'SUBMIT',
    source: 'MOBILE_APP',
    reason: input?.reason?.trim() || undefined,
    confirmationText: input?.confirmationText?.trim() || undefined,
    reauthProof: input?.reauthProof?.trim() || undefined,
    appleAuthorizationCode: input?.appleAuthorizationCode?.trim() || undefined,
  }
  const { data, error } = await invokeFunction<{
    ok?: boolean
    alreadyPending?: boolean
    activeOrderCount?: number
    deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
    request?: AccountDeletionRequestState | null
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

  await markAccountDeletionPendingOnDevice(data?.request?.id)

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
    activeOrderCount: data?.activeOrderCount,
    deletionPath: data?.deletionPath,
    request: data?.request ?? null,
  }
}

export async function issueProviderDeletionProof(provider: 'apple' | 'google') {
  const { data, error } = await invokeFunction<{ proof?: string; expiresAt?: string }>(
    'reauth-proof-action',
    { body: { action: 'issue-provider-proof', provider, purpose: 'ACCOUNT_DELETION' } },
  )
  if (error || !data?.proof) {
    return {
      error: await readFunctionErrorMessage(error, 'We could not confirm your provider sign-in right now.'),
      proof: null,
    }
  }
  return { error: null, proof: data.proof }
}

export type AccountDeletionRequestState = {
  id: string
  status: 'PENDING' | 'ACKNOWLEDGED' | 'BLOCKED' | 'READY_FOR_FINALIZATION' | string
  createdAt: string
  activeOrderCount: number
  deletionPath: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD' | string | null
  role: string
}

export async function getAccountDeletionRequestStatus(): Promise<{
  error: string | null
  request: AccountDeletionRequestState | null
}> {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    request?: AccountDeletionRequestState | null
  }>('request-account-deletion', { body: { action: 'STATUS' } })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not load your deletion request status yet.'
        : await readFunctionErrorMessage(error, 'We could not load your deletion request status right now.'),
      request: null,
    }
  }
  const request = data?.request ?? null
  if (request && request.status !== 'COMPLETED') {
    await markAccountDeletionPendingOnDevice(request.id)
  }
  return { error: null, request }
}
