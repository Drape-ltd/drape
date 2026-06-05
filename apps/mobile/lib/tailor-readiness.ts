export type TailorSellerStage =
  | 'DRAFT'
  | 'APPLICATION_COMPLETE'
  | 'IDENTITY_VERIFIED'
  | 'PAYOUT_READY'
  | 'LIVE_STANDARD'
  | 'LIVE_HIGHER_RISK'
  | 'RESTRICTED'

export type TailorReadinessInput = {
  profileCompleted?: boolean | null
  idVerificationStatus?: string | null
  isLive?: boolean | null
  payoutCurrency?: string | null
  payoutProvider?: string | null
  stripeAccountId?: string | null
  paystackAccountId?: string | null
  stripeConnectAccountId?: string | null
  paystackRecipientCode?: string | null
  payoutAccountVerified?: boolean | null
  payoutReverificationRequired?: boolean | null
  payoutAccountType?: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  shipsInternationally?: boolean | null
}

export type TailorReadiness = {
  sellerStage: TailorSellerStage
  identityVerified: boolean
  payoutReady: boolean
  publicDiscoveryReady: boolean
  canAcceptPaidOrders: boolean
  canPublishPaidItems: boolean
  payoutProviderLabel: string | null
  blockers: string[]
  title: string
  body: string
  actionLabel: string | null
  tone: 'neutral' | 'warning' | 'success'
}

export type PayoutProviderLabel = 'Stripe' | 'Paystack'

function hasValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function isIdentityVerifiedStatus(status: string | null | undefined) {
  return status === 'VERIFIED' || status === 'APPROVED'
}

export function suggestedPayoutProvider(currency: string | null | undefined): PayoutProviderLabel {
  const normalized = (currency ?? '').trim().toUpperCase()
  if (normalized === 'NGN' || normalized === 'GHS' || normalized === 'KES') return 'Paystack'
  return 'Stripe'
}

export function payoutSetupCopy(currency: string | null | undefined) {
  const normalized = (currency ?? '').trim().toUpperCase()
  const provider = suggestedPayoutProvider(normalized)
  const currencyLabel = normalized || 'your main selling currency'

  if (provider === 'Paystack') {
    return {
      provider,
      title: `Connect ${provider} for ${currencyLabel}`,
      body: `${currencyLabel} payouts should use ${provider} first. Use Drapeon payout setup to send the account details Drapeon needs to link before paid work goes live.`,
      emailSubject: `Drapeon payout setup: ${currencyLabel} via ${provider}`,
    }
  }

  return {
    provider,
    title: `Connect ${provider} for ${currencyLabel}`,
    body: `${currencyLabel} payouts should use ${provider} first. Use Drapeon payout setup to send the account details Drapeon needs to link before paid work goes live.`,
    emailSubject: `Drapeon payout setup: ${currencyLabel} via ${provider}`,
  }
}

export function deriveTailorReadiness(input: TailorReadinessInput | null | undefined): TailorReadiness {
  const profileCompleted = input?.profileCompleted === true
  const idVerificationStatus = input?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const identityVerified = isIdentityVerifiedStatus(idVerificationStatus)
  const payoutVerified = input?.payoutAccountVerified === true
  const needsReverification = input?.payoutReverificationRequired === true
  const payoutCurrency =
    ((input as { payoutCurrency?: string | null; payout_currency?: string | null } | null)?.payoutCurrency
      ?? (input as { payoutCurrency?: string | null; payout_currency?: string | null } | null)?.payout_currency
      ?? null)
  const payoutProviderLabel =
    hasValue(payoutCurrency)
      ? suggestedPayoutProvider(payoutCurrency)
      : input?.payoutAccountType === 'STRIPE_CONNECT'
        || hasValue(input?.stripeConnectAccountId)
        || hasValue(input?.stripeAccountId)
        ? 'Stripe'
        : input?.payoutAccountType === 'PAYSTACK'
          || hasValue(input?.paystackRecipientCode)
          || hasValue(input?.paystackAccountId)
          ? 'Paystack'
          : null
  const explicitPayoutStateKnown =
    typeof input?.payoutAccountVerified === 'boolean'
    || typeof input?.payoutReverificationRequired === 'boolean'
  const payoutReady = identityVerified && (
    explicitPayoutStateKnown
      ? (payoutVerified && !needsReverification)
      : payoutProviderLabel != null
  )
  const publicDiscoveryReady = profileCompleted && identityVerified
  const canAcceptPaidOrders = payoutReady
  const canPublishPaidItems = payoutReady
  const liveHigherRisk = input?.isLive === true && input?.shipsInternationally === true

  const blockers: string[] = []
  if (!profileCompleted) blockers.push('Complete your public profile')
  if (idVerificationStatus === 'PENDING') blockers.push('Wait for identity review to finish')
  if (idVerificationStatus === 'REJECTED') blockers.push('Resubmit identity verification')
  if (identityVerified && !payoutReady) blockers.push('Connect a payout account before taking paid orders')

  if (!profileCompleted) {
    return {
      sellerStage: 'DRAFT',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: 'Finish your seller profile first',
      body: 'Your profile, portfolio, and verification need to be in place before customers can discover you as a normal live business.',
      actionLabel: 'Complete profile',
      tone: 'warning',
    }
  }

  if (!identityVerified) {
    return {
      sellerStage: 'APPLICATION_COMPLETE',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: idVerificationStatus === 'PENDING' ? 'Identity review is in progress' : 'Identity verification is still needed',
      body:
        idVerificationStatus === 'PENDING'
          ? 'Your profile can finish review before it goes live. Paid work should still wait until identity review and payout setup are both complete.'
          : idVerificationStatus === 'REJECTED'
            ? 'Your verification needs attention before Drapeon can show you publicly or let you take paid work.'
            : 'Customers should not discover or pay an unverified seller profile as if it were fully ready.',
      actionLabel:
        idVerificationStatus === 'PENDING'
          ? null
          : idVerificationStatus === 'REJECTED'
            ? 'Resubmit verification'
            : 'Finish verification',
      tone: 'warning',
    }
  }

  if (!payoutReady) {
    const reconnect = needsReverification
    return {
      sellerStage: 'IDENTITY_VERIFIED',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: reconnect ? 'Reconnect your payout account' : 'Set up your payout account',
      body: reconnect
        ? 'Your payout details changed or need review again. Reconnect your payout account to start receiving earnings and unlock paid work again. It takes about 2 minutes.'
        : 'Set up your payout account to start receiving earnings. Paid quotes and live shop items stay blocked until a verified payout path is connected. It takes about 2 minutes.',
      actionLabel: reconnect ? 'Reconnect payout account' : 'Set up payout account',
      tone: 'warning',
    }
  }

  if (input?.isLive !== true) {
    return {
      sellerStage: 'PAYOUT_READY',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: 'You are payout-ready',
      body: 'Identity and payout checks look good. Review your storefront and go live when you are ready for standard paid work.',
      actionLabel: 'Review live profile',
      tone: 'neutral',
    }
  }

  return {
    sellerStage: liveHigherRisk ? 'LIVE_HIGHER_RISK' : 'LIVE_STANDARD',
    identityVerified,
    payoutReady,
    publicDiscoveryReady,
    canAcceptPaidOrders,
    canPublishPaidItems,
    payoutProviderLabel,
    blockers,
    title: liveHigherRisk ? 'Live with higher-risk shipping enabled' : 'Live and payout-ready',
    body: liveHigherRisk
      ? 'Standard payout checks look good. Keep higher-risk cross-border work conservative and ops-visible while Drapeon is still learning.'
      : 'You can accept standard paid work and publish paid items with your current setup.',
    actionLabel: null,
    tone: 'success',
  }
}
