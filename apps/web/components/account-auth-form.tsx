'use client'

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, ImagePlus, KeyRound, Search, ShieldCheck, ShoppingBag, Store, Video, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
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
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  normalizePhoneForStorage,
  ACCOUNT_PHONE_UNIQUENESS_HINT,
  parseTailorPriceMajor,
  PHONE_COUNTRIES,
  SUPPORTED_ACCOUNT_CURRENCIES,
  TAILOR_LANGUAGE_GROUPS,
  TAILOR_SELLER_TYPE_OPTIONS,
  TAILOR_SETUP_VALIDATION,
  TAILOR_SPECIALTY_GROUPS,
  TAILOR_TRUST_VIDEO_CHALLENGES,
  validatePhoneForProfile,
  type AccountCurrencyCode,
  type CurrencySource,
  type PhoneCountryCode,
} from '@drape/shared'
import { createClient } from '../lib/supabase'
import { safeAccountReturnPath } from '../lib/account-return-path'
import {
  type CustomerGarmentContext,
  type DrapeRole,
  type MeasurementUnit,
  type TailorFulfillment,
  type TailorAvailability,
  type TailorSellerType,
  type WebOnboardingPayload,
  persistedWebOnboardingPayload,
} from '../lib/account-bootstrap'
import { markWebSessionScope } from '../lib/web-session-scope'
import { assessWebDevice, deviceTrustRequest, verifyWebDevice } from '../lib/device-trust-client'
import { PhoneNumberField } from './ui/phone-number-field'
import { MoneyInput } from './money-input'
import { StructuredAddressSearch } from './structured-address-search'
import { SignupTrustVideo } from './signup-trust-video'
import { TurnstileChallenge } from './turnstile-challenge'
import {
  blobToDataUrl,
  createSignupMediaDraftKey,
  deleteSignupMediaDraft,
  readSignupMediaDraft,
  readVideoDurationSeconds,
  saveSignupMediaDraft,
  stageSignupMedia,
  type QuarantineMediaEntry,
  type SignupMediaDraftDescriptor,
} from '../lib/signup-media-draft'

type AuthMode = 'sign-in' | 'sign-up'
type PendingDeviceChallenge = {
  challengeId: string
  maskedEmail: string
  expiresAt: string
  session: Session
  destination: string
}

const AUTH_REQUEST_TIMEOUT_MS = 8000
const PUBLIC_SIGNUP_DRAFT_KEY = 'drapeon.web.auth.signup-draft.v1'

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
  if (normalized.includes('captcha') || normalized.includes('security verification')) {
    return 'The security check expired or could not be verified. Complete it again and retry.'
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

function createMediaClaimToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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

function browserPhoneCountry(): PhoneCountryCode {
  const locale = browserLocale()
  const region = locale ? new Intl.Locale(locale).region?.toUpperCase() : null
  if (region && PHONE_COUNTRIES.some((country) => country.code === region)) {
    return region as PhoneCountryCode
  }
  return 'US'
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

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('This browser could not prepare the photo.')),
      'image/jpeg',
      quality,
    )
  })
}

async function prepareAvatar(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose a JPG, PNG, or WebP image under 10 MB.')
  }

  const source = await createImageBitmap(file)
  const size = Math.min(source.width, source.height)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare the photo.')
  context.drawImage(
    source,
    Math.max(0, (source.width - size) / 2),
    Math.max(0, (source.height - size) / 2),
    size,
    size,
    0,
    0,
    512,
    512,
  )
  source.close()
  return canvasToJpegBlob(canvas, 0.82)
}

async function preparePortfolioImage(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
    throw new Error('Choose a JPG, PNG, or WebP image under 15 MB.')
  }
  const source = await createImageBitmap(file)
  const scale = Math.min(1, 900 / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare the work sample.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  source.close()
  return canvasToJpegBlob(canvas, 0.72)
}

function SetupOptionPicker({
  label,
  values,
  groups,
  limit,
  onChange,
}: {
  label: string
  values: string[]
  groups: Array<{ label: string; items: string[] }>
  limit: number
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerId = useId()
  const normalizedQuery = query.trim().toLowerCase()
  const visibleGroups = normalizedQuery
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.toLowerCase().includes(normalizedQuery)),
        }))
        .filter((group) => group.items.length > 0)
    : groups

  return (
    <div className="grid gap-2">
      <label id={triggerId} className="text-sm font-semibold text-ink">{label}</label>
      <button
        type="button"
        aria-labelledby={triggerId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-[58px] w-full cursor-pointer items-center gap-3 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-left outline-none transition-colors hover:border-needle/30 hover:bg-bone/30 focus-visible:ring-2 focus-visible:ring-needle/35"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">
            {values.length ? values.join(', ') : `Choose ${label.toLowerCase()}`}
          </span>
          <span className="mt-1 block text-xs text-ink/48">{values.length}/{limit} selected</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-ink/45" aria-hidden="true" />
      </button>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label={`Selected ${label.toLowerCase()}`}>
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              aria-label={`Remove ${value}`}
              className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-needle/16 bg-needle/7 px-3 text-xs font-semibold text-needle transition-colors hover:bg-needle/12 focus-visible:ring-2 focus-visible:ring-needle/30"
            >
              {value}<X className="size-3" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[120] grid items-end bg-black/35 p-0 sm:place-items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby={`${triggerId}-title`} className="flex max-h-[86vh] w-full flex-col rounded-t-[24px] border border-ink/10 bg-white shadow-2xl sm:max-w-xl sm:rounded-[20px]">
            <div className="mx-auto mt-3 h-1 w-14 rounded-full bg-ink/12 sm:hidden" />
            <div className="flex items-start gap-4 border-b border-ink/8 px-5 py-5 sm:px-6">
              <div className="min-w-0 flex-1">
                <h2 id={`${triggerId}-title`} className="text-2xl text-ink">{label}</h2>
                <p className="mt-1 text-sm leading-6 text-ink/56">Choose up to {limit}. Your selections appear on your public profile.</p>
              </div>
              <button type="button" aria-label={`Close ${label.toLowerCase()}`} onClick={() => setOpen(false)} className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-bone text-ink transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-needle/35"><X className="size-5" /></button>
            </div>
            <div className="border-b border-ink/8 px-5 py-4 sm:px-6">
              <label className="flex min-h-11 items-center gap-3 rounded-[8px] border border-ink/10 bg-bone/35 px-3 focus-within:border-needle">
                <Search className="size-4 shrink-0 text-ink/40" aria-hidden="true" />
                <span className="sr-only">Search {label.toLowerCase()}</span>
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink/36" />
                {query ? <button type="button" onClick={() => setQuery('')} className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-ink/8" aria-label="Clear search"><X className="size-4" /></button> : null}
              </label>
            </div>
            <div className="overflow-y-auto px-5 py-4 sm:px-6">
              {visibleGroups.length ? visibleGroups.map((group) => (
                <div key={group.label} className="mb-5 last:mb-0">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/42">{group.label}</p>
                  <div className="overflow-hidden rounded-[10px] border border-ink/8">
                    {group.items.map((option, index) => {
                      const active = values.includes(option)
                      const disabled = !active && values.length >= limit
                      return (
                        <button
                          key={option}
                          type="button"
                          disabled={disabled}
                          role="checkbox"
                          aria-checked={active}
                          onClick={() => onChange(active ? values.filter((value) => value !== option) : [...values, option])}
                          className={`flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${index ? 'border-t border-ink/8' : ''} ${active ? 'bg-needle/7 text-needle' : 'bg-white text-ink hover:bg-bone/55'} disabled:cursor-not-allowed disabled:opacity-40`}
                        >
                          <span className="min-w-0 flex-1 font-medium">{option}</span>
                          <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${active ? 'border-needle bg-needle text-white' : 'border-ink/20 bg-white'}`}>{active ? <Check className="size-3.5" aria-hidden="true" /> : null}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )) : <p className="py-8 text-center text-sm text-ink/48">No matches for “{query}”.</p>}
            </div>
            <div className="border-t border-ink/8 bg-white p-4 sm:px-6">
              <button type="button" onClick={() => setOpen(false)} className="min-h-12 w-full cursor-pointer rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-needle-600 focus-visible:ring-2 focus-visible:ring-needle/35">Done · {values.length} selected</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function SetupSingleChoicePicker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; hint: string }>
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value) ?? options[0]
  const titleId = useId()
  if (!selected) return null
  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="flex min-h-[68px] w-full cursor-pointer items-center gap-3 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-left transition-colors hover:border-needle/30 hover:bg-bone/30 focus-visible:ring-2 focus-visible:ring-needle/35">
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{selected.label}</span><span className="mt-1 block text-xs leading-5 text-ink/52">{selected.hint}</span></span><ChevronDown className="size-5 shrink-0 text-ink/45" aria-hidden="true" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-[120] grid items-end bg-black/35 sm:place-items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full rounded-t-[24px] border border-ink/10 bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-[20px] sm:p-6">
            <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><h2 id={titleId} className="text-2xl text-ink">{label}</h2><p className="mt-1 text-sm leading-6 text-ink/56">Pick the description that best matches how your business works.</p></div><button type="button" aria-label={`Close ${label.toLowerCase()}`} onClick={() => setOpen(false)} className="grid size-10 cursor-pointer place-items-center rounded-full bg-bone hover:bg-ink/10"><X className="size-5" /></button></div>
            <div className="mt-5 grid gap-2">{options.map((option) => { const active = option.value === value; return <button key={option.value} type="button" role="radio" aria-checked={active} onClick={() => { onChange(option.value); setOpen(false) }} className={`flex min-h-[72px] w-full cursor-pointer items-center gap-3 rounded-[10px] border p-4 text-left transition-colors ${active ? 'border-needle bg-needle/7' : 'border-ink/10 bg-white hover:bg-bone/55'}`}><span className="min-w-0 flex-1"><span className={`block text-sm font-semibold ${active ? 'text-needle' : 'text-ink'}`}>{option.label}</span><span className="mt-1 block text-xs leading-5 text-ink/54">{option.hint}</span></span><span className={`grid size-5 shrink-0 place-items-center rounded-full border ${active ? 'border-needle bg-needle text-white' : 'border-ink/20'}`}>{active ? <Check className="size-3.5" /> : null}</span></button> })}</div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function SignupDraftVideoPreview({ draft, label, onRemove }: { draft: SignupMediaDraftDescriptor; label: string; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    void readSignupMediaDraft(draft.key).then((blob) => {
      if (!active || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [draft.key])
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-ink/10 bg-[#121815]">
      {url ? <video src={url} controls playsInline preload="metadata" className="size-full object-cover" aria-label={label} /> : <div className="grid size-full place-items-center text-white/70"><Video className="size-7" /></div>}
      <button type="button" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove} className="absolute right-2 top-2 z-10 grid size-8 cursor-pointer place-items-center rounded-full bg-black/75 text-white"><X className="size-4" /></button>
      <span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2 py-1 text-[11px] font-semibold text-white">Video · {Math.round(draft.durationSeconds)} sec</span>
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
  const detectedPhoneCountry = useMemo(() => browserPhoneCountry(), [])
  const isSignUp = mode === 'sign-up'
  const appleOAuthEnabled = process.env.NEXT_PUBLIC_AUTH_APPLE_ENABLED === 'true'
  const googleOAuthEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === 'true'

  // Step state (sign-up only)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1)

  // Auth state
  const [role, setRole] = useState<DrapeRole>(initialRole)
  const [displayName, setDisplayName] = useState('')
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [avatarDraft, setAvatarDraft] = useState<SignupMediaDraftDescriptor | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const signupHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousSignupStepRef = useRef(step)
  const trustChallengeInitializedRef = useRef(false)
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
  const [tailorBio, setTailorBio] = useState('')
  const [tailorLanguagesList, setTailorLanguagesList] = useState<string[]>(['English'])
  const [tailorSpecialtiesList, setTailorSpecialtiesList] = useState<string[]>([])
  const [tailorSellerType, setTailorSellerType] = useState<TailorSellerType>('TAILOR')
  const [tailorAvailability, setTailorAvailability] = useState<TailorAvailability>('OPEN')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [fulfillment, setFulfillment] = useState<TailorFulfillment[]>([])
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupCity, setPickupCity] = useState('')
  const [pickupRegion, setPickupRegion] = useState('')
  const [pickupPostalCode, setPickupPostalCode] = useState('')
  const [pickupCountryCode, setPickupCountryCode] = useState('')
  const [consultationMode, setConsultationMode] = useState<'UNAVAILABLE' | 'FREE' | 'PAID'>('FREE')
  const [consultationRequirement, setConsultationRequirement] = useState<'OPTIONAL' | 'REQUIRED'>('OPTIONAL')
  const [consultationFee, setConsultationFee] = useState('')
  const [consultationDuration, setConsultationDuration] = useState<'15' | '30' | '45' | '60'>('30')
  const [consultationCallType, setConsultationCallType] = useState<'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'>('VIDEO')
  const [consultationFeeCreditable, setConsultationFeeCreditable] = useState(false)
  const [portfolioDataUrls, setPortfolioDataUrls] = useState<string[]>([])
  const [portfolioImageDrafts, setPortfolioImageDrafts] = useState<SignupMediaDraftDescriptor[]>([])
  const [portfolioVideoDrafts, setPortfolioVideoDrafts] = useState<SignupMediaDraftDescriptor[]>([])
  const portfolioInputRef = useRef<HTMLInputElement>(null)
  const [trustVideoDraft, setTrustVideoDraft] = useState<SignupMediaDraftDescriptor | null>(null)
  const [trustChallengeId, setTrustChallengeId] = useState<string>(TAILOR_TRUST_VIDEO_CHALLENGES[0].id)
  const [trustChallengeText, setTrustChallengeText] = useState<string>(TAILOR_TRUST_VIDEO_CHALLENGES[0].text)
  const [trustConsentGranted, setTrustConsentGranted] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [deviceChallenge, setDeviceChallenge] = useState<PendingDeviceChallenge | null>(null)
  const [deviceCode, setDeviceCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [skipProfileSetup, setSkipProfileSetup] = useState(false)
  const [providerLoading, setProviderLoading] = useState<'apple' | 'google' | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [signupDraftHydrated, setSignupDraftHydrated] = useState(false)
  const signupDraftSnapshot = useMemo<Record<string, unknown>>(() => ({
    step, pendingConfirmationEmail, role, displayName, phone, email, avatarDraft, tailorLocation, tailorBio,
    tailorLanguagesList, tailorSpecialtiesList, tailorSellerType, tailorAvailability,
    priceMin, priceMax, supportsCustomOrders, supportsReadyMade, fulfillment,
    pickupAddress, pickupCity, pickupRegion, pickupPostalCode, pickupCountryCode,
    consultationMode, consultationRequirement, consultationFee, consultationDuration,
    consultationCallType, consultationFeeCreditable, portfolioImageDrafts, portfolioVideoDrafts,
    trustVideoDraft, trustChallengeId, trustConsentGranted,
  }), [
    avatarDraft, consultationCallType, consultationDuration, consultationFee,
    consultationFeeCreditable, consultationMode, consultationRequirement, displayName, email,
    fulfillment, phone, pickupAddress, pickupCity, pickupCountryCode, pickupPostalCode,
    pendingConfirmationEmail,
    pickupRegion, portfolioImageDrafts, portfolioVideoDrafts, priceMax, priceMin, role,
    step,
    supportsCustomOrders, supportsReadyMade, tailorAvailability, tailorBio,
    tailorLanguagesList, tailorLocation, tailorSellerType, tailorSpecialtiesList,
    trustChallengeId, trustConsentGranted, trustVideoDraft,
  ])


  const passwordInputId = useId()

  useEffect(() => {
    if (isSignUp || searchParams.get('device') !== 'verify' || deviceChallenge) return
    let active = true
    const supabase = createClient()
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active || !data.session) return
      try {
        const resumed = await deviceTrustRequest(data.session, { action: 'resume' })
        if (!active || !resumed.challengeId) return
        setDeviceChallenge({
          challengeId: resumed.challengeId,
          maskedEmail: resumed.maskedEmail ?? 'your account email',
          expiresAt: resumed.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
          session: data.session,
          destination: contextualReturn ?? '/account/orders',
        })
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Device verification could not resume.')
      }
    })
    return () => { active = false }
  }, [contextualReturn, deviceChallenge, isSignUp, searchParams])

  useEffect(() => {
    if (!isSignUp || signupDraftHydrated) return
    let active = true
    async function hydrateDraft() {
      try {
        const raw = window.localStorage.getItem(PUBLIC_SIGNUP_DRAFT_KEY)
        if (raw) {
          const draft = JSON.parse(raw) as Record<string, unknown>
          const hasMeaningfulDraft = [
            draft.displayName,
            draft.phone,
            draft.email,
            draft.tailorLocation,
            draft.tailorBio,
            draft.priceMin,
            draft.priceMax,
          ].some((value) => typeof value === 'string' && value.trim().length > 0) || Boolean(
            draft.avatarDraft ||
            draft.trustVideoDraft ||
            (Array.isArray(draft.portfolioImageDrafts) && draft.portfolioImageDrafts.length) ||
            (Array.isArray(draft.portfolioVideoDrafts) && draft.portfolioVideoDrafts.length),
          )
          if (draft.step === 1 || draft.step === 2 || draft.step === 3 || draft.step === 4 || draft.step === 5 || draft.step === 6) setStep(draft.step)
          if (typeof draft.pendingConfirmationEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.pendingConfirmationEmail)) {
            setPendingConfirmationEmail(draft.pendingConfirmationEmail.trim().toLowerCase())
          }
          if (draft.role === 'CUSTOMER' || draft.role === 'TAILOR') setRole(draft.role)
          if (typeof draft.displayName === 'string') setDisplayName(draft.displayName)
          if (typeof draft.phone === 'string') setPhone(draft.phone)
          if (typeof draft.email === 'string') setEmail(draft.email)
          if (typeof draft.tailorLocation === 'string') setTailorLocation(draft.tailorLocation)
          if (typeof draft.tailorBio === 'string') setTailorBio(draft.tailorBio)
          if (Array.isArray(draft.tailorLanguagesList)) setTailorLanguagesList(draft.tailorLanguagesList.filter((value): value is string => typeof value === 'string'))
          if (Array.isArray(draft.tailorSpecialtiesList)) setTailorSpecialtiesList(draft.tailorSpecialtiesList.filter((value): value is string => typeof value === 'string'))
          if (draft.tailorSellerType === 'TAILOR' || draft.tailorSellerType === 'BOUTIQUE' || draft.tailorSellerType === 'TAILOR_SHOP') setTailorSellerType(draft.tailorSellerType)
          if (draft.tailorAvailability === 'OPEN' || draft.tailorAvailability === 'LIMITED' || draft.tailorAvailability === 'FULLY_BOOKED') setTailorAvailability(draft.tailorAvailability)
          if (typeof draft.priceMin === 'string') setPriceMin(draft.priceMin)
          if (typeof draft.priceMax === 'string') setPriceMax(draft.priceMax)
          if (typeof draft.supportsCustomOrders === 'boolean') setSupportsCustomOrders(draft.supportsCustomOrders)
          if (typeof draft.supportsReadyMade === 'boolean') setSupportsReadyMade(draft.supportsReadyMade)
          if (Array.isArray(draft.fulfillment)) setFulfillment(draft.fulfillment.filter((value): value is TailorFulfillment => value === 'PICKUP' || value === 'DELIVERY' || value === 'SHIPPING'))
          if (typeof draft.pickupAddress === 'string') setPickupAddress(draft.pickupAddress)
          if (typeof draft.pickupCity === 'string') setPickupCity(draft.pickupCity)
          if (typeof draft.pickupRegion === 'string') setPickupRegion(draft.pickupRegion)
          if (typeof draft.pickupPostalCode === 'string') setPickupPostalCode(draft.pickupPostalCode)
          if (typeof draft.pickupCountryCode === 'string') setPickupCountryCode(draft.pickupCountryCode)
          if (draft.consultationMode === 'UNAVAILABLE' || draft.consultationMode === 'FREE' || draft.consultationMode === 'PAID') setConsultationMode(draft.consultationMode)
          if (draft.consultationRequirement === 'OPTIONAL' || draft.consultationRequirement === 'REQUIRED') setConsultationRequirement(draft.consultationRequirement)
          if (typeof draft.consultationFee === 'string') setConsultationFee(draft.consultationFee)
          if (draft.consultationDuration === '15' || draft.consultationDuration === '30' || draft.consultationDuration === '45' || draft.consultationDuration === '60') setConsultationDuration(draft.consultationDuration)
          if (draft.consultationCallType === 'AUDIO' || draft.consultationCallType === 'VIDEO' || draft.consultationCallType === 'AUDIO_OR_VIDEO') setConsultationCallType(draft.consultationCallType)
          if (typeof draft.consultationFeeCreditable === 'boolean') setConsultationFeeCreditable(draft.consultationFeeCreditable)

          let savedAvatar = draft.avatarDraft && typeof draft.avatarDraft === 'object' && typeof (draft.avatarDraft as SignupMediaDraftDescriptor).key === 'string'
            ? draft.avatarDraft as SignupMediaDraftDescriptor
            : null
          if (!savedAvatar && typeof draft.avatarDataUrl === 'string' && draft.avatarDataUrl.startsWith('data:image/')) {
            const blob = await fetch(draft.avatarDataUrl).then((response) => response.blob())
            const key = createSignupMediaDraftKey('avatar')
            await saveSignupMediaDraft(key, blob)
            savedAvatar = { key, name: 'profile-photo.jpg', contentType: blob.type, byteLength: blob.size, durationSeconds: 0, createdAt: new Date().toISOString() }
          }
          if (savedAvatar) {
            const blob = await readSignupMediaDraft(savedAvatar.key)
            if (active && blob) {
              setAvatarDraft(savedAvatar)
              setAvatarDataUrl(await blobToDataUrl(blob))
            }
          }

          let savedPortfolioImages = Array.isArray(draft.portfolioImageDrafts)
            ? draft.portfolioImageDrafts.filter((value): value is SignupMediaDraftDescriptor => Boolean(value && typeof value === 'object' && typeof (value as SignupMediaDraftDescriptor).key === 'string')).slice(0, 12)
            : []
          if (!savedPortfolioImages.length && Array.isArray(draft.portfolioDataUrls)) {
            savedPortfolioImages = (await Promise.all(draft.portfolioDataUrls
              .filter((value): value is string => typeof value === 'string' && value.startsWith('data:image/'))
              .slice(0, 12)
              .map(async (dataUrl, index) => {
                const blob = await fetch(dataUrl).then((response) => response.blob())
                const key = createSignupMediaDraftKey('portfolio')
                await saveSignupMediaDraft(key, blob)
                return { key, name: `portfolio-photo-${index + 1}.jpg`, contentType: blob.type, byteLength: blob.size, durationSeconds: 0, createdAt: new Date().toISOString() }
              })))
          }
          const restoredPortfolioImages = await Promise.all(savedPortfolioImages.map(async (descriptor) => {
            const blob = await readSignupMediaDraft(descriptor.key)
            return blob ? { descriptor, dataUrl: await blobToDataUrl(blob) } : null
          }))
          if (active) {
            const availableImages = restoredPortfolioImages.filter((value): value is { descriptor: SignupMediaDraftDescriptor; dataUrl: string } => Boolean(value))
            setPortfolioImageDrafts(availableImages.map((value) => value.descriptor))
            setPortfolioDataUrls(availableImages.map((value) => value.dataUrl))
          }

          if (Array.isArray(draft.portfolioVideoDrafts)) setPortfolioVideoDrafts(draft.portfolioVideoDrafts.filter((value): value is SignupMediaDraftDescriptor => Boolean(value && typeof value === 'object' && typeof (value as SignupMediaDraftDescriptor).key === 'string')).slice(0, 4))
          if (draft.trustVideoDraft && typeof draft.trustVideoDraft === 'object' && typeof (draft.trustVideoDraft as SignupMediaDraftDescriptor).key === 'string') setTrustVideoDraft(draft.trustVideoDraft as SignupMediaDraftDescriptor)
          const storedChallenge = TAILOR_TRUST_VIDEO_CHALLENGES.find((challenge) => challenge.id === draft.trustChallengeId)
          if (storedChallenge) { setTrustChallengeId(storedChallenge.id); setTrustChallengeText(storedChallenge.text) }
          if (typeof draft.trustConsentGranted === 'boolean') setTrustConsentGranted(draft.trustConsentGranted)
          if (hasMeaningfulDraft) {
            setMessage('Your saved signup draft was restored. Re-enter your password to continue.')
          }
        }
      } catch {
        window.localStorage.removeItem(PUBLIC_SIGNUP_DRAFT_KEY)
      } finally {
        if (active) setSignupDraftHydrated(true)
      }
    }
    void hydrateDraft()
    return () => { active = false }
  }, [isSignUp, signupDraftHydrated])

  useEffect(() => {
    if (!isSignUp || !signupDraftHydrated) return
    window.localStorage.setItem(PUBLIC_SIGNUP_DRAFT_KEY, JSON.stringify(signupDraftSnapshot))
  }, [isSignUp, signupDraftHydrated, signupDraftSnapshot])

  useEffect(() => {
    if (!isSignUp || !signupDraftHydrated) return
    const persistLatestDraft = () => {
      window.localStorage.setItem(
        PUBLIC_SIGNUP_DRAFT_KEY,
        JSON.stringify(signupDraftSnapshot),
      )
    }
    window.addEventListener('pagehide', persistLatestDraft)
    return () => window.removeEventListener('pagehide', persistLatestDraft)
  }, [isSignUp, signupDraftHydrated, signupDraftSnapshot])

  useEffect(() => {
    if (!isSignUp || previousSignupStepRef.current === step) return
    previousSignupStepRef.current = step
    const heading = signupHeadingRef.current
    if (!heading) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    heading.focus({ preventScroll: true })
    heading.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [isSignUp, step])

  useEffect(() => {
    if (!isSignUp || role !== 'TAILOR' || step !== 6 || trustChallengeInitializedRef.current || trustVideoDraft) return
    trustChallengeInitializedRef.current = true
    const bytes = new Uint32Array(1)
    window.crypto.getRandomValues(bytes)
    const challenge = TAILOR_TRUST_VIDEO_CHALLENGES[(bytes[0] ?? 0) % TAILOR_TRUST_VIDEO_CHALLENGES.length] ?? TAILOR_TRUST_VIDEO_CHALLENGES[0]
    setTrustChallengeId(challenge.id)
    setTrustChallengeText(challenge.text)
  }, [isSignUp, role, step, trustVideoDraft])

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const blob = await prepareAvatar(file)
      if (avatarDraft?.key) await deleteSignupMediaDraft(avatarDraft.key).catch(() => undefined)
      const key = createSignupMediaDraftKey('avatar')
      await saveSignupMediaDraft(key, blob)
      setAvatarDraft({ key, name: file.name, contentType: blob.type, byteLength: blob.size, durationSeconds: 0, createdAt: new Date().toISOString() })
      setAvatarDataUrl(await blobToDataUrl(blob))
      event.target.value = ''
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This photo could not be prepared.')
      event.target.value = ''
    }
  }

  async function selectPortfolioImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    if (portfolioDataUrls.length + portfolioVideoDrafts.length + files.length > 12) {
      setError('Choose up to 12 portfolio photos or videos.')
      return
    }
    setError(null)
    try {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      const videoFiles = files.filter((file) => file.type.startsWith('video/'))
      if (portfolioVideoDrafts.length + videoFiles.length > 4) throw new Error('Choose up to 4 portfolio videos.')
      const preparedImages: Array<{ descriptor: SignupMediaDraftDescriptor; dataUrl: string }> = []
      for (const file of imageFiles) {
        const blob = await preparePortfolioImage(file)
        const key = createSignupMediaDraftKey('portfolio')
        await saveSignupMediaDraft(key, blob)
        preparedImages.push({
          descriptor: { key, name: file.name, contentType: blob.type, byteLength: blob.size, durationSeconds: 0, createdAt: new Date().toISOString() },
          dataUrl: await blobToDataUrl(blob),
        })
      }
      const preparedVideos: SignupMediaDraftDescriptor[] = []
      for (const file of videoFiles) {
        if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) throw new Error('Portfolio videos must be MP4, MOV, or WebM.')
        if (file.size > MEDIA_LIMITS_BYTES.portfolioVideo) throw new Error('Keep each portfolio video under 30 MB.')
        const durationSeconds = await readVideoDurationSeconds(file)
        if (durationSeconds > MEDIA_LIMITS_SECONDS.portfolioVideo + 0.75) throw new Error('Portfolio videos must be 30 seconds or less.')
        const key = createSignupMediaDraftKey('portfolio')
        await saveSignupMediaDraft(key, file)
        preparedVideos.push({ key, name: file.name, contentType: file.type, byteLength: file.size, durationSeconds, createdAt: new Date().toISOString() })
      }
      setPortfolioImageDrafts((current) => [...current, ...preparedImages.map((value) => value.descriptor)].slice(0, 12))
      setPortfolioDataUrls((current) => [...current, ...preparedImages.map((value) => value.dataUrl)].slice(0, 12))
      setPortfolioVideoDrafts((current) => [...current, ...preparedVideos].slice(0, 4))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those work samples could not be prepared.')
    }
  }

  async function removePortfolioVideo(index: number) {
    const draft = portfolioVideoDrafts[index]
    if (draft) await deleteSignupMediaDraft(draft.key).catch(() => undefined)
    setPortfolioVideoDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  async function removePortfolioImage(index: number) {
    const draft = portfolioImageDrafts[index]
    if (draft) await deleteSignupMediaDraft(draft.key).catch(() => undefined)
    setPortfolioImageDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setPortfolioDataUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  async function removeAvatar() {
    if (avatarDraft?.key) await deleteSignupMediaDraft(avatarDraft.key).catch(() => undefined)
    setAvatarDraft(null)
    setAvatarDataUrl(null)
  }

  function validateTailorSection(section: 3 | 4 | 5 | 6) {
    if (section === 3) {
      if (!avatarDataUrl) return TAILOR_SETUP_VALIDATION.PROFILE_PHOTO_REQUIRED_MESSAGE
      if (tailorLocation.trim().length < 2) return TAILOR_SETUP_VALIDATION.LOCATION_REQUIRED_MESSAGE
      if (tailorBio.trim().length < 80) return TAILOR_SETUP_VALIDATION.BIO_REQUIRED_MESSAGE
      if (!tailorLanguagesList.length) return TAILOR_SETUP_VALIDATION.LANGUAGE_REQUIRED_MESSAGE
      const leak = fieldHasContactLeak(tailorLocation, 'Location') || fieldHasContactLeak(tailorBio, 'Bio')
      if (leak) return leak
    }
    if (section === 4) {
      if (!tailorSpecialtiesList.length) return TAILOR_SETUP_VALIDATION.SPECIALTY_REQUIRED_MESSAGE
      const min = parseMajorAmountToMinor(priceMin)
      const max = parseMajorAmountToMinor(priceMax)
      if (!min || !max || max < min) return TAILOR_SETUP_VALIDATION.PRICE_REQUIRED_MESSAGE
      const minMajor = parseTailorPriceMajor(priceMin)
      const maxMajor = parseTailorPriceMajor(priceMax)
      if (minMajor < getTailorPriceMinMajor(defaultCurrency)) return getTailorPriceMinimumMessage(defaultCurrency)
      if (maxMajor > getTailorPriceMaxMajor(defaultCurrency)) return getTailorPriceLimitMessage(defaultCurrency)
      if (!supportsCustomOrders && !supportsReadyMade) return TAILOR_SETUP_VALIDATION.ORDER_MODE_REQUIRED_MESSAGE
    }
    if (section === 5 && tailorSellerType !== 'BOUTIQUE' && portfolioDataUrls.length + portfolioVideoDrafts.length < 1) {
      return TAILOR_SETUP_VALIDATION.PORTFOLIO_REQUIRED_MESSAGE
    }
    if (section === 6) {
      if (!fulfillment.length) return TAILOR_SETUP_VALIDATION.FULFILLMENT_REQUIRED_MESSAGE
      if (fulfillment.includes('PICKUP') && pickupAddress.trim().length < 8) {
        return TAILOR_SETUP_VALIDATION.PICKUP_ADDRESS_REQUIRED_MESSAGE
      }
      if (fulfillment.includes('PICKUP') && (!pickupCity.trim() || !/^[A-Za-z]{2}$/u.test(pickupCountryCode.trim()))) {
        return 'Add the pickup city and 2-letter country code before offering pickup.'
      }
      if (consultationMode === 'PAID' && !parseMajorAmountToMinor(consultationFee)) {
        return 'Enter a valid consultation fee.'
      }
      if (!trustVideoDraft) return TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE
      if (!trustConsentGranted) return 'Review and accept the private trust-video consent before creating your account.'
    }
    return null
  }

  function continueTailorSection(section: 3 | 4 | 5) {
    const issue = validateTailorSection(section)
    if (issue) {
      setError(issue)
      return
    }
    setError(null)
    setStep((section + 1) as 4 | 5 | 6)
  }

  const hasTailorDraft =
    tailorLocation.trim().length > 0 ||
    tailorBio.trim().length > 0 ||
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

    let providerUrl: string | null = null
    try {
      const { data, error: providerError } = await withAuthTimeout(
        supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: buildAuthCallbackUrl(contextualReturn ?? '/account/orders'),
            skipBrowserRedirect: true,
          },
        }),
        `${provider === 'apple' ? 'Apple' : 'Google'} sign-in`,
      )

      if (providerError || !data.url) {
        setProviderLoading(null)
        setError(mapAuthError(providerError?.message))
        return
      }
      providerUrl = data.url
    } catch (providerFailure) {
      setProviderLoading(null)
      setError(mapAuthError(providerFailure instanceof Error ? providerFailure.message : String(providerFailure)))
      return
    }

    const currentUrl = window.location.href
    window.location.assign(providerUrl)
    // A browser policy, embedded webview, or content blocker can refuse the
    // cross-origin handoff without throwing. Restore the controls instead of
    // leaving the page permanently frozen on “Opening…”. A successful
    // navigation unloads this timer before it can run.
    window.setTimeout(() => {
      if (window.location.href !== currentUrl) return
      setProviderLoading(null)
      setError(`The ${provider === 'apple' ? 'Apple' : 'Google'} sign-in page could not open. Check your browser settings and try again.`)
    }, 4_000)
  }

  function renderProviderEntry() {
    if (!appleOAuthEnabled && !googleOAuthEnabled) return null

    return (
      <div className="mt-6 grid gap-3">
        {appleOAuthEnabled ? (
        <button
          type="button"
          onClick={() => void continueWithProvider('apple')}
          disabled={loading || providerLoading !== null}
          className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current"><path d="M17.1 12.5c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.3-2.1-4-2.1-1.7-.2-3.3 1-4.2 1-.9 0-2.3-1-3.8-.9-1.9 0-3.7 1.1-4.7 2.8-2 3.5-.5 8.7 1.4 11.5.9 1.4 2.1 2.9 3.6 2.8 1.4-.1 2-1 3.7-1s2.2 1 3.8 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.5-3.1 1.5-3.2-.1 0-3.1-1.2-3.1-5zM14.3 4.5c.8-1 1.3-2.3 1.2-3.5-1.2.1-2.6.8-3.4 1.7-.7.8-1.4 2.2-1.2 3.4 1.3.1 2.6-.6 3.4-1.6z"/></svg>
          {providerLoading === 'apple' ? 'Opening Apple…' : 'Continue with Apple'}
        </button>
        ) : null}
        {googleOAuthEnabled ? (
        <button
          type="button"
          onClick={() => void continueWithProvider('google')}
          disabled={loading || providerLoading !== null}
          className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-full border border-ink/12 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.3 2.7C7.2 7.7 9.4 5.9 12 5.9z"/></svg>
          {providerLoading === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        ) : null}
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
      avatarDraft: avatarDraft ?? undefined,
      portfolioImageDrafts: portfolioImageDrafts.length ? portfolioImageDrafts : undefined,
      portfolioVideoDrafts: portfolioVideoDrafts.length ? portfolioVideoDrafts : undefined,
      trustVideoDraft: trustVideoDraft ?? undefined,
      trustChallengeId,
      trustChallengeText,
      trustConsentGranted,
    }

    if (skipOverride ?? skipProfileSetup) {
      const minimalBase = {
        source: base.source,
        role: base.role,
        displayName: base.displayName,
        phone: base.phone,
        defaultCurrency: base.defaultCurrency,
        currencySource: base.currencySource,
        regionCode: base.regionCode,
        avatarDraft: base.avatarDraft,
      }
      if (role === 'CUSTOMER') {
        return {
          ...minimalBase,
          customer: {
            unitPreference,
            garmentContext: 'BOTH',
          },
        }
      }
      // Tailor minimal defaults
      return {
        ...minimalBase,
        tailor: {
          location: 'Not set',
          bio: '',
          languages: ['English'],
          specialties: [],
          sellerType: 'TAILOR',
          availability: 'OPEN',
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
    if (tailorBio.trim().length < 80) {
      setError(TAILOR_SETUP_VALIDATION.BIO_REQUIRED_MESSAGE)
      return null
    }
    const contactLeakError =
      fieldHasContactLeak(tailorLocation, 'Location') ||
      fieldHasContactLeak(tailorBio, 'Bio') ||
      fieldHasContactLeak(tailorLanguagesList.join(', '), 'Languages') ||
      fieldHasContactLeak(tailorSpecialtiesList.join(', '), 'Specialties') ||
      fieldHasContactLeak(pickupAddress, 'Pickup address')
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
    if (tailorSellerType !== 'BOUTIQUE' && portfolioDataUrls.length + portfolioVideoDrafts.length === 0) {
      setError(TAILOR_SETUP_VALIDATION.PORTFOLIO_REQUIRED_MESSAGE)
      return null
    }
    if (!trustVideoDraft) {
      setError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      return null
    }
    if (!trustConsentGranted) {
      setError('Review and accept the private trust-video consent before creating your account.')
      return null
    }
    if (fulfillment.includes('PICKUP') && pickupAddress.trim().length < 8) {
      setError(TAILOR_SETUP_VALIDATION.PICKUP_ADDRESS_REQUIRED_MESSAGE)
      return null
    }

    return {
      ...base,
      tailor: {
        location: tailorLocation.trim(),
        bio: tailorBio.trim(),
        languages,
        specialties,
        sellerType: tailorSellerType,
        availability: tailorAvailability,
        priceRangeMin,
        priceRangeMax,
        supportsCustomOrders,
        supportsReadyMade,
        fulfillment,
        pickupAddress: pickupAddress.trim(),
        pickupCity: pickupCity.trim(),
        pickupRegion: pickupRegion.trim(),
        pickupPostalCode: pickupPostalCode.trim(),
        pickupCountryCode: pickupCountryCode.trim().toUpperCase(),
        consultationMode,
        consultationRequirement,
        consultationFee,
        consultationDuration,
        consultationCallType,
        consultationFeeCreditable,
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
    if (password !== confirmPassword) return 'Passwords do not match.'
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
    if (!captchaToken) {
      setError('Complete the security check before continuing.')
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setLoading(true)
    const normalizedEmail = email.trim().toLowerCase()
    const accountHome = isSignUp && role === 'TAILOR'
      ? '/account/profile?setup=1'
      : accountHomeForRole(role)
    const redirectTo = buildAuthCallbackUrl(accountHome)

    if (isSignUp) {
      const onboarding = buildOnboardingPayload(skipOverride)
      if (!onboarding) {
        setLoading(false)
        return
      }

      window.localStorage.setItem('drapeon.web.auth.roleIntent', role)
      window.localStorage.setItem('drapeon.web.auth.onboarding', JSON.stringify(onboarding))

      const mediaClaimToken = createMediaClaimToken()
      const mediaClaimHash = await sha256(mediaClaimToken)
      const quarantineEntries: QuarantineMediaEntry[] = [
        ...(onboarding.avatarDraft ? [{ ...onboarding.avatarDraft, kind: 'avatar' as const }] : []),
        ...(onboarding.portfolioImageDrafts ?? []).map((entry) => ({ ...entry, kind: 'portfolio-image' as const })),
        ...(onboarding.portfolioVideoDrafts ?? []).map((entry) => ({ ...entry, kind: 'portfolio-video' as const })),
        ...(onboarding.trustVideoDraft ? [{ ...onboarding.trustVideoDraft, kind: 'trust-video' as const }] : []),
      ]

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          captchaToken,
          emailRedirectTo: redirectTo,
          data: {
            display_name: displayName.trim(),
            phone: onboarding.phone,
            role,
            web_onboarding: persistedWebOnboardingPayload(onboarding),
            signup_media_claim_token: quarantineEntries.length ? mediaClaimToken : undefined,
            signup_media_claim_hash: quarantineEntries.length ? mediaClaimHash : undefined,
            signup_trust_challenge_id: onboarding.trustChallengeId,
            signup_trust_challenge_text: onboarding.trustChallengeText,
            signup_trust_consent_granted: onboarding.trustConsentGranted === true,
          },
        },
      })

      setCaptchaToken(null)
      setCaptchaResetKey((current) => current + 1)

      if (error) {
        setLoading(false)
        window.localStorage.removeItem('drapeon.web.auth.roleIntent')
        window.localStorage.removeItem('drapeon.web.auth.onboarding')
        setError(mapAuthError(error.message))
        return
      }
      if (!data.session) {
        if (quarantineEntries.length && data.user?.id) {
          try {
            await stageSignupMedia({ userId: data.user.id, claimToken: mediaClaimToken, entries: quarantineEntries })
          } catch (mediaError) {
            setLoading(false)
            setPendingConfirmationEmail(normalizedEmail)
            setError(mediaError instanceof Error ? mediaError.message : 'Private signup media could not upload. Try again before confirming your email.')
            return
          }
        }
        setPendingConfirmationEmail(normalizedEmail)
        setMessage('Check your email to confirm your Drapeon account. The link returns you to your account after confirmation.')
        setLoading(false)
        return
      }
      setLoading(false)
      markWebSessionScope(true)
      router.replace(`/auth/callback?next=${encodeURIComponent(accountHome)}`)
      return
    }

    let signInError: string | undefined
    let signedInRole: DrapeRole | null = null
    let signedInSession: Session | null = null
    try {
      // Do not trim passwords: signup preserves the exact value and whitespace
      // can be a legitimate part of a user's credential. Await the real auth
      // outcome so a late response cannot establish a session after the UI has
      // already reported an artificial client timeout.
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
        options: { captchaToken },
      })
      signInError = error?.message
      signedInSession = data?.session ?? null
      const metadataRole = data?.user?.user_metadata?.role
      signedInRole = metadataRole === 'TAILOR' || metadataRole === 'CUSTOMER' ? metadataRole : null
      if (!signedInRole && data?.user?.id) {
        signedInRole = await fetchStoredAccountRole(data.user.id)
      }
    } catch (signInFailure) {
      signInError = signInFailure instanceof Error ? signInFailure.message : String(signInFailure)
    }

    setCaptchaToken(null)
    setCaptchaResetKey((current) => current + 1)

    if (signInError) {
      console.warn('[web auth] Password sign-in failed', signInError)
      setLoading(false)
      if (isEmailNotConfirmedError(signInError)) {
        setPendingConfirmationEmail(normalizedEmail)
      }
      setError(mapAuthError(signInError))
      return
    }

    if (!signedInSession) {
      setLoading(false)
      setError('Drapeon could not establish a complete session. Please sign in again.')
      return
    }

    const destination = contextualReturn ?? accountHomeForRole(signedInRole ?? role)
    try {
      const assessment = await assessWebDevice(signedInSession, rememberDevice)
      if (!assessment.trusted) {
        if (!assessment.challengeId) throw new Error('A device verification code could not be created.')
        setPassword('')
        setDeviceCode('')
        setDeviceChallenge({
          challengeId: assessment.challengeId,
          maskedEmail: assessment.maskedEmail ?? 'your account email',
          expiresAt: assessment.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
          session: signedInSession,
          destination,
        })
        setLoading(false)
        return
      }
    } catch (cause) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      setLoading(false)
      setError(cause instanceof Error ? cause.message : 'This device could not be verified.')
      return
    }

    setPendingConfirmationEmail(null)
    markWebSessionScope(rememberDevice)
    window.localStorage.removeItem('drapeon.web.auth.roleIntent')
    window.localStorage.removeItem('drapeon.web.auth.onboarding')
    setLoading(false)
    router.replace(destination as Route)
  }

  async function verifyDeviceCode() {
    if (!deviceChallenge || loading) return
    const normalizedCode = deviceCode.replace(/\D/gu, '').slice(0, 6)
    if (normalizedCode.length !== 6) {
      setError('Enter the six-digit code from your email.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await verifyWebDevice(deviceChallenge.session, deviceChallenge.challengeId, normalizedCode)
      markWebSessionScope(rememberDevice)
      window.localStorage.removeItem('drapeon.web.auth.roleIntent')
      window.localStorage.removeItem('drapeon.web.auth.onboarding')
      router.replace(deviceChallenge.destination as Route)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That code could not be verified.')
      setLoading(false)
    }
  }

  async function resendDeviceCode() {
    if (!deviceChallenge || loading) return
    setLoading(true)
    setError(null)
    try {
      const next = await assessWebDevice(deviceChallenge.session, rememberDevice)
      if (!next.challengeId) throw new Error('A new verification code could not be created.')
      setDeviceChallenge({
        ...deviceChallenge,
        challengeId: next.challengeId,
        maskedEmail: next.maskedEmail ?? deviceChallenge.maskedEmail,
        expiresAt: next.expiresAt ?? deviceChallenge.expiresAt,
      })
      setDeviceCode('')
      setMessage('A new code was sent. Use the latest email.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A new code could not be sent.')
    } finally {
      setLoading(false)
    }
  }

  async function cancelDeviceVerification() {
    if (!deviceChallenge || loading) return
    setLoading(true)
    await createClient().auth.signOut({ scope: 'local' }).catch(() => undefined)
    setDeviceChallenge(null)
    setDeviceCode('')
    setMessage(null)
    setError(null)
    setLoading(false)
    router.replace('/sign-in')
  }

  async function resendConfirmation() {
    if (loading || resendLoading || !pendingConfirmationEmail) return
    if (!captchaToken) {
      setError('Complete the security check before requesting another email.')
      return
    }

    const supabase = getSupabase()
    if (!supabase) return

    setError(null)
    setMessage(null)
    setResendLoading(true)
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: pendingConfirmationEmail,
      options: {
        emailRedirectTo: buildAuthCallbackUrl(role === 'TAILOR' ? '/account/profile?setup=1' : accountHomeForRole(role)),
        captchaToken,
      },
    })
    setCaptchaToken(null)
    setCaptchaResetKey((current) => current + 1)
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
        {role === 'TAILOR' ? (
          <div className="mt-4 rounded-[10px] border border-needle/18 bg-needle/7 px-4 py-3 text-left">
            <p className="text-sm font-semibold text-ink">Continue from any browser or device</p>
            <p className="mt-1 text-xs leading-5 text-ink/58">After confirmation, Drapeon opens your required studio setup. You will add your portfolio or ready-made proof and private trust video there before submitting for review.</p>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-ink/44">
          Check spam if it hasn&apos;t arrived in a few minutes.
        </p>
        <div className="mt-5 text-left">
          <TurnstileChallenge
            key={captchaResetKey}
            action="resend"
            onTokenChange={setCaptchaToken}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            void resendConfirmation()
          }}
          disabled={resendLoading || !captchaToken}
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
        {message ? (
          <p role="status" aria-live="polite" className="mt-4 rounded-lg border border-needle/20 bg-needle/8 px-4 py-3 text-sm text-ink">
            {message}
          </p>
        ) : null}
      </div>
    )
  }

  if (!isSignUp && deviceChallenge) {
    return (
      <div className="rounded-[8px] border border-ink/8 bg-white/92 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">New device</p>
            <h1 className="mt-2 text-3xl leading-tight text-ink sm:text-4xl">Check your email.</h1>
            <p className="mt-3 text-sm leading-6 text-ink/64">
              Enter the six-digit code sent to <span className="font-semibold text-ink">{deviceChallenge.maskedEmail}</span>.
            </p>
          </div>
        </div>
        <form
          className="mt-7 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void verifyDeviceCode()
          }}
        >
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Verification code
            <span className="relative block">
              <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink/40" aria-hidden="true" />
              <input
                value={deviceCode}
                onChange={(event) => {
                  setDeviceCode(event.target.value.replace(/\D/gu, '').slice(0, 6))
                  setError(null)
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                aria-describedby="device-code-expiry"
                className="min-h-14 w-full rounded-lg border border-ink/10 bg-white pl-12 pr-4 text-center font-mono text-2xl tracking-[0.28em] text-ink outline-none transition focus:border-needle"
                placeholder="000000"
              />
            </span>
          </label>
          <p id="device-code-expiry" className="text-xs leading-5 text-ink/50">
            Expires {new Date(deviceChallenge.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Never share this code.
          </p>
          {message ? <p role="status" className="rounded-lg border border-needle/15 bg-needle/7 px-4 py-3 text-sm text-needle">{message}</p> : null}
          {error ? <p role="alert" className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">{error}</p> : null}
          <button
            type="submit"
            disabled={loading || deviceCode.length !== 6}
            className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
          >
            {loading ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/6 pt-5 text-sm">
          <button type="button" disabled={loading} onClick={() => void cancelDeviceVerification()} className="font-semibold text-ink/56 hover:text-ink">
            Use another account
          </button>
          <button type="button" disabled={loading} onClick={() => void resendDeviceCode()} className="font-semibold text-needle hover:underline">
            Send a new code
          </button>
        </div>
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
                setError(null)
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
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError(null)
                }}
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

          <TurnstileChallenge
            key={captchaResetKey}
            action="signin"
            onTokenChange={setCaptchaToken}
          />

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
                disabled={loading || resendLoading || !captchaToken}
                className="min-h-11 rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-needle transition hover:bg-bone disabled:cursor-not-allowed disabled:text-ink/36"
              >
                {resendLoading ? 'Sending...' : 'Resend confirmation email'}
              </button>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading || !captchaToken}
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
              <span className="block font-semibold text-ink">Trust this device for 30 days</span>
              <span className="mt-1 block text-xs leading-5 text-ink/56">
                Uncheck this on shared or public computers. We will verify this browser again after the session ends.
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
      <div className="mb-6 flex items-center gap-2" aria-label={`Step ${step} of ${role === 'TAILOR' ? 2 : 3}`}>
        {Array.from({ length: role === 'TAILOR' ? 2 : 3 }, (_, index) => index + 1).map((n) => (
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
            <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-3 scroll-mt-28 text-4xl leading-tight text-ink outline-none sm:text-5xl">
              Start your Drapeon account.
            </h1>
            <p className="mt-4 text-sm leading-7 text-ink/66">
              One account for ordering and tailoring.
            </p>
            {message ? <p role="status" className="mt-3 rounded-[8px] border border-needle/15 bg-needle/6 px-3 py-2 text-xs leading-5 text-ink/62">{message}</p> : null}
          </div>

          {renderProviderEntry()}

          <form
            className="mt-1 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              const validationError = validateStep1()
              if (validationError) {
                setError(validationError)
                return
              }
              setError(null)
              setStep(2)
            }}
          >
            <div className="flex items-center gap-4 rounded-[8px] border border-ink/10 bg-white p-3">
              <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/10 text-lg font-semibold text-needle">
                {avatarDataUrl ? (
                  <Image src={avatarDataUrl} alt="Profile photo preview" fill unoptimized className="object-cover" />
                ) : (
                  displayName.trim().slice(0, 1).toUpperCase() || 'D'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Profile photo</p>
                <p className="mt-1 text-xs leading-5 text-ink/52">Add a clear photo for your profile, orders, and messages. It is privately staged before confirmation and attaches even if you open the email on another browser or device.</p>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                aria-hidden="true"
                tabIndex={-1}
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => { void selectAvatar(event) }}
                className="sr-only"
              />
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="min-h-10 rounded-[8px] border border-ink/12 px-3 text-xs font-semibold text-needle transition hover:bg-bone"
                >
                  {avatarDataUrl ? 'Change' : 'Add photo'}
                </button>
                {avatarDataUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      void removeAvatar()
                      if (avatarInputRef.current) avatarInputRef.current.value = ''
                    }}
                    className="text-xs font-semibold text-ink/52 transition hover:text-rust"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            <label className="grid gap-2 text-sm font-semibold text-ink">
              Display name
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setError(null)
                }}
                placeholder="e.g. John Doe"
                autoComplete="name"
                className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
              />
            </label>

            <PhoneNumberField
              label="Phone number"
              value={phone}
              onValueChange={(value) => {
                setPhone(value)
                setError(null)
              }}
              placeholder="Phone number"
              required
              defaultCountryCode={detectedPhoneCountry}
              hint={`Used for order updates and account recovery. ${ACCOUNT_PHONE_UNIQUENESS_HINT}`}
            />

            <label className="grid gap-2 text-sm font-semibold text-ink">
              Email
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setPendingConfirmationEmail(null)
                  setError(null)
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
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError(null)
                  }}
                  placeholder="10+ characters"
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

            <div className="grid gap-2 text-sm font-semibold text-ink">
              <label htmlFor={`${passwordInputId}-confirmation`}>Confirm password</label>
              <input
                id={`${passwordInputId}-confirmation`}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  setError(null)
                }}
                placeholder="Enter it again"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={MAX_PASSWORD_LENGTH}
                className="min-h-12 rounded-lg border border-ink/10 bg-white px-4 text-base font-normal text-ink outline-none transition placeholder:text-ink/36 focus:border-needle"
              />
            </div>

            {error ? (
              <div role="alert" aria-live="polite" className="rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600"
            >
              Continue
            </button>
          </form>

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
            <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-2 scroll-mt-28 text-3xl leading-tight text-ink outline-none sm:text-4xl">
              Choose your role.
            </h1>
            <p className="mt-2 text-sm text-ink/58">You can shop and work from one account.</p>
          </div>

          <div className="mt-5 grid gap-2">
            {/* Customer card */}
            <button
              type="button"
              onClick={() => setRole('CUSTOMER')}
              aria-pressed={role === 'CUSTOMER'}
              className={`flex min-h-24 cursor-pointer items-center gap-4 rounded-[8px] border p-4 text-left transition-colors ${
                role === 'CUSTOMER'
                  ? 'border-needle/30 bg-needle/6 ring-2 ring-needle/20'
                  : 'border-ink/10 bg-white hover:bg-bone/60'
              }`}
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-needle/10">
                <ShoppingBag aria-hidden="true" className="size-5 text-needle" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1"><p className="text-base font-semibold text-ink">Customer</p><p className="mt-1 text-sm leading-5 text-ink/62">Find tailors, share a brief, and track every order.</p></div>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${role === 'CUSTOMER' ? 'border-needle bg-needle' : 'border-ink/20'}`}>{role === 'CUSTOMER' ? <span className="size-1.5 rounded-full bg-white" /> : null}</span>
            </button>

            {/* Tailor card */}
            <button
              type="button"
              onClick={() => setRole('TAILOR')}
              aria-pressed={role === 'TAILOR'}
              className={`flex min-h-24 cursor-pointer items-center gap-4 rounded-[8px] border p-4 text-left transition-colors ${
                role === 'TAILOR'
                  ? 'border-needle/30 bg-needle/6 ring-2 ring-needle/20'
                  : 'border-ink/10 bg-white hover:bg-bone/60'
              }`}
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-needle/10">
                <Store aria-hidden="true" className="size-5 text-needle" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1"><p className="text-base font-semibold text-ink">Tailor</p><p className="mt-1 text-sm leading-5 text-ink/62">Build your storefront, manage work, and receive payouts.</p></div>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${role === 'TAILOR' ? 'border-needle bg-needle' : 'border-ink/20'}`}>{role === 'TAILOR' ? <span className="size-1.5 rounded-full bg-white" /> : null}</span>
            </button>
          </div>

          {error ? (
            <div role="alert" aria-live="polite" className="mt-4 rounded-lg border border-rust/20 bg-rust/8 px-4 py-3 text-sm leading-6 text-ink">
              {error}
            </div>
          ) : null}

          {role === 'TAILOR' ? (
            <div className="mt-5 grid gap-3">
              <div className="rounded-[8px] border border-needle/14 bg-needle/6 px-4 py-3">
                <p className="text-sm font-semibold text-ink">Your studio setup follows confirmation</p>
                <p className="mt-1 text-xs leading-5 text-ink/58">After confirming your email, Drapeon opens the required four-step setup. Boutique and Tailor Shop accounts must add their first hidden ready-made proof item before trust review can begin.</p>
              </div>
              <TurnstileChallenge
                key={captchaResetKey}
                action="signup"
                onTokenChange={setCaptchaToken}
              />
            </div>
          ) : null}

          <div className="mt-5 flex justify-between gap-3">
            <button
              type="button"
              onClick={() => { setError(null); setStep(1) }}
              className="min-h-11 rounded-[8px] border border-ink/10 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bone"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null)
                if (role === 'TAILOR') void submit(true)
                else setStep(3)
              }}
              disabled={loading || (role === 'TAILOR' && !captchaToken)}
              className="min-h-11 rounded-[8px] bg-needle px-6 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(45,106,79,0.16)] transition hover:bg-needle-600"
            >
              {role === 'TAILOR' ? (loading ? 'Creating…' : 'Create account') : 'Continue'}
            </button>
          </div>
        </>
      ) : null}

      {role === 'TAILOR' && step === 3 ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Studio setup · 1 of 4</p>
          <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-3 scroll-mt-28 text-4xl leading-tight text-ink outline-none sm:text-5xl">Your identity.</h1>
          <p className="mt-3 text-sm leading-6 text-ink/62">Build the public profile customers use to recognize and trust your studio.</p>
          <div className="mt-6 grid gap-5">
            <div className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-bone/40 p-3">
              <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/10 font-semibold text-needle">
                {avatarDataUrl ? <Image src={avatarDataUrl} alt="Profile photo" fill unoptimized className="object-cover" /> : displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{displayName}</p><p className="truncate text-xs text-ink/52">{phone}</p></div>
              {!avatarDataUrl ? <span className="ml-auto text-xs font-semibold text-rust">Photo required</span> : <Check className="ml-auto size-5 text-needle" aria-label="Profile photo ready" />}
            </div>
            <StructuredAddressSearch
              label="City or base location"
              value={tailorLocation}
              placeholder="Search city or area"
              allowManualFallback={false}
              className=""
              onSelect={(address) => {
                setTailorLocation([address.city, address.stateRegion, address.country].filter(Boolean).join(', '))
                setPickupCity(address.city ?? '')
                setPickupRegion(address.stateRegion ?? '')
                setPickupCountryCode(address.countryCode ?? '')
                setError(null)
              }}
            />
            <label className="grid gap-2 text-sm font-semibold text-ink">
              About your work
              <textarea value={tailorBio} onChange={(event) => { setTailorBio(event.target.value); setError(null) }} maxLength={600} rows={5} placeholder="What do you make best? Who do you sew for? How do fittings and timelines work?" className="rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-base font-normal leading-7 text-ink outline-none focus:border-needle" />
              <span className={`text-xs font-normal ${tailorBio.trim().length >= 80 ? 'text-needle' : 'text-ink/48'}`}>{tailorBio.trim().length}/80 minimum · 600 maximum</span>
            </label>
            <SetupOptionPicker label="Languages" values={tailorLanguagesList} groups={TAILOR_LANGUAGE_GROUPS} limit={12} onChange={(values) => { setTailorLanguagesList(values); setError(null) }} />
            {error ? <div role="alert" className="rounded-[8px] border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">{error}</div> : null}
            <div className="flex gap-3"><button type="button" onClick={() => { setError(null); setStep(2) }} className="min-h-12 flex-1 rounded-full border border-ink/10 bg-white px-5 text-sm font-semibold">Back</button><button type="button" onClick={() => continueTailorSection(3)} className="min-h-12 flex-1 rounded-full bg-needle px-5 text-sm font-semibold text-white">Continue</button></div>
          </div>
        </section>
      ) : null}

      {role === 'TAILOR' && step === 4 ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Studio setup · 2 of 4</p>
          <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-3 scroll-mt-28 text-4xl leading-tight text-ink outline-none sm:text-5xl">What you make.</h1>
          <p className="mt-3 text-sm leading-6 text-ink/62">Use the same catalogue and business choices as the Drapeon app.</p>
          <div className="mt-6 grid gap-5">
            <SetupOptionPicker label="Specialties" values={tailorSpecialtiesList} groups={TAILOR_SPECIALTY_GROUPS} limit={20} onChange={(values) => { setTailorSpecialtiesList(values); setError(null) }} />
            <SetupSingleChoicePicker
              label="Business type"
              value={tailorSellerType}
              options={TAILOR_SELLER_TYPE_OPTIONS}
              onChange={(value) => {
                setTailorSellerType(value)
                if (value === 'BOUTIQUE') { setSupportsCustomOrders(false); setSupportsReadyMade(true) }
                else if (value === 'TAILOR_SHOP') { setSupportsCustomOrders(true); setSupportsReadyMade(true) }
                else { setSupportsCustomOrders(true); setSupportsReadyMade(false) }
                setError(null)
              }}
            />
            <label className="grid gap-2 text-sm font-semibold text-ink">Profile currency<select value={defaultCurrency} onChange={(event) => { setDefaultCurrency(event.target.value as AccountCurrencyCode); setCurrencySource('USER_SELECTED') }} className="min-h-12 rounded-[8px] border border-ink/10 bg-white px-4 text-base font-normal">{SUPPORTED_CURRENCIES.map((option) => <option key={option.code} value={option.code}>{option.symbol} {option.code} — {option.name}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2"><MoneyInput id="signup-tailor-price-min" label="Typical project minimum" value={priceMin} onValueChange={setPriceMin} currency={defaultCurrency} /><MoneyInput id="signup-tailor-price-max" label="Typical project maximum" value={priceMax} onValueChange={setPriceMax} currency={defaultCurrency} /></div>
            <fieldset className="grid gap-2"><legend className="text-sm font-semibold text-ink">How customers can order</legend><label className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white p-3 text-sm"><input type="checkbox" checked={supportsCustomOrders} onChange={(event) => setSupportsCustomOrders(event.target.checked)} /> Custom orders</label><label className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white p-3 text-sm"><input type="checkbox" checked={supportsReadyMade} onChange={(event) => setSupportsReadyMade(event.target.checked)} /> Ready-made shop</label></fieldset>
            {error ? <div role="alert" className="rounded-[8px] border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">{error}</div> : null}
            <div className="flex gap-3"><button type="button" onClick={() => { setError(null); setStep(3) }} className="min-h-12 flex-1 rounded-full border border-ink/10 bg-white px-5 text-sm font-semibold">Back</button><button type="button" onClick={() => continueTailorSection(4)} className="min-h-12 flex-1 rounded-full bg-needle px-5 text-sm font-semibold text-white">Continue</button></div>
          </div>
        </section>
      ) : null}

      {role === 'TAILOR' && step === 5 ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Studio setup · 3 of 4</p>
          <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-3 scroll-mt-28 text-4xl leading-tight text-ink outline-none sm:text-5xl">{tailorSellerType === 'BOUTIQUE' ? 'Shop proof.' : tailorSellerType === 'TAILOR_SHOP' ? 'Public proof.' : 'Portfolio.'}</h1>
          <p className="mt-3 text-sm leading-6 text-ink/62">{tailorSellerType === 'BOUTIQUE' ? 'Your first ready-made listing is the proof customers inspect. You can prepare optional brand media now; the listing editor opens after email confirmation.' : tailorSellerType === 'TAILOR_SHOP' ? 'Add at least one portfolio photo or video now. You will add one ready-made listing after confirmation before review can begin.' : 'Add at least one real work photo or short video. You will see exactly what is selected before continuing.'}</p>
          <div className="mt-6 grid gap-5">
            {tailorSellerType === 'BOUTIQUE' ? <div className="rounded-[10px] border border-needle/16 bg-needle/6 p-4"><p className="text-sm font-semibold text-ink">Ready-made proof continues after confirmation</p><p className="mt-1 text-xs leading-5 text-ink/58">A real listing needs inventory, price, size, and delivery details owned by your confirmed account. Your saved signup returns directly to that editor.</p></div> : null}
            <input ref={portfolioInputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple className="sr-only" onChange={(event) => { void selectPortfolioImages(event) }} />
            <button type="button" onClick={() => portfolioInputRef.current?.click()} className="grid min-h-32 cursor-pointer place-items-center rounded-[12px] border border-dashed border-needle/35 bg-needle/5 p-5 text-center transition-colors hover:bg-needle/10 focus-visible:ring-2 focus-visible:ring-needle/35"><span><span className="mx-auto flex items-center justify-center gap-2 text-needle"><ImagePlus className="size-6" aria-hidden="true" /><Video className="size-6" aria-hidden="true" /></span><span className="mt-2 block text-sm font-semibold text-needle">Choose portfolio media</span><span className="mt-1 block text-xs text-ink/48">Photos or videos · 12 items total · up to 4 videos</span></span></button>
            {portfolioDataUrls.length || portfolioVideoDrafts.length ? <div className="grid grid-cols-2 gap-3" aria-label="Selected work samples">{portfolioDataUrls.map((url, index) => <div key={portfolioImageDrafts[index]?.key ?? `${url.slice(-12)}-${index}`} className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-ink/10 bg-bone"><Image src={url} alt={`Work sample photo ${index + 1}`} fill unoptimized className="object-cover" /><button type="button" aria-label={`Remove work sample photo ${index + 1}`} onClick={() => void removePortfolioImage(index)} className="absolute right-2 top-2 grid size-8 cursor-pointer place-items-center rounded-full bg-black/70 text-white"><X className="size-4" /></button><span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">Photo</span></div>)}{portfolioVideoDrafts.map((draft, index) => <SignupDraftVideoPreview key={draft.key} draft={draft} label={`Work sample video ${index + 1}`} onRemove={() => void removePortfolioVideo(index)} />)}</div> : <p className="rounded-[8px] border border-ink/8 bg-bone/40 px-4 py-3 text-sm text-ink/56">No portfolio media selected yet.</p>}
            <div className="flex items-center justify-between text-xs text-ink/48"><span>{portfolioDataUrls.length + portfolioVideoDrafts.length}/12 media selected</span><span>{portfolioVideoDrafts.length}/4 videos</span></div>
            <p className="text-xs leading-5 text-ink/48">Media uploads to private temporary storage before confirmation, then attaches to your account. You can open the confirmation link on another browser or device.</p>
            {error ? <div role="alert" className="rounded-[8px] border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">{error}</div> : null}
            <div className="flex gap-3"><button type="button" onClick={() => { setError(null); setStep(4) }} className="min-h-12 flex-1 rounded-full border border-ink/10 bg-white px-5 text-sm font-semibold">Back</button><button type="button" onClick={() => continueTailorSection(5)} className="min-h-12 flex-1 rounded-full bg-needle px-5 text-sm font-semibold text-white">Continue</button></div>
          </div>
        </section>
      ) : null}

      {role === 'TAILOR' && step === 6 ? (
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Studio setup · 4 of 4</p>
          <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-3 scroll-mt-28 text-4xl leading-tight text-ink outline-none sm:text-5xl">Setup &amp; verification.</h1>
          <p className="mt-3 text-sm leading-6 text-ink/62">Set availability, fulfilment, and consultation rules before submitting your private trust video.</p>
          <form className="mt-6 grid gap-5" onSubmit={(event) => { event.preventDefault(); const issue = validateTailorSection(6); if (issue) { setError(issue); return }; void submit() }}>
            <label className="grid gap-2 text-sm font-semibold text-ink">Availability<select value={tailorAvailability} onChange={(event) => setTailorAvailability(event.target.value as TailorAvailability)} className="min-h-12 rounded-[8px] border border-ink/10 bg-white px-4 text-base font-normal"><option value="OPEN">Open for orders</option><option value="LIMITED">Limited availability</option><option value="FULLY_BOOKED">Fully booked</option></select></label>
            <fieldset className="grid gap-2"><legend className="text-sm font-semibold text-ink">How customers receive orders <span className="font-normal text-ink/48">· choose at least one</span></legend>{FULFILLMENT_OPTIONS.map((option) => <label key={option.value} className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white p-3 text-sm"><input type="checkbox" checked={fulfillment.includes(option.value)} onChange={() => { setFulfillment((current) => current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value]); setError(null) }} /> {option.label}</label>)}</fieldset>
            {fulfillment.includes('PICKUP') ? <div className="grid gap-3 rounded-[8px] border border-ink/10 bg-bone/35 p-4"><StructuredAddressSearch label="Private pickup address · required for Pickup" value={pickupAddress} placeholder="Search full pickup address" allowManualFallback className="" onSelect={(address) => { setPickupAddress(address.displayValue); setPickupCity(address.city); setPickupRegion(address.stateRegion); setPickupPostalCode(address.postcode); setPickupCountryCode(address.countryCode ?? ''); setError(null) }} /><p className="text-xs leading-5 text-ink/48">Required only when Pickup is selected. Kept private until a confirmed customer needs collection details.</p></div> : null}
            <fieldset className="grid gap-3"><legend className="text-sm font-semibold text-ink">Consultations</legend><div className="grid grid-cols-3 gap-2">{(['UNAVAILABLE','FREE','PAID'] as const).map((value) => <button key={value} type="button" aria-pressed={consultationMode === value} onClick={() => setConsultationMode(value)} className={`min-h-11 rounded-full border px-2 text-xs font-semibold ${consultationMode === value ? 'border-needle bg-needle text-white' : 'border-ink/10 bg-white text-ink'}`}>{value === 'UNAVAILABLE' ? 'Not offered' : value === 'FREE' ? 'Free' : 'Paid'}</button>)}</div>{consultationMode !== 'UNAVAILABLE' ? <><label className="grid gap-2 text-sm font-semibold text-ink">Requirement<select value={consultationRequirement} onChange={(event) => setConsultationRequirement(event.target.value as 'OPTIONAL' | 'REQUIRED')} className="min-h-11 rounded-[8px] border border-ink/10 bg-white px-3 font-normal"><option value="OPTIONAL">Optional</option><option value="REQUIRED">Required before ordering</option></select></label><div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm font-semibold text-ink">Duration<select value={consultationDuration} onChange={(event) => setConsultationDuration(event.target.value as '15' | '30' | '45' | '60')} className="min-h-11 rounded-[8px] border border-ink/10 bg-white px-3 font-normal">{['15','30','45','60'].map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label><label className="grid gap-2 text-sm font-semibold text-ink">Call type<select value={consultationCallType} onChange={(event) => setConsultationCallType(event.target.value as 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO')} className="min-h-11 rounded-[8px] border border-ink/10 bg-white px-3 font-normal"><option value="VIDEO">Video</option><option value="AUDIO">Audio</option><option value="AUDIO_OR_VIDEO">Audio or video</option></select></label></div>{consultationMode === 'PAID' ? <><MoneyInput id="signup-consultation-fee" label="Consultation fee" value={consultationFee} onValueChange={setConsultationFee} currency={defaultCurrency} /><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={consultationFeeCreditable} onChange={(event) => setConsultationFeeCreditable(event.target.checked)} /> Credit the fee toward an order</label></> : null}</> : null}</fieldset>
            <SignupTrustVideo challengeText={trustChallengeText} draft={trustVideoDraft} consentGranted={trustConsentGranted} onDraftChange={(nextDraft) => { setTrustVideoDraft(nextDraft); setError(null) }} onConsentChange={(granted) => { setTrustConsentGranted(granted); setError(null) }} onError={setError} />
            <div className="rounded-[10px] border border-ink/8 bg-bone/40 px-4 py-3 text-xs leading-5 text-ink/58"><p><span className="font-semibold text-ink">What happens next:</span> create the account, then open the confirmation email on any browser or device. Drapeon attaches the privately staged profile media and trust video for review before the storefront can go live.</p><p className="mt-2">Keep this page open only until account creation finishes and the check-your-inbox screen appears.</p></div>
            <TurnstileChallenge key={captchaResetKey} action="signup" onTokenChange={setCaptchaToken} />
            {error ? <div role="alert" className="rounded-[8px] border border-rust/20 bg-rust/8 px-4 py-3 text-sm text-ink">{error}</div> : null}
            <div className="flex gap-3"><button type="button" onClick={() => { setError(null); setStep(5) }} className="min-h-12 flex-1 rounded-full border border-ink/10 bg-white px-5 text-sm font-semibold">Back</button><button type="submit" disabled={loading || !captchaToken} className="min-h-12 flex-1 rounded-full bg-needle px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">{loading ? 'Creating…' : 'Create account'}</button></div>
          </form>
        </section>
      ) : null}

      {/* ── Customer step 3 ── */}
      {step === 3 && role === 'CUSTOMER' ? (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Profile setup
            </p>
            <h1 ref={signupHeadingRef} tabIndex={-1} className="mt-3 scroll-mt-28 text-4xl leading-tight text-ink outline-none sm:text-5xl">
              Tell tailors about your style.
            </h1>
            <p className="mt-4 text-sm leading-7 text-ink/66">
              Add the basic fit details needed before measurements, saved tailors, and orders.
            </p>
          </div>

          <form
            className="mt-6 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <>
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

              <>
                <div className="grid gap-2 text-sm font-semibold text-ink">
                  <span>Measurement units</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['in', 'cm'] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        aria-pressed={unitPreference === unit}
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
                        aria-pressed={garmentContext === option.value}
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
              </>

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

            <TurnstileChallenge
              key={captchaResetKey}
              action="signup"
              onTokenChange={setCaptchaToken}
            />

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
                disabled={loading || !captchaToken}
                className="flex-1 min-h-[52px] rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(45,106,79,0.18)] transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/18 disabled:text-ink/42"
              >
                {loading ? 'Working...' : 'Create account'}
              </button>
            </div>

            {role === 'CUSTOMER' ? (
              <button
                type="button"
                onClick={() => {
                  setSkipProfileSetup(true)
                  void submit(true)
                }}
                disabled={loading || !captchaToken}
                className="text-center text-xs text-ink/44 hover:text-ink disabled:cursor-not-allowed disabled:text-ink/28"
              >
                Skip for now
              </button>
            ) : null}
          </form>
        </>
      ) : null}
    </div>
  )
}
