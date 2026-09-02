'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Landmark, ShieldCheck, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONTACTS, formatDate, formatDatabaseEnumLabel } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime, type AccountRouteIdentity } from '../account-route-runtime'

type Profile = {
  id: string
  currency: string | null
  payout_currency: string | null
  payout_provider: string | null
  payout_reverification_required: boolean | null
  payout_account_type: string | null
  payout_account_verified: boolean | null
  payout_bank_name: string | null
  payout_account_name: string | null
  payout_account_masked: string | null
  payout_country_code: string | null
  manual_bank_entry: boolean | null
  manual_bank_name: string | null
  manual_bank_verification_status: string | null
  paystack_recipient_code: string | null
  stripe_connect_account_id: string | null
}
type Pending = {
  id: string
  status: 'PENDING'
  submittedAt: string | null
  confirmationStatus: 'PENDING' | 'CONFIRMED'
  lifecycleState: 'AWAITING_CONFIRMATION' | 'SECURITY_HOLD' | 'OPS_REVIEW'
  confirmationExpiresAt: string | null
  holdUntil: string | null
  requestedDestination: {
    payoutProvider: string | null
    payoutCurrency: string | null
    payoutBankName: string | null
    payoutAccountName: string | null
    payoutAccountMasked: string | null
    payoutAccountVerified: boolean
  } | null
}
type Bank = { code: string; name: string; country?: string | null; currency?: string | null }
type Notice = { tone: 'error' | 'success'; text: string } | null
const input =
  'h-10 w-full rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15'
const primary =
  'h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:opacity-45'
const secondary =
  'h-10 rounded-[8px] border border-ui-border bg-white px-4 text-sm font-semibold text-ink hover:border-needle/40 disabled:opacity-45'
async function message(error: unknown) {
  try {
    const response = (error as { context?: Response }).context
    const body = response
      ? ((await response.clone().json()) as { message?: string; error?: string })
      : null
    return body?.message || body?.error || null
  } catch {
    return null
  }
}
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke('payout-account-action', { body })
  if (error) throw new Error((await message(error)) || 'Payout action could not finish.')
  const payload = (data ?? {}) as Record<string, unknown>
  if (payload.error) throw new Error(String(payload.message || payload.error))
  return payload as T
}
function status(profile: Profile) {
  if (profile.payout_reverification_required) return 'Reverification needed'
  if (profile.payout_account_verified) return 'Ready'
  if (profile.manual_bank_entry)
    return `Manual bank ${formatDatabaseEnumLabel(profile.manual_bank_verification_status, 'pending review').toLowerCase()}`
  if (profile.stripe_connect_account_id) return 'Stripe review needed'
  if (profile.paystack_recipient_code) return 'Paystack review needed'
  return 'Setup required'
}
function Section({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow?: string
  title: string
  body?: string
  children: React.ReactNode
}) {
  return (
    <section className="app-surface overflow-hidden">
      <header className="border-b border-ui-border px-5 py-4">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">{eyebrow}</p>
        ) : null}
        <h2 className="mt-1 text-xl font-semibold">{title}</h2>
        {body ? <p className="mt-2 text-sm leading-6 text-ink/58">{body}</p> : null}
      </header>
      {children}
    </section>
  )
}
function Alert({ notice }: { notice: Notice }) {
  return notice ? (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[8px] border p-3 text-sm ${notice.tone === 'error' ? 'border-rust/20 bg-rust/8 text-rust' : 'border-needle/20 bg-needle/8 text-needle'}`}
    >
      {notice.text}
    </p>
  ) : null
}

function PayoutContent({ userId, identity }: { userId: string; identity: AccountRouteIdentity }) {
  const router = useRouter()
  const params = useSearchParams()
  const returnHandled = useRef(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [payoutCurrency, setPayoutCurrency] = useState('USD')
  const [country, setCountry] = useState('US')
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [verified, setVerified] = useState<{
    resolvedAccountName: string
    maskedAccountNumber: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  useEffect(() => {
    let active = true
    if (identity.role !== 'TAILOR') {
      queueMicrotask(() => { if (active) setLoadState('ready') })
      return
    }
    queueMicrotask(() => { if (active) setLoadState('loading') })
    const supabase = createClient()
    void supabase
      .from('tailor_profiles')
      .select(
        'id, currency, payout_currency, payout_provider, payout_reverification_required, payout_account_type, payout_account_verified'
      )
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setLoadState(error ? 'error' : 'ready')
          return
        }
        const base = data as Pick<
          Profile,
          | 'id'
          | 'currency'
          | 'payout_currency'
          | 'payout_provider'
          | 'payout_reverification_required'
          | 'payout_account_type'
          | 'payout_account_verified'
        >
        setProfile((current) =>
          current || {
            ...base,
            payout_bank_name: null,
            payout_account_name: null,
            payout_account_masked: null,
            payout_country_code: null,
            manual_bank_entry: null,
            manual_bank_name: null,
            manual_bank_verification_status: null,
            paystack_recipient_code: null,
            stripe_connect_account_id: null,
          }
        )
        setPayoutCurrency(base.payout_currency || base.currency || 'USD')
        setLoadState('ready')
      })
    void invoke<{
      profile?: {
        id: string
        payoutCurrency?: string | null
        payoutProvider?: string | null
        payoutReverificationRequired?: boolean
        payoutAccountType?: string | null
        payoutAccountVerified?: boolean
        payoutBankName?: string | null
        payoutAccountName?: string | null
        payoutAccountMasked?: string | null
        payoutCountryCode?: string | null
        manualBankEntry?: boolean
        manualBankName?: string | null
        manualBankVerificationStatus?: string | null
        paystackRecipientCode?: string | null
        stripeConnectAccountId?: string | null
      }
      pendingPayoutChange?: Pending | null
    }>({ action: 'get-status' })
      .then((result) => {
        if (!active) return
        const secure = result.profile
        const next: Profile | null = secure
          ? {
              id: secure.id,
              currency: secure.payoutCurrency || null,
              payout_currency: secure.payoutCurrency || null,
              payout_provider: secure.payoutProvider || null,
              payout_reverification_required: secure.payoutReverificationRequired === true,
              payout_account_type: secure.payoutAccountType || null,
              payout_account_verified: secure.payoutAccountVerified === true,
              payout_bank_name: secure.payoutBankName || null,
              payout_account_name: secure.payoutAccountName || null,
              payout_account_masked: secure.payoutAccountMasked || null,
              payout_country_code: secure.payoutCountryCode || null,
              manual_bank_entry: secure.manualBankEntry === true,
              manual_bank_name: secure.manualBankName || null,
              manual_bank_verification_status: secure.manualBankVerificationStatus || null,
              paystack_recipient_code: secure.paystackRecipientCode || null,
              stripe_connect_account_id: secure.stripeConnectAccountId || null,
            }
          : null
        setProfile(next)
        setPending(result.pendingPayoutChange || null)
        setPayoutCurrency(next?.payout_currency || 'USD')
        setCountry(next?.payout_country_code || 'US')
        setLoadState('ready')
      })
      .catch(() => {
        if (active)
          setNotice({
            tone: 'error',
            text: 'Secure destination details are taking longer to refresh. Your saved destination has not changed.',
          })
      })
    return () => {
      active = false
    }
  }, [identity.role, revision, userId])
  const loadPending = useCallback(async () => {
    try {
      const result = await invoke<{ pendingPayoutChange?: Pending | null }>({
        action: 'get-status',
      })
      setPending(result.pendingPayoutChange || null)
    } catch {
      setNotice({
        tone: 'error',
        text: 'Current payout details remain active, but replacement status could not refresh.',
      })
    }
  }, [])
  useEffect(() => {
    if (profile) queueMicrotask(() => { void loadPending() })
  }, [loadPending, profile])
  useEffect(() => {
    if (!profile?.id || identity.role !== 'TAILOR') return
    const client = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRevision((value) => value + 1), 180)
    }
    const channel = client
      .channel(`web-payout:${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tailor_profiles', filter: `id=eq.${profile.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payout_change_requests', filter: `tailor_user_id=eq.${userId}` }, refresh)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [identity.role, profile?.id, userId])
  const paystack = ['NGN', 'GHS', 'KES'].includes(payoutCurrency)
  const stripe = ['USD', 'GBP', 'EUR', 'CAD'].includes(payoutCurrency)
  const paystackCountry =
    payoutCurrency === 'NGN'
      ? 'NG'
      : payoutCurrency === 'GHS'
        ? 'GH'
        : payoutCurrency === 'KES'
          ? 'KE'
          : country
  const bankOptions = useMemo(
    () => [...new Map(banks.map((bank) => [bank.code, bank])).values()],
    [banks]
  )
  const loadBanks = useCallback(
    async (quiet = false) => {
      if (!paystack) return
      setBusy('banks')
      if (!quiet) setNotice(null)
      try {
        const result = await invoke<{ banks?: Bank[]; warning?: string | null }>({
          action: 'list-paystack-banks',
          payoutCurrency,
          countryCode: paystackCountry,
        })
        setBanks(result.banks || [])
        if (result.warning) setNotice({ tone: 'success', text: result.warning })
      } catch (cause) {
        setNotice({
          tone: 'error',
          text: cause instanceof Error ? cause.message : 'Bank directory could not load.',
        })
      } finally {
        setBusy(null)
      }
    },
    [paystack, paystackCountry, payoutCurrency]
  )
  const directoryRef = useRef('')
  useEffect(() => {
    if (!profile || !paystack) return
    const key = `${payoutCurrency}:${paystackCountry}`
    if (directoryRef.current === key) return
    directoryRef.current = key
    setBanks([])
    setBankCode('')
    setBankName('')
    setVerified(null)
    void loadBanks(true)
  }, [loadBanks, paystack, paystackCountry, payoutCurrency, profile])
  const refreshStripe = useCallback(
    async (fromReturn = false) => {
      setBusy('refresh-stripe')
      setNotice(null)
      try {
        const result = await invoke<{
          pendingReview?: boolean
          confirmationRequired?: boolean
          account?: { payoutAccountVerified?: boolean } | null
        }>({ action: 'refresh-stripe-connect-status' })
        await loadPending()
        setRevision((v) => v + 1)
        setNotice({
          tone: 'success',
          text: result.confirmationRequired
            ? 'Replacement verified. Confirm it below; your current destination remains active until then.'
            : result.pendingReview
              ? 'Stripe still needs more information.'
              : result.account?.payoutAccountVerified
                ? 'Stripe payout account verified and active.'
                : 'Stripe status refreshed.',
        })
      } catch (cause) {
        setNotice({
          tone: 'error',
          text: cause instanceof Error ? cause.message : 'Stripe status could not refresh.',
        })
      } finally {
        setBusy(null)
        if (fromReturn) router.replace('/account/payout', { scroll: false })
      }
    },
    [loadPending, router]
  )
  const setup = params.get('setup')
  useEffect(() => {
    if (!profile || returnHandled.current || (setup !== 'complete' && setup !== 'refresh')) return
    returnHandled.current = true
    void refreshStripe(true)
  }, [profile, refreshStripe, setup])
  async function verify() {
    setBusy('verify')
    setNotice(null)
    try {
      const result = await invoke<{
        verification?: { resolvedAccountName: string; maskedAccountNumber: string }
      }>({
        action: 'verify-paystack-account',
        payoutCurrency,
        countryCode: paystackCountry,
        bankCode,
        bankName,
        accountNumber,
        accountName: accountName.trim() || undefined,
      })
      setVerified(result.verification || null)
      setNotice({
        tone: 'success',
        text: result.verification
          ? `Verified account name: ${result.verification.resolvedAccountName}`
          : 'Account verified.',
      })
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Account could not be verified.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function savePaystack() {
    if (!verified) {
      setNotice({ tone: 'error', text: 'Verify the account before saving it.' })
      return
    }
    setBusy('save-paystack')
    setNotice(null)
    try {
      const result = await invoke<{
        pendingReview?: boolean
        confirmationRequired?: boolean
        account?: { payoutAccountVerified?: boolean } | null
      }>({
        action: 'confirm-paystack-account',
        payoutCurrency,
        countryCode: paystackCountry,
        bankCode,
        bankName,
        accountNumber,
        accountName: verified.resolvedAccountName,
      })
      await loadPending()
      setRevision((v) => v + 1)
      setNotice({
        tone: 'success',
        text: result.confirmationRequired
          ? 'Replacement verified. Confirm it below; your current destination remains active.'
          : result.pendingReview
            ? 'Replacement is under review. Your current verified destination remains active.'
            : result.account?.payoutAccountVerified
              ? 'Paystack payout account verified and active.'
              : 'Paystack account saved.',
      })
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Payout account could not save.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function startStripe() {
    setBusy('stripe')
    setNotice(null)
    try {
      const origin = window.location.origin
      const result = await invoke<{ onboarding?: { url?: string | null } }>({
        action: 'start-stripe-connect',
        payoutCurrency,
        countryCode: country,
        returnUrl: `${origin}/account/payout?setup=complete`,
        refreshUrl: `${origin}/account/payout?setup=refresh`,
      })
      if (result.onboarding?.url) {
        window.location.assign(result.onboarding.url)
        return
      }
      setNotice({ tone: 'success', text: 'Stripe onboarding started.' })
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Stripe onboarding could not start.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function decide(action: 'confirm-payout-change' | 'cancel-payout-change') {
    if (!pending) return
    setBusy(action)
    setNotice(null)
    try {
      const result = await invoke<{ lifecycleState?: 'ACTIVATED' | 'OPS_REVIEW' }>({
        action,
        requestId: pending.id,
      })
      setNotice({
        tone: 'success',
        text:
          action === 'cancel-payout-change'
            ? 'Payout change cancelled. Your current destination was not changed.'
            : result.lifecycleState === 'ACTIVATED'
              ? 'New payout destination is active.'
              : 'Review started. Your current destination remains active.',
      })
      await loadPending()
      setRevision((v) => v + 1)
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Payout change could not finish.',
      })
    } finally {
      setBusy(null)
    }
  }
  if (loadState === 'loading')
    return (
      <section className="app-surface p-6" aria-busy="true">
        Loading payout setup…
      </section>
    )
  if (loadState === 'error')
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Payout setup unavailable</h2>
        <p className="mt-2 text-sm text-ink/58">Your saved destination has not changed.</p>
        <button className={`${primary} mt-4`} onClick={() => setRevision((v) => v + 1)}>
          Try again
        </button>
      </section>
    )
  if (!profile)
    return (
      <section className="app-surface p-6">
        <h2 className="text-xl font-semibold">Payout setup needs a tailor profile.</h2>
        <p className="mt-2 text-sm text-ink/58">
          Customer accounts do not receive tailor earnings.
        </p>
        <Link
          href="/apply?source=account"
          className="mt-4 inline-flex text-sm font-semibold text-needle"
        >
          Apply as a tailor
        </Link>
      </section>
    )
  return (
    <div className="grid gap-5 pb-10">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Status', status(profile)],
          [
            'Provider',
            formatDatabaseEnumLabel(
              profile.payout_provider || profile.payout_account_type,
              'Not set'
            ),
          ],
          ['Currency', profile.payout_currency || 'Not set'],
          [
            'Release',
            profile.payout_account_verified && !profile.payout_reverification_required
              ? 'Ready when eligible'
              : 'Verification needed',
          ],
        ].map(([label, value]) => (
          <div key={label} className="app-surface p-4">
            <WalletCards className="size-4 text-needle" />
            <p className="mt-3 text-xs text-ink/48">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </section>
      <Alert notice={notice} />
      <Section
        eyebrow="Current destination"
        title="Where earnings are sent"
        body="The active verified destination stays in place until a replacement is confirmed and approved."
      >
        <dl className="divide-y divide-ui-border px-5">
          {[
            ['Bank', profile.payout_bank_name || profile.manual_bank_name || 'Not set'],
            ['Account', profile.payout_account_masked || 'Not set'],
            ['Account name', profile.payout_account_name || 'Not set'],
            ['Paystack recipient', profile.paystack_recipient_code ? 'Saved' : 'Not saved'],
            ['Stripe Connect', profile.stripe_connect_account_id ? 'Connected' : 'Not started'],
            [
              'Manual bank',
              profile.manual_bank_entry
                ? formatDatabaseEnumLabel(profile.manual_bank_verification_status, 'Pending review')
                : 'Not used',
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-3">
              <dt className="text-xs font-semibold text-ink/45">{label}</dt>
              <dd className="text-right text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {pending?.requestedDestination ? (
        <Section
          eyebrow={
            pending.lifecycleState === 'AWAITING_CONFIRMATION'
              ? 'Confirmation required'
              : pending.lifecycleState === 'SECURITY_HOLD'
                ? 'Activating replacement'
                : 'Drapeon review'
          }
          title={
            pending.lifecycleState === 'AWAITING_CONFIRMATION'
              ? 'Confirm this payout change'
              : 'Your current destination stays active'
          }
          body={
            pending.lifecycleState === 'AWAITING_CONFIRMATION'
              ? 'Review and confirm within 48 hours. Nothing changes until you confirm.'
              : 'Drapeon is checking the replacement and will record the terminal outcome.'
          }
        >
          <dl className="divide-y divide-ui-border px-5">
            {[
              [
                'Provider',
                formatDatabaseEnumLabel(
                  pending.requestedDestination.payoutProvider,
                  'Not recorded'
                ),
              ],
              ['Currency', pending.requestedDestination.payoutCurrency || 'Not recorded'],
              ['Bank', pending.requestedDestination.payoutBankName || 'Not recorded'],
              ['Account name', pending.requestedDestination.payoutAccountName || 'Not recorded'],
              ['Account', pending.requestedDestination.payoutAccountMasked || 'Not recorded'],
              [
                'Provider check',
                pending.requestedDestination.payoutAccountVerified ? 'Verified' : 'Incomplete',
              ],
              ['Submitted', formatDate(pending.submittedAt, { fallback: 'Recorded' })],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-3">
                <dt className="text-xs font-semibold text-ink/45">{label}</dt>
                <dd className="text-right text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {pending.lifecycleState === 'AWAITING_CONFIRMATION' ? (
            <div className="flex flex-wrap gap-3 border-t border-ui-border p-5">
              <button
                className={primary}
                disabled={busy !== null}
                onClick={() => void decide('confirm-payout-change')}
              >
                {busy === 'confirm-payout-change' ? 'Confirming…' : 'Confirm this change'}
              </button>
              <button
                className={secondary}
                disabled={busy !== null}
                onClick={() => void decide('cancel-payout-change')}
              >
                Cancel request
              </button>
            </div>
          ) : null}
        </Section>
      ) : null}
      <Section
        eyebrow="Provider setup"
        title="Use an automated payout route"
        body="Stripe Connect handles USD, GBP, EUR, and CAD. Paystack handles NGN, GHS, and KES."
      >
        <div className="grid gap-5 p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-semibold">
              Payout currency
              <select
                className={input}
                value={payoutCurrency}
                onChange={(e) => {
                  const value = e.target.value
                  setPayoutCurrency(value)
                  setCountry(
                    value === 'NGN'
                      ? 'NG'
                      : value === 'GHS'
                        ? 'GH'
                        : value === 'KES'
                          ? 'KE'
                          : country
                  )
                  setBanks([])
                  setBankCode('')
                  setVerified(null)
                }}
              >
                {['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'].map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Country code
              <input
                className={input}
                value={paystack ? paystackCountry : country}
                readOnly={paystack}
                maxLength={2}
                onChange={(e) => {
                  setCountry(e.target.value.toUpperCase())
                  setVerified(null)
                }}
              />
            </label>
            <div className="flex items-end">
              {stripe ? (
                <button
                  className={`${primary} w-full`}
                  disabled={busy !== null}
                  onClick={() => void startStripe()}
                >
                  {busy === 'stripe' ? 'Opening Stripe…' : 'Start Stripe Connect'}
                </button>
              ) : (
                <button
                  className={`${secondary} w-full`}
                  disabled={busy !== null}
                  onClick={() => void loadBanks()}
                >
                  {busy === 'banks'
                    ? 'Loading banks…'
                    : bankOptions.length
                      ? 'Refresh banks'
                      : 'Retry banks'}
                </button>
              )}
            </div>
          </div>
          {profile.stripe_connect_account_id ? (
            <button
              className={`${secondary} w-fit`}
              disabled={busy !== null}
              onClick={() => void refreshStripe()}
            >
              {busy === 'refresh-stripe' ? 'Refreshing…' : 'Refresh Stripe status'}
            </button>
          ) : null}
          {paystack ? (
            <div className="grid gap-4 rounded-[8px] border border-ui-border bg-bone/35 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold">
                  Bank
                  <select
                    className={input}
                    value={bankCode}
                    disabled={busy === 'banks' || !bankOptions.length}
                    onChange={(e) => {
                      const bank = bankOptions.find((option) => option.code === e.target.value)
                      setBankCode(e.target.value)
                      setBankName(bank?.name || '')
                      setVerified(null)
                    }}
                  >
                    <option value="">
                      {busy === 'banks'
                        ? 'Loading banks…'
                        : bankOptions.length
                          ? 'Select bank'
                          : 'Banks unavailable'}
                    </option>
                    {bankOptions.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  Account number
                  <input
                    className={input}
                    value={accountNumber}
                    onChange={(e) => {
                      setAccountNumber(e.target.value)
                      setVerified(null)
                    }}
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold md:col-span-2">
                  Expected account name
                  <input
                    className={input}
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                  />
                </label>
              </div>
              {verified ? (
                <p className="rounded-[8px] border border-needle/20 bg-needle/8 p-3 text-sm text-needle">
                  Verified: {verified.resolvedAccountName} · {verified.maskedAccountNumber}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <button
                  className={secondary}
                  disabled={busy !== null || !bankCode || !accountNumber}
                  onClick={() => void verify()}
                >
                  {busy === 'verify' ? 'Verifying…' : 'Verify account'}
                </button>
                <button
                  className={primary}
                  disabled={busy !== null || !verified}
                  onClick={() => void savePaystack()}
                >
                  {busy === 'save-paystack' ? 'Saving…' : 'Save verified Paystack account'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Section>
      <Section
        eyebrow="Manual bank entry"
        title="Unsupported bank? Contact payout support"
        body="Manual bank details need a controlled review and recorded payout path before they can be used."
      >
        <div className="p-5">
          <a
            href={`mailto:${CONTACTS.payouts}?subject=Manual payout setup question`}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-rust/20 px-4 text-sm font-semibold text-rust"
          >
            <Landmark className="size-4" />
            Contact payouts
          </a>
        </div>
      </Section>
      <p className="flex items-center gap-2 text-xs text-ink/45">
        <ShieldCheck className="size-4 text-needle" />
        Drapeon stores provider references and status, not online-banking credentials.
      </p>
    </div>
  )
}
export function PayoutWorkspace() {
  return (
    <AccountRouteRuntime surface="payout">
      {({ session, identity }) => <PayoutContent userId={session.user.id} identity={identity} />}
    </AccountRouteRuntime>
  )
}
