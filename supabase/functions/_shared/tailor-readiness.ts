export type TailorReadinessInput = {
  profile_completed?: boolean | null
  id_verification_status?: string | null
  stripe_account_id?: string | null
  paystack_account_id?: string | null
  is_live?: boolean | null
}

export type TailorReadiness = {
  identityVerified: boolean
  payoutReady: boolean
  canAcceptPaidOrders: boolean
  canPublishPaidItems: boolean
  message: string | null
  code: 'PROFILE_INCOMPLETE' | 'IDENTITY_REVIEW_PENDING' | 'IDENTITY_VERIFICATION_REQUIRED' | 'PAYOUT_SETUP_REQUIRED' | null
}

function hasValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

export function deriveTailorReadiness(input: TailorReadinessInput | null | undefined): TailorReadiness {
  const profileCompleted = input?.profile_completed === true
  const idStatus = input?.id_verification_status ?? 'NOT_SUBMITTED'
  const identityVerified = idStatus === 'APPROVED'
  const payoutReady = identityVerified && (hasValue(input?.stripe_account_id) || hasValue(input?.paystack_account_id))

  if (!profileCompleted) {
    return {
      identityVerified,
      payoutReady,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: 'PROFILE_INCOMPLETE',
      message: 'Complete your seller profile before taking paid work live.',
    }
  }

  if (!identityVerified) {
    return {
      identityVerified,
      payoutReady,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: idStatus === 'PENDING' ? 'IDENTITY_REVIEW_PENDING' : 'IDENTITY_VERIFICATION_REQUIRED',
      message:
        idStatus === 'PENDING'
          ? 'Identity review is still in progress. Paid work should wait until review is complete.'
          : 'Finish identity verification before taking paid work live.',
    }
  }

  if (!payoutReady) {
    return {
      identityVerified,
      payoutReady,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: 'PAYOUT_SETUP_REQUIRED',
      message: 'Connect a payout account before sending paid quotes or publishing live paid items.',
    }
  }

  return {
    identityVerified,
    payoutReady,
    canAcceptPaidOrders: true,
    canPublishPaidItems: true,
    code: null,
    message: null,
  }
}
