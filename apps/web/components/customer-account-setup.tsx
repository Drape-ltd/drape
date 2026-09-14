'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import {
  SUPPORTED_ACCOUNT_CURRENCIES,
  detectCurrencyPreference,
  normalizePhoneForStorage,
  validatePhoneForProfile,
  type AccountCurrencyCode,
  type CurrencySource,
} from '@drape/shared'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { bootstrapWebOnboarding, type CustomerGarmentContext } from '../lib/account-bootstrap'
import { createClient } from '../lib/supabase'
import { PhoneNumberField } from './ui/phone-number-field'

type UnitPreference = 'in' | 'cm'
type SetupState = 'loading' | 'ready' | 'error'

type CustomerProfileRow = {
  display_name?: string | null
  phone?: string | null
  unit_preference?: string | null
  garment_context?: string | null
  measurements?: { unit?: unknown; garmentContext?: unknown } | null
}

const garmentOptions: Array<{
  value: CustomerGarmentContext
  label: string
  hint: string
}> = [
  { value: 'MENSWEAR', label: 'Menswear', hint: 'Suits, agbada, kaftans, shirts, and trousers' },
  { value: 'WOMENSWEAR', label: 'Womenswear', hint: 'Dresses, blouses, skirts, and saree blouses' },
  { value: 'BOTH', label: 'Both', hint: 'I order menswear and womenswear' },
  {
    value: 'PREFER_NOT_TO_SAY',
    label: 'Prefer not to say',
    hint: 'Tailors can work from my measurements',
  },
]

function browserLocale() {
  return typeof navigator === 'undefined'
    ? null
    : navigator.language || navigator.languages?.[0] || null
}

function normalizeGarmentContext(value: unknown): CustomerGarmentContext | null {
  if (value === 'PREFER_NOT') return 'PREFER_NOT_TO_SAY'
  return value === 'MENSWEAR' ||
    value === 'WOMENSWEAR' ||
    value === 'BOTH' ||
    value === 'PREFER_NOT_TO_SAY'
    ? value
    : null
}

function normalizeUnit(value: unknown): UnitPreference | null {
  return value === 'in' || value === 'cm' ? value : null
}

function profileIsComplete(profile: CustomerProfileRow | null, metadataPhone: string) {
  const measurements = profile?.measurements ?? {}
  return Boolean(
    String(profile?.display_name ?? '').trim() &&
    (String(profile?.phone ?? '').trim() || metadataPhone) &&
    normalizeUnit(profile?.unit_preference ?? measurements.unit) &&
    normalizeGarmentContext(profile?.garment_context ?? measurements.garmentContext)
  )
}

async function invokeProfileAction<T>(body: Record<string, unknown>) {
  const result = await createClient().functions.invoke('account-profile-action', { body })
  const payload = (result.data ?? {}) as T & { error?: string; message?: string }
  if (result.error || payload.error) {
    throw new Error(
      payload.message ||
        payload.error ||
        result.error?.message ||
        'That action could not be completed.'
    )
  }
  return payload
}

export function CustomerAccountSetup(): React.JSX.Element {
  const router = useRouter()
  const detectedCurrency = useMemo(() => detectCurrencyPreference({ locale: browserLocale() }), [])
  const [state, setState] = useState<SetupState>('loading')
  const [loadError, setLoadError] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [unitPreference, setUnitPreference] = useState<UnitPreference>('in')
  const [garmentContext, setGarmentContext] = useState<CustomerGarmentContext | null>(null)
  const [currency, setCurrency] = useState<AccountCurrencyCode>(detectedCurrency.currency)
  const [currencySource, setCurrencySource] = useState<CurrencySource>(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const [verifiedPhone, setVerifiedPhone] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null)
  const [busy, setBusy] = useState<'send' | 'verify' | 'save' | 'signout' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const supabase = createClient()

    async function load() {
      const { data, error: userError } = await supabase.auth.getUser()
      if (!active) return
      if (userError || !data.user) {
        router.replace('/sign-in?next=%2Faccount%2Fcustomer%2Fsetup' as Route)
        return
      }

      const [profileResult, accountResult] = await Promise.all([
        supabase
          .from('customer_profiles')
          .select('display_name, phone, unit_preference, garment_context, measurements')
          .eq('user_id', data.user.id)
          .maybeSingle(),
        supabase
          .from('users')
          .select('role, default_currency, currency_source, region_code')
          .eq('id', data.user.id)
          .maybeSingle(),
      ])
      if (!active) return
      if (profileResult.error || accountResult.error) {
        setLoadError('Your account setup could not load. Refresh to try again.')
        setState('error')
        return
      }

      const metadataRole = data.user.user_metadata?.role
      const accountRole = accountResult.data?.role
      const role =
        metadataRole === 'CUSTOMER' || metadataRole === 'TAILOR'
          ? metadataRole
          : accountRole === 'CUSTOMER' || accountRole === 'TAILOR'
            ? accountRole
            : null
      if (!role) {
        router.replace('/account/choose-role?next=%2Faccount%2Fcustomer%2Fsetup' as Route)
        return
      }
      if (role === 'TAILOR') {
        router.replace('/account/profile?setup=1' as Route)
        return
      }

      const profile = (profileResult.data ?? null) as CustomerProfileRow | null
      const metadataPhone = normalizePhoneForStorage(String(data.user.user_metadata?.phone ?? ''))
      if (profileIsComplete(profile, metadataPhone)) {
        router.replace('/account/orders' as Route)
        return
      }

      const metadataName = [
        data.user.user_metadata?.display_name,
        data.user.user_metadata?.full_name,
        data.user.user_metadata?.name,
      ].find((value) => typeof value === 'string' && value.trim())
      setDisplayName(String(profile?.display_name || metadataName || '').trim())
      setPhone(normalizePhoneForStorage(String(profile?.phone || metadataPhone || '')))
      setUnitPreference(
        normalizeUnit(profile?.unit_preference ?? profile?.measurements?.unit) ?? 'in'
      )
      setGarmentContext(
        normalizeGarmentContext(profile?.garment_context ?? profile?.measurements?.garmentContext)
      )

      const storedCurrency = accountResult.data?.default_currency
      if (
        typeof storedCurrency === 'string' &&
        (SUPPORTED_ACCOUNT_CURRENCIES as readonly string[]).includes(storedCurrency)
      ) {
        setCurrency(storedCurrency as AccountCurrencyCode)
        const storedSource = accountResult.data?.currency_source
        if (
          storedSource === 'IP_GEO' ||
          storedSource === 'DEVICE_LOCALE' ||
          storedSource === 'USER_SELECTED' ||
          storedSource === 'UNSUPPORTED_FALLBACK'
        ) {
          setCurrencySource(storedSource)
        }
        if (typeof accountResult.data?.region_code === 'string') {
          setRegionCode(accountResult.data.region_code)
        }
      }

      const metadataVerifiedPhone = normalizePhoneForStorage(
        String(data.user.user_metadata?.verified_phone ?? '')
      )
      setVerifiedPhone(metadataVerifiedPhone)
      setState('ready')
    }

    void load().catch(() => {
      if (!active) return
      setLoadError('Your account setup could not load. Refresh to try again.')
      setState('error')
    })
    return () => {
      active = false
    }
  }, [router])

  const normalizedPhone = normalizePhoneForStorage(phone)
  const phoneAlreadyVerified = Boolean(normalizedPhone && normalizedPhone === verifiedPhone)

  function validate() {
    const nameError = validateDisplayName(displayName)
    if (nameError) return nameError
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) return phoneError
    if (!garmentContext) return 'Choose what you typically order to continue.'
    return null
  }

  async function finishSetup() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy('save')
    setError('')
    try {
      await bootstrapWebOnboarding(createClient(), {
        userId: '',
        onboarding: {
          source: 'web',
          role: 'CUSTOMER',
          displayName: displayName.trim(),
          phone: normalizedPhone,
          defaultCurrency: currency,
          currencySource,
          regionCode,
          customer: { unitPreference, garmentContext: garmentContext! },
        },
      })
      await createClient().auth.refreshSession()
      router.replace('/account/orders?welcome=1' as Route)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your setup could not be saved. Try again.')
      setBusy(null)
    }
  }

  async function sendCode() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy('send')
    setError('')
    try {
      const availability = await invokeProfileAction<{ available?: boolean }>({
        action: 'check-phone-availability',
        phone: normalizedPhone,
      })
      if (availability.available !== true)
        throw new Error('That phone number is already connected to another Drapeon account.')
      const result = await invokeProfileAction<{
        ok?: boolean
        verified?: boolean
        bypassed?: boolean
        expiresAt?: string | null
      }>({ action: 'send-phone-otp', phone: normalizedPhone })
      if (result.verified === true || result.bypassed === true) {
        setVerifiedPhone(normalizedPhone)
        setBusy(null)
        await finishSetup()
        return
      }
      setOtpSent(true)
      setOtpExpiresAt(result.expiresAt ?? null)
      setBusy(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The verification code could not be sent.')
      setBusy(null)
    }
  }

  async function verifyCode() {
    if (otpCode.replace(/\D/gu, '').length !== 6) {
      setError('Enter the 6-digit verification code.')
      return
    }
    setBusy('verify')
    setError('')
    try {
      const result = await invokeProfileAction<{ ok?: boolean; verified?: boolean }>({
        action: 'verify-phone-otp',
        phone: normalizedPhone,
        code: otpCode,
      })
      if (result.verified !== true) throw new Error('That code could not be verified.')
      setVerifiedPhone(normalizedPhone)
      setBusy(null)
      await finishSetup()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That code could not be verified.')
      setBusy(null)
    }
  }

  async function handleUseAnotherAccount() {
    setBusy('signout')
    await createClient()
      .auth.signOut({ scope: 'local' })
      .catch(() => undefined)
    router.replace('/sign-in' as Route)
  }

  if (state === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-bone">
        <p className="text-sm font-semibold text-ink/60">Loading your setup…</p>
      </main>
    )
  }
  if (state === 'error') {
    return (
      <main className="grid min-h-screen place-items-center bg-bone px-5">
        <div className="w-full max-w-lg rounded-[8px] border border-rust/20 bg-white p-6">
          <h1 className="text-3xl text-ink">Setup unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-ink/64">{loadError}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f0e8_100%)] px-5 py-8">
      <section className="mx-auto max-w-2xl">
        <div className="rounded-[8px] border border-ink/8 bg-white/92 p-6 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Almost there
          </p>
          <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
            Finish your Drapeon profile.
          </h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">
            Your Google or Apple account is connected. Add the private account details Drapeon needs
            for orders, recovery, and measurements.
          </p>

          <div className="mt-7 grid gap-5">
            <label className="grid gap-2 text-sm font-semibold text-ink">
              Display name
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setError('')
                }}
                className="min-h-12 rounded-[8px] border border-ink/12 bg-white px-4 outline-none focus:border-needle"
                placeholder="Your name"
                autoComplete="name"
              />
            </label>

            <PhoneNumberField
              value={phone}
              onValueChange={(value) => {
                setPhone(value)
                setOtpSent(false)
                setOtpCode('')
                setError('')
              }}
              error={null}
              onClearError={() => setError('')}
              hint="Used privately for order updates and account recovery."
              aria-label="Phone number"
            />

            <fieldset>
              <legend className="text-sm font-semibold text-ink">Measurement unit</legend>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {(
                  [
                    ['in', 'Inches'],
                    ['cm', 'Centimetres'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={unitPreference === value}
                    onClick={() => setUnitPreference(value)}
                    className={`min-h-12 rounded-[8px] border px-4 text-sm font-semibold ${unitPreference === value ? 'border-needle bg-needle/8 text-needle' : 'border-ink/12 bg-white text-ink'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-ink">
                What do you typically order?
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {garmentOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={garmentContext === option.value}
                    onClick={() => {
                      setGarmentContext(option.value)
                      setError('')
                    }}
                    className={`min-h-24 rounded-[8px] border p-4 text-left ${garmentContext === option.value ? 'border-needle bg-needle/8' : 'border-ink/12 bg-white'}`}
                  >
                    <span className="block text-sm font-semibold text-ink">{option.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-ink/56">{option.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="grid gap-2 text-sm font-semibold text-ink">
              Account currency
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value as AccountCurrencyCode)
                  setCurrencySource('USER_SELECTED')
                }}
                className="min-h-12 rounded-[8px] border border-ink/12 bg-white px-4 outline-none focus:border-needle"
              >
                {SUPPORTED_ACCOUNT_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal leading-5 text-ink/52">
                This controls new prices you see. Existing orders keep their original currency.
              </span>
            </label>

            {otpSent ? (
              <div className="rounded-[8px] border border-needle/20 bg-needle/6 p-4">
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  Verification code
                  <input
                    value={otpCode}
                    onChange={(event) => {
                      setOtpCode(event.target.value.replace(/\D/gu, '').slice(0, 6))
                      setError('')
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="min-h-12 rounded-[8px] border border-ink/12 bg-white px-4 text-center font-mono text-xl tracking-[0.24em] outline-none focus:border-needle"
                    placeholder="000000"
                  />
                </label>
                <p className="mt-2 text-xs leading-5 text-ink/52">
                  {otpExpiresAt
                    ? `Use the code sent by SMS before ${new Date(otpExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                    : 'Use the code sent by SMS.'}
                </p>
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-[8px] border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-rust"
              >
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (otpSent && !phoneAlreadyVerified) void verifyCode()
                else if (phoneAlreadyVerified) void finishSetup()
                else void sendCode()
              }}
              className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle-600 disabled:bg-ink/20"
            >
              {busy === 'send'
                ? 'Sending code…'
                : busy === 'verify'
                  ? 'Verifying…'
                  : busy === 'save'
                    ? 'Finishing setup…'
                    : otpSent && !phoneAlreadyVerified
                      ? 'Verify and finish'
                      : phoneAlreadyVerified
                        ? 'Finish setup'
                        : 'Verify phone and finish'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleUseAnotherAccount()}
              className="text-sm font-semibold text-ink/56 hover:text-ink"
            >
              {busy === 'signout' ? 'Signing out…' : 'Use a different account'}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
