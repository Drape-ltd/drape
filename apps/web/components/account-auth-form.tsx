'use client'

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'
import {
  currencyDisplayLabel,
  currencySymbol,
  detectCurrencyPreference,
  normalizePhoneForStorage,
  SUPPORTED_ACCOUNT_CURRENCIES,
  validatePhoneForProfile,
  type AccountCurrencyCode,
  type CurrencySource,
} from '@drape/shared'
import { createClient } from '../lib/supabase'
import {
  bootstrapWebOnboarding,
  type CustomerGarmentContext,
  type DrapeRole,
  type MeasurementUnit,
  type TailorFulfillment,
  type WebOnboardingPayload,
} from '../lib/account-bootstrap'

type AuthMode = 'sign-in' | 'sign-up'

const GARMENT_OPTIONS: Array<{ value: CustomerGarmentContext; label: string; hint: string }> = [
  { value: 'MENSWEAR', label: 'Menswear', hint: 'Agbada, kaftans, suits, shirts, trousers' },
  { value: 'WOMENSWEAR', label: 'Womenswear', hint: 'Dresses, blouses, skirts, occasionwear' },
  { value: 'BOTH', label: 'Both', hint: 'I order across menswear and womenswear' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say', hint: 'Tailors can work from measurements only' },
]

const FULFILLMENT_OPTIONS: Array<{ value: TailorFulfillment; label: string }> = [
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'SHIPPING', label: 'Shipping' },
]

const SUPPORTED_CURRENCIES = SUPPORTED_ACCOUNT_CURRENCIES.map((code) => ({
  code,
  symbol: currencySymbol(code),
  name: currencyDisplayLabel(code),
}))

function normalizeRole(value: string | null): DrapeRole {
  return value?.toLowerCase() === 'tailor' ? 'TAILOR' : 'CUSTOMER'
}

function roleLabel(role: DrapeRole) {
  return role === 'TAILOR' ? 'tailor' : 'customer'
}

function mapAuthError(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')) {
    return 'Incorrect email or password.'
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'This email already has a Drapeon account. Sign in instead.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Check your email and confirm your Drapeon account before signing in.'
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Please wait a minute before trying again.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Connection looks weak. Try again when the signal improves.'
  }
  return 'We could not complete this step right now. Please try again.'
}

function browserLocale() {
  if (typeof navigator === 'undefined') return null
  return navigator.language || navigator.languages?.[0] || null
}

function parseList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseMajorAmountToMinor(value: string) {
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function fieldHasContactLeak(value: string, label: string): string | null {
  if (!value.trim()) return null
  const result = filterContactInfo(value)
  if (!result.blocked) return null
  return `${label} can't include phone numbers, emails, links, social handles, or off-platform contact instructions.`
}

export function AccountAuthForm({ mode }: { mode: AuthMode }): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialRole = useMemo(() => normalizeRole(searchParams.get('role')), [searchParams])
  const detectedCurrency = useMemo(() => detectCurrencyPreference({ locale: browserLocale() }), [])
  const [role, setRole] = useState<DrapeRole>(initialRole)
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [defaultCurrency, setDefaultCurrency] = useState<AccountCurrencyCode>(detectedCurrency.currency)
  const [currencySource, setCurrencySource] = useState<CurrencySource>(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const [unitPreference, setUnitPreference] = useState<MeasurementUnit>('in')
  const [garmentContext, setGarmentContext] = useState<CustomerGarmentContext | ''>('')
  const [tailorLocation, setTailorLocation] = useState('')
  const [tailorLanguages, setTailorLanguages] = useState('English')
  const [tailorSpecialties, setTailorSpecialties] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [fulfillment, setFulfillment] = useState<TailorFulfillment[]>(['PICKUP'])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null)
  const isSignUp = mode === 'sign-up'

  function getSupabase() {
    try {
      return createClient()
    } catch {
      setError('Account access is temporarily unavailable. Please try again later or contact support.')
      return null
    }
  }

  function buildOnboardingPayload(): WebOnboardingPayload | null {
    const normalizedPhone = normalizePhoneForStorage(phone)
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) {
      setError('Enter a valid phone number for order updates and account recovery.')
      return null
    }

    const base = {
      source: 'web' as const,
      role,
      displayName: displayName.trim(),
      phone: normalizedPhone,
      defaultCurrency,
      currencySource,
      regionCode: regionCode || detectedCurrency.regionCode || 'ZZ',
    }

    if (role === 'CUSTOMER') {
      if (!garmentContext) {
        setError('Choose what you typically order so tailors get the right fit context.')
        return null
      }
      return {
        ...base,
        customer: {
          unitPreference,
          garmentContext,
        },
      }
    }

    const languages = parseList(tailorLanguages)
    const specialties = parseList(tailorSpecialties)
    const priceRangeMin = parseMajorAmountToMinor(priceMin)
    const priceRangeMax = parseMajorAmountToMinor(priceMax)
    if (tailorLocation.trim().length < 2) {
      setError('Add your city or base location.')
      return null
    }
    const contactLeakError =
      fieldHasContactLeak(tailorLocation, 'Location') ||
      fieldHasContactLeak(tailorLanguages, 'Languages') ||
      fieldHasContactLeak(tailorSpecialties, 'Specialties')
    if (contactLeakError) {
      setError(contactLeakError)
      return null
    }
    if (languages.length === 0) {
      setError('Add at least one language you work in.')
      return null
    }
    if (specialties.length === 0) {
      setError('Add at least one specialty, like Agbada, alterations, bridal, or Ankara.')
      return null
    }
    if (!priceRangeMin || !priceRangeMax || priceRangeMax < priceRangeMin) {
      setError('Add a valid starting and high-end price range.')
      return null
    }
    if (!supportsCustomOrders && !supportsReadyMade) {
      setError('Choose custom orders, ready-made items, or both.')
      return null
    }
    if (fulfillment.length === 0) {
      setError('Choose at least one fulfillment option.')
      return null
    }

    return {
      ...base,
      tailor: {
        location: tailorLocation.trim(),
        languages,
        specialties,
        priceRangeMin,
        priceRangeMax,
        supportsCustomOrders,
        supportsReadyMade,
        fulfillment,
      },
    }
  }

  function validate(options?: { credentials?: boolean }) {
    const normalizedEmail = email.trim().toLowerCase()
    if (options?.credentials !== false && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return 'Enter a valid email address.'
    }
    if (isSignUp) {
      const nameError = validateDisplayName(displayName)
      if (nameError) return nameError
      if (!phone.trim()) return 'Enter a phone number for order updates and account recovery.'
      const normalizedPhone = normalizePhoneForStorage(phone)
      const phoneError = validatePhoneForProfile(normalizedPhone)
      if (phoneError) return phoneError
      if (options?.credentials === false) return null
      const passwordError = validatePasswordStrength(password, {
        forbiddenValues: [normalizedEmail, displayName],
      })
      if (passwordError) return passwordError
      if (password !== confirmPassword) return 'Passwords do not match.'
    }
    if (options?.credentials !== false && !password) return 'Enter your password.'
    return null
  }

  async function submit() {
    if (loading || oauthLoading) return
    setError(null)
    setMessage(null)

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const redirectTo = `${window.location.origin}/account/dashboard`

    if (isSignUp) {
      const onboarding = buildOnboardingPayload()
      if (!onboarding) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            display_name: displayName.trim(),
            phone: onboarding.phone,
            role,
            web_onboarding: onboarding,
          },
        },
      })

      setLoading(false)
      if (error) {
        setError(mapAuthError(error.message))
        return
      }
      if (!data.session) {
        setMessage('Check your email to confirm your Drapeon account, then sign in.')
        return
      }
      await bootstrapWebOnboarding(supabase, {
        userId: data.session.user.id,
        onboarding,
      })
      router.replace('/account/dashboard')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })
    if (error) {
      setLoading(false)
      setError(mapAuthError(error.message))
      return
    }

    setLoading(false)
    router.replace('/account/dashboard')
  }

  async function oauth(provider: 'google' | 'apple') {
    if (loading || oauthLoading) return
    setError(null)
    setMessage(null)
    let onboarding: WebOnboardingPayload | null = null
    if (isSignUp) {
      const validationError = validate({ credentials: false })
      if (validationError) {
        setError(validationError)
        return
      }
      onboarding = buildOnboardingPayload()
      if (!onboarding) return
    }
    const supabase = getSupabase()
    if (!supabase) return

    setOauthLoading(provider)
    if (isSignUp) {
      window.localStorage.setItem('drapeon.web.auth.roleIntent', role)
      if (onboarding) {
        window.localStorage.setItem('drapeon.web.auth.onboarding', JSON.stringify(onboarding))
      }
    } else {
      window.localStorage.removeItem('drapeon.web.auth.roleIntent')
      window.localStorage.removeItem('drapeon.web.auth.onboarding')
    }
    const next = encodeURIComponent('/account/dashboard')
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
      },
    })
    setOauthLoading(null)
    if (error) {
      setError(mapAuthError(error.message))
    }
  }

  return (
    <div className="rounded-[1.6rem] border border-ink/8 bg-white/88 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          {isSignUp ? 'Create account' : 'Sign in'}
        </p>
        <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
          {isSignUp ? `Start as a ${roleLabel(role)}.` : 'Sign in to Drapeon.'}
        </h1>
        <p className="mt-4 text-sm leading-7 text-ink/66">
          {isSignUp
            ? 'Choose a starting side. You can add the other later.'
            : 'Use the same account from the app.'}
        </p>
      </div>

      {isSignUp ? (
        <div className="mt-6 grid grid-cols-2 gap-2 rounded-[1.1rem] border border-ink/8 bg-bone/70 p-1.5">
          {(['CUSTOMER', 'TAILOR'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setRole(entry)}
              className={
                role === entry
                  ? 'rounded-[0.9rem] bg-white px-4 py-3 text-sm font-semibold text-ink shadow-sm'
                  : 'rounded-[0.9rem] px-4 py-3 text-sm font-semibold text-ink/58 transition hover:text-ink'
              }
            >
              {entry === 'CUSTOMER' ? 'Customer' : 'Tailor'}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="mt-6 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {isSignUp ? (
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
              className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
            />
          </label>
        ) : null}
        {isSignUp ? (
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Phone number
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+2348012345678"
              type="tel"
              autoComplete="tel"
              className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
            />
            <span className="text-xs font-normal leading-5 text-ink/52">
              Used for order updates, account recovery, and critical trust-chain alerts.
            </span>
          </label>
        ) : null}
        <label className="grid gap-2 text-sm font-semibold text-ink">
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-ink">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isSignUp ? '8+ characters' : 'Your password'}
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            maxLength={MAX_PASSWORD_LENGTH}
            className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
          />
          {isSignUp ? <span className="text-xs font-normal leading-5 text-ink/52">{PASSWORD_POLICY_HINT}</span> : null}
        </label>
        {isSignUp ? (
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Confirm password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter password"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
            />
          </label>
        ) : null}

        {isSignUp ? (
          <div className="grid gap-5 rounded-[1.2rem] border border-ink/8 bg-bone/45 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
                {role === 'TAILOR' ? 'Tailor setup' : 'Customer setup'}
              </p>
              <p className="mt-2 text-sm leading-6 text-ink/62">
                {role === 'TAILOR'
                  ? 'Save the same first setup details the app asks for. Photos, ID, portfolio, and payout setup continue in the app.'
                  : 'Save the same first fit details the app asks for. Measurements and Drape Vision continue in the app.'}
              </p>
            </div>

            <label className="grid gap-2 text-sm font-semibold text-ink">
              Account currency
              <select
                value={defaultCurrency}
                onChange={(event) => {
                  setDefaultCurrency(event.target.value as AccountCurrencyCode)
                  setCurrencySource('USER_SELECTED')
                  setRegionCode(regionCode || detectedCurrency.regionCode || 'ZZ')
                }}
                className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition focus:border-needle"
              >
                {SUPPORTED_CURRENCIES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.symbol} {option.code} — {option.name}
                  </option>
                ))}
              </select>
            </label>

            {role === 'CUSTOMER' ? (
              <>
                <div className="grid gap-2 text-sm font-semibold text-ink">
                  <span>Measurement units</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['in', 'cm'] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => setUnitPreference(unit)}
                        className={
                          unitPreference === unit
                            ? 'rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white'
                            : 'rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink'
                        }
                      >
                        {unit === 'in' ? 'Inches' : 'Centimetres'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 text-sm font-semibold text-ink">
                  <span>What do you typically order?</span>
                  <div className="grid gap-2">
                    {GARMENT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setGarmentContext(option.value)}
                        className={
                          garmentContext === option.value
                            ? 'rounded-[1rem] border border-needle/20 bg-needle/8 px-4 py-3 text-left'
                            : 'rounded-[1rem] border border-ink/8 bg-white px-4 py-3 text-left transition hover:bg-white/80'
                        }
                      >
                        <span className="block text-sm font-semibold text-ink">{option.label}</span>
                        <span className="mt-1 block text-xs font-normal leading-5 text-ink/56">{option.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  City or base location
                  <input
                    value={tailorLocation}
                    onChange={(event) => setTailorLocation(event.target.value)}
                    placeholder="Lagos, London, Atlanta..."
                    autoComplete="address-level2"
                    className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  Languages
                  <input
                    value={tailorLanguages}
                    onChange={(event) => setTailorLanguages(event.target.value)}
                    placeholder="English, Yoruba"
                    className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                  />
                  <span className="text-xs font-normal leading-5 text-ink/52">Separate each language with a comma.</span>
                </label>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                  Specialties
                  <input
                    value={tailorSpecialties}
                    onChange={(event) => setTailorSpecialties(event.target.value)}
                    placeholder="Agbada, Ankara, bridal, alterations"
                    className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                  />
                  <span className="text-xs font-normal leading-5 text-ink/52">Separate each specialty with a comma.</span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    Starting price
                    <input
                      value={priceMin}
                      onChange={(event) => setPriceMin(event.target.value)}
                      placeholder="50000"
                      inputMode="decimal"
                      className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-semibold text-ink">
                    High-end price
                    <input
                      value={priceMax}
                      onChange={(event) => setPriceMax(event.target.value)}
                      placeholder="250000"
                      inputMode="decimal"
                      className="min-h-12 rounded-[1rem] border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                    />
                  </label>
                </div>
                <div className="grid gap-2 text-sm font-semibold text-ink">
                  <span>What will you offer?</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ['custom', 'Custom orders', supportsCustomOrders, setSupportsCustomOrders],
                      ['ready-made', 'Ready-made items', supportsReadyMade, setSupportsReadyMade],
                    ].map(([key, label, selected, setter]) => (
                      <button
                        key={key as string}
                        type="button"
                        onClick={() => (setter as Dispatch<SetStateAction<boolean>>)(!(selected as boolean))}
                        className={
                          selected
                            ? 'rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white'
                            : 'rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink'
                        }
                      >
                        {label as string}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 text-sm font-semibold text-ink">
                  <span>Fulfillment</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {FULFILLMENT_OPTIONS.map((option) => {
                      const selected = fulfillment.includes(option.value)
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setFulfillment((current) =>
                              selected
                                ? current.filter((entry) => entry !== option.value)
                                : [...current, option.value]
                            )
                          }}
                          className={
                            selected
                              ? 'rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white'
                              : 'rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink'
                          }
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[1rem] border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-[1rem] border border-needle/16 bg-needle/8 px-4 py-3 text-sm leading-6 text-ink">
            {message}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !!oauthLoading}
          className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
        >
          {loading ? 'Working...' : isSignUp ? 'Create account' : 'Sign in'}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              void oauth('google')
            }}
            disabled={loading || !!oauthLoading}
            className="min-h-12 rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-60"
          >
            {oauthLoading === 'google' ? 'Opening...' : 'Continue with Google'}
          </button>
          <button
            type="button"
            onClick={() => {
              void oauth('apple')
            }}
            disabled={loading || !!oauthLoading}
            className="min-h-12 rounded-full border border-ink bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink/88 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {oauthLoading === 'apple' ? 'Opening...' : 'Continue with Apple'}
          </button>
        </div>
      </form>

      <div className="mt-6 flex flex-col gap-3 border-t border-ink/6 pt-5 text-sm text-ink/62 sm:flex-row sm:items-center sm:justify-between">
        {isSignUp ? (
          <>
            <span>Already have an account?</span>
            <a href={`/sign-in?role=${role.toLowerCase()}`} className="font-semibold text-needle">Sign in</a>
          </>
        ) : (
          <>
            <a href="/account/recovery" className="font-semibold text-needle">Forgot password?</a>
            <a href={`/sign-up?role=${role.toLowerCase()}`} className="font-semibold text-needle">Create account</a>
          </>
        )}
      </div>
    </div>
  )
}
