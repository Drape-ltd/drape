/**
 * Seller profile setup wizard — 4 steps
 * Step 0: Identity (display name, phone, location, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (at least one work sample)
 * Step 3: Availability + ID verification upload
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { detectDeviceCurrencyPreference, fetchCurrencyPreferenceContext } from '@/lib/currency'
import { isDuplicatePhoneError, isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { syncUserRow } from '@/lib/syncUserRow'
import { stripExif } from '@/lib/stripExif'
import { createValidatedUploadPayload, uploadPublicStorageImage } from '@/lib/storage-upload'
import { Sentry } from '@/lib/sentry'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import {
  AddressAutocompleteInput,
  Button,
  Input,
  RemoteImage,
  TagSelector,
  ProgressStepper,
} from '@/components/ui'
import type { TagGroup } from '@/components/ui'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
import {
  normalizePhoneForStorage,
  PHONE_STORAGE_HINT,
  validatePhoneForProfile,
} from '@drape/shared/phone'
import {
  deriveTailorSetupProgress,
  getTailorPriceMaxMajor,
  getTailorPriceMinMajor,
  parseTailorPriceMajor,
  TAILOR_SETUP_VALIDATION,
  type TailorSetupField,
  type TailorSetupFieldErrors,
  type TailorSetupStep,
} from '@drape/shared/tailor-setup'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { Availability } from '@/lib/shared-types'

type SellerType = 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
type ProfilePhotoSource = 'camera' | 'library'
type PortfolioMediaSource = 'camera-photo' | 'camera-video' | 'library'
type IdDocumentSource = 'camera' | 'library'
type PortfolioItem = { type: 'photo' | 'video'; url: string }
type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
type MediaSheetMode = 'profile-photo' | 'portfolio-media' | 'id-document' | null
type SetupChoiceSheetMode = 'availability' | 'seller-type' | 'order-mode' | 'fulfillment' | 'currency' | null

type TailorSetupProfileRow = {
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  location: string | null
  languages: unknown
  specialty_tags: unknown
  price_range_min: number | null
  price_range_max: number | null
  currency: string | null
  seller_type: string | null
  id_verification_status: string | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  delivery_fee: number | null
  shipping_fee: number | null
  portfolio_photo_urls: unknown
  portfolio_video_urls: unknown
  availability: string | null
}

type UserCurrencyRow = {
  default_currency: string | null
  currency_source: string | null
  region_code: string | null
  phone: string | null
}

type PickupDetailsRow = {
  pickup_address: string | null
  pickup_instructions: string | null
}

type NominatimSuggestion = {
  display_name?: unknown
  address?: {
    city?: unknown
    town?: unknown
    village?: unknown
    county?: unknown
    country?: unknown
  }
}

type ErrorWithStatus = {
  statusCode?: unknown
  name?: unknown
}

const MAX_PORTFOLIO_ITEMS = 12
const MIN_PORTFOLIO_ITEMS = 1
const MAX_PORTFOLIO_VIDEOS = 2
const MAX_LANGUAGE_TAGS = 12
const MAX_SPECIALTY_TAGS = 20
const SUPPORTED_CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'] as const
const PORTFOLIO_MIN_MARKER_LEFT = `${(MIN_PORTFOLIO_ITEMS / MAX_PORTFOLIO_ITEMS) * 100}%` as `${number}%`

const STEP_TITLES = ['Your identity', 'What you make', 'Portfolio', 'Selling setup']
const STEP_SUBS = [
  'This is your public tailor profile. No contact details here. Buyers find you through Drapeon.',
  'Tell people what you make and what to expect on price.',
  'Add at least one real work sample. More photos help buyers trust your profile faster.',
  'Choose what you sell, how people receive orders, and verify your identity to go live.',
]
const STEP_LABELS = ['Identity', 'Specialties', 'Portfolio', 'Selling']
const AVAILABILITY_SETUP_OPTIONS: Array<{ value: Availability; label: string; hint: string }> = [
  { value: 'OPEN', label: 'Open', hint: 'Accepting new order requests.' },
  { value: 'LIMITED', label: 'Limited', hint: 'Visible, but customers see that replies may take longer.' },
  { value: 'FULLY_BOOKED', label: 'Fully booked', hint: 'New bookings pause. Existing orders are unaffected.' },
]
const SELLER_TYPE_OPTIONS: Array<{ value: SellerType; label: string; hint: string }> = [
  { value: 'TAILOR', label: 'Tailor', hint: 'Custom work first.' },
  { value: 'BOUTIQUE', label: 'Boutique', hint: 'A shop with tailors behind it.' },
  { value: 'TAILOR_SHOP', label: 'Tailor shop', hint: 'Custom and ready-made together.' },
]

// ─── Language options (grouped by region) ────────────────────────────────────

const LANGUAGE_GROUPS: TagGroup[] = [
  {
    label: 'West African',
    items: [
      'English',
      'Yoruba',
      'Igbo',
      'Hausa',
      'Pidgin',
      'Twi',
      'Akan',
      'Fante',
      'Ga',
      'Ewe',
      'Wolof',
      'Fulani',
      'Dagbani',
    ],
  },
  {
    label: 'East & Southern Africa',
    items: ['Swahili', 'Amharic', 'Somali', 'Zulu', 'Xhosa', 'Shona', 'Kikuyu', 'Luganda'],
  },
  {
    label: 'European',
    items: ['French', 'Portuguese', 'Spanish', 'Italian', 'German', 'Dutch'],
  },
  {
    label: 'Middle Eastern',
    items: ['Arabic', 'Turkish', 'Farsi'],
  },
  {
    label: 'South & Southeast Asian',
    items: ['Hindi', 'Urdu', 'Punjabi', 'Gujarati', 'Bengali', 'Tamil', 'Tagalog'],
  },
  {
    label: 'East Asian',
    items: ['Mandarin', 'Japanese', 'Korean'],
  },
]

// ─── Specialty options (grouped by category) ─────────────────────────────────

const SPECIALTY_GROUPS: TagGroup[] = [
  {
    label: 'West African',
    items: [
      'Agbada',
      'Iro & Buba',
      'Ankara',
      'Kaftans',
      'Dashiki',
      'Boubou',
      'Native Wear',
      'Asoebi',
      'Kente',
    ],
  },
  {
    label: 'Formal & Western',
    items: ['Suits', 'Wool Suits', 'Tuxedo', 'Shirts', 'Trousers', 'Blazers'],
  },
  {
    label: 'Womenswear',
    items: [
      'Bespoke Dress',
      'Wedding Gown',
      'Prom Dress',
      'Bridal',
      'Jumpsuit',
      'Skirts',
      'Blouses',
    ],
  },
  {
    label: 'South Asian',
    items: ['Lehenga', 'Saree Blouse', 'Kurta', 'Shalwar Kameez', 'Sherwani'],
  },
  {
    label: 'Middle Eastern & North African',
    items: ['Abaya', 'Jalabiya', 'Kaftan'],
  },
  {
    label: 'East Asian',
    items: ['Qipao / Cheongsam'],
  },
  {
    label: 'Craft & Textile',
    items: ['Crochet', 'Knitwear', 'Embroidery', 'Beadwork', 'Adire', 'Batik'],
  },
  {
    label: 'Lifestyle & Ready-made',
    items: ['Two-piece Set', 'Loungewear', 'Beachwear', 'Ready-made'],
  },
]
const BIO_PROMPTS = [
  'What you make best',
  'Who you usually sew for',
  'How fittings and timelines work',
] as const
const PRICE_PRESETS: Array<{
  label: string
  currency: 'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD'
  min: string
  max: string
}> = [
  { label: 'Budget', currency: 'NGN', min: '50000', max: '120000' },
  { label: 'Mid-range', currency: 'NGN', min: '120000', max: '300000' },
  { label: 'Premium', currency: 'NGN', min: '300000', max: '800000' },
] as const

export default function TailorSetupScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, signOut, switchRole } = useAuth()
  const detectedCurrency = useMemo(() => detectDeviceCurrencyPreference(), [])
  const oauthName =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    ''
  const oauthPhone = typeof user?.user_metadata?.phone === 'string' ? user.user_metadata.phone : ''

  // Guard: if the profile is already complete and ID is not pending re-submission,
  // prevent direct-URL re-entry which would allow upsert-overwrite of existing data.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase
      .from('tailor_profiles')
      .select('profile_completed, id_verification_status')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return
        if (
          data?.profile_completed &&
          data?.id_verification_status !== 'NOT_SUBMITTED' &&
          data?.id_verification_status !== 'REJECTED'
        ) {
          router.replace('/(tailor)/profile')
        }
      })
    return () => {
      cancelled = true
    }
  }, [router, user?.id])

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert(
              'Unable to sign out',
              'Please try again in a moment. You can stay here and continue setup, then sign out later if needed.'
            )
          })
        },
      },
    ])
  }

  function switchBackToCustomer() {
    if (switchingToCustomer) return
    Alert.alert(
      'Return to customer mode?',
      'Your tailor setup can wait. Drapeon will take you back to the customer side with this same account.',
      [
        { text: 'Stay here', style: 'cancel' },
        {
          text: 'Return to customer',
          onPress: () => {
            setSwitchingToCustomer(true)
            void switchRole('CUSTOMER')
              .then(({ error }) => {
                if (error) {
                  Alert.alert('Could not switch modes', error)
                  return
                }
                router.replace('/(customer)')
              })
              .finally(() => setSwitchingToCustomer(false))
          },
        },
      ]
    )
  }

  const [step, setStep] = useState<TailorSetupStep>(0)
  const [saving, setSaving] = useState(false)
  const [switchingToCustomer, setSwitchingToCustomer] = useState(false)
  const [visibleErrors, setVisibleErrors] = useState<TailorSetupFieldErrors>({})
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [pickupHydrated, setPickupHydrated] = useState(false)
  const [mediaSheetMode, setMediaSheetMode] = useState<MediaSheetMode>(null)
  const [choiceSheetMode, setChoiceSheetMode] = useState<SetupChoiceSheetMode>(null)
  const initialStepResolved = useRef(false)

  // Step 0
  const [displayName, setDisplayName] = useState(oauthName)
  const [nameError, setNameError] = useState('')
  const [phone, setPhone] = useState(oauthPhone)
  const [phoneError, setPhoneError] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [bio, setBio] = useState('')
  const [bioError, setBioError] = useState('')
  const [location, setLocation] = useState('')
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const locationDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [languages, setLanguages] = useState<string[]>(['English'])

  // Step 1
  const [specialties, setSpecialties] = useState<string[]>([])
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [currency, setCurrency] = useState<'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD'>(
    detectedCurrency.currency
  )
  const [currencySource, setCurrencySource] = useState(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const priceMinGuide = useMemo(
    () => getTailorPriceMinMajor(currency).toLocaleString('en'),
    [currency]
  )
  const priceMaxGuide = useMemo(
    () => getTailorPriceMaxMajor(currency).toLocaleString('en'),
    [currency]
  )

  // Step 2
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const pickedUris = useRef<Set<string>>(new Set())

  // Step 3
  const [availability, setAvailability] = useState<Availability>('OPEN')
  const [sellerType, setSellerType] = useState<SellerType>('TAILOR')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupInstructions, setPickupInstructions] = useState('')
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null)
  const [idVerificationStatus, setIdVerificationStatus] =
    useState<VerificationStatus>('NOT_SUBMITTED')
  const [idError, setIdError] = useState('')
  const [uploadingId, setUploadingId] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    void fetchCurrencyPreferenceContext().then((resolved) => {
      if (cancelled) return
      setCurrency(resolved.currency)
      setCurrencySource(resolved.source)
      setRegionCode(resolved.regionCode)
    })

    supabase
      .from('tailor_profiles')
      .select(
        `
        display_name, avatar_url, bio, location, languages, specialty_tags,
        price_range_min, price_range_max, currency, seller_type,
        id_verification_status,
        supports_custom_orders, supports_ready_made,
        pickup_available, delivery_available, shipping_available,
        delivery_fee, shipping_fee,
        portfolio_photo_urls, portfolio_video_urls, availability
      `
      )
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setProfileHydrated(true)
          return
        }

        const row = data as TailorSetupProfileRow
        const nextDisplayName = row.display_name ?? oauthName
        const nextAvatarUrl = row.avatar_url ?? null
        const nextBio = row.bio ?? ''
        const nextLocation = row.location ?? ''
        const nextLanguages = Array.isArray(row.languages)
          ? row.languages.filter(
              (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0
            )
          : []
        const nextSpecialties = Array.isArray(row.specialty_tags)
          ? row.specialty_tags.filter(
              (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0
            )
          : []
        const nextPhotos = Array.isArray(row.portfolio_photo_urls)
          ? row.portfolio_photo_urls
              .filter(
                (item: unknown): item is string =>
                  typeof item === 'string' && item.trim().length > 0
              )
              .map((url: string) => ({ type: 'photo' as const, url }))
          : []
        const nextVideos = Array.isArray(row.portfolio_video_urls)
          ? row.portfolio_video_urls
              .filter(
                (item: unknown): item is string =>
                  typeof item === 'string' && item.trim().length > 0
              )
              .map((url: string) => ({ type: 'video' as const, url }))
          : []

        if (typeof nextDisplayName === 'string' && nextDisplayName.trim().length > 0) {
          setDisplayName(nextDisplayName)
        }
        if (typeof nextAvatarUrl === 'string' && nextAvatarUrl.trim().length > 0) {
          setAvatarUrl(nextAvatarUrl)
        }
        if (typeof nextBio === 'string' && nextBio.trim().length > 0) {
          setBio(nextBio)
        }
        if (typeof nextLocation === 'string' && nextLocation.trim().length > 0) {
          setLocation(nextLocation)
        }
        if (nextLanguages.length > 0) {
          setLanguages(nextLanguages.slice(0, MAX_LANGUAGE_TAGS))
        }
        if (nextSpecialties.length > 0) {
          setSpecialties(nextSpecialties.slice(0, MAX_SPECIALTY_TAGS))
        }
        if (typeof row.price_range_min === 'number' && row.price_range_min > 0) {
          setPriceMin(String(row.price_range_min / 100))
        }
        if (typeof row.price_range_max === 'number' && row.price_range_max > 0) {
          setPriceMax(String(row.price_range_max / 100))
        }
        if (
          typeof row.currency === 'string' &&
          SUPPORTED_CURRENCIES.includes(row.currency as (typeof SUPPORTED_CURRENCIES)[number])
        ) {
          setCurrency(row.currency as typeof currency)
        }
        if (nextPhotos.length > 0 || nextVideos.length > 0) {
          setPortfolioItems([...nextPhotos, ...nextVideos])
        }
        if (
          typeof row.availability === 'string' &&
          ['OPEN', 'LIMITED', 'FULLY_BOOKED'].includes(row.availability)
        ) {
          setAvailability(row.availability as Availability)
        }
        if (
          typeof row.seller_type === 'string' &&
          ['TAILOR', 'BOUTIQUE', 'TAILOR_SHOP'].includes(row.seller_type)
        ) {
          setSellerType(row.seller_type as SellerType)
        }
        if (typeof row.supports_custom_orders === 'boolean')
          setSupportsCustomOrders(row.supports_custom_orders)
        if (typeof row.supports_ready_made === 'boolean')
          setSupportsReadyMade(row.supports_ready_made)
        if (typeof row.pickup_available === 'boolean') setPickupAvailable(row.pickup_available)
        if (typeof row.delivery_available === 'boolean')
          setDeliveryAvailable(row.delivery_available)
        if (typeof row.shipping_available === 'boolean')
          setShippingAvailable(row.shipping_available)
        if (
          typeof row.id_verification_status === 'string' &&
          ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'APPROVED', 'REJECTED'].includes(
            row.id_verification_status
          )
        ) {
          setIdVerificationStatus(
            row.id_verification_status === 'APPROVED'
              ? 'VERIFIED'
              : (row.id_verification_status as VerificationStatus)
          )
        }
        setProfileHydrated(true)
      })

    supabase
      .from('users')
      .select('default_currency, currency_source, region_code, phone')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return

        const row = data as UserCurrencyRow
        const nextCurrency =
          typeof row.default_currency === 'string' &&
          SUPPORTED_CURRENCIES.includes(
            row.default_currency as (typeof SUPPORTED_CURRENCIES)[number]
          )
            ? (row.default_currency as typeof currency)
            : null

        if (nextCurrency) {
          setCurrency(nextCurrency)
        }
        if (
          typeof row.currency_source === 'string' &&
          row.currency_source.trim().length > 0
        ) {
          setCurrencySource(row.currency_source.trim().toUpperCase() as typeof currencySource)
        }
        if (
          typeof row.region_code === 'string' &&
          row.region_code.trim().length > 0
        ) {
          setRegionCode(row.region_code.trim().toUpperCase())
        }
        const nextPhone =
          typeof row.phone === 'string' && row.phone.trim().length > 0
            ? row.phone.trim()
            : oauthPhone
        if (nextPhone.trim().length > 0) {
          setPhone(nextPhone)
        }
      })

    supabase
      .from('tailor_pickup_details')
      .select('pickup_address, pickup_instructions')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setPickupHydrated(true)
          return
        }

        const row = data as PickupDetailsRow
        if (typeof row.pickup_address === 'string') setPickupAddress(row.pickup_address)
        if (typeof row.pickup_instructions === 'string')
          setPickupInstructions(row.pickup_instructions)
        setPickupHydrated(true)
      })

    return () => {
      cancelled = true
    }
  }, [user?.id, oauthName, oauthPhone])

  // ── Location autocomplete via Nominatim (OSM, no API key) ───────────────────

  function onLocationChange(text: string) {
    setLocation(text)
    clearVisibleError('location')
    setShowSuggestions(false)
    if (locationDebounce.current) clearTimeout(locationDebounce.current)
    if (text.trim().length < 3) {
      setLocationSuggestions([])
      return
    }
    locationDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=6&featuretype=city`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drapeon/1.0' } }
        )
        const data = (await res.json()) as NominatimSuggestion[]
        const labels = data
          .filter(
            (item) =>
              item && typeof item.display_name === 'string' && item.display_name.length > 0
          )
          .map((item) => {
            const displayName =
              typeof item.display_name === 'string' ? item.display_name : ''
            const a = item.address ?? {}
            const city =
              a.city ?? a.town ?? a.village ?? a.county ?? displayName.split(',')[0]
            const country = a.country ?? ''
            return country ? `${city}, ${country}` : city
          })
          .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
        const unique = [...new Set(labels)] as string[]
        setLocationSuggestions(unique)
        setShowSuggestions(unique.length > 0)
      } catch {
        // Nominatim unavailable — just let the user type freely
      }
    }, 400)
  }

  function selectLocation(suggestion: string) {
    setLocation(suggestion)
    clearVisibleError('location')
    setLocationSuggestions([])
    setShowSuggestions(false)
  }

  // ── Bio gibberish detection ──────────────────────────────────────────────────

  function isBioGibberish(text: string): boolean {
    const t = text.trim()
    // Excessive repeated characters: "hhhhhh", "aaaaaaa"
    if (/(.)\1{4,}/i.test(t)) return true
    // Actual keyboard-smash sequences (chars that run in order along a row)
    if (
      /qwert|werty|ertyu|rtyui|tyuio|yuiop|asdfg|sdfgh|dfghj|fghjk|ghjkl|zxcvb|xcvbn|cvbnm/i.test(t)
    )
      return true
    // Must contain at least 5 real words (3+ letters each)
    const words = t.match(/[a-zA-Z]{3,}/g) ?? []
    if (words.length < 5) return true
    // Vowel ratio below 15% → likely consonant mashing (real English ~38% vowels)
    const vowels = (t.match(/[aeiou]/gi) ?? []).length
    const letters = (t.match(/[a-zA-Z]/g) ?? []).length
    if (letters > 20 && vowels / letters < 0.15) return true
    // Average word length > 14 = suspiciously long tokens
    const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length
    if (avgLen > 14) return true
    return false
  }

  function validateName(value: string) {
    const error = validateDisplayName(value)
    setNameError(error ?? '')
    return !error
  }

  function validatePhone(value: string) {
    if (!value.trim()) {
      setPhoneError(TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE)
      return false
    }
    const error = validatePhoneForProfile(value)
    if (error) {
      setPhoneError(error)
      return false
    }
    setPhoneError('')
    return true
  }

  function validateBio(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) {
      setBioError("Contact details aren't allowed in your bio.")
      return false
    }
    if (text.trim().length < 80) {
      setBioError(`About you needs at least 80 characters (${text.trim().length}/80).`)
      return false
    }
    if (isBioGibberish(text)) {
      setBioError('Please enter a meaningful description of your work and experience.')
      return false
    }
    setBioError('')
    return true
  }

  const hasIdDocumentForSetup = useCallback(() => {
    if (idPhotoUri) return true
    return idVerificationStatus !== 'NOT_SUBMITTED' && idVerificationStatus !== 'REJECTED'
  }, [idPhotoUri, idVerificationStatus])

  const getSetupProgress = useCallback((overrides?: {
    nameError?: string
    phoneError?: string
    bioError?: string
    idDocumentPresent?: boolean
  }) => {
    return deriveTailorSetupProgress({
      displayName,
      nameError: overrides?.nameError ?? nameError,
      phone,
      phoneError: overrides?.phoneError ?? phoneError,
      profilePhotoPresent: !!avatarUrl,
      location,
      bio,
      bioError: overrides?.bioError ?? bioError,
      bioLooksInvalid: bio.trim().length > 0 && isBioGibberish(bio),
      languages,
      specialties,
      priceMin,
      priceMax,
      currency,
      portfolioItemCount: portfolioItems.length,
      supportsCustomOrders,
      supportsReadyMade,
      pickupAvailable,
      deliveryAvailable,
      shippingAvailable,
      pickupAddress,
      idDocumentPresent: overrides?.idDocumentPresent ?? hasIdDocumentForSetup(),
    })
  }, [
    displayName,
    nameError,
    phone,
    phoneError,
    avatarUrl,
    location,
    bio,
    bioError,
    languages,
    specialties,
    priceMin,
    priceMax,
    currency,
    portfolioItems.length,
    supportsCustomOrders,
    supportsReadyMade,
    pickupAvailable,
    deliveryAvailable,
    shippingAvailable,
    pickupAddress,
    hasIdDocumentForSetup,
  ])

  function clearVisibleError(field: TailorSetupField) {
    setVisibleErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  useEffect(() => {
    if (initialStepResolved.current || !profileHydrated || !pickupHydrated) return
    const progress = getSetupProgress()
    setStep(progress.firstIncompleteStep)
    initialStepResolved.current = true
  }, [getSetupProgress, pickupHydrated, profileHydrated])

  function openProfilePhotoPicker() {
    setMediaSheetMode('profile-photo')
  }

  async function pickProfilePhoto(source: ProfilePhotoSource) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to take your profile photo.'
          : 'Allow photo access to choose your profile photo.'
      )
      return
    }

    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: 'images',
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.85,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: 'images',
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.85,
          })
    if (res.canceled || !res.assets[0] || !user?.id) return

    setUploadingAvatar(true)
    try {
      const cleanUri = await stripExif(res.assets[0].uri, { maxWidth: 900 })
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'avatars',
        path: `${user.id}/avatar.jpg`,
        uri: cleanUri,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        upsert: true,
      })
      setAvatarUrl(`${publicUrl}?t=${new Date().getTime()}`)
      clearVisibleError('profilePhoto')
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_avatar_upload', userId: user?.id },
      })
      Alert.alert(
        'Could not add profile photo',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your setup details are still here, so retry the photo when the signal improves.'
          : 'We could not upload this photo right now. Please try again in a moment.'
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  function openPortfolioMediaPicker() {
    setMediaSheetMode('portfolio-media')
  }

  async function uploadPortfolioAsset(
    asset: ImagePicker.ImagePickerAsset,
    index: number
  ): Promise<PortfolioItem> {
    if (!user?.id) {
      throw new Error('Session expired. Please sign in again.')
    }

    const isVideo = asset.type === 'video'
    const stamp = `${new Date().getTime()}-${index}`

    if (isVideo) {
      const extension = asset.fileName?.split('.').pop()?.toLowerCase() || 'mp4'
      const filename = `portfolio/${user.id}/${stamp}.${extension}`
      const payload = await createValidatedUploadPayload(asset.uri, 50 * 1024 * 1024)
      const contentType = asset.mimeType ?? payload.contentType ?? 'video/mp4'
      const { error: videoError } = await supabase.storage
        .from('portfolio-photos')
        .upload(filename, payload.data, { contentType })
      if (videoError) throw videoError
      const { data } = supabase.storage.from('portfolio-photos').getPublicUrl(filename)
      return { type: 'video', url: data.publicUrl }
    }

    const uri = await stripExif(asset.uri, { maxWidth: 1400 })
    const filename = `portfolio/${user.id}/${stamp}.jpg`
    const publicUrl = await uploadPublicStorageImage({
      bucket: 'portfolio-photos',
      path: filename,
      uri,
      contentType: 'image/jpeg',
      maxBytes: 10 * 1024 * 1024,
    })
    return { type: 'photo', url: publicUrl }
  }

  async function pickPortfolioMedia(source: PortfolioMediaSource) {
    if (portfolioItems.length >= MAX_PORTFOLIO_ITEMS) {
      Alert.alert('Maximum reached', `You can add up to ${MAX_PORTFOLIO_ITEMS} photos or videos.`)
      return
    }
    const videoCount = portfolioItems.filter((i) => i.type === 'video').length
    if (source === 'camera-video' && videoCount >= MAX_PORTFOLIO_VIDEOS) {
      Alert.alert(
        'Video limit',
        `You can include up to ${MAX_PORTFOLIO_VIDEOS} videos in your portfolio.`
      )
      return
    }

    const permission =
      source === 'library'
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'library'
          ? 'Allow photo access to choose portfolio media.'
          : 'Allow camera access to capture portfolio media.'
      )
      return
    }

    const res =
      source === 'library'
        ? await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsMultipleSelection: true,
            orderedSelection: true,
            selectionLimit: Math.min(
              MAX_PORTFOLIO_ITEMS - portfolioItems.length,
              MAX_PORTFOLIO_ITEMS
            ),
            quality: 0.85,
            videoMaxDuration: 30,
          })
        : source === 'camera-video'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: 'videos',
              quality: 0.8,
              videoMaxDuration: 30,
            })
          : await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              quality: 0.85,
            })
    if (res.canceled || !res.assets[0]) return

    const remainingSlots = MAX_PORTFOLIO_ITEMS - portfolioItems.length
    const candidates = res.assets.slice(0, remainingSlots)
    const acceptedAssets: ImagePicker.ImagePickerAsset[] = []
    let skippedDuplicates = 0
    let skippedVideos = 0
    let nextVideoCount = videoCount

    for (const asset of candidates) {
      if (pickedUris.current.has(asset.uri)) {
        skippedDuplicates += 1
        continue
      }
      if (asset.type === 'video' && nextVideoCount >= MAX_PORTFOLIO_VIDEOS) {
        skippedVideos += 1
        continue
      }
      if (asset.type === 'video') nextVideoCount += 1
      acceptedAssets.push(asset)
    }

    if (acceptedAssets.length === 0) {
      const reason =
        skippedDuplicates > 0
          ? 'Those files are already in your portfolio.'
          : `You can include up to ${MAX_PORTFOLIO_VIDEOS} videos in your portfolio.`
      Alert.alert('Nothing added', reason)
      return
    }

    setUploadingMedia(true)
    acceptedAssets.forEach((asset) => pickedUris.current.add(asset.uri))

    const uploadedItems: PortfolioItem[] = []
    const failedAssets: ImagePicker.ImagePickerAsset[] = []
    try {
      for (let i = 0; i < acceptedAssets.length; i += 1) {
        try {
          uploadedItems.push(await uploadPortfolioAsset(acceptedAssets[i], i))
        } catch (assetError) {
          failedAssets.push(acceptedAssets[i])
          pickedUris.current.delete(acceptedAssets[i].uri)
          Sentry.captureException(assetError, {
            extra: { context: 'tailor_setup_media_asset_upload', userId: user?.id },
          })
        }
      }

      if (uploadedItems.length > 0) {
        setPortfolioItems((prev) => [...prev, ...uploadedItems].slice(0, MAX_PORTFOLIO_ITEMS))
        clearVisibleError('portfolio')
      }

      if (
        failedAssets.length > 0 ||
        skippedDuplicates > 0 ||
        skippedVideos > 0 ||
        res.assets.length > candidates.length
      ) {
        const notes = [
          uploadedItems.length > 0 ? `${uploadedItems.length} added` : null,
          failedAssets.length > 0 ? `${failedAssets.length} failed` : null,
          skippedDuplicates > 0 ? `${skippedDuplicates} duplicate` : null,
          skippedVideos > 0 ? `${skippedVideos} over video limit` : null,
          res.assets.length > candidates.length
            ? `${res.assets.length - candidates.length} over portfolio limit`
            : null,
        ].filter(Boolean)
        Alert.alert('Portfolio update', notes.join(' · '))
      }
    } catch (error) {
      const capturedError = error as ErrorWithStatus
      acceptedAssets.forEach((asset) => pickedUris.current.delete(asset.uri))
      const details = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not upload this media yet. Retry from this setup step when the signal improves.'
        : 'We could not upload this media right now. Please try again in a moment.'
      Sentry.captureException(error, {
        extra: {
          context: 'tailor_setup_media_upload',
          userId: user?.id,
          statusCode: capturedError.statusCode,
          name: capturedError.name,
        },
      })
      Alert.alert('Could not upload media', details)
    } finally {
      setUploadingMedia(false)
    }
  }

  function openIdPhotoPicker() {
    setMediaSheetMode('id-document')
  }

  async function pickIdPhoto(source: IdDocumentSource) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to take your ID document photo.'
          : 'Allow photo access to choose your ID document.'
      )
      return
    }

    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 })
    if (res.canceled || !res.assets[0]) return
    setIdPhotoUri(res.assets[0].uri)
    clearVisibleError('idDocument')
    setIdError('')
  }

  async function uploadIdAndSave(): Promise<string | null> {
    if (!idPhotoUri) return null
    setUploadingId(true)
    const filename = `id-verification/${user?.id}/${Date.now()}.jpg`
    try {
      const cleanUri = await stripExif(idPhotoUri)
      const payload = await createValidatedUploadPayload(cleanUri, 20 * 1024 * 1024)
      const { error } = await supabase.storage
        .from('id-documents')
        .upload(filename, payload.data, { contentType: 'image/jpeg' })
      if (error) throw error
      setUploadingId(false)
      return filename
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_id_upload', userId: user?.id },
      })
      setUploadingId(false)
      return null
    }
  }

  async function finish() {
    if (saving || uploadingId || uploadingMedia) return

    if (!hasIdDocumentForSetup()) {
      setStep(3)
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      return
    }

    setSaving(true)

    if (!user?.id) {
      setSaving(false)
      Alert.alert('Session expired', 'Please sign in again and retry profile setup.')
      return
    }

    const idUrl = idPhotoUri ? await uploadIdAndSave() : null

    if (idPhotoUri && !idUrl) {
      setSaving(false)
      setStep(3)
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      Alert.alert(
        'ID upload failed',
        'We could not upload your ID document yet. Retry from this setup step before submitting.'
      )
      return
    }

    const normalizedPhone = normalizePhoneForStorage(phone)

    const { error } = await invokeFunction('tailor-profile-action', {
      body: {
        action: 'upsert-setup',
        profile: {
          displayName: displayName.trim(),
          avatarUrl,
          bio: bio.trim() || null,
          location: location.trim(),
          languages: languages.slice(0, MAX_LANGUAGE_TAGS),
          specialties: specialties.slice(0, MAX_SPECIALTY_TAGS),
          priceRangeMin: priceMin ? Math.round(parseTailorPriceMajor(priceMin) * 100) : null,
          priceRangeMax: priceMax ? Math.round(parseTailorPriceMajor(priceMax) * 100) : null,
          currency,
          portfolioPhotoUrls: portfolioItems.filter((i) => i.type === 'photo').map((i) => i.url),
          portfolioVideoUrls: portfolioItems.filter((i) => i.type === 'video').map((i) => i.url),
          availability,
          sellerType,
          supportsCustomOrders,
          supportsReadyMade,
          pickupAvailable,
          pickupAddress: pickupAddress.trim() || null,
          pickupInstructions: pickupInstructions.trim() || null,
          deliveryAvailable,
          shippingAvailable,
          deliveryFee: 0,
          shippingFee: 0,
          idDocumentUrl: idUrl,
        },
      },
    })

    setSaving(false)

    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your setup yet. Your details are still here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not save your profile right now. Please try again in a moment.'
          )
      if (message.includes(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)) {
        setStep(3)
        setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
        setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      }
      Sentry.captureException(error, {
        extra: {
          context: 'tailor_setup_submit',
          step,
          userId: user.id,
          pickupAvailable,
          deliveryAvailable,
          shippingAvailable,
          supportsCustomOrders,
          supportsReadyMade,
        },
      })
      Alert.alert('Setup not saved', message)
      return
    }

    const { error: authError } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim(), phone: normalizedPhone },
    })

    if (authError) {
      Alert.alert(
        'Profile saved',
        'Your profile was saved, but we could not finish updating your account contact details. Please reopen setup and try again.'
      )
      return
    }

    try {
      await syncUserRow({
        userId: user.id,
        displayName: displayName.trim(),
        role: 'TAILOR',
        phone: normalizedPhone,
        defaultCurrency: currency,
        currencySource,
        regionCode,
        currencyConfirmedAt: new Date().toISOString(),
        strict: true,
      })
    } catch (syncError) {
      Alert.alert(
        'Profile saved',
        isDuplicatePhoneError(syncError)
          ? 'That phone number is already connected to another Drapeon account. Use a different number or contact support.'
          : isLikelyConnectivityIssue(syncError)
          ? 'Your tailor profile was saved, but we could not finish locking your account currency because the connection looks weak. Please reopen setup and retry.'
          : 'Your tailor profile was saved, but we could not finish locking your account currency right now. Please reopen setup and try again.'
      )
      return
    }

    if (idUrl) {
      invokeFunction('notify-ops-verification', {
        body: { tailorId: user.id },
      }).catch(() => {})
    }

    Alert.alert(
      'Profile submitted',
      idUrl
        ? "We'll review your ID within 24 hours. You'll be notified when your profile goes live."
        : 'Your profile is saved. Submit a government ID to go live.',
      [{ text: 'OK', onPress: () => router.replace('/(tailor)/profile') }]
    )
  }

  function next() {
    if (saving || uploadingId || uploadingMedia) return
    const nextNameError = step === 0 ? (validateDisplayName(displayName) ?? '') : nameError
    const nextPhoneError =
      step === 0
        ? !phone.trim()
          ? TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE
          : (validatePhoneForProfile(phone) ?? '')
        : phoneError
    const bioValid = step === 0 ? validateBio(bio) : true

    if (step === 0) {
      setNameError(nextNameError)
      setPhoneError(nextPhoneError)
    }

    const progress = getSetupProgress({
      nameError: nextNameError,
      phoneError: nextPhoneError,
      bioError: bioValid ? '' : bioError || TAILOR_SETUP_VALIDATION.BIO_REQUIRED_MESSAGE,
    })

    if (!progress.stepValid[step]) {
      const currentErrors = progress.stepErrors[step]
      setVisibleErrors(currentErrors)
      if (currentErrors.idDocument) {
        setIdError(currentErrors.idDocument)
      }
      return
    }

    setVisibleErrors({})
    if (step === 3 && !hasIdDocumentForSetup()) {
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      return
    }
    if (step < 3) setStep((step + 1) as TailorSetupStep)
    else finish()
  }

  function goBack() {
    if (step > 0) {
      setStep((step - 1) as TailorSetupStep)
      return
    }
    Alert.alert(
      'Leave setup?',
      'Your tailor profile is not finished yet. You can stay here, return to customer mode, or sign out and come back later.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Return to customer', onPress: switchBackToCustomer },
        { text: 'Sign out', style: 'destructive', onPress: handleSignOut },
      ]
    )
  }

  const setupProgress = getSetupProgress()
  const setupChecklist = [
    {
      label: 'Phone number',
      detail: 'Used for order updates and recovery',
      complete: !setupProgress.fieldErrors.phone && phone.trim().length > 0,
      targetStep: 0 as TailorSetupStep,
    },
    {
      label: 'Profile photo',
      detail: 'A clear face photo builds trust faster',
      complete: !setupProgress.fieldErrors.profilePhoto,
      targetStep: 0 as TailorSetupStep,
    },
    {
      label: 'Portfolio item',
      detail: 'Add at least one real work sample',
      complete: !setupProgress.fieldErrors.portfolio,
      targetStep: 2 as TailorSetupStep,
    },
    {
      label: 'ID document',
      detail: 'Required before trust review',
      complete: !setupProgress.fieldErrors.idDocument,
      targetStep: 3 as TailorSetupStep,
    },
  ]
  const checklistRemaining = setupChecklist.filter((item) => !item.complete).length
  const selectedAvailability = AVAILABILITY_SETUP_OPTIONS.find((item) => item.value === availability) ?? AVAILABILITY_SETUP_OPTIONS[0]
  const selectedSellerType = SELLER_TYPE_OPTIONS.find((item) => item.value === sellerType) ?? SELLER_TYPE_OPTIONS[0]
  const orderModeLabel =
    supportsCustomOrders && supportsReadyMade
      ? 'Custom orders + Shop now'
      : supportsCustomOrders
        ? 'Custom orders'
        : supportsReadyMade
          ? 'Shop now'
          : 'Not selected'
  const orderModeHint =
    supportsCustomOrders && supportsReadyMade
      ? 'Customers can request bespoke work or buy ready-made pieces.'
      : supportsCustomOrders
        ? 'Customers send details and you quote the work.'
        : supportsReadyMade
          ? 'Customers buy ready-made pieces you already have.'
          : 'Choose at least one way customers can order from you.'
  const fulfillmentSelections = [
    pickupAvailable ? 'Pickup' : null,
    deliveryAvailable ? 'Delivery' : null,
    shippingAvailable ? 'Shipping' : null,
  ].filter(Boolean) as string[]
  const fulfillmentLabel = fulfillmentSelections.length > 0 ? fulfillmentSelections.join(', ') : 'Not selected'
  const fulfillmentHint =
    fulfillmentSelections.length > 0
      ? 'These options appear during checkout for eligible orders.'
      : 'Choose at least one way customers receive orders.'
  const stepBlockingNote =
    step === 1 && (!priceMin || !priceMax)
      ? 'Set a price range to continue'
      : step === 2 && portfolioItems.length < MIN_PORTFOLIO_ITEMS
        ? 'Add at least 1 photo or video of your work to continue'
        : step === 3 && !(supportsCustomOrders || supportsReadyMade)
          ? 'Choose at least one way customers can order from you'
          : step === 3 && !(pickupAvailable || deliveryAvailable || shippingAvailable)
            ? 'Choose at least one way customers receive orders'
            : step === 3 && !hasIdDocumentForSetup()
              ? TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE
              : ''

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <AuthBackButton onPress={goBack} />
          <Text style={styles.stepCount}>{step + 1} / 4</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Progress stepper with step labels */}
        <ProgressStepper steps={STEP_LABELS} current={step} />

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          <View style={styles.content}>
            <AuthEntryHeader
              eyebrow="Seller profile setup"
              title={STEP_TITLES[step]}
              body={STEP_SUBS[step]}
              showWordmark={false}
            />

            <View style={styles.setupChecklistCard}>
              <View style={styles.setupChecklistHeader}>
                <Text style={styles.setupChecklistTitle}>Profile review checklist</Text>
                <Text style={styles.setupChecklistMeta}>
                  {checklistRemaining === 0 ? 'Ready to submit' : `${checklistRemaining} needed`}
                </Text>
              </View>
              {setupChecklist.map((item) => {
                const stateLabel = item.complete ? 'Done' : 'Needed'
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={[
                      styles.setupChecklistRow,
                      step === item.targetStep && styles.setupChecklistRowActive,
                    ]}
                    onPress={() => {
                      setStep(item.targetStep)
                    }}
                    activeOpacity={0.85}
                  >
                    <View
                      style={[
                        styles.setupChecklistMark,
                        item.complete && styles.setupChecklistMarkDone,
                      ]}
                    >
                      <Text
                        style={[
                          styles.setupChecklistMarkText,
                          item.complete && styles.setupChecklistMarkTextDone,
                        ]}
                      >
                        {item.complete ? '✓' : '!'}
                      </Text>
                    </View>
                    <View style={styles.setupChecklistTextBlock}>
                      <Text style={styles.setupChecklistLabel}>{item.label}</Text>
                      <Text style={styles.setupChecklistDetail}>{item.detail}</Text>
                    </View>
                    <Text
                      style={[
                        styles.setupChecklistState,
                        item.complete && styles.setupChecklistStateDone,
                      ]}
                    >
                      {stateLabel}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              <View style={styles.setupChecklistFooter}>
                <Text style={styles.setupChecklistFooterText}>
                  After profile review, Drapeon will guide you through payout setup before paid work can release earnings.
                </Text>
              </View>
            </View>

            {/* ── Step 0: Identity ── */}
            {step === 0 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <TouchableOpacity
                    style={[
                      styles.profilePhotoPicker,
                      !!visibleErrors.profilePhoto && styles.profilePhotoPickerError,
                    ]}
                    onPress={openProfilePhotoPicker}
                    disabled={uploadingAvatar}
                    activeOpacity={0.86}
                  >
                    <View style={styles.profilePhotoPreview}>
                      {uploadingAvatar ? (
                        <ActivityIndicator color={Colors.needleGreen} />
                      ) : avatarUrl ? (
                        <RemoteImage
                          uri={avatarUrl}
                          style={styles.profilePhotoImage}
                          contentFit="cover"
                          transition={120}
                          surface="tailor_setup_profile_photo"
                        />
                      ) : (
                        <Text style={styles.profilePhotoInitial}>
                          {(displayName.trim()[0] || 'D').toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={styles.profilePhotoCopy}>
                      <Text style={styles.profilePhotoTitle}>Profile photo</Text>
                      <Text style={styles.profilePhotoHint}>
                        Take or choose a clear face photo. Customers see this before booking.
                      </Text>
                    </View>
                    <Text style={styles.profilePhotoAction}>{avatarUrl ? 'Change' : 'Add'}</Text>
                  </TouchableOpacity>
                  {!!visibleErrors.profilePhoto && (
                    <Text style={styles.helperError}>{visibleErrors.profilePhoto}</Text>
                  )}
                  <Input
                    label="Display name"
                    placeholder="e.g. Emeka Obi"
                    value={displayName}
                    onChangeText={(value) => {
                      setDisplayName(value)
                      clearVisibleError('displayName')
                      if (nameError) validateName(value)
                    }}
                    onBlur={() => validateName(displayName)}
                    error={nameError || visibleErrors.displayName}
                    required
                    autoCapitalize="words"
                    hint="No @, URLs, or phone numbers. This is your public name."
                    testID="display-name-input"
                  />
                  <Input
                    label="Phone number"
                    placeholder="For order updates and account recovery"
                    value={phone}
                    onChangeText={(value) => {
                      setPhone(value)
                      clearVisibleError('phone')
                      if (phoneError) validatePhone(value)
                    }}
                    onBlur={() => validatePhone(phone)}
                    error={phoneError || visibleErrors.phone}
                    required
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    hint={PHONE_STORAGE_HINT}
                    testID="phone-input"
                  />
                  <View>
                    <Input
                      label="Location"
                      placeholder="e.g. Lagos, Nigeria"
                      value={location}
                      onChangeText={onLocationChange}
                      onBlur={() => setShowSuggestions(false)}
                      error={visibleErrors.location}
                      required
                      testID="location-input"
                      autoCorrect={false}
                      autoComplete="off"
                    />
                    {showSuggestions && locationSuggestions.length > 0 && (
                      <View style={styles.suggestionsBox}>
                        {locationSuggestions.map((s, i) => (
                          <TouchableOpacity
                            key={i}
                            style={[
                              styles.suggestionRow,
                              i === locationSuggestions.length - 1 && styles.suggestionRowLast,
                            ]}
                            onPress={() => selectLocation(s)}
                          >
                            <Text style={styles.suggestionText}>{s}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <Input
                    label="About you"
                    placeholder="Tell people who you are, what you make, and your experience. Min 80 characters."
                    value={bio}
                    onChangeText={(v) => {
                      setBio(v)
                      clearVisibleError('bio')
                      validateBio(v)
                    }}
                    onBlur={() => validateBio(bio)}
                    error={bioError || visibleErrors.bio}
                    required
                    multiline
                    numberOfLines={5}
                    maxLength={500}
                    filterContact
                    hint={`Min 80 characters · ${bio.trim().length}/500. No social handles, phone numbers, or URLs.`}
                    testID="bio-input"
                  />
                  <Text style={styles.fieldHint}>What customers look for</Text>
                  <View style={styles.helperList}>
                    {BIO_PROMPTS.map((prompt) => (
                      <View key={prompt} style={styles.helperListRow}>
                        <View style={styles.helperBullet} />
                        <Text style={styles.helperListText}>{prompt}</Text>
                      </View>
                    ))}
                  </View>

                  <TagSelector
                    label="Languages you speak"
                    options={LANGUAGE_GROUPS}
                    selected={languages}
                    maxSelected={MAX_LANGUAGE_TAGS}
                    maxSelectedMessage={TAILOR_SETUP_VALIDATION.LANGUAGE_LIMIT_MESSAGE}
                    onChange={(nextLanguages) => {
                      setLanguages(nextLanguages.slice(0, MAX_LANGUAGE_TAGS))
                      clearVisibleError('languages')
                    }}
                    searchable
                  />
                  {!!visibleErrors.languages && (
                    <Text style={styles.helperError}>{visibleErrors.languages}</Text>
                  )}
                </View>
              </View>
            )}

            {/* ── Step 1: Specialties + pricing ── */}
            {step === 1 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <TagSelector
                    label="What do you make?"
                    required
                    hint="Select all that apply. These appear on your public profile."
                    options={SPECIALTY_GROUPS}
                    selected={specialties}
                    maxSelected={MAX_SPECIALTY_TAGS}
                    maxSelectedMessage={TAILOR_SETUP_VALIDATION.SPECIALTY_LIMIT_MESSAGE}
                    onChange={(nextSpecialties) => {
                      setSpecialties(nextSpecialties.slice(0, MAX_SPECIALTY_TAGS))
                      clearVisibleError('specialties')
                    }}
                    searchable
                  />
                  {!!visibleErrors.specialties && (
                    <Text style={styles.helperError}>{visibleErrors.specialties}</Text>
                  )}

                  <View>
                    <Text style={styles.fieldLabel}>
                      Typical price range <Text style={styles.required}>*</Text>
                    </Text>
                    <Text style={styles.fieldHint}>
                      This shows on your profile as a guide, not a fixed price. For {currency}, use
                      at least {priceMinGuide} and keep the high end at {priceMaxGuide} or less.
                    </Text>
                    <Text style={styles.fieldHint}>
                      {currencySource === 'UNSUPPORTED_FALLBACK'
                        ? 'Your region is not mapped to a supported local currency yet, so we preselected USD. Change it here if another supported currency fits your business better.'
                        : `We preselected ${currency} from your device region. Change it now if you want a different supported account currency.`}
                    </Text>
                    <SetupSelectorCard
                      title={currency}
                      body="This is the currency customers see for your profile price guide."
                      meta="Pricing currency"
                      onPress={() => setChoiceSheetMode('currency')}
                    />
                    {currency === 'NGN' ? (
                      <View style={styles.quickRangeList}>
                        {PRICE_PRESETS.map((preset) => (
                          <TouchableOpacity
                            key={preset.label}
                            style={styles.quickRangeRow}
                            onPress={() => {
                              setCurrency(preset.currency)
                              setPriceMin(preset.min)
                              setPriceMax(preset.max)
                              clearVisibleError('priceRange')
                            }}
                            activeOpacity={0.78}
                          >
                            <View>
                              <Text style={styles.quickRangeTitle}>{preset.label}</Text>
                              <Text style={styles.quickRangeBody}>
                                {preset.currency} {preset.min}–{preset.max}
                              </Text>
                            </View>
                            <Feather name="plus" size={17} color={Colors.needleGreen} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.priceRow}>
                      <Input
                        label="From"
                        placeholder="50"
                        value={priceMin}
                        onChangeText={(value) => {
                          setPriceMin(value)
                          clearVisibleError('priceRange')
                        }}
                        keyboardType="decimal-pad"
                        required
                        containerStyle={styles.priceInput}
                      />
                      <Input
                        label="To"
                        placeholder="500"
                        value={priceMax}
                        onChangeText={(value) => {
                          setPriceMax(value)
                          clearVisibleError('priceRange')
                        }}
                        keyboardType="decimal-pad"
                        required
                        containerStyle={styles.priceInput}
                      />
                    </View>
                    {!!priceMin &&
                      !!priceMax &&
                      parseTailorPriceMajor(priceMax) < parseTailorPriceMajor(priceMin) && (
                        <Text style={styles.priceError}>"To" must be greater than "From"</Text>
                      )}
                    {!!visibleErrors.priceRange && (
                      <Text style={styles.helperError}>{visibleErrors.priceRange}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 2: Portfolio ── */}
            {step === 2 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <View style={styles.portfolioStatus}>
                    <View style={styles.portfolioBar}>
                      <View
                        style={[
                          styles.portfolioBarFill,
                          { width: `${(portfolioItems.length / MAX_PORTFOLIO_ITEMS) * 100}%` },
                        ]}
                      />
                      <View style={styles.portfolioBarMinMarker} />
                    </View>
                    <Text style={styles.portfolioCount}>
                      {portfolioItems.length >= MIN_PORTFOLIO_ITEMS
                        ? `${portfolioItems.length}/${MAX_PORTFOLIO_ITEMS} added · add more to build trust`
                        : 'Add 1 work sample to continue'}
                      {' · '}
                      {portfolioItems.filter((i) => i.type === 'video').length}/
                      {MAX_PORTFOLIO_VIDEOS} videos
                    </Text>
                    {!!visibleErrors.portfolio && (
                      <Text style={styles.helperError}>{visibleErrors.portfolio}</Text>
                    )}
                  </View>

                  <View style={styles.portfolioGrid}>
                    {portfolioItems.map((item, i) => (
                      <View key={i} style={styles.portfolioThumb}>
                        {item.type === 'photo' ? (
                          <RemoteImage
                            uri={item.url}
                            style={styles.portfolioImg}
                            contentFit="cover"
                            transition={120}
                            surface="tailor_setup_portfolio_preview"
                          />
                        ) : (
                          <View style={[styles.portfolioImg, styles.videoThumb]}>
                            <Text style={styles.videoIcon}>▶</Text>
                            <Text style={styles.videoLabel}>Video</Text>
                          </View>
                        )}
                        <TouchableOpacity
                          style={styles.portfolioRemove}
                          onPress={() => {
                            setPortfolioItems((prev) => prev.filter((_, idx) => idx !== i))
                            clearVisibleError('portfolio')
                          }}
                        >
                          <Text style={styles.portfolioRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {portfolioItems.length < MAX_PORTFOLIO_ITEMS && (
                      <TouchableOpacity
                        style={styles.portfolioAdd}
                        onPress={openPortfolioMediaPicker}
                        disabled={uploadingMedia}
                      >
                        <Text style={styles.portfolioAddIcon}>{uploadingMedia ? '…' : '+'}</Text>
                        <Text style={styles.portfolioAddLabel}>Add media</Text>
                        <Text style={styles.portfolioAddHint}>Multi-select from library</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 3: Selling setup + ID verification ── */}
            {step === 3 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <View>
                    <Text style={styles.fieldLabel}>Availability</Text>
                    <SetupSelectorCard
                      title={selectedAvailability.label}
                      body={selectedAvailability.hint}
                      meta="Availability"
                      onPress={() => setChoiceSheetMode('availability')}
                    />
                  </View>

                  <View>
                    <Text style={styles.fieldLabel}>Seller type</Text>
                    <SetupSelectorCard
                      title={selectedSellerType.label}
                      body={selectedSellerType.hint}
                      meta="Business type"
                      onPress={() => setChoiceSheetMode('seller-type')}
                    />
                    {!!visibleErrors.orderMode && (
                      <Text style={styles.helperError}>{visibleErrors.orderMode}</Text>
                    )}
                  </View>

                  <View>
                    <Text style={styles.fieldLabel}>What customers can do</Text>
                    <SetupSelectorCard
                      title={orderModeLabel}
                      body={orderModeHint}
                      meta="Order paths"
                      warning={!!visibleErrors.orderMode || !(supportsCustomOrders || supportsReadyMade)}
                      onPress={() => setChoiceSheetMode('order-mode')}
                    />
                  </View>

                  <View>
                    <Text style={styles.fieldLabel}>Fulfillment</Text>
                    <SetupSelectorCard
                      title={fulfillmentLabel}
                      body={fulfillmentHint}
                      meta="Receiving orders"
                      warning={!!visibleErrors.fulfillment || fulfillmentSelections.length === 0}
                      onPress={() => setChoiceSheetMode('fulfillment')}
                    />
                    {!!visibleErrors.fulfillment && (
                      <Text style={styles.helperError}>{visibleErrors.fulfillment}</Text>
                    )}
                    {pickupAvailable ? (
                      <View style={styles.fulfillmentFeeBlock}>
                        <Text style={styles.fieldLabel}>Private pickup details</Text>
                        <Text style={styles.fieldHint}>
                          Double-check this exact address before you save. Customers only see it
                          after an order is marked ready for collection.
                        </Text>
                        <AddressAutocompleteInput
                          label="Pickup address"
                          placeholder="e.g. 12 Marina Road, Victoria Island"
                          value={pickupAddress}
                          onChangeText={(value) => {
                            setPickupAddress(value)
                            clearVisibleError('pickupAddress')
                          }}
                          hint="Search and tap a suggestion to autofill, or type the full address manually. Include street or building, district or city, state or region, postal code if used, and country."
                          multiline
                        />
                        <Input
                          label="Pickup instructions (optional)"
                          placeholder="e.g. Ask for the front desk and bring your collection code."
                          value={pickupInstructions}
                          onChangeText={setPickupInstructions}
                        />
                        {pickupAddress.trim().length === 0 ? (
                          <Text style={styles.helperError}>
                            Add your exact pickup address to keep pickup turned on.
                          </Text>
                        ) : pickupAddress.trim().length < 8 ? (
                          <Text style={styles.helperError}>
                            Add a fuller pickup address before offering pickup.
                          </Text>
                        ) : visibleErrors.pickupAddress ? (
                          <Text style={styles.helperError}>{visibleErrors.pickupAddress}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    {deliveryAvailable || shippingAvailable ? (
                      <View style={styles.fulfillmentFeeBlock}>
                        <Text style={styles.fieldLabel}>Standard Drapeon dispatch fees</Text>
                        <Text style={styles.fieldHint}>
                          Drapeon now collects the standard delivery or shipping fee at checkout based
                          on the buyer address and your location. You only need to choose whether
                          you offer delivery or shipping here.
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View>
                    <Text style={styles.fieldLabel}>Identity verification</Text>
                    <Text style={styles.fieldHint}>
                      Upload a government-issued photo ID (passport, national ID, or driver's
                      licence) before submitting. Your profile goes live once we've reviewed your ID
                      within 24 hours.
                    </Text>
                    {idPhotoUri ? (
                      <View style={styles.idPreviewWrap}>
                        <RemoteImage
                          uri={idPhotoUri}
                          style={styles.idPreview}
                          contentFit="cover"
                          transition={120}
                          surface="tailor_setup_id_preview"
                        />
                        <TouchableOpacity
                          onPress={() => {
                            setIdPhotoUri(null)
                            setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
                          }}
                        >
                          <Text style={styles.idRemove}>Remove and re-upload</Text>
                        </TouchableOpacity>
                      </View>
                    ) : hasIdDocumentForSetup() ? (
                      <View style={styles.idExistingRow}>
                        <View style={styles.idExistingIcon}>
                          <Feather name="file-text" size={14} color={Colors.needleGreen} />
                        </View>
                        <View style={styles.idExistingCopy}>
                          <Text style={styles.idExistingTitle}>ID document uploaded</Text>
                          <Text style={styles.idExistingHint}>Submit with this document or replace it before continuing.</Text>
                        </View>
                        <TouchableOpacity onPress={openIdPhotoPicker} hitSlop={8}>
                          <Text style={styles.idExistingAction}>Replace</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.idPickBtn, !!idError && styles.idPickBtnError]}
                        onPress={openIdPhotoPicker}
                      >
                        <Text style={styles.idPickIcon}>🪪</Text>
                        <Text style={styles.idPickLabel}>Upload ID document</Text>
                        <Text style={styles.idPickHint}>
                          Passport · National ID · Driver's licence
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!!(idError || visibleErrors.idDocument) && (
                      <Text style={styles.helperError}>{idError || visibleErrors.idDocument}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* CTA */}
        <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom + Spacing.sm, Spacing.xl) }]}>
          <Button
            label={
              uploadingMedia
                ? 'Uploading…'
	                : step < 3
	                  ? 'Continue'
	                  : saving || uploadingId
	                    ? 'Submitting…'
	                    : 'Submit for review'
            }
            onPress={next}
            loading={saving || uploadingId || uploadingMedia}
            disabled={saving || uploadingId || uploadingMedia}
          />
          {step === 0 && (
            <>
              <TouchableOpacity
                onPress={switchBackToCustomer}
                style={styles.modeSwitchLink}
                disabled={saving || uploadingId || uploadingMedia || switchingToCustomer}
              >
                {switchingToCustomer ? (
                  <ActivityIndicator size="small" color={Colors.needleGreen} />
                ) : (
                  <Text style={styles.modeSwitchText}>Use Drapeon as customer instead</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSignOut}
                style={styles.signOutLink}
                disabled={saving || uploadingId || uploadingMedia || switchingToCustomer}
              >
                <Text style={styles.signOutText}>Sign out</Text>
              </TouchableOpacity>
            </>
          )}
          {stepBlockingNote ? <Text style={styles.minNote}>{stepBlockingNote}</Text> : null}
        </View>
        <MediaChoiceSheet
          mode={mediaSheetMode}
          onClose={() => setMediaSheetMode(null)}
          onProfilePhoto={(source) => {
            setMediaSheetMode(null)
            void pickProfilePhoto(source)
          }}
          onPortfolioMedia={(source) => {
            setMediaSheetMode(null)
            void pickPortfolioMedia(source)
          }}
          onIdDocument={(source) => {
            setMediaSheetMode(null)
            void pickIdPhoto(source)
          }}
          videoLimitReached={portfolioItems.filter((i) => i.type === 'video').length >= MAX_PORTFOLIO_VIDEOS}
        />
        <SetupChoiceSheet
          mode={choiceSheetMode}
          onClose={() => setChoiceSheetMode(null)}
          availability={availability}
          sellerType={sellerType}
          supportsCustomOrders={supportsCustomOrders}
          supportsReadyMade={supportsReadyMade}
          pickupAvailable={pickupAvailable}
          deliveryAvailable={deliveryAvailable}
          shippingAvailable={shippingAvailable}
          currency={currency}
          onAvailability={(value) => {
            setAvailability(value)
            setChoiceSheetMode(null)
          }}
          onSellerType={(value) => {
            setSellerType(value)
            setChoiceSheetMode(null)
          }}
          onToggleCustomOrders={() => {
            setSupportsCustomOrders((value) => !value)
            clearVisibleError('orderMode')
          }}
          onToggleReadyMade={() => {
            setSupportsReadyMade((value) => !value)
            clearVisibleError('orderMode')
          }}
          onTogglePickup={() => {
            setPickupAvailable((value) => !value)
            clearVisibleError('fulfillment')
            clearVisibleError('pickupAddress')
          }}
          onToggleDelivery={() => {
            setDeliveryAvailable((value) => !value)
            clearVisibleError('fulfillment')
          }}
          onToggleShipping={() => {
            setShippingAvailable((value) => !value)
            clearVisibleError('fulfillment')
          }}
          onCurrency={(value) => {
            setCurrency(value)
            setCurrencySource('USER_SELECTED')
            setRegionCode(regionCode || detectedCurrency.regionCode)
            clearVisibleError('priceRange')
            setChoiceSheetMode(null)
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SetupSelectorCard({
  meta,
  title,
  body,
  onPress,
  warning,
}: {
  meta: string
  title: string
  body: string
  onPress: () => void
  warning?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.selectorCard, warning && styles.selectorCardWarning]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.selectorCopy}>
        <Text style={[styles.selectorMeta, warning && styles.selectorMetaWarning]}>{meta}</Text>
        <Text style={styles.selectorTitle}>{title}</Text>
        <Text style={styles.selectorBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

function SetupChoiceSheet({
  mode,
  onClose,
  availability,
  sellerType,
  supportsCustomOrders,
  supportsReadyMade,
  pickupAvailable,
  deliveryAvailable,
  shippingAvailable,
  currency,
  onAvailability,
  onSellerType,
  onToggleCustomOrders,
  onToggleReadyMade,
  onTogglePickup,
  onToggleDelivery,
  onToggleShipping,
  onCurrency,
}: {
  mode: SetupChoiceSheetMode
  onClose: () => void
  availability: Availability
  sellerType: SellerType
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  currency: (typeof SUPPORTED_CURRENCIES)[number]
  onAvailability: (value: Availability) => void
  onSellerType: (value: SellerType) => void
  onToggleCustomOrders: () => void
  onToggleReadyMade: () => void
  onTogglePickup: () => void
  onToggleDelivery: () => void
  onToggleShipping: () => void
  onCurrency: (value: (typeof SUPPORTED_CURRENCIES)[number]) => void
}) {
  const insets = useSafeAreaInsets()
  const visible = mode !== null
  const sheetBottomPadding = Math.max(insets.bottom + Spacing.lg, Spacing.xxl)
  const title =
    mode === 'availability'
      ? 'Availability'
      : mode === 'seller-type'
        ? 'Seller type'
        : mode === 'order-mode'
          ? 'Order paths'
          : mode === 'fulfillment'
            ? 'Fulfillment'
            : 'Pricing currency'
  const body =
    mode === 'availability'
      ? 'Choose how customers should see your availability before they try to book.'
      : mode === 'seller-type'
        ? 'Pick the description that best matches how your business works.'
        : mode === 'order-mode'
          ? 'Choose what customers can start from your profile.'
          : mode === 'fulfillment'
            ? 'Choose how customers receive orders. Pickup details stay private until collection.'
            : 'Choose the currency customers see on your public profile price guide.'
  const isMulti = mode === 'order-mode' || mode === 'fulfillment'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close setup options">
              <Text style={styles.sheetCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetBody}>{body}</Text>

          <ScrollView
            style={styles.sheetChoicesScroll}
            contentContainerStyle={styles.sheetChoicesContent}
            showsVerticalScrollIndicator={false}
          >
            {mode === 'availability'
              ? AVAILABILITY_SETUP_OPTIONS.map((item) => (
                  <ChoiceSheetRow
                    key={item.value}
                    title={item.label}
                    body={item.hint}
                    selected={availability === item.value}
                    onPress={() => onAvailability(item.value)}
                  />
                ))
              : null}

            {mode === 'seller-type'
              ? SELLER_TYPE_OPTIONS.map((item) => (
                  <ChoiceSheetRow
                    key={item.value}
                    title={item.label}
                    body={item.hint}
                    selected={sellerType === item.value}
                    onPress={() => onSellerType(item.value)}
                  />
                ))
              : null}

            {mode === 'order-mode' ? (
              <>
                <ChoiceSheetRow
                  title="Custom orders"
                  body="Customers send a brief and you quote the work."
                  selected={supportsCustomOrders}
                  onPress={onToggleCustomOrders}
                  multi
                />
                <ChoiceSheetRow
                  title="Shop now"
                  body="Customers buy ready-made pieces you already have."
                  selected={supportsReadyMade}
                  onPress={onToggleReadyMade}
                  multi
                />
              </>
            ) : null}

            {mode === 'fulfillment' ? (
              <>
                <ChoiceSheetRow
                  title="Pickup"
                  body="Customer collects from you or your shop."
                  selected={pickupAvailable}
                  onPress={onTogglePickup}
                  multi
                />
                <ChoiceSheetRow
                  title="Delivery"
                  body="You or your team deliver nearby orders."
                  selected={deliveryAvailable}
                  onPress={onToggleDelivery}
                  multi
                />
                <ChoiceSheetRow
                  title="Shipping"
                  body="Courier or shipping partner handles it."
                  selected={shippingAvailable}
                  onPress={onToggleShipping}
                  multi
                />
              </>
            ) : null}

            {mode === 'currency'
              ? SUPPORTED_CURRENCIES.map((item) => (
                  <ChoiceSheetRow
                    key={item}
                    title={item}
                    body={
                      item === 'NGN'
                        ? 'Recommended for Nigerian pricing and local Paystack checkout.'
                        : 'Use this if it matches how you quote customers.'
                    }
                    selected={currency === item}
                    onPress={() => onCurrency(item)}
                  />
                ))
              : null}
          </ScrollView>

          {isMulti ? (
            <TouchableOpacity style={styles.sheetDoneButton} onPress={onClose}>
              <Text style={styles.sheetDoneButtonText}>Done</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function ChoiceSheetRow({
  title,
  body,
  selected,
  onPress,
  multi,
}: {
  title: string
  body: string
  selected: boolean
  onPress: () => void
  multi?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.choiceSheetRow, selected && styles.choiceSheetRowSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.choiceSheetMark, selected && styles.choiceSheetMarkSelected]}>
        <Text style={[styles.choiceSheetMarkText, selected && styles.choiceSheetMarkTextSelected]}>
          {selected ? '✓' : multi ? '+' : ''}
        </Text>
      </View>
      <View style={styles.choiceSheetText}>
        <Text style={styles.choiceSheetTitle}>{title}</Text>
        <Text style={styles.choiceSheetBody}>{body}</Text>
      </View>
    </TouchableOpacity>
  )
}

function MediaChoiceSheet({
  mode,
  onClose,
  onProfilePhoto,
  onPortfolioMedia,
  onIdDocument,
  videoLimitReached,
}: {
  mode: MediaSheetMode
  onClose: () => void
  onProfilePhoto: (source: ProfilePhotoSource) => void
  onPortfolioMedia: (source: PortfolioMediaSource) => void
  onIdDocument: (source: IdDocumentSource) => void
  videoLimitReached: boolean
}) {
  const insets = useSafeAreaInsets()
  const visible = mode !== null
  const sheetBottomPadding = Math.max(insets.bottom + Spacing.lg, Spacing.xxl)
  const title =
    mode === 'profile-photo'
      ? 'Profile photo'
      : mode === 'portfolio-media'
        ? 'Add portfolio media'
        : 'ID document'
  const body =
    mode === 'profile-photo'
      ? 'Use a clear face photo customers can recognize before they book you.'
      : mode === 'portfolio-media'
        ? 'Add real work samples. Photos build trust fastest; short videos help with movement and finish.'
        : 'Use a clear, readable photo of your passport, national ID, or driver’s licence.'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close media options">
              <Text style={styles.sheetCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetBody}>{body}</Text>

          {mode === 'profile-photo' ? (
            <>
              <SheetOption title="Take photo" body="Open camera and crop square." onPress={() => onProfilePhoto('camera')} />
              <SheetOption title="Choose from library" body="Use an existing photo from your phone." onPress={() => onProfilePhoto('library')} />
            </>
          ) : null}

          {mode === 'portfolio-media' ? (
            <>
              <SheetOption title="Take photo" body="Capture one fresh work sample." onPress={() => onPortfolioMedia('camera-photo')} />
              <SheetOption
                title="Choose from library"
                body="Select several photos or videos at once."
                onPress={() => onPortfolioMedia('library')}
              />
              <SheetOption
                title="Record short video"
                body={videoLimitReached ? 'Video limit reached for this portfolio.' : 'Record up to 30 seconds.'}
                onPress={() => onPortfolioMedia('camera-video')}
                disabled={videoLimitReached}
              />
            </>
          ) : null}

          {mode === 'id-document' ? (
            <>
              <SheetOption title="Take photo" body="Best when the ID is with you now." onPress={() => onIdDocument('camera')} />
              <SheetOption title="Choose from library" body="Use an existing clear ID photo." onPress={() => onIdDocument('library')} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function SheetOption({
  title,
  body,
  onPress,
  disabled,
}: {
  title: string
  body: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.sheetOption, disabled && styles.sheetOptionDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <View style={styles.sheetOptionText}>
        <Text style={styles.sheetOptionTitle}>{title}</Text>
        <Text style={styles.sheetOptionBody}>{body}</Text>
      </View>
      <Text style={styles.sheetOptionChevron}>›</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  headerSpacer: { width: 68 },
  stepCount: { fontSize: FontSize.sm, color: Colors.midGrey },

  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  heroMeta: { gap: Spacing.sm },
  heroMetaCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  heroMetaLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  heroMetaValue: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    lineHeight: 20,
    fontWeight: FontWeight.medium,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  setupChecklistCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  setupChecklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.xs,
  },
  setupChecklistTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  setupChecklistMeta: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  setupChecklistRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
  },
  setupChecklistRowActive: { backgroundColor: Colors.needleGreenLight },
  setupChecklistMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  setupChecklistMarkDone: {
    backgroundColor: Colors.needleGreen,
    borderColor: Colors.needleGreen,
  },
  setupChecklistMarkDeferred: {
    backgroundColor: Colors.bone,
  },
  setupChecklistMarkText: {
    color: Colors.midGrey,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  setupChecklistMarkTextDone: { color: Colors.textInverse },
  setupChecklistTextBlock: { flex: 1, gap: 2 },
  setupChecklistLabel: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  setupChecklistDetail: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 16,
  },
  setupChecklistState: {
    fontSize: FontSize.xs,
    color: Colors.kanteRust,
    fontWeight: FontWeight.semibold,
  },
  setupChecklistStateDone: { color: Colors.needleGreen },
  setupChecklistStateDeferred: { color: Colors.midGrey },
  setupChecklistFooter: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
  },
  setupChecklistFooterText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
  },

  fields: { gap: Spacing.xl },
  profilePhotoPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    padding: Spacing.md,
  },
  profilePhotoPickerError: {
    borderColor: Colors.error,
    backgroundColor: Colors.errorLight,
  },
  profilePhotoPreview: {
    width: 68,
    height: 68,
    borderRadius: 34,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  profilePhotoImage: { width: '100%', height: '100%' },
  profilePhotoInitial: {
    color: Colors.needleGreen,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  profilePhotoCopy: { flex: 1, gap: 4 },
  profilePhotoTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  profilePhotoHint: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 17,
  },
  profilePhotoAction: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginBottom: Spacing.sm,
  },
  fieldHint: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  helperError: {
    fontSize: FontSize.xs,
    color: Colors.kanteRust,
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
  required: { color: Colors.error },
  helperList: {
    gap: Spacing.sm,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.md,
  },
  helperListRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  helperBullet: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    marginTop: 6,
  },
  helperListText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
    fontWeight: FontWeight.medium,
  },
  quickRangeList: {
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  quickRangeRow: {
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  quickRangeTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  quickRangeBody: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 17,
  },
  selectorCard: {
    minHeight: 96,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  selectorCardWarning: {
    borderColor: Colors.kanteRust,
    backgroundColor: Colors.errorLight,
  },
  selectorCopy: { flex: 1, gap: 3 },
  selectorMeta: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  selectorMetaWarning: { color: Colors.kanteRust },
  selectorTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  selectorBody: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
  },

  // Pricing
  priceRow: { flexDirection: 'row', gap: Spacing.md },
  priceInput: { flex: 1, marginBottom: 0 },
  priceError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs },

  // Portfolio
  portfolioStatus: { gap: Spacing.xs },
  portfolioBar: {
    height: 4,
    backgroundColor: Colors.lightGrey,
    borderRadius: 2,
    position: 'relative',
  },
  portfolioBarFill: { height: '100%', backgroundColor: Colors.needleGreen, borderRadius: 2 },
  portfolioBarMinMarker: {
    position: 'absolute',
    left: PORTFOLIO_MIN_MARKER_LEFT,
    top: -2,
    width: 2,
    height: 8,
    backgroundColor: Colors.needleGreen,
    borderRadius: 1,
  },
  portfolioCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioThumb: {
    width: 100,
    height: 100,
    borderRadius: Radius.md,
    position: 'relative',
    overflow: 'hidden',
  },
  portfolioImg: { width: '100%', height: '100%' },
  videoThumb: {
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  videoIcon: { fontSize: 24, color: Colors.textInverse },
  videoLabel: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)' },
  portfolioRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  portfolioRemoveText: { color: Colors.textInverse, fontSize: 11, fontWeight: FontWeight.bold },
  portfolioAdd: {
    width: 100,
    height: 100,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  portfolioAddIcon: { fontSize: 24, color: Colors.midGrey },
  portfolioAddLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  portfolioAddHint: { fontSize: 9, color: Colors.midGrey, textAlign: 'center' },

  // Availability
  availCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    marginBottom: Spacing.md,
  },
  availCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  availRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 2,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  availRadioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  availLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  availLabelActive: { color: Colors.needleGreen },
  availHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },
  choiceGroup: { gap: Spacing.sm },
  choiceCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    gap: 4,
  },
  choiceCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  choiceTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
    fontFamily: Fonts.display,
  },
  choiceTitleActive: { color: Colors.needleGreen },
  choiceHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  fulfillmentFeeBlock: { gap: Spacing.md, marginTop: Spacing.md },

  // ID verification
  idPickBtn: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.lightGrey,
  },
  idPickBtnError: {
    borderColor: Colors.error,
    backgroundColor: Colors.errorLight,
  },
  idPickIcon: { fontSize: 40 },
  idPickLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  idPickHint: { fontSize: FontSize.xs, color: Colors.midGrey },
  idPreviewWrap: { gap: Spacing.md },
  idPreview: {
    width: '100%',
    height: 200,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
  },
  idRemove: { fontSize: FontSize.sm, color: Colors.error },
  idExistingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.md,
  },
  idExistingIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  idExistingCopy: { flex: 1, gap: 2 },
  idExistingTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  idExistingHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  idExistingAction: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },

  infoBox: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '25',
  },
  infoText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  cta: {
    padding: Spacing.xl,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    gap: Spacing.sm,
  },
  modeSwitchLink: { alignSelf: 'center', minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  modeSwitchText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  signOutLink: { alignSelf: 'center' },
  signOutText: { fontSize: FontSize.sm, color: Colors.error },
  minNote: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
    maxHeight: '78%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 72,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.lightGrey,
    marginBottom: Spacing.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  sheetClose: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  sheetCloseText: {
    fontSize: 26,
    lineHeight: 28,
    color: Colors.inkLight,
  },
  sheetBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },
  sheetChoicesScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sheetChoicesContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  sheetOption: {
    minHeight: 72,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  sheetOptionDisabled: {
    opacity: 0.45,
  },
  sheetOptionText: { flex: 1, gap: 3 },
  sheetOptionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  sheetOptionBody: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 17,
  },
  sheetOptionChevron: {
    fontSize: 26,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  choiceSheetRow: {
    minHeight: 78,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  choiceSheetRowSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  choiceSheetMark: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceSheetMarkSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreen,
  },
  choiceSheetMarkText: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    fontWeight: FontWeight.bold,
  },
  choiceSheetMarkTextSelected: { color: Colors.textInverse },
  choiceSheetText: { flex: 1, gap: 3 },
  choiceSheetTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  choiceSheetBody: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 17,
  },
  sheetDoneButton: {
    minHeight: 52,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDoneButtonText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },

  suggestionsBox: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    marginTop: 2,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  suggestionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionText: { fontSize: FontSize.sm, color: Colors.ink },
})
