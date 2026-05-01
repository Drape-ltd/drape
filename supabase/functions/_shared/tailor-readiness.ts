export type TailorReadinessInput = {
  profile_completed?: boolean | null
  id_verification_status?: string | null
  stripe_account_id?: string | null
  paystack_account_id?: string | null
  stripe_connect_account_id?: string | null
  paystack_recipient_code?: string | null
  payout_account_verified?: boolean | null
  payout_reverification_required?: boolean | null
  payout_account_type?: string | null
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

function isIdentityVerifiedStatus(status: string | null | undefined) {
  return status === 'VERIFIED' || status === 'APPROVED'
}

export function deriveTailorReadiness(input: TailorReadinessInput | null | undefined): TailorReadiness {
  const profileCompleted = input?.profile_completed === true
  const idStatus = input?.id_verification_status ?? 'NOT_SUBMITTED'
  const identityVerified = isIdentityVerifiedStatus(idStatus)
  const legacyProviderLinked = hasValue(input?.stripe_account_id)
    || hasValue(input?.paystack_account_id)
    || hasValue(input?.stripe_connect_account_id)
    || hasValue(input?.paystack_recipient_code)
  const payoutVerified = input?.payout_account_verified === true
  const needsReverification = input?.payout_reverification_required === true
  const explicitPayoutStateKnown =
    typeof input?.payout_account_verified === 'boolean'
    || typeof input?.payout_reverification_required === 'boolean'
  const payoutReady = identityVerified && (
    explicitPayoutStateKnown
      ? (payoutVerified && !needsReverification)
      : legacyProviderLinked
  )

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
      message: 'Set up a verified payout account in Payments & payouts before sending paid quotes or publishing live paid items.',
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
