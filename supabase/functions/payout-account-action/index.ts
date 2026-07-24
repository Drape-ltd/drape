import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue } from '../_shared/ops-issues.ts'
import { createPaystackTransferRecipient, fallbackPaystackBanks, listPaystackBanks, resolvePaystackAccountNumber } from '../_shared/paystack.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { createStripeAccountLink, createStripeConnectAccount, retrieveStripeConnectAccount } from '../_shared/stripe.ts'
import { isApprovedTailorProfile, stagePayoutChangeRequest } from '../_shared/verification-review.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  MANUAL_BANK_ENTRY_NOTE,
  payoutBankLogoUrl,
  validateManualBankEntry,
} from '../../../packages/shared/src/payout-setup.ts'

const FN = 'payout-account-action'
const PAYSTACK_PAYOUT_CURRENCIES = new Set(['NGN', 'GHS', 'KES'])
const STRIPE_PAYOUT_CURRENCIES = new Set(['USD', 'GBP', 'EUR', 'CAD'])
const PAYOUT_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const PAYOUT_DESTINATION_HOLD_MS = 72 * 60 * 60 * 1000
const MANUAL_BANK_ENTRY_ENABLED = Deno.env.get('MANUAL_BANK_ENTRY_ENABLED') === '1'

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-status'),
  }),
  z.object({
    action: z.literal('list-paystack-banks'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES']),
    countryCode: z.string().trim().min(2).max(2).optional(),
  }),
  z.object({
    action: z.literal('verify-paystack-account'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES']),
    countryCode: z.string().trim().min(2).max(2),
    bankCode: z.string().trim().min(2).max(40),
    bankName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(40),
    accountName: z.string().trim().min(2).max(120).optional(),
  }),
  z.object({
    action: z.literal('confirm-paystack-account'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES']),
    countryCode: z.string().trim().min(2).max(2),
    bankCode: z.string().trim().min(2).max(40),
    bankName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(40),
    accountName: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal('submit-manual-bank-entry'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD']),
    bankName: z.string().trim().min(1).max(120),
    bankCountryCode: z.string().trim().min(2).max(2),
    swiftBic: z.string().trim().min(1).max(16),
    accountNumber: z.string().trim().min(1).max(64),
    accountName: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal('start-stripe-connect'),
    payoutCurrency: z.enum(['USD', 'GBP', 'EUR', 'CAD']),
    countryCode: z.string().trim().min(2).max(2),
    returnUrl: z.string().trim().min(1).max(500),
    refreshUrl: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal('refresh-stripe-connect-status'),
  }),
])

type TailorProfileRow = {
  id: string
  display_name?: string | null
  profile_completed?: boolean | null
  id_verification_status?: string | null
  is_live?: boolean | null
  payout_currency?: string | null
  payout_provider?: 'PAYSTACK' | 'STRIPE' | null
  payout_reverification_required?: boolean | null
  payout_account_type?: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payout_account_verified?: boolean | null
  payout_account_verified_at?: string | null
  payout_bank_name?: string | null
  payout_bank_code?: string | null
  payout_account_name?: string | null
  payout_account_masked?: string | null
  payout_country_code?: string | null
  manual_bank_entry?: boolean | null
  manual_bank_name?: string | null
  manual_bank_country_code?: string | null
  manual_bank_country_name?: string | null
  manual_bank_swift_bic?: string | null
  manual_bank_account_name?: string | null
  manual_bank_verification_status?: string | null
  manual_bank_submitted_at?: string | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
  stripe_account_id?: string | null
  paystack_account_id?: string | null
  payout_account_change_count?: number | null
  payout_account_last_changed_at?: string | null
  payout_account_change_locked_until?: string | null
  payout_destination_hold_until?: string | null
  payout_name_match_status?: 'NOT_CHECKED' | 'MATCH' | 'REVIEW_REQUIRED' | 'MISMATCH' | null
  payout_name_match_checked_at?: string | null
  payout_name_match_metadata?: Record<string, unknown> | null
}

type PayoutChangeRequestRow = {
  id: string
  requested_destination?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  const payload =
    typeof body.error === 'string' && typeof body.message !== 'string'
      ? { ...body, message: body.error }
      : body
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function providerErrorResponse(error: unknown, headers: HeadersInit) {
  const message = error instanceof Error ? error.message : String(error)
  const isProviderish =
    message.includes('Paystack')
    || message.includes('Stripe')
    || message.includes('Missing Paystack')
    || message.includes('Missing Stripe')

  if (isProviderish) {
    return jsonResponse({ code: 'PAYOUT_PROVIDER_ERROR', error: message }, 503, headers)
  }

  return jsonResponse({ code: 'INTERNAL_ERROR', error: 'We could not complete payout setup right now.' }, 500, headers)
}

function normalizeCountryCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null
}

function normalizeNameForCompare(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

function maskAccountNumber(value: string) {
  const trimmed = value.trim().replace(/[\s-]+/gu, '')
  if (trimmed.length <= 4) return trimmed
  return `${'*'.repeat(Math.max(trimmed.length - 4, 4))}${trimmed.slice(-4)}`
}

function payoutSetupErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error)
  const cleaned = raw.replace(/^Paystack error:\s*/iu, '').trim()
  return cleaned || fallback
}

function paystackAccountVerificationError(error: unknown, headers: HeadersInit) {
  log('warn', FN, 'paystack.account_verification_failed', {
    error: error instanceof Error ? error.message : String(error),
  })
  return jsonResponse({
    code: 'PAYSTACK_ACCOUNT_VERIFICATION_FAILED',
    error: payoutSetupErrorMessage(
      error,
      'We could not verify this account number. Check the bank and account number, then try again.',
    ),
  }, 400, headers)
}

function paystackRecipientSetupError(error: unknown, headers: HeadersInit) {
  log('error', FN, 'paystack.recipient_setup_failed', {
    error: error instanceof Error ? error.message : String(error),
  })
  return jsonResponse({
    code: 'PAYSTACK_RECIPIENT_SETUP_FAILED',
    error: payoutSetupErrorMessage(
      error,
      'We verified the account, but Paystack could not create the payout recipient yet. Try again in a moment.',
    ),
  }, 503, headers)
}

function manualBankResetPatch() {
  return {
    manual_bank_entry: false,
    manual_bank_name: null,
    manual_bank_country_code: null,
    manual_bank_country_name: null,
    manual_bank_swift_bic: null,
    manual_bank_account_number: null,
    manual_bank_account_name: null,
    manual_bank_verification_status: 'NOT_SUBMITTED',
    manual_bank_submitted_at: null,
    manual_bank_verified_at: null,
    manual_bank_verified_by: null,
  }
}

function payoutProviderForCurrency(currency: string) {
  if (PAYSTACK_PAYOUT_CURRENCIES.has(currency)) return 'PAYSTACK' as const
  if (STRIPE_PAYOUT_CURRENCIES.has(currency)) return 'STRIPE' as const
  throw new Error(`Unsupported payout currency ${currency}`)
}

function addMsIso(iso: string, ms: number) {
  return new Date(Date.parse(iso) + ms).toISOString()
}

function isFutureIso(value: string | null | undefined, nowIso: string) {
  if (!value) return false
  const valueMs = Date.parse(value)
  const nowMs = Date.parse(nowIso)
  return Number.isFinite(valueMs) && Number.isFinite(nowMs) && valueMs > nowMs
}

function normalizedKeyPart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

function currentPayoutDestinationKey(profile: TailorProfileRow) {
  if (profile.payout_account_type === 'PAYSTACK') {
    return [
      'PAYSTACK',
      profile.payout_currency ?? '',
      profile.payout_bank_code ?? '',
      profile.payout_account_masked ?? '',
      normalizedKeyPart(profile.payout_account_name),
    ].join(':')
  }

  if (profile.payout_account_type === 'STRIPE_CONNECT') {
    return [
      'STRIPE_CONNECT',
      profile.payout_currency ?? '',
      profile.stripe_connect_account_id ?? profile.stripe_account_id ?? '',
    ].join(':')
  }

  if (profile.manual_bank_entry === true) {
    return [
      'MANUAL',
      profile.payout_currency ?? '',
      profile.manual_bank_country_code ?? profile.payout_country_code ?? '',
      normalizedKeyPart(profile.manual_bank_name ?? profile.payout_bank_name),
      profile.payout_account_masked ?? '',
      normalizedKeyPart(profile.manual_bank_account_name ?? profile.payout_account_name),
    ].join(':')
  }

  return null
}

function hasVerifiedPayoutDestination(profile: TailorProfileRow) {
  return profile.payout_account_verified === true
    && profile.payout_reverification_required !== true
    && currentPayoutDestinationKey(profile) !== null
}

function currentDestinationPayload(profile: TailorProfileRow) {
  return {
    payout_currency: profile.payout_currency ?? null,
    payout_provider: profile.payout_provider ?? null,
    payout_account_type: profile.payout_account_type ?? null,
    payout_account_verified: profile.payout_account_verified ?? false,
    payout_reverification_required: profile.payout_reverification_required ?? null,
    payout_bank_name: profile.payout_bank_name ?? null,
    payout_bank_code: profile.payout_bank_code ?? null,
    payout_account_name: profile.payout_account_name ?? null,
    payout_account_masked: profile.payout_account_masked ?? null,
    payout_country_code: profile.payout_country_code ?? null,
    paystack_recipient_code: profile.paystack_recipient_code ?? null,
    paystack_account_id: profile.paystack_account_id ?? null,
    stripe_connect_account_id: profile.stripe_connect_account_id ?? null,
    stripe_account_id: profile.stripe_account_id ?? null,
    manual_bank_entry: profile.manual_bank_entry ?? false,
    manual_bank_name: profile.manual_bank_name ?? null,
    manual_bank_country_code: profile.manual_bank_country_code ?? null,
    manual_bank_country_name: profile.manual_bank_country_name ?? null,
    manual_bank_swift_bic: profile.manual_bank_swift_bic ?? null,
    manual_bank_account_name: profile.manual_bank_account_name ?? null,
    manual_bank_verification_status: profile.manual_bank_verification_status ?? null,
    payout_name_match_status: profile.payout_name_match_status ?? 'NOT_CHECKED',
    payout_name_match_checked_at: profile.payout_name_match_checked_at ?? null,
    payout_name_match_metadata: profile.payout_name_match_metadata ?? {},
  }
}

async function createPayoutChangeReviewIssue(
  supabase: any,
  input: {
    callerId: string
    profile: TailorProfileRow
    requestId: string | null
    provider: 'PAYSTACK' | 'STRIPE'
    payoutCurrency: string
    title: string
    description: string
    metadata?: Record<string, unknown>
  },
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_BLOCKED',
    severity: 'HIGH',
    source: FN,
    actorId: input.callerId,
    actorRole: 'TAILOR',
    userId: input.callerId,
    tailorProfileId: input.profile.id,
    relatedEntityType: 'payout_change_request',
    relatedEntityId: input.requestId,
    provider: input.provider,
    title: input.title,
    description: input.description,
    recommendedAction: 'Compare the current payout destination against the requested destination, confirm account holder risk, then approve or reject the staged change.',
    dedupeKey: `payout-change:${input.profile.id}`,
    metadata: {
      request_id: input.requestId,
      payout_currency: input.payoutCurrency,
      ...(input.metadata ?? {}),
    },
  })
}

function payoutChangeGuardResponse(profile: TailorProfileRow, nextDestinationKey: string, nowIso: string, headers: HeadersInit) {
  const currentDestinationKey = currentPayoutDestinationKey(profile)
  const isDestinationChange = hasVerifiedPayoutDestination(profile)
    && currentDestinationKey !== null
    && currentDestinationKey !== nextDestinationKey

  if (!isDestinationChange || !isFutureIso(profile.payout_account_change_locked_until, nowIso)) {
    return null
  }

  const lockedUntil = profile.payout_account_change_locked_until as string
  const retryAfter = Math.max(60, Math.ceil((Date.parse(lockedUntil) - Date.parse(nowIso)) / 1000))
  return jsonResponse({
    code: 'PAYOUT_CHANGE_COOLDOWN',
    error: 'For account safety, payout destination changes are limited for a short period after a verified account is changed.',
    lockedUntil,
    retryAfter,
  }, 409, {
    ...headers,
    'Retry-After': String(retryAfter),
  })
}

function payoutChangePatch(profile: TailorProfileRow, nextDestinationKey: string, nowIso: string) {
  const currentDestinationKey = currentPayoutDestinationKey(profile)
  const isDestinationChange = hasVerifiedPayoutDestination(profile)
    && currentDestinationKey !== null
    && currentDestinationKey !== nextDestinationKey

  if (!isDestinationChange) {
    return {
      payout_account_last_changed_at: profile.payout_account_last_changed_at ?? nowIso,
    }
  }

  return {
    payout_account_change_count: (profile.payout_account_change_count ?? 0) + 1,
    payout_account_last_changed_at: nowIso,
    payout_account_change_locked_until: addMsIso(nowIso, PAYOUT_CHANGE_COOLDOWN_MS),
    payout_destination_hold_until: addMsIso(nowIso, PAYOUT_DESTINATION_HOLD_MS),
  }
}

async function loadTailorProfile(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select(`
      id,
      display_name,
      profile_completed,
      id_verification_status,
      is_live,
      payout_currency,
      payout_provider,
      payout_reverification_required,
      payout_account_type,
      payout_account_verified,
      payout_account_verified_at,
      payout_bank_name,
      payout_bank_code,
      payout_account_name,
      payout_account_masked,
      payout_country_code,
      manual_bank_entry,
      manual_bank_name,
      manual_bank_country_code,
      manual_bank_country_name,
      manual_bank_swift_bic,
      manual_bank_account_name,
      manual_bank_verification_status,
      manual_bank_submitted_at,
      paystack_recipient_code,
      stripe_connect_account_id,
      stripe_account_id,
      paystack_account_id,
      payout_account_change_count,
      payout_account_last_changed_at,
      payout_account_change_locked_until,
      payout_destination_hold_until,
      payout_name_match_status,
      payout_name_match_checked_at,
      payout_name_match_metadata
    `)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data as TailorProfileRow | null) ?? null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse({
        error: 'Please sign in again before managing your payout account.',
        message: 'Please sign in again before managing your payout account.',
      }, 401, cors)
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 40)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const profile = await loadTailorProfile(supabase, caller.id)
    if (!profile?.id) {
      return jsonResponse({ error: 'Complete your tailor profile before setting up payouts.' }, 404, cors)
    }

    const body = parsed.data

    if (body.action === 'get-status') {
      const payoutCurrency = normalizeAccountCurrency(profile.payout_currency) ?? 'USD'
      return jsonResponse({
        ok: true,
        profile: {
          id: profile.id,
          displayName: profile.display_name ?? 'Your tailor profile',
          payoutCurrency,
          payoutProvider: resolvePaymentProviderForCurrency(payoutCurrency),
          payoutAccountType: profile.payout_account_type ?? null,
          payoutAccountVerified: profile.payout_account_verified === true,
          payoutReverificationRequired: profile.payout_reverification_required === true,
          payoutAccountVerifiedAt: profile.payout_account_verified_at ?? null,
          payoutBankName: profile.payout_bank_name ?? null,
          payoutAccountName: profile.payout_account_name ?? null,
          payoutAccountMasked: profile.payout_account_masked ?? null,
          payoutCountryCode: profile.payout_country_code ?? null,
          manualBankEntry: profile.manual_bank_entry === true,
          manualBankName: profile.manual_bank_name ?? null,
          manualBankCountryCode: profile.manual_bank_country_code ?? null,
          manualBankCountryName: profile.manual_bank_country_name ?? null,
          manualBankSwiftBic: profile.manual_bank_swift_bic ?? null,
          manualBankAccountName: profile.manual_bank_account_name ?? null,
          manualBankVerificationStatus: profile.manual_bank_verification_status ?? 'NOT_SUBMITTED',
          manualBankSubmittedAt: profile.manual_bank_submitted_at ?? null,
          manualBankEntryEnabled: MANUAL_BANK_ENTRY_ENABLED,
          paystackRecipientCode: profile.paystack_recipient_code ?? null,
          stripeConnectAccountId: profile.stripe_connect_account_id ?? null,
          payoutAccountChangeCount: profile.payout_account_change_count ?? 0,
          payoutAccountLastChangedAt: profile.payout_account_last_changed_at ?? null,
          payoutAccountChangeLockedUntil: profile.payout_account_change_locked_until ?? null,
          payoutDestinationHoldUntil: profile.payout_destination_hold_until ?? null,
        },
      }, 200, cors)
    }

    if (body.action === 'list-paystack-banks') {
      const normalizedCountryCode =
        normalizeCountryCode(body.countryCode) ?? (body.payoutCurrency === 'NGN' ? 'NG' : body.payoutCurrency === 'GHS' ? 'GH' : 'KE')
      let banks
      let source: 'live' | 'fallback' = 'live'
      let warning: string | null = null

      try {
        banks = await listPaystackBanks({
          countryCode: normalizedCountryCode,
          currency: body.payoutCurrency,
        })
      } catch (error) {
        const fallbackBanks = fallbackPaystackBanks({
          countryCode: normalizedCountryCode,
          currency: body.payoutCurrency,
        })

        if (fallbackBanks.length === 0) {
          throw error
        }

        source = 'fallback'
        warning = 'Paystack is taking too long to return the live bank directory. Showing a fallback list so you can keep testing.'
        banks = fallbackBanks
        log('warn', FN, 'paystack.bank_list_fallback', {
          actor_id: caller.id,
          payout_currency: body.payoutCurrency,
          country_code: normalizedCountryCode,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      return jsonResponse({
        ok: true,
        source,
        warning,
        banks: banks
          .filter((bank) => bank.active !== false)
          .map((bank) => ({
            code: bank.code,
            name: bank.name,
            country: bank.country ?? null,
            currency: bank.currency ?? body.payoutCurrency,
            logoUrl: payoutBankLogoUrl(bank.name),
          })),
      }, 200, cors)
    }

    if (body.action === 'verify-paystack-account') {
      let resolved
      try {
        resolved = await resolvePaystackAccountNumber({
          accountNumber: body.accountNumber,
          bankCode: body.bankCode,
          currency: body.payoutCurrency,
        })
      } catch (error) {
        return paystackAccountVerificationError(error, cors)
      }

      return jsonResponse({
        ok: true,
        verification: {
          accountNumber: resolved.account_number,
          enteredAccountName: body.accountName?.trim() || null,
          resolvedAccountName: resolved.account_name,
          matchesEnteredName: body.accountName?.trim()
            ? normalizeNameForCompare(body.accountName) === normalizeNameForCompare(resolved.account_name)
            : null,
          maskedAccountNumber: maskAccountNumber(resolved.account_number),
          bankCode: body.bankCode.trim(),
          bankName: body.bankName.trim(),
          payoutCurrency: body.payoutCurrency,
          countryCode: normalizeCountryCode(body.countryCode),
        },
      }, 200, cors)
    }

    if (body.action === 'confirm-paystack-account') {
      let resolved
      try {
        resolved = await resolvePaystackAccountNumber({
          accountNumber: body.accountNumber,
          bankCode: body.bankCode,
          currency: body.payoutCurrency,
        })
      } catch (error) {
        return paystackAccountVerificationError(error, cors)
      }

      const resolvedName = normalizeNameForCompare(resolved.account_name)
      const enteredName = normalizeNameForCompare(body.accountName)
      if (resolvedName !== enteredName) {
        return jsonResponse({
          code: 'ACCOUNT_NAME_MISMATCH',
          error: 'The verified account name does not match what you entered. Please confirm the resolved account name before saving.',
          resolvedAccountName: resolved.account_name,
        }, 409, cors)
      }

      let recipient
      try {
        recipient = await createPaystackTransferRecipient({
          name: resolved.account_name,
          accountNumber: resolved.account_number,
          bankCode: body.bankCode,
          currency: body.payoutCurrency,
        })
      } catch (error) {
        return paystackRecipientSetupError(error, cors)
      }

      const now = new Date().toISOString()
      const payoutCountryCode = normalizeCountryCode(body.countryCode)
      const payoutBankName = body.bankName.trim()
      const payoutBankCode = body.bankCode.trim()
      const payoutAccountMasked = maskAccountNumber(resolved.account_number)
      const nextDestinationKey = [
        'PAYSTACK',
        body.payoutCurrency,
        payoutBankCode,
        payoutAccountMasked,
        normalizedKeyPart(resolved.account_name),
      ].join(':')
      const guardResponse = payoutChangeGuardResponse(profile, nextDestinationKey, now, cors)
      if (guardResponse) return guardResponse

      const paystackDestination = {
        payout_currency: body.payoutCurrency,
        payout_provider: 'PAYSTACK',
        payout_account_type: 'PAYSTACK',
        payout_account_verified: true,
        payout_reverification_required: false,
        payout_bank_name: payoutBankName,
        payout_bank_code: payoutBankCode,
        payout_account_name: resolved.account_name,
        payout_account_masked: payoutAccountMasked,
        payout_country_code: payoutCountryCode,
        paystack_recipient_code: recipient.recipient_code,
        paystack_account_id: recipient.recipient_code,
        stripe_connect_account_id: null,
        stripe_account_id: null,
        payout_name_match_status: 'NOT_CHECKED',
        payout_name_match_checked_at: null,
        payout_name_match_metadata: {
          provider: 'PAYSTACK',
          provider_owned_kyc: true,
          resolved_account_name: resolved.account_name,
        },
        ...manualBankResetPatch(),
      }

      if (isApprovedTailorProfile(profile)) {
        const request = await stagePayoutChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: profile.id,
          currentDestination: currentDestinationPayload(profile),
          requestedDestination: paystackDestination,
          metadata: { action: body.action, provider: 'PAYSTACK', next_destination_key: nextDestinationKey },
        })

        await createPayoutChangeReviewIssue(supabase, {
          callerId: caller.id,
          profile,
          requestId: request?.id ?? null,
          provider: 'PAYSTACK',
          payoutCurrency: body.payoutCurrency,
          title: 'Payout destination change needs review',
          description: `${profile.display_name ?? 'A tailor'} verified a new Paystack payout destination after approval. Existing payout details stay live until ops approves the change.`,
          metadata: { bank_name: payoutBankName, account_name: resolved.account_name, account_masked: payoutAccountMasked },
        })

        await audit(supabase, {
          event: 'seller.payout_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'warn',
          payload: { function: FN, provider: 'PAYSTACK', request_id: request?.id ?? null, payout_currency: body.payoutCurrency },
        })

        return jsonResponse({ ok: true, pendingReview: true, requestId: request?.id ?? null }, 200, cors)
      }

      const { error: currencyUpdateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_currency: body.payoutCurrency,
        })
        .eq('id', profile.id)

      if (currencyUpdateError) {
        throw currencyUpdateError
      }

      const { error: verificationUpdateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_provider: 'PAYSTACK',
          payout_account_type: 'PAYSTACK',
          payout_account_verified: true,
          payout_account_verified_at: now,
          payout_reverification_required: false,
          payout_bank_name: payoutBankName,
          payout_bank_code: payoutBankCode,
          payout_account_name: resolved.account_name,
          payout_account_masked: payoutAccountMasked,
          payout_country_code: payoutCountryCode,
          paystack_recipient_code: recipient.recipient_code,
          paystack_account_id: recipient.recipient_code,
          stripe_connect_account_id: null,
          stripe_account_id: null,
          payout_name_match_status: 'NOT_CHECKED',
          payout_name_match_checked_at: null,
          payout_name_match_metadata: {
            provider: 'PAYSTACK',
            provider_owned_kyc: true,
            resolved_account_name: resolved.account_name,
          },
          ...manualBankResetPatch(),
          ...payoutChangePatch(profile, nextDestinationKey, now),
        })
        .eq('id', profile.id)

      if (verificationUpdateError) {
        throw verificationUpdateError
      }

      await audit(supabase, {
        event: 'seller.payout_account_verified',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: 'info',
        payload: {
          function: FN,
          provider: 'PAYSTACK',
          payout_currency: body.payoutCurrency,
          recipient_code: recipient.recipient_code,
        },
      })

      return jsonResponse({
        ok: true,
        account: {
          id: profile.id,
          displayName: profile.display_name ?? 'Your tailor profile',
          payoutCurrency: body.payoutCurrency,
          payoutProvider: 'PAYSTACK',
          payoutAccountType: 'PAYSTACK',
          payoutAccountVerified: true,
          payoutReverificationRequired: false,
          payoutAccountVerifiedAt: now,
          payoutBankName,
          payoutAccountName: resolved.account_name,
          payoutAccountMasked,
          payoutCountryCode,
          manualBankEntry: false,
          manualBankName: null,
          manualBankCountryCode: null,
          manualBankCountryName: null,
          manualBankSwiftBic: null,
          manualBankAccountName: null,
          manualBankVerificationStatus: 'NOT_SUBMITTED',
          manualBankSubmittedAt: null,
          paystackRecipientCode: recipient.recipient_code,
          stripeConnectAccountId: null,
          payoutAccountChangeCount: hasVerifiedPayoutDestination(profile) && currentPayoutDestinationKey(profile) !== nextDestinationKey
            ? (profile.payout_account_change_count ?? 0) + 1
            : profile.payout_account_change_count ?? 0,
          payoutAccountLastChangedAt: now,
          payoutAccountChangeLockedUntil: hasVerifiedPayoutDestination(profile) && currentPayoutDestinationKey(profile) !== nextDestinationKey
            ? addMsIso(now, PAYOUT_CHANGE_COOLDOWN_MS)
            : profile.payout_account_change_locked_until ?? null,
          payoutDestinationHoldUntil: hasVerifiedPayoutDestination(profile) && currentPayoutDestinationKey(profile) !== nextDestinationKey
            ? addMsIso(now, PAYOUT_DESTINATION_HOLD_MS)
            : profile.payout_destination_hold_until ?? null,
        },
      }, 200, cors)
    }

    if (body.action === 'submit-manual-bank-entry') {
      if (!MANUAL_BANK_ENTRY_ENABLED) {
        return jsonResponse({
          code: 'MANUAL_BANK_ENTRY_DISABLED',
          error: 'Manual bank entry is paused for beta. Use Stripe or Paystack, or contact payouts if your bank is not listed.',
        }, 409, cors)
      }

      const validation = validateManualBankEntry(body)
      if (!validation.ok) {
        return jsonResponse({
          code: 'MANUAL_BANK_ENTRY_INVALID',
          error: validation.message,
          fieldErrors: validation.fieldErrors,
        }, 400, cors)
      }

      const manual = validation.value
      const now = new Date().toISOString()
      const provider = payoutProviderForCurrency(manual.payoutCurrency)
      const maskedAccountNumber = maskAccountNumber(manual.accountNumber)
      const nextDestinationKey = [
        'MANUAL',
        manual.payoutCurrency,
        manual.bankCountryCode,
        normalizedKeyPart(manual.bankName),
        maskedAccountNumber,
        normalizedKeyPart(manual.accountName),
      ].join(':')
      const guardResponse = payoutChangeGuardResponse(profile, nextDestinationKey, now, cors)
      if (guardResponse) return guardResponse

      const manualDestination = {
        payout_currency: manual.payoutCurrency,
        payout_provider: provider,
        payout_account_type: null,
        payout_account_verified: false,
        payout_reverification_required: true,
        payout_bank_name: manual.bankName,
        payout_bank_code: null,
        payout_account_name: manual.accountName,
        payout_account_masked: maskedAccountNumber,
        payout_country_code: manual.bankCountryCode,
        paystack_recipient_code: null,
        paystack_account_id: null,
        stripe_connect_account_id: null,
        stripe_account_id: null,
        manual_bank_entry: true,
        manual_bank_name: manual.bankName,
        manual_bank_country_code: manual.bankCountryCode,
        manual_bank_country_name: manual.bankCountryName,
        manual_bank_swift_bic: manual.swiftBic,
        manual_bank_account_number: manual.accountNumber,
        manual_bank_account_name: manual.accountName,
        manual_bank_verification_status: 'PENDING',
      }

      if (isApprovedTailorProfile(profile)) {
        const request = await stagePayoutChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: profile.id,
          currentDestination: currentDestinationPayload(profile),
          requestedDestination: manualDestination,
          metadata: { action: body.action, provider, next_destination_key: nextDestinationKey },
        })

        await createPayoutChangeReviewIssue(supabase, {
          callerId: caller.id,
          profile,
          requestId: request?.id ?? null,
          provider,
          payoutCurrency: manual.payoutCurrency,
          title: 'Manual payout destination change needs review',
          description: `${profile.display_name ?? 'A tailor'} submitted manual payout details after approval. Existing payout details stay live until ops approves the change.`,
          metadata: { bank_name: manual.bankName, bank_country_code: manual.bankCountryCode, account_name: manual.accountName, account_masked: maskedAccountNumber },
        })

        await audit(supabase, {
          event: 'seller.payout_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'warn',
          payload: { function: FN, provider, request_id: request?.id ?? null, payout_currency: manual.payoutCurrency, manual_bank_entry: true },
        })

        return jsonResponse({ ok: true, pendingReview: true, requestId: request?.id ?? null }, 200, cors)
      }

      const { error: updateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_currency: manual.payoutCurrency,
          payout_provider: provider,
          payout_account_type: null,
          payout_account_verified: false,
          payout_account_verified_at: null,
          payout_reverification_required: true,
          payout_bank_name: manual.bankName,
          payout_bank_code: null,
          payout_account_name: manual.accountName,
          payout_account_masked: maskedAccountNumber,
          payout_country_code: manual.bankCountryCode,
          paystack_recipient_code: null,
          paystack_account_id: null,
          stripe_connect_account_id: null,
          stripe_account_id: null,
          manual_bank_entry: true,
          manual_bank_name: manual.bankName,
          manual_bank_country_code: manual.bankCountryCode,
          manual_bank_country_name: manual.bankCountryName,
          manual_bank_swift_bic: manual.swiftBic,
          manual_bank_account_number: manual.accountNumber,
          manual_bank_account_name: manual.accountName,
          manual_bank_verification_status: 'PENDING',
          manual_bank_submitted_at: now,
          manual_bank_verified_at: null,
          manual_bank_verified_by: null,
          ...payoutChangePatch(profile, nextDestinationKey, now),
        })
        .eq('id', profile.id)

      if (updateError) {
        throw updateError
      }

      await createOrRefreshOpsIssue(supabase, {
        issueType: 'PAYOUT_BLOCKED',
        severity: 'HIGH',
        source: FN,
        actorId: caller.id,
        actorRole: 'TAILOR',
        userId: caller.id,
        tailorProfileId: profile.id,
        relatedEntityType: 'tailor_profile',
        relatedEntityId: profile.id,
        provider,
        title: 'Manual payout bank needs verification',
        description: `${profile.display_name ?? 'A tailor'} submitted manual bank details because their bank was not listed.`,
        recommendedAction: 'Verify the manual bank details, confirm the account holder, and only mark the payout account verified once the destination is safe for first payout.',
        dedupeKey: `manual-bank-entry:${profile.id}`,
        metadata: {
          payout_currency: manual.payoutCurrency,
          bank_name: manual.bankName,
          bank_country_code: manual.bankCountryCode,
          bank_country_name: manual.bankCountryName,
          swift_bic: manual.swiftBic,
          account_name: manual.accountName,
          account_masked: maskedAccountNumber,
          verification_status: 'PENDING',
          note_to_tailor: MANUAL_BANK_ENTRY_NOTE,
        },
      })

      await audit(supabase, {
        event: 'seller.manual_bank_entry_submitted',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: 'info',
        payload: {
          function: FN,
          payout_currency: manual.payoutCurrency,
          provider,
          bank_country_code: manual.bankCountryCode,
          manual_bank_entry: true,
        },
      })

      return jsonResponse({
        ok: true,
        account: {
          id: profile.id,
          displayName: profile.display_name ?? 'Your tailor profile',
          payoutCurrency: manual.payoutCurrency,
          payoutProvider: provider,
          payoutAccountType: null,
          payoutAccountVerified: false,
          payoutReverificationRequired: true,
          payoutAccountVerifiedAt: null,
          payoutBankName: manual.bankName,
          payoutAccountName: manual.accountName,
          payoutAccountMasked: maskedAccountNumber,
          payoutCountryCode: manual.bankCountryCode,
          manualBankEntry: true,
          manualBankName: manual.bankName,
          manualBankCountryCode: manual.bankCountryCode,
          manualBankCountryName: manual.bankCountryName,
          manualBankSwiftBic: manual.swiftBic,
          manualBankAccountName: manual.accountName,
          manualBankVerificationStatus: 'PENDING',
          manualBankSubmittedAt: now,
          paystackRecipientCode: null,
          stripeConnectAccountId: null,
          payoutAccountChangeCount: hasVerifiedPayoutDestination(profile) && currentPayoutDestinationKey(profile) !== nextDestinationKey
            ? (profile.payout_account_change_count ?? 0) + 1
            : profile.payout_account_change_count ?? 0,
          payoutAccountLastChangedAt: now,
          payoutAccountChangeLockedUntil: hasVerifiedPayoutDestination(profile) && currentPayoutDestinationKey(profile) !== nextDestinationKey
            ? addMsIso(now, PAYOUT_CHANGE_COOLDOWN_MS)
            : profile.payout_account_change_locked_until ?? null,
          payoutDestinationHoldUntil: hasVerifiedPayoutDestination(profile) && currentPayoutDestinationKey(profile) !== nextDestinationKey
            ? addMsIso(now, PAYOUT_DESTINATION_HOLD_MS)
            : profile.payout_destination_hold_until ?? null,
        },
      }, 200, cors)
    }

    if (body.action === 'start-stripe-connect') {
      const countryCode = normalizeCountryCode(body.countryCode)
      if (!countryCode) {
        return jsonResponse({ error: 'Enter the payout country first.' }, 400, cors)
      }

      const now = new Date().toISOString()
      let accountId = profile.stripe_connect_account_id?.trim() || null
      if (!accountId) {
        const account = await createStripeConnectAccount({
          email: caller.email ?? `${caller.id}@drapeon.co`,
          countryCode,
          metadata: {
            drape_user_id: caller.id,
            tailor_profile_id: profile.id,
          },
        })
        accountId = account.id
      }

      const nextDestinationKey = ['STRIPE_CONNECT', body.payoutCurrency, accountId].join(':')
      const guardResponse = payoutChangeGuardResponse(profile, nextDestinationKey, now, cors)
      if (guardResponse) return guardResponse

      const accountLink = await createStripeAccountLink({
        accountId,
        returnUrl: body.returnUrl,
        refreshUrl: body.refreshUrl,
      })

      const stripeDestination = {
        payout_currency: body.payoutCurrency,
        payout_provider: 'STRIPE',
        payout_account_type: 'STRIPE_CONNECT',
        payout_account_verified: false,
        payout_reverification_required: true,
        payout_country_code: countryCode,
        stripe_connect_account_id: accountId,
        stripe_account_id: accountId,
        paystack_recipient_code: null,
        paystack_account_id: null,
        payout_bank_name: null,
        payout_bank_code: null,
        payout_account_name: null,
        payout_account_masked: null,
        ...manualBankResetPatch(),
      }

      if (isApprovedTailorProfile(profile)) {
        const request = await stagePayoutChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: profile.id,
          currentDestination: currentDestinationPayload(profile),
          requestedDestination: stripeDestination,
          metadata: { action: body.action, provider: 'STRIPE', next_destination_key: nextDestinationKey },
        })

        await createPayoutChangeReviewIssue(supabase, {
          callerId: caller.id,
          profile,
          requestId: request?.id ?? null,
          provider: 'STRIPE',
          payoutCurrency: body.payoutCurrency,
          title: 'Stripe payout destination change needs review',
          description: `${profile.display_name ?? 'A tailor'} started a new Stripe payout destination after approval. Existing payout details stay live until ops approves the change.`,
          metadata: { stripe_connect_account_id: accountId, country_code: countryCode },
        })

        await audit(supabase, {
          event: 'seller.payout_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'warn',
          payload: { function: FN, provider: 'STRIPE', request_id: request?.id ?? null, payout_currency: body.payoutCurrency, stripe_connect_account_id: accountId },
        })

        return jsonResponse({
          ok: true,
          pendingReview: true,
          requestId: request?.id ?? null,
          onboarding: {
            provider: 'STRIPE',
            payoutCurrency: body.payoutCurrency,
            countryCode,
            stripeConnectAccountId: accountId,
            url: accountLink.url,
            expiresAt: accountLink.expires_at,
          },
        }, 200, cors)
      }

      const { error: updateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_currency: body.payoutCurrency,
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: false,
          payout_reverification_required: true,
          payout_country_code: countryCode,
          stripe_connect_account_id: accountId,
          stripe_account_id: accountId,
          paystack_recipient_code: null,
          paystack_account_id: null,
          payout_bank_name: null,
          payout_bank_code: null,
          payout_account_name: null,
          payout_account_masked: null,
          payout_account_verified_at: null,
          ...manualBankResetPatch(),
          ...payoutChangePatch(profile, nextDestinationKey, now),
        })
        .eq('id', profile.id)

      if (updateError) {
        throw updateError
      }

      return jsonResponse({
        ok: true,
        onboarding: {
          provider: 'STRIPE',
          payoutCurrency: body.payoutCurrency,
          countryCode,
          stripeConnectAccountId: accountId,
          url: accountLink.url,
          expiresAt: accountLink.expires_at,
        },
      }, 200, cors)
    }

    if (body.action === 'refresh-stripe-connect-status') {
      let accountId = profile.stripe_connect_account_id?.trim() || null
      let pendingPayoutRequest: PayoutChangeRequestRow | null = null
      if (!accountId) {
        const { data: pending, error: pendingError } = await supabase
          .from('payout_change_requests')
          .select('id, requested_destination, metadata')
          .eq('tailor_user_id', caller.id)
          .eq('status', 'PENDING')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (pendingError) throw pendingError
        pendingPayoutRequest = (pending as PayoutChangeRequestRow | null) ?? null
        const pendingStripeId = typeof pendingPayoutRequest?.requested_destination?.stripe_connect_account_id === 'string'
          ? pendingPayoutRequest.requested_destination.stripe_connect_account_id.trim()
          : ''
        accountId = pendingStripeId || null
      }

      if (!accountId) {
        return jsonResponse({ error: 'Stripe Connect is not started for this tailor yet.' }, 409, cors)
      }

      const account = await retrieveStripeConnectAccount(accountId)
      const verified = account.charges_enabled === true && account.payouts_enabled === true
      const now = new Date().toISOString()

      if (isApprovedTailorProfile(profile)) {
        const requestedDestination = {
          ...(pendingPayoutRequest?.requested_destination ?? {}),
          payout_provider: 'STRIPE',
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: verified,
          payout_reverification_required: verified ? false : true,
          stripe_connect_account_id: account.id,
          stripe_account_id: account.id,
          payout_country_code: normalizeCountryCode(account.country ?? profile.payout_country_code ?? null),
        }

        let requestId = pendingPayoutRequest?.id ?? null
        if (requestId) {
          const { error: pendingUpdateError } = await supabase
            .from('payout_change_requests')
            .update({
              current_destination: currentDestinationPayload(profile),
              requested_destination: requestedDestination,
              metadata: { ...(pendingPayoutRequest?.metadata ?? {}), action: body.action, provider: 'STRIPE', stripe_status_refreshed_at: now },
              submitted_at: now,
              updated_at: now,
            })
            .eq('id', requestId)
          if (pendingUpdateError) throw pendingUpdateError
        } else {
          const staged = await stagePayoutChangeRequest(supabase, {
            tailorUserId: caller.id,
            tailorProfileId: profile.id,
            currentDestination: currentDestinationPayload(profile),
            requestedDestination,
            metadata: { action: body.action, provider: 'STRIPE', stripe_status_refreshed_at: now },
          })
          requestId = staged?.id ?? null
        }

        if (verified) {
          await audit(supabase, {
            event: 'seller.payout_change_ready_for_review',
            actor_id: caller.id,
            actor_role: 'TAILOR',
            severity: 'warn',
            payload: {
              function: FN,
              provider: 'STRIPE',
              request_id: requestId,
              payout_currency: normalizeAccountCurrency(profile.payout_currency) ?? 'USD',
              stripe_connect_account_id: account.id,
            },
          })
        }

        return jsonResponse({
          ok: true,
          pendingReview: true,
          requestId,
          account: {
            provider: 'STRIPE',
            stripeConnectAccountId: account.id,
            chargesEnabled: account.charges_enabled === true,
            payoutsEnabled: account.payouts_enabled === true,
            detailsSubmitted: account.details_submitted === true,
            payoutAccountVerified: verified,
            payoutReverificationRequired: verified ? false : true,
            payoutAccountVerifiedAt: verified ? now : null,
            payoutCountryCode: normalizeCountryCode(account.country ?? profile.payout_country_code ?? null),
          },
        }, 200, cors)
      }

      const { error: updateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: verified,
          payout_reverification_required: verified ? false : true,
          payout_account_verified_at: verified ? now : null,
          stripe_connect_account_id: account.id,
          stripe_account_id: account.id,
          payout_country_code: normalizeCountryCode(account.country ?? profile.payout_country_code ?? null),
        })
        .eq('id', profile.id)

      if (updateError) {
        throw updateError
      }

      if (verified) {
        await audit(supabase, {
          event: 'seller.payout_account_verified',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'info',
          payload: {
            function: FN,
            provider: 'STRIPE',
            payout_currency: normalizeAccountCurrency(profile.payout_currency) ?? 'USD',
            stripe_connect_account_id: account.id,
          },
        })
      }

      return jsonResponse({
        ok: true,
        account: {
          provider: 'STRIPE',
          stripeConnectAccountId: account.id,
          chargesEnabled: account.charges_enabled === true,
          payoutsEnabled: account.payouts_enabled === true,
          detailsSubmitted: account.details_submitted === true,
          payoutAccountVerified: verified,
          payoutReverificationRequired: verified ? false : true,
          payoutAccountVerifiedAt: verified ? now : null,
          payoutCountryCode: normalizeCountryCode(account.country ?? profile.payout_country_code ?? null),
        },
      }, 200, cors)
    }

    return jsonResponse({
      error: 'Unsupported payout action.',
      message: 'Unsupported payout action.',
      code: 'UNSUPPORTED_ACTION',
    }, 400, cors)
  } catch (error) {
    log('error', FN, 'unhandled', {
      error: error instanceof Error ? error.message : String(error),
    })
    return providerErrorResponse(error, cors)
  }
})
