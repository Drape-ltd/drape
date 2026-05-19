import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export type ReauthProofPurpose =
  | 'ACCOUNT_DELETION'
  | 'EMAIL_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'PHONE_CHANGE'
  | 'PAYOUT_ACCOUNT_CHANGE'

export async function issueReauthProof(input: {
  password: string
  purpose: ReauthProofPurpose
}): Promise<{
  error: string | null
  proof?: string
  expiresAt?: string
}> {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    proof?: string
    expiresAt?: string
  }>('reauth-proof-action', {
    body: {
      action: 'issue-proof',
      password: input.password,
      purpose: input.purpose,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not confirm your password yet.'
        : await readFunctionErrorMessage(error, 'We could not confirm your password right now.'),
    }
  }

  if (!data?.proof) {
    return { error: 'We could not confirm your password right now.' }
  }

  return {
    error: null,
    proof: data.proof,
    expiresAt: data.expiresAt,
  }
}
