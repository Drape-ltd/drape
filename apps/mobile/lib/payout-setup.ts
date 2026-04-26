import { invokeFunction, supabase } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export type PayoutSetupProvider = 'STRIPE' | 'PAYSTACK'
export type PayoutSetupRequestStatus = 'PENDING' | 'IN_REVIEW' | 'LINKED' | 'REJECTED' | 'CANCELLED'

export type TailorPayoutSetupRequest = {
  id: string
  provider: PayoutSetupProvider
  currency: string
  country: string
  accountHolderName: string
  businessName: string | null
  payoutDetails: string
  note: string | null
  status: PayoutSetupRequestStatus
  createdAt: string
  reviewedAt: string | null
}

type PayoutSetupResponse = {
  ok?: boolean
  alreadyPending?: boolean
  requestId?: string
  status?: PayoutSetupRequestStatus
}

export async function loadLatestPayoutSetupRequest(userId: string): Promise<TailorPayoutSetupRequest | null> {
  const { data, error } = await supabase
    .from('tailor_payout_setup_requests')
    .select('id, provider, currency, country, account_holder_name, business_name, payout_details, note, status, created_at, reviewed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    provider: data.provider as PayoutSetupProvider,
    currency: data.currency,
    country: data.country,
    accountHolderName: data.account_holder_name,
    businessName: data.business_name ?? null,
    payoutDetails: data.payout_details,
    note: data.note ?? null,
    status: data.status as PayoutSetupRequestStatus,
    createdAt: data.created_at,
    reviewedAt: data.reviewed_at ?? null,
  }
}

export async function submitPayoutSetupRequest(input: {
  provider: PayoutSetupProvider
  currency: string
  country: string
  accountHolderName: string
  businessName?: string | null
  payoutDetails: string
  note?: string | null
}) {
  const { data, error } = await invokeFunction<PayoutSetupResponse>('payout-setup-request', {
    body: {
      provider: input.provider,
      currency: input.currency,
      country: input.country.trim(),
      accountHolderName: input.accountHolderName.trim(),
      businessName: input.businessName?.trim() || null,
      payoutDetails: input.payoutDetails.trim(),
      note: input.note?.trim() || null,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not submit your payout setup details yet.'
        : await readFunctionErrorMessage(error, 'We could not submit your payout setup details right now.'),
      alreadyPending: false,
      status: null as PayoutSetupRequestStatus | null,
    }
  }

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
    status: (data?.status ?? null) as PayoutSetupRequestStatus | null,
  }
}
