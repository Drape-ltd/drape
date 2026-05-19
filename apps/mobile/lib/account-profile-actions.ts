import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'
import { invokeFunction, supabase } from './supabase'

export type AccountProfileRole = 'CUSTOMER' | 'TAILOR'

export async function updatePersonalInfoWithServerPreflight(input: {
  role: AccountProfileRole
  displayName: string
  phone: string
  reauthProof?: string
}): Promise<{
  error: string | null
  phoneChanged?: boolean
}> {
  const { data, error } = await invokeFunction<{ ok?: boolean; phoneChanged?: boolean }>(
    'account-profile-action',
    {
      body: {
        action: 'update-personal-info',
        role: input.role,
        displayName: input.displayName,
        phone: input.phone,
        reauthProof: input.reauthProof,
      },
    },
  )

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your personal information yet.'
        : await readFunctionErrorMessage(error, 'We could not save your personal information right now.'),
    }
  }

  if (!data?.ok) {
    return { error: 'We could not save your personal information right now.' }
  }

  await supabase.auth.refreshSession().catch(() => {})

  return {
    error: null,
    phoneChanged: data.phoneChanged === true,
  }
}
