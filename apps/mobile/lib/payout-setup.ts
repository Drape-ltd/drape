import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorStatus } from './function-errors'
import type { ManualBankVerificationStatus } from '@drape/shared/payout-setup'

export type PayoutSetupProvider = 'STRIPE' | 'PAYSTACK'
export type PayoutSetupCurrency = 'NGN' | 'GHS' | 'KES' | 'USD' | 'GBP' | 'EUR' | 'CAD'

export type TailorPayoutStatus = {
  id: string
  displayName: string
  payoutCurrency: PayoutSetupCurrency
  payoutProvider: PayoutSetupProvider | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payoutAccountVerified: boolean
  payoutReverificationRequired: boolean
  payoutAccountVerifiedAt: string | null
  payoutBankName: string | null
  payoutAccountName: string | null
  payoutAccountMasked: string | null
  payoutCountryCode: string | null
  manualBankEntry: boolean
  manualBankName: string | null
  manualBankCountryCode: string | null
  manualBankCountryName: string | null
  manualBankSwiftBic: string | null
  manualBankAccountName: string | null
  manualBankVerificationStatus: ManualBankVerificationStatus | null
  manualBankSubmittedAt: string | null
  manualBankEntryEnabled: boolean
  paystackRecipientCode: string | null
  stripeConnectAccountId: string | null
  payoutAccountChangeCount: number
  payoutAccountLastChangedAt: string | null
  payoutAccountChangeLockedUntil: string | null
  payoutDestinationHoldUntil: string | null
}

export type PaystackBank = {
  code: string
  name: string
  country: string | null
  currency: string | null
  logoUrl: string | null
}

export type PaystackBankDirectory = {
  banks: PaystackBank[]
  source: 'live' | 'fallback'
  warning: string | null
}

export type PaystackVerification = {
  accountNumber: string
  enteredAccountName: string | null
  resolvedAccountName: string
  matchesEnteredName: boolean | null
  maskedAccountNumber: string
  bankCode: string
  bankName: string
  payoutCurrency: string
  countryCode: string | null
}

type StatusResponse = {
  ok?: boolean
  profile?: TailorPayoutStatus
}

async function edgeError(error: unknown, fallback: string) {
  const status = readFunctionErrorStatus(error)
  if (status === 404) {
    return 'Payout setup is not available in this environment yet. Deploy the latest payout function, then try again.'
  }
  return isLikelyConnectivityIssue(error)
    ? 'Connection looks weak. Try again when your signal improves.'
    : await readFunctionErrorMessage(error, fallback)
}

export async function loadPayoutAccountStatus() {
  const { data, error } = await invokeFunction<StatusResponse>('payout-account-action', {
    body: { action: 'get-status' },
  })

  if (error || !data?.profile) {
    return {
      profile: null,
      error: await edgeError(error, 'We could not load your payout setup right now.'),
    }
  }

  return { profile: data.profile, error: null }
}

export async function listPaystackPayoutBanks(input: {
  payoutCurrency: 'NGN' | 'GHS' | 'KES'
  countryCode: string
}) {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    banks?: PaystackBank[]
    source?: 'live' | 'fallback'
    warning?: string | null
  }>('payout-account-action', {
    body: {
      action: 'list-paystack-banks',
      payoutCurrency: input.payoutCurrency,
      countryCode: input.countryCode.trim().toUpperCase(),
    },
  })

  if (error || !Array.isArray(data?.banks)) {
    return {
      directory: null as PaystackBankDirectory | null,
      error: await edgeError(error, 'We could not load the bank list right now.'),
    }
  }

  return {
    directory: {
      banks: data.banks,
      source: data.source === 'fallback' ? 'fallback' : 'live',
      warning: typeof data.warning === 'string' ? data.warning : null,
    } as PaystackBankDirectory,
    error: null,
  }
}

export async function verifyPaystackPayoutAccount(input: {
  payoutCurrency: 'NGN' | 'GHS' | 'KES'
  countryCode: string
  bankCode: string
  bankName: string
  accountNumber: string
  accountName?: string
}) {
  const { data, error } = await invokeFunction<{ ok?: boolean; verification?: PaystackVerification }>('payout-account-action', {
    body: {
      action: 'verify-paystack-account',
      payoutCurrency: input.payoutCurrency,
      countryCode: input.countryCode.trim().toUpperCase(),
      bankCode: input.bankCode.trim(),
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      accountName: input.accountName?.trim() || undefined,
    },
  })

  if (error || !data?.verification) {
    return {
      verification: null,
      error: await edgeError(error, 'We could not verify this bank account right now.'),
    }
  }

  return {
    verification: data.verification,
    error: null,
  }
}

export async function confirmPaystackPayoutAccount(input: {
  payoutCurrency: 'NGN' | 'GHS' | 'KES'
  countryCode: string
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
}) {
  const { data, error } = await invokeFunction<{ ok?: boolean; account?: TailorPayoutStatus; pendingReview?: boolean }>('payout-account-action', {
    body: {
      action: 'confirm-paystack-account',
      payoutCurrency: input.payoutCurrency,
      countryCode: input.countryCode.trim().toUpperCase(),
      bankCode: input.bankCode.trim(),
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      accountName: input.accountName.trim(),
    },
  })

  if (error || (!data?.account && data?.pendingReview !== true)) {
    return {
      account: null,
      pendingReview: false,
      error: await edgeError(error, 'We could not save this payout account right now.'),
    }
  }

  return {
    account: data.account ?? null,
    pendingReview: data.pendingReview === true,
    error: null,
  }
}

export async function submitManualBankEntry(input: {
  payoutCurrency: PayoutSetupCurrency
  bankName: string
  bankCountryCode: string
  swiftBic: string
  accountNumber: string
  accountName: string
}) {
  const { data, error } = await invokeFunction<{ ok?: boolean; account?: TailorPayoutStatus; pendingReview?: boolean }>('payout-account-action', {
    body: {
      action: 'submit-manual-bank-entry',
      payoutCurrency: input.payoutCurrency,
      bankName: input.bankName.trim(),
      bankCountryCode: input.bankCountryCode.trim().toUpperCase(),
      swiftBic: input.swiftBic.trim(),
      accountNumber: input.accountNumber.trim(),
      accountName: input.accountName.trim(),
    },
  })

  if (error || (!data?.account && data?.pendingReview !== true)) {
    return {
      account: null,
      pendingReview: false,
      error: await edgeError(error, 'We could not submit these manual bank details right now.'),
    }
  }

  return {
    account: data.account ?? null,
    pendingReview: data.pendingReview === true,
    error: null,
  }
}

export async function startStripeConnectOnboarding(input: {
  payoutCurrency: 'USD' | 'GBP' | 'EUR' | 'CAD'
  countryCode: string
  returnUrl: string
  refreshUrl: string
}) {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    onboarding?: {
      provider: 'STRIPE'
      payoutCurrency: string
      countryCode: string
      stripeConnectAccountId: string
      url: string
      expiresAt: number
    }
  }>('payout-account-action', {
    body: {
      action: 'start-stripe-connect',
      payoutCurrency: input.payoutCurrency,
      countryCode: input.countryCode.trim().toUpperCase(),
      returnUrl: input.returnUrl,
      refreshUrl: input.refreshUrl,
    },
  })

  if (error || !data?.onboarding?.url) {
    return {
      onboarding: null,
      error: await edgeError(error, 'We could not start Stripe onboarding right now.'),
    }
  }

  return {
    onboarding: data.onboarding,
    error: null,
  }
}

export async function refreshStripeConnectPayoutStatus() {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    pendingReview?: boolean
    account?: {
      provider: 'STRIPE'
      stripeConnectAccountId: string
      chargesEnabled: boolean
      payoutsEnabled: boolean
      detailsSubmitted: boolean
      payoutAccountVerified: boolean
      payoutReverificationRequired: boolean
      payoutAccountVerifiedAt: string | null
      payoutCountryCode: string | null
    }
  }>('payout-account-action', {
    body: { action: 'refresh-stripe-connect-status' },
  })

  if (error || (!data?.account && data?.pendingReview !== true)) {
    return {
      account: null,
      pendingReview: false,
      error: await edgeError(error, 'We could not refresh the Stripe payout status right now.'),
    }
  }

  return {
    account: data.account ?? null,
    pendingReview: data.pendingReview === true,
    error: null,
  }
}
