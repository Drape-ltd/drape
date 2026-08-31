'use client'

import { useId, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Route } from 'next'
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
  getTailorPriceLimitMessage,
  getTailorPriceMaxMajor,
  getTailorPriceMinimumMessage,
  getTailorPriceMinMajor,
  normalizePhoneForStorage,
  parseTailorPriceMajor,
  SUPPORTED_ACCOUNT_CURRENCIES,
  TAILOR_SETUP_VALIDATION,
  validatePhoneForProfile,
  type AccountCurrencyCode,
  type CurrencySource,
} from '@drape/shared'
import { createClient } from '../lib/supabase'
import { safeAccountReturnPath } from '../lib/account-return-path'
import {
  type CustomerGarmentContext,
  type DrapeRole,
  type MeasurementUnit,
  type TailorFulfillment,
  type WebOnboardingPayload,
} from '../lib/account-bootstrap'
import { markWebSessionScope } from '../lib/web-session-scope'
import { PhoneNumberField } from './ui/phone-number-field'
import { MoneyInput } from './money-input'

type AuthMode = 'sign-in' | 'sign-up'

const AUTH_REQUEST_TIMEOUT_MS = 8000

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

function accountHomeForRole(role: DrapeRole) {
  return role === 'TAILOR' ? '/account/work' : '/account/orders'
}

function mapAuthError(message: string | undefined) {
  const normalized = (message ?? '').toLowerCase()
  if (normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')) {
    return 'Incorrect email or password.'
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'This email already has a Drapeon account. Sign in instead.'
  }
  if (
    normalized.includes('phone_already_in_use') ||
    normalized.includes('already uses this phone number') ||
    normalized.includes('phone number is already connected')
  ) {
    return 'That phone number is already connected to another Drapeon account. Use a different number or contact support.'
  }
  if (normalized.includes('database error saving new user')) {
    return 'We could not create this account with those details. If you are reusing a phone number, use a different number or contact support.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Check your email and confirm your Drapeon account before signing in.'
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Please wait a minute before trying again.'
  }
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'Sign-in is taking too long. Check the connection and try again.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'Connection looks weak. Try again when the signal improves.'
  }
  return 'We could not complete this step right now. Please try again.'
}

function isEmailNotConfirmedError(message: string | undefined) {
  return (message ?? '').toLowerCase().includes('email not confirmed')
}

function getBrowserAuthOrigin() {
  if (typeof window === 'undefined') return null
  if (window.location.hostname === '127.0.0.1') {
    return `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ''}`
  }
  return window.location.origin
}

function getPublicSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    return configured
  }

  const browserOrigin = getBrowserAuthOrigin()
  if (browserOrigin) return browserOrigin

  return 'https://drapeon.co'
}

function buildAuthCallbackUrl(nextPath = '/account/orders') {
  const url = new URL('/auth/callback', getPublicSiteOrigin())
  url.searchParams.set('next', nextPath)
  return url.toString()
}

function withAuthTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`${label} timed out`))
      }, AUTH_REQUEST_TIMEOUT_MS)
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function browserLocale() {
  if (typeof navigator === 'undefined') return null
  return navigator.language || navigator.languages?.[0] || null
}

function parseMajorAmountToMinor(value: string) {
  const amount = parseTailorPriceMajor(value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100)
}

function fieldHasContactLeak(value: string, label: string): string | null {
  if (!value.trim()) return null
  const result = filterContactInfo(value)
  if (!result.blocked) return null
  return `${label} can't include phone numbers, emails, links, social handles, or off-platform contact instructions.`
}

// ─── Chip input component ───────────────────────────────────────────────────

function ChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  function addChip() {
    const trimmed = draft.trim()
    if (!trimmed || values.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...values, trimmed])
    setDraft('')
  }

  return (
    <div className="grid gap-2 text-sm font-semibold text-ink">
      <span>{label}</span>
      <div className="min-h-12 rounded-lg border border-ink/10 bg-white px-3 py-2 transition focus-within:border-needle">
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 rounded-full bg-needle/10 px-2.5 py-1 text-xs font-semibold text-needle"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="leading-none text-needle/60 hover:text-needle"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addChip()
              }
            }}
            onBlur={addChip}
            placeholder={values.length === 0 ? placeholder : 'Add more...'}
            className="min-w-[120px] flex-1 bg-transparent text-sm font-normal text-ink outline-none placeholder:text-ink/36"
          />
        </div>
      </div>
      {hint ? (
        <span className="text-xs font-normal leading-5 text-ink/52">{hint}</span>
      ) : null}
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AccountAuthForm({ mode }: { mode: AuthMode }): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialRole = useMemo(() => normalizeRole(searchParams.get('role')), [searchParams])
  const contextualReturn = useMemo(() => safeAccountReturnPath(searchParams.get('next')), [searchParams])
  const detectedCurrency = useMemo(() => detectCurrencyPreference({ locale: browserLocale() }), [])
  const isSignUp = mode === 'sign-up'

  // Step state (sign-up only)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Auth state
  const [role, setRole] = useState<DrapeRole>(initialRole)
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [defaultCurrency, setDefaultCurrency] = useState<AccountCurrencyCode>(detectedCurrency.currency)
  const [currencySource, setCurrencySource] = useState<CurrencySource>(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const [unitPreference, setUnitPreference] = useState<MeasurementUnit>('in')
  const [garmentContext, setGarmentContext] = useState<CustomerGarmentContext | ''>('')
  const [tailorLocation, setTailorLocation] = useState('')
  const [tailorLanguagesList, setTailorLanguagesList] = useState<string[]>(['English'])
  const [tailorSpecialtiesList, setTailorSpecialtiesList] = useState<string[]>([])
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [fulfillment, setFulfillment] = useState<TailorFulfillment[]>(['PICKUP'])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [skipProfileSetup, setSkipProfileSetup] = useState(false)
  const [providerLoading, setProviderLoading] = useState<'apple' | 'google' | null>(null)


  const passwordInputId = useId()

  const hasTailorDraft =
    tailorLocation.trim().length > 0 ||
    tailorSpecialtiesList.length > 0 ||
    priceMin.trim().length > 0 ||
    priceMax.trim().length > 0 ||
    supportsReadyMade ||
    !supportsCustomOrders ||
    fulfillment.length !== 1 ||
    fulfillment[0] !== 'PICKUP' ||
    tailorLanguagesList.join(',') !== 'English'

  // Suppress unused variable warning — hasTailorDraft is used for reference tracking
  void hasTailorDraft

  const passwordStrengthError = useMemo(() => {
    if (!isSignUp || password.length === 0) return null
    return validatePasswordStrength(password, {
      forbiddenValues: [email.trim().toLowerCase(), displayName],
    })
  }, [displayName, email, isSignUp, password])

  function getSupabase() {
    try {
      return createClient()
    } catch {
      setError('Account access is temporarily unavailable. Please try again later or contact support.')
      return null
    }
  }

  async function continueWithProvider(provider: 'apple' | 'google') {
    if (loading || providerLoading) return
    setError(null)
    const supabase = getSupabase()
    if (!supabase) return

    setProviderLoading(provider)
    window.localStorage.removeItem('drapeon.web.auth.roleIntent')
    window.localStorage.removeItem('drapeon.web.auth.onboarding')

    const { data, error: providerError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: buildAuthCallbackUrl(contextualReturn ?? '/account/dashboard'),
        skipBrowserRedirect: true,
      },
    })

    if (providerError || !data.url) {
      setProviderLoading(null)
      setError(mapAuthError(providerError?.message))
      return
    }

    window.location.assign(data.url)
  }

  function renderProviderEntry() {
    return (
      <div className="mt-6 grid gap-3">
        <Link
          href="/explore"
          className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
        >
          Explore Drapeon
        </Link>
        <button
          type="button"
          onClick={() => void continueWithProvider('apple')}
          disabled={loading || providerLoading !== null}
          className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current"><path d="M17.1 12.5c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.3-2.1-4-2.1-1.7-.2-3.3 1-4.2 1-.9 0-2.3-1-3.8-.9-1.9 0-3.7 1.1-4.7 2.8-2 3.5-.5 8.7 1.4 11.5.9 1.4 2.1 2.9 3.6 2.8 1.4-.1 2-1 3.7-1s2.2 1 3.8 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.5-3.1 1.5-3.2-.1 0-3.1-1.2-3.1-5zM14.3 4.5c.8-1 1.3-2.3 1.2-3.5-1.2.1-2.6.8-3.4 1.7-.7.8-1.4 2.2-1.2 3.4 1.3.1 2.6-.6 3.4-1.6z"/></svg>
          {providerLoading === 'apple' ? 'Opening Apple…' : 'Continue with Apple'}
        </button>
        <button
          type="button"
          onClick={() => void continueWithProvider('google')}
          disabled={loading || providerLoading !== null}
          className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-full border border-ink/12 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.3 2.7C7.2 7.7 9.4 5.9 12 5.9z"/></svg>
          {providerLoading === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <div className="flex items-center gap-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/36">
          <span className="h-px flex-1 bg-ink/10" />
          Continue with email
          <span className="h-px flex-1 bg-ink/10" />
        </div>
      </div>
    )
  }

  async function fetchStoredAccountRole(userId: string): Promise<DrapeRole | null> {
    const supabase = getSupabase()
    if (!supabase) return null

    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .maybeSingle()

    return data?.role === 'TAILOR' || data?.role === 'CUSTOMER' ? data.role : null
  }

  function buildOnboardingPayload(skipOverride?: boolean): WebOnboardingPayload | null {
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

    if (skipOverride ?? skipProfileSetup) {
      if (role === 'CUSTOMER') {
        return {
          ...base,
          customer: {
            unitPreference,
            garmentContext: 'BOTH',
          },
        }
      }
      // Tailor minimal defaults
      return {
        ...base,
        tailor: {
          location: 'Not set',
          languages: ['English'],
          specialties: [],
          priceRangeMin: null,
          priceRangeMax: null,
          supportsCustomOrders: true,
          supportsReadyMade: false,
          fulfillment: ['PICKUP'],
        },
      }
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

    const languages = tailorLanguagesList
    const specialties = tailorSpecialtiesList
    const priceMinMajor = parseTailorPriceMajor(priceMin)
    const priceMaxMajor = parseTailorPriceMajor(priceMax)
    const priceRangeMin = parseMajorAmountToMinor(priceMin)
    const priceRangeMax = parseMajorAmountToMinor(priceMax)
    if (tailorLocation.trim().length < 2) {
      setError(TAILOR_SETUP_VALIDATION.LOCATION_REQUIRED_MESSAGE)
      return null
    }
    const contactLeakError =
      fieldHasContactLeak(tailorLocation, 'Location') ||
      fieldHasContactLeak(tailorLanguagesList.join(', '), 'Languages') ||
      fieldHasContactLeak(tailorSpecialtiesList.join(', '), 'Specialties')
    if (contactLeakError) {
      setError(contactLeakError)
      return null
    }
    if (languages.length === 0) {
      setError(TAILOR_SETUP_VALIDATION.LANGUAGE_REQUIRED_MESSAGE)
      return null
    }
    if (specialties.length === 0) {
      setError(TAILOR_SETUP_VALIDATION.SPECIALTY_REQUIRED_MESSAGE)
      return null
    }
    if (!priceRangeMin || !priceRangeMax || priceRangeMax < priceRangeMin || !Number.isFinite(priceMinMajor) || !Number.isFinite(priceMaxMajor)) {
      setError(TAILOR_SETUP_VALIDATION.PRICE_REQUIRED_MESSAGE)
      return null
    }
    if (priceMinMajor < getTailorPriceMinMajor(defaultCurrency)) {
      setError(getTailorPriceMinimumMessage(defaultCurrency))
      return null
    }
    if (priceMaxMajor > getTailorPriceMaxMajor(defaultCurrency)) {
      setError(getTailorPriceLimitMessage(defaultCurrency))
      return null
    }
    if (!supportsCustomOrders && !supportsReadyMade) {
      setError(TAILOR_SETUP_VALIDATION.ORDER_MODE_REQUIRED_MESSAGE)
      return null
    }
    if (fulfillment.length === 0) {
      setError(TAILOR_SETUP_VALIDATION.FULFILLMENT_REQUIRED_MESSAGE)
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
    }
    if (options?.credentials !== false && !password) return 'Enter your password.'
    return null
  }

  function validateStep1() {
    const nameError = validateDisplayName(displayName)
    if (nameError) return nameError
    if (!phone.trim()) return 'Enter a phone number for order updates and account recovery.'
    const normalizedPhone = normalizePhoneForStorage(phone)
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) return phoneError
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())) {
      return 'Enter a valid email address.'
    }
    const pwError = validatePasswordStrength(password, {
      forbiddenValues: [email.trim().toLowerCase(), displayName],
    })
    if (pwError) return pwError
    return null
  }

  async function submit(skipOverride?: boolean) {
    if (loading) return
    setError(null)
    setMessage(null)
    setPendingConfirmationEmail(null)

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const accountHome = accountHomeForRole(role)
    const redirectTo = buildAuthCallbackUrl(accountHome)

    if (isSignUp) {
      const onboarding = buildOnboardingPayload(skipOverride)
      if (!onboarding) {
        setLoading(false)
        return
      }

      window.localStorage.setItem('drapeon.web.auth.roleIntent', role)
      window.localStorage.setItem('drapeon.web.auth.onboarding', JSON.stringify(onboarding))

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
        window.localStorage.removeItem('drapeon.web.auth.roleIntent')
        window.localStorage.removeItem('drapeon.web.auth.onboarding')
        setError(mapAuthError(error.message))
        return
      }
      if (!data.session) {
        setPendingConfirmationEmail(normalizedEmail)
        setMessage('Check your email to confirm your Drapeon account. The link opens your workspace after confirmation.')
        return
      }
      markWebSessionScope(true)
      router.replace(`/auth/callback?next=${encodeURIComponent(accountHome)}`)
      return
    }

    let signInError: string | undefined
    let signedInRole: DrapeRole | null = null
    try {
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: password.trim(),
        }),
        'Password sign-in',
      )
      signInError = error?.message
      const metadataRole = data?.user?.user_metadata?.role
      signedInRole = metadataRole === 'TAILOR' || metadataRole === 'CUSTOMER' ? metadataRole : null
      if (!signedInRole && data?.user?.id) {
        signedInRole = await fetchStoredAccountRole(data.user.id)
      }
    } catch (signInFailure) {
      signInError = signInFailure instanceof Error ? signInFailure.message : String(signInFailure)
    }

    if (signInError) {
      console.warn('[web auth] Password sign-in failed', signInError)
      setLoading(false)
      if (isEmailNotConfirmedError(signInError)) {
        setPendingConfirmationEmail(normalizedEmail)
      }
      setError(mapAuthError(signInError))
      return
    }

    setPendingConfirmationEmail(null)
    markWebSessionScope(rememberDevice)
    window.localStorage.removeItem('drapeon.web.auth.roleIntent')
    window.localStorage.removeItem('drapeon.web.auth.onboarding')
    setLoading(false)
    router.replace((contextualReturn ?? accountHomeForRole(signedInRole ?? role)) as Route)
  }

  async function resendConfirmation() {
    if (loading || resendLoading || !pendingConfirmationEmail) return

    const supabase = getSupabase()
    if (!supabase) return

    setError(null)
    setMessage(null)
    setResendLoading(true)
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: pendingConfirmationEmail,
      options: {
        emailRedirectTo: buildAuthCallbackUrl(accountHomeForRole(role)),
      },
    })
    setResendLoading(false)

    if (resendError) {
      setError(mapAuthError(resendError.message))
      return
    }

    setMessage('Confirmation email sent again. Open the latest Drapeon email and use that link.')
  }

  // ─── Post-signup confirmation screen ───────────────────────────────────────
  if (isSignUp && pendingConfirmationEmail) {
    return (
      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-7 shadow-[0_18px_60px_rgba(22,28,24,0.06)] text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-needle/10">
          <svg
            viewBox="0 0 24 24"
            className="size-8 text-needle"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16v16H4V4zm0 0 8 9 8-9" />
          </svg>
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Almost there</p>
        <h2 className="mt-3 text-3xl text-ink">Check your inbox</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          We sent a confirmation link to{' '}
          <span className="font-semibold text-ink">{pendingConfirmationEmail}</span>. Open it to
          activate your Drapeon account.
        </p>
        <p className="mt-2 text-xs text-ink/44">
          Check spam if it hasn&apos;t arrived in a few minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            void resendConfirmation()
          }}
          disabled={resendLoading}
          className="mt-6 min-h-11 w-full rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-needle transition hover:bg-bone disabled:cursor-not-allowed disabled:text-ink/36"
        >
          {resendLoading ? 'Sending...' : 'Resend confirmation email'}
        </button>
        <button
          type="button"
          onClick={() => setPendingConfirmationEmail(null)}
          className="mt-3 text-xs text-ink/44 hover:text-ink"
        >
          Use a different email
        </button>
        {error ? (
          <p className="mt-4 rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  // ─── Sign-in form ──────────────────────────────────────────────────────────
  if (!isSignUp) {
    return (
      <div className="rounded-[8px] border border-ink/8 bg-white/88 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Sign in</p>
          <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
            Sign in to Drapeon.
          </h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">Use your Drapeon account.</p>
        </div>

        {renderProviderEntry()}

        <form
          className="mt-1 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Email
            <input
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setPendingConfirmationEmail(null)
              }}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
            />
          </label>

          <div className="grid gap-2 text-sm font-semibold text-ink">
            {/* 2a: Forgot password inline with label */}
            <div className="flex items-center justify-between">
              <label htmlFor={passwordInputId}>Password</label>
              <a
                href="/account/recovery"
                className="text-xs font-semibold text-needle hover:underline"
              >
                Forgot password?
              </a>
            </div>
            <span className="relative block">
              <input
                id={passwordInputId}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                maxLength={MAX_PASSWORD_LENGTH}
                className="min-h-12 w-full rounded-lg border border-ink/10 bg-white px-4 pr-20 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-needle transition hover:bg-bone"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </div>

          {error ? (
            <div role="alert" aria-live="polite" className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
              {error}
            </div>
          ) : null}

          {pendingConfirmationEmail ? (
            <div className="grid gap-3 rounded-lg border border-ink/8 bg-white/72 px-4 py-3 text-sm leading-6 text-ink">
              <p className="text-ink/66">
                Need a fresh link for{' '}
                <span className="font-semibold text-ink">{pendingConfirmationEmail}</span>?
              </p>
              <button
                type="button"
                onClick={() => {
                  void resendConfirmation()
                }}
                disabled={loading || resendLoading}
                className="min-h-11 rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-needle transition hover:bg-bone disabled:cursor-not-allowed disabled:text-ink/36"
              >
                {resendLoading ? 'Sending...' : 'Resend confirmation email'}
              </button>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
          >
            {loading ? 'Working...' : 'Sign in'}
          </button>

          {/* 2b: Remember device below submit */}
          <label className="flex cursor-pointer items-start gap-3 pt-1 text-sm text-ink/62">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(event) => setRememberDevice(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-ink/20 text-needle focus:ring-needle/40"
            />
            <span>
              <span className="block font-semibold text-ink">Remember this device</span>
              <span className="mt-1 block text-xs leading-5 text-ink/56">
                Uncheck this on shared or public computers. Your session will end when you close this tab.
              </span>
            </span>
          </label>
        </form>

        {/* 2c: Footer — only "Don't have an account?" */}
        <div className="mt-6 flex flex-col gap-3 border-t border-ink/6 pt-5 text-sm text-ink/62 sm:flex-row sm:items-center sm:justify-between">
          <span>Don&apos;t have an account?</span>
          <a href="/sign-up" className="font-semibold text-needle">
            Create account →
          </a>
        </div>
      </div>
    )
  }

  // ─── Sign-up multi-step form ───────────────────────────────────────────────

  return (
    <div className="rounded-[8px] border border-ink/8 bg-white/88 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-7">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {([1, 2, 3] as const).map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full transition-all ${step >= n ? 'bg-needle' : 'bg-ink/12'}`}
          />
        ))}
      </div>

      {/* ── Step 1: Credentials ── */}
      {step === 1 ? (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Create account
            </p>
            <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
              Start your Drapeon account.
            </h1>
            <p className="mt-4 text-sm leading-7 text-ink/66">
              One account for ordering and tailoring.
            </p>
          </div>

          {renderProviderEntry()}

          <div className="mt-1 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold text-ink">
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="e.g. John Doe"
                autoComplete="name"
                className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
              />
            </label>

            <PhoneNumberField
              label="Phone number"
              value={phone}
              onValueChange={setPhone}
              placeholder="Phone number"
              required
              hint="Used for order updates, account recovery, and critical trust-chain alerts."
            />

            <label className="grid gap-2 text-sm font-semibold text-ink">
              Email
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setPendingConfirmationEmail(null)
                }}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
              />
            </label>

            <div className="grid gap-2 text-sm font-semibold text-ink">
              <label htmlFor={passwordInputId}>Password</label>
              <span className="relative block">
                <input
                  id={passwordInputId}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="8+ characters"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  maxLength={MAX_PASSWORD_LENGTH}
                  className="min-h-12 w-full rounded-lg border border-ink/10 bg-white px-4 pr-20 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-needle transition hover:bg-bone"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
              <span
                className={`text-xs font-normal leading-5 ${
                  password.length > 0 && !passwordStrengthError
                    ? 'text-needle'
                    : passwordStrengthError
                      ? 'text-rust'
                      : 'text-ink/52'
                }`}
              >
                {password.length > 0 && !passwordStrengthError
                  ? 'Password meets the Drapeon policy.'
                  : (passwordStrengthError ?? PASSWORD_POLICY_HINT)}
              </span>
            </div>

            {error ? (
              <div role="alert" aria-live="polite" className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                const e = validateStep1()
                if (e) {
                  setError(e)
                  return
                }
                setError(null)
                setStep(2)
              }}
              className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
            >
              Continue
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-ink/6 pt-5 text-sm text-ink/62 sm:flex-row sm:items-center sm:justify-between">
            <span>Already have an account?</span>
            <a href="/sign-in" className="font-semibold text-needle">
              Sign in
            </a>
          </div>
        </>
      ) : null}

      {/* ── Step 2: Role choice ── */}
      {step === 2 ? (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Your role
            </p>
            <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
              How will you use Drapeon?
            </h1>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {/* Customer card */}
            <button
              type="button"
              onClick={() => setRole('CUSTOMER')}
              className={`rounded-[8px] border p-5 text-left transition ${
                role === 'CUSTOMER'
                  ? 'border-needle/30 bg-needle/6 ring-2 ring-needle/20'
                  : 'border-ink/10 bg-white hover:bg-bone/60'
              }`}
            >
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-needle/10">
                <svg
                  viewBox="0 0 24 24"
                  className="size-5 text-needle"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <line x1="20" y1="4" x2="8.12" y2="15.88" />
                  <line x1="14.47" y1="14.48" x2="20" y2="20" />
                  <line x1="8.12" y1="8.12" x2="12" y2="12" />
                </svg>
              </div>
              <p className="text-base font-semibold text-ink">I&apos;m ordering</p>
              <p className="mt-1.5 text-sm leading-6 text-ink/62">
                Browse tailors, submit custom briefs, track orders, and manage fit records.
              </p>
            </button>

            {/* Tailor card */}
            <button
              type="button"
              onClick={() => setRole('TAILOR')}
              className={`rounded-[8px] border p-5 text-left transition ${
                role === 'TAILOR'
                  ? 'border-needle/30 bg-needle/6 ring-2 ring-needle/20'
                  : 'border-ink/10 bg-white hover:bg-bone/60'
              }`}
            >
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-needle/10">
                <svg
                  viewBox="0 0 24 24"
                  className="size-5 text-needle"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 3h18v4H3zM3 10h4M7 10v4M3 17h18v4H3z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-ink">I&apos;m tailoring</p>
              <p className="mt-1.5 text-sm leading-6 text-ink/62">
                Manage custom orders, showcase your portfolio, and get paid through Drapeon.
              </p>
            </button>
          </div>

          <p className="mt-3 text-xs text-ink/44">
            You can add the other side from your account later.
          </p>

          {error ? (
            <div role="alert" aria-live="polite" className="mt-4 rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => { setError(null); setStep(1) }}
              className="flex-1 min-h-[52px] rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setStep(3) }}
              className="flex-1 min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
            >
              Continue
            </button>
          </div>
        </>
      ) : null}

      {/* ── Step 3: Profile setup ── */}
      {step === 3 ? (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Profile setup
            </p>
            <h1 className="mt-3 text-4xl leading-tight text-ink sm:text-5xl">
              {role === 'TAILOR' ? 'Set up your studio.' : 'Tell tailors about your style.'}
            </h1>
            <p className="mt-4 text-sm leading-7 text-ink/66">
              {role === 'TAILOR'
                ? 'Add the basic studio details needed before deeper verification, portfolio, and payout setup.'
                : 'Add the basic fit details needed before measurements, saved tailors, and orders.'}
            </p>
          </div>

          <form
            className="mt-6 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {/* Currency selector — 7 currencies, keep styled select */}
            <label className="grid gap-2 text-sm font-semibold text-ink">
              Account currency
              <select
                value={defaultCurrency}
                onChange={(event) => {
                  setDefaultCurrency(event.target.value as AccountCurrencyCode)
                  setCurrencySource('USER_SELECTED')
                  setRegionCode(regionCode || detectedCurrency.regionCode || 'ZZ')
                }}
                className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition focus:border-needle"
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
                            ? 'rounded-lg border border-needle/20 bg-needle/8 px-4 py-3 text-left'
                            : 'rounded-lg border border-ink/8 bg-white px-4 py-3 text-left transition hover:bg-white/80'
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
                    className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
                  />
                </label>

                <ChipInput
                  label="Languages"
                  hint="Press Enter or comma to add each language."
                  values={tailorLanguagesList}
                  onChange={setTailorLanguagesList}
                  placeholder="English, Yoruba..."
                />

                <ChipInput
                  label="Specialties"
                  hint="Press Enter or comma to add each specialty."
                  values={tailorSpecialtiesList}
                  onChange={setTailorSpecialtiesList}
                  placeholder="Agbada, Ankara, bridal..."
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <MoneyInput id="tailor-signup-price-min" label="Starting price" value={priceMin} onValueChange={setPriceMin} currency={defaultCurrency} required />
                  <MoneyInput id="tailor-signup-price-max" label="High-end price" value={priceMax} onValueChange={setPriceMax} currency={defaultCurrency} required />
                </div>

                <div className="grid gap-2 text-sm font-semibold text-ink">
                  <span>What will you offer?</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ['custom', 'Custom orders', supportsCustomOrders, setSupportsCustomOrders],
                        ['ready-made', 'Ready-made items', supportsReadyMade, setSupportsReadyMade],
                      ] as const
                    ).map(([key, label, selected, setter]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          (setter as Dispatch<SetStateAction<boolean>>)(!(selected as boolean))
                        }
                        className={
                          selected
                            ? 'rounded-full bg-needle px-4 py-3 text-sm font-semibold text-white'
                            : 'rounded-full border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink'
                        }
                      >
                        {label}
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
                                : [...current, option.value],
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

            {error ? (
              <div role="alert" aria-live="polite" className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
                {error}
              </div>
            ) : null}

            {message ? (
              <div className="rounded-lg border border-needle/16 bg-needle/8 px-4 py-3 text-sm leading-6 text-ink">
                {message}
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setError(null); setStep(2) }}
                className="flex-1 min-h-[52px] rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
              >
                {loading ? 'Working...' : 'Create account'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setSkipProfileSetup(true)
                void submit(true)
              }}
              className="text-center text-xs text-ink/44 hover:text-ink"
            >
              Skip for now
            </button>
          </form>
        </>
      ) : null}
    </div>
  )
}
