import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'
import { invokeFunction, supabase } from './supabase'

export type AccountProfileRole = 'CUSTOMER' | 'TAILOR'

export const DUPLICATE_PHONE_MESSAGE =
  'That phone number is already connected to another Drapeon account. Use a different number or contact support.'

export const PHONE_OTP_UNAVAILABLE_MESSAGE =
  'We could not verify this phone number right now. You can retry in a moment.'

function isPhoneOtpClientEnforced() {
  return (process.env.EXPO_PUBLIC_PHONE_OTP_MODE ?? '').trim().toLowerCase() === 'enforced'
}

export async function checkAccountPhoneAvailability(phone: string): Promise<{
  available: boolean
  error: string | null
}> {
  const { data, error } = await invokeFunction<{ ok?: boolean; available?: boolean }>(
    'account-profile-action',
    {
      body: {
        action: 'check-phone-availability',
        phone,
      },
    },
  )

  if (error) {
    const message = isLikelyConnectivityIssue(error)
      ? 'Connection looks weak. We could not check this phone number yet.'
      : await readFunctionErrorMessage(error, 'We could not check this phone number right now.')
    return {
      available: false,
      error: message,
    }
  }

  return {
    available: data?.available === true,
    error: data?.available === true ? null : DUPLICATE_PHONE_MESSAGE,
  }
}

export async function sendAccountPhoneOtp(phone: string): Promise<{
  error: string | null
  bypassed: boolean
  expiresAt?: string | null
}> {
  if (!isPhoneOtpClientEnforced()) {
    return { error: null, bypassed: true, expiresAt: null }
  }

  const { data, error } = await invokeFunction<{
    ok?: boolean
    verified?: boolean
    bypassed?: boolean
    expiresAt?: string | null
  }>('account-profile-action', {
    body: {
      action: 'send-phone-otp',
      phone,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not send a verification code yet.'
        : await readFunctionErrorMessage(error, PHONE_OTP_UNAVAILABLE_MESSAGE),
      bypassed: false,
      expiresAt: null,
    }
  }

  if (!data?.ok) {
    return {
      error: PHONE_OTP_UNAVAILABLE_MESSAGE,
      bypassed: false,
      expiresAt: null,
    }
  }

  return {
    error: null,
    bypassed: data.bypassed === true || data.verified === true,
    expiresAt: data.expiresAt ?? null,
  }
}

export async function verifyAccountPhoneOtp(input: {
  phone: string
  code: string
}): Promise<{
  error: string | null
  verified: boolean
  bypassed: boolean
}> {
  if (!isPhoneOtpClientEnforced()) {
    return { error: null, verified: true, bypassed: true }
  }

  const { data, error } = await invokeFunction<{
    ok?: boolean
    verified?: boolean
    bypassed?: boolean
  }>('account-profile-action', {
    body: {
      action: 'verify-phone-otp',
      phone: input.phone,
      code: input.code,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not verify that code yet.'
        : await readFunctionErrorMessage(error, PHONE_OTP_UNAVAILABLE_MESSAGE),
      verified: false,
      bypassed: false,
    }
  }

  if (!data?.ok || data.verified !== true) {
    return {
      error: PHONE_OTP_UNAVAILABLE_MESSAGE,
      verified: false,
      bypassed: false,
    }
  }

  await supabase.auth.refreshSession().catch(() => {})

  return {
    error: null,
    verified: true,
    bypassed: data.bypassed === true,
  }
}

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
