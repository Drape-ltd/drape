import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createPaystackTransferRecipient, fallbackPaystackBanks, listPaystackBanks, resolvePaystackAccountNumber } from '../_shared/paystack.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { createStripeAccountLink, createStripeConnectAccount, retrieveStripeConnectAccount } from '../_shared/stripe.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency, resolvePaymentProviderForCurrency } from '../../../packages/shared/src/currency-config.ts'

const FN = 'payout-account-action'
const PAYSTACK_PAYOUT_CURRENCIES = new Set(['NGN', 'GHS', 'KES'])
const STRIPE_PAYOUT_CURRENCIES = new Set(['USD', 'GBP', 'EUR', 'CAD'])

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
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
  stripe_account_id?: string | null
  paystack_account_id?: string | null
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
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
    return jsonResponse({ error: message }, 503, headers)
  }

  return new Response('Internal server error', { status: 500, headers })
}

function normalizeCountryCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null
}

function normalizeNameForCompare(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

function maskAccountNumber(value: string) {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return trimmed
  return `${'*'.repeat(Math.max(trimmed.length - 4, 4))}${trimmed.slice(-4)}`
}

function payoutProviderForCurrency(currency: string) {
  if (PAYSTACK_PAYOUT_CURRENCIES.has(currency)) return 'PAYSTACK' as const
  if (STRIPE_PAYOUT_CURRENCIES.has(currency)) return 'STRIPE' as const
  throw new Error(`Unsupported payout currency ${currency}`)
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
      paystack_recipient_code,
      stripe_connect_account_id,
      stripe_account_id,
      paystack_account_id
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
      return new Response('Unauthorized', { status: 401, headers: cors })
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', { actor_id: caller.id, error: parsed.error })
      return new Response(parsed.error, { status: 400, headers: cors })
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
      return new Response('Too many requests', { status: 429, headers: cors })
    }

    const profile = await loadTailorProfile(supabase, caller.id)
    if (!profile?.id) {
      return new Response('Tailor profile not found.', { status: 404, headers: cors })
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
          paystackRecipientCode: profile.paystack_recipient_code ?? null,
          stripeConnectAccountId: profile.stripe_connect_account_id ?? null,
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
          })),
      }, 200, cors)
    }

    if (body.action === 'verify-paystack-account') {
      const resolved = await resolvePaystackAccountNumber({
        accountNumber: body.accountNumber,
        bankCode: body.bankCode,
        currency: body.payoutCurrency,
      })

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
      const resolved = await resolvePaystackAccountNumber({
        accountNumber: body.accountNumber,
        bankCode: body.bankCode,
        currency: body.payoutCurrency,
      })

      const resolvedName = normalizeNameForCompare(resolved.account_name)
      const enteredName = normalizeNameForCompare(body.accountName)
      if (resolvedName !== enteredName) {
        return jsonResponse({
          code: 'ACCOUNT_NAME_MISMATCH',
          error: 'The verified account name does not match what you entered. Please confirm the resolved account name before saving.',
          resolvedAccountName: resolved.account_name,
        }, 409, cors)
      }

      const recipient = await createPaystackTransferRecipient({
        name: resolved.account_name,
        accountNumber: resolved.account_number,
        bankCode: body.bankCode,
        currency: body.payoutCurrency,
      })

      const now = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_currency: body.payoutCurrency,
          payout_account_type: 'PAYSTACK',
          payout_account_verified: true,
          payout_account_verified_at: now,
          payout_reverification_required: false,
          payout_bank_name: body.bankName.trim(),
          payout_bank_code: body.bankCode.trim(),
          payout_account_name: resolved.account_name,
          payout_account_masked: maskAccountNumber(resolved.account_number),
          payout_country_code: normalizeCountryCode(body.countryCode),
          paystack_recipient_code: recipient.recipient_code,
          paystack_account_id: recipient.recipient_code,
          stripe_connect_account_id: null,
          stripe_account_id: null,
        })
        .eq('id', profile.id)

      if (updateError) {
        throw updateError
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
          provider: 'PAYSTACK',
          payoutCurrency: body.payoutCurrency,
          payoutAccountType: 'PAYSTACK',
          payoutAccountVerified: true,
          payoutAccountVerifiedAt: now,
          payoutBankName: body.bankName.trim(),
          payoutAccountName: resolved.account_name,
          payoutAccountMasked: maskAccountNumber(resolved.account_number),
          payoutCountryCode: normalizeCountryCode(body.countryCode),
          paystackRecipientCode: recipient.recipient_code,
        },
      }, 200, cors)
    }

    if (body.action === 'start-stripe-connect') {
      const countryCode = normalizeCountryCode(body.countryCode)
      if (!countryCode) {
        return jsonResponse({ error: 'Enter the payout country first.' }, 400, cors)
      }

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

      const accountLink = await createStripeAccountLink({
        accountId,
        returnUrl: body.returnUrl,
        refreshUrl: body.refreshUrl,
      })

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
      const accountId = profile.stripe_connect_account_id?.trim()
      if (!accountId) {
        return jsonResponse({ error: 'Stripe Connect is not started for this tailor yet.' }, 409, cors)
      }

      const account = await retrieveStripeConnectAccount(accountId)
      const verified = account.charges_enabled === true && account.payouts_enabled === true
      const now = new Date().toISOString()

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

    return new Response('Unsupported action', { status: 400, headers: cors })
  } catch (error) {
    log('error', FN, 'unhandled', {
      error: error instanceof Error ? error.message : String(error),
    })
    return providerErrorResponse(error, cors)
  }
})
