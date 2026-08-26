/**
 * Edit Profile — single source of truth for all tailor profile data.
 * Onboarding writes here; this screen reads and updates the same row.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Modal, Platform, KeyboardAvoidingView,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useTailorProfile } from '@/lib/tailorProfile'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { appendToHistory, goBackOrReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { Sentry } from '@/lib/sentry'
import { AddressAutocompleteInput, MoneyInput, TagSelector } from '@/components/ui'
import type { TagGroup } from '@/components/ui'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
import {
  formatMoneyInputValue,
  parseMoneyInputToMinorUnits,
  type AccountCurrencyCode,
} from '@drape/shared'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { Availability } from '@/lib/shared-types'

// ─── Specialty options ────────────────────────────────────────────────────────

const SPECIALTY_GROUPS: TagGroup[] = [
  { label: 'West African', items: ['Agbada', 'Iro & Buba', 'Ankara', 'Kaftans', 'Dashiki', 'Boubou', 'Native Wear', 'Asoebi', 'Kente'] },
  { label: 'Formal & Western', items: ['Suits', 'Wool Suits', 'Tuxedo', 'Shirts', 'Trousers', 'Blazers'] },
  { label: 'Womenswear', items: ['Bespoke Dress', 'Wedding Gown', 'Prom Dress', 'Bridal', 'Jumpsuit', 'Skirts', 'Blouses'] },
  { label: 'South Asian', items: ['Lehenga', 'Saree Blouse', 'Kurta', 'Shalwar Kameez', 'Sherwani'] },
  { label: 'Middle Eastern & North African', items: ['Abaya', 'Jalabiya', 'Kaftan'] },
  { label: 'East Asian', items: ['Qipao / Cheongsam'] },
  { label: 'Craft & Textile', items: ['Crochet', 'Knitwear', 'Embroidery', 'Beadwork', 'Adire', 'Batik'] },
  { label: 'Lifestyle & Ready-made', items: ['Two-piece Set', 'Loungewear', 'Beachwear', 'Ready-made'] },
]
const BIO_PROMPTS = [
  'What you make best',
  'Who you usually sew for',
  'How fittings and timelines work',
] as const

type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
type Currency = 'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD'
type SellerType = 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
type ConsultationMode = 'UNAVAILABLE' | 'FREE' | 'PAID'
type ConsultationRequirement = 'OPTIONAL' | 'REQUIRED'

type TailorEditProfileRow = {
  id: string
  display_name: string | null
  location: string | null
  bio: string | null
  specialty_tags: unknown
  languages: unknown
  availability: Availability | null
  currency: Currency | null
  id_verification_status: VerificationStatus | 'APPROVED' | null
  seller_type: SellerType | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  accepts_custom_orders_now: boolean | null
  shop_paused: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  consultation_mode: ConsultationMode | null
  consultation_requirement: ConsultationRequirement | null
  consultation_fee_amount: number | null
  consultation_duration_minutes: 15 | 30 | 45 | 60 | null
  consultation_call_type: 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO' | null
  consultation_fee_creditable: boolean | null
}

type PickupDetailsRow = {
  pickup_address: string | null
  pickup_address_line1: string | null
  pickup_city: string | null
  pickup_region: string | null
  pickup_postal_code: string | null
  pickup_country_code: string | null
  pickup_instructions: string | null
}

type NominatimSuggestion = {
  display_name?: string
  address?: {
    city?: string
    town?: string
    village?: string
    county?: string
    country?: string
  }
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function normalizeVerificationStatus(value: TailorEditProfileRow['id_verification_status']): VerificationStatus {
  if (value === 'APPROVED') return 'VERIFIED'
  return value ?? 'NOT_SUBMITTED'
}

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: 'GBP', label: '£ GBP' },
  { value: 'USD', label: '$ USD' },
  { value: 'EUR', label: '€ EUR' },
  { value: 'CAD', label: 'CA$ CAD' },
  { value: 'NGN', label: '₦ NGN' },
  { value: 'GHS', label: '₵ GHS' },
  { value: 'KES', label: 'KSh KES' },
]

const AVAIL_OPTIONS: { value: Availability; label: string; hint: string }[] = [
  { value: 'OPEN',         label: 'Open',         hint: 'Taking new orders' },
  { value: 'LIMITED',      label: 'Limited',       hint: 'Taking orders, but may respond slower' },
  { value: 'FULLY_BOOKED', label: 'Fully booked',  hint: 'Profile visible, orders closed' },
]

const VERIFY_LABEL: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: 'Not started',
  PENDING:       'Review in progress',
  VERIFIED:      'Identity confirmed',
  REJECTED:      'Action needed',
}
const VERIFY_COLOR: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: Colors.midGrey,
  PENDING:       Colors.warning,
  VERIFIED:      Colors.success,
  REJECTED:      Colors.error,
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditProfileScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{
    focus?: string
    returnTo?: string
    historyChain?: string
  }>()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { avatarUrl, setAvatarUrl } = useTailorProfile()
  const isFulfillmentFocus = params.focus === 'fulfillment'
  const scrollRef = useRef<ScrollView>(null)
  const hasFocusedFulfillment = useRef(false)

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      params.historyChain ?? params.returnTo,
      '/(tailor)/profile',
    )
  }

  useContextualBackHandler(goBack)

  // ── Form state ──────────────────────────────────────────────────────────────
  const [displayName, setDisplayName]     = useState('')
  const [location, setLocation]           = useState('')
  const [bio, setBio]                     = useState('')
  const [specialties, setSpecialties]     = useState<string[]>([])
  // Languages are edited elsewhere on mobile, but must round-trip here so a
  // fulfillment-only save never stages an unrelated public-profile change.
  const [profileLanguages, setProfileLanguages] = useState<string[]>([])
  const [availability, setAvailability]   = useState<Availability>('OPEN')
  const [sellerType, setSellerType]       = useState<SellerType>('TAILOR')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [acceptsCustomOrdersNow, setAcceptsCustomOrdersNow] = useState(true)
  const [shopPaused, setShopPaused] = useState(false)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupCity, setPickupCity] = useState('')
  const [pickupRegion, setPickupRegion] = useState('')
  const [pickupPostalCode, setPickupPostalCode] = useState('')
  const [pickupCountryCode, setPickupCountryCode] = useState('')
  const [pickupInstructions, setPickupInstructions] = useState('')
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [consultationMode, setConsultationMode] = useState<ConsultationMode>('FREE')
  const [consultationRequirement, setConsultationRequirement] = useState<ConsultationRequirement>('OPTIONAL')
  const [consultationFee, setConsultationFee] = useState('')
  const [consultationDurationMinutes, setConsultationDurationMinutes] = useState<15 | 30 | 45 | 60>(30)
  const [consultationCallType, setConsultationCallType] = useState<'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'>('VIDEO')
  const [consultationFeeCreditable, setConsultationFeeCreditable] = useState(false)
  const [verifyStatus, setVerifyStatus]   = useState<VerificationStatus>('NOT_SUBMITTED')
  const [portfolioCount, setPortfolioCount] = useState(0)

  // Baseline snapshot to compute dirty state
  const [base, setBase] = useState<{
    displayName: string; location: string; bio: string
    specialties: string[]; availability: Availability; currency: Currency
    sellerType: SellerType
    supportsCustomOrders: boolean
    supportsReadyMade: boolean
    acceptsCustomOrdersNow: boolean
    shopPaused: boolean
    pickupAvailable: boolean
    pickupAddress: string
    pickupCity: string
    pickupRegion: string
    pickupPostalCode: string
    pickupCountryCode: string
    pickupInstructions: string
    deliveryAvailable: boolean
    shippingAvailable: boolean
    consultationMode: ConsultationMode
    consultationRequirement: ConsultationRequirement
    consultationFee: string
    consultationDurationMinutes: 15 | 30 | 45 | 60
    consultationCallType: 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'
    consultationFeeCreditable: boolean
  } | null>(null)

  const [currency, setCurrency]           = useState<Currency>('GBP')
  const [bioError, setBioError]           = useState('')

  const [loading, setLoading]             = useState(true)
  const [fetchError, setFetchError]       = useState(false)
  const [saving, setSaving]               = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [errors, setErrors]               = useState<{ name?: string; location?: string; specialties?: string }>({})
  const [showSpecialtySheet, setShowSpecialtySheet] = useState(false)
  const [showCurrencySheet, setShowCurrencySheet] = useState(false)

  // Location autocomplete
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions]          = useState(false)
  const locationDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Derived ─────────────────────────────────────────────────────────────────

  const initials = (user?.user_metadata?.display_name ?? displayName)
    .split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('') || '?'

  const dirty = base !== null && (
    displayName    !== base.displayName ||
    location       !== base.location ||
    bio            !== base.bio ||
    availability   !== base.availability ||
    currency       !== base.currency ||
    sellerType     !== base.sellerType ||
    supportsCustomOrders !== base.supportsCustomOrders ||
    supportsReadyMade !== base.supportsReadyMade ||
    acceptsCustomOrdersNow !== base.acceptsCustomOrdersNow ||
    shopPaused !== base.shopPaused ||
    pickupAvailable !== base.pickupAvailable ||
    pickupAddress !== base.pickupAddress ||
    pickupCity !== base.pickupCity ||
    pickupRegion !== base.pickupRegion ||
    pickupPostalCode !== base.pickupPostalCode ||
    pickupCountryCode !== base.pickupCountryCode ||
    pickupInstructions !== base.pickupInstructions ||
    deliveryAvailable !== base.deliveryAvailable ||
    shippingAvailable !== base.shippingAvailable ||
    consultationMode !== base.consultationMode ||
    consultationRequirement !== base.consultationRequirement ||
    consultationFee !== base.consultationFee ||
    consultationDurationMinutes !== base.consultationDurationMinutes ||
    consultationCallType !== base.consultationCallType ||
    consultationFeeCreditable !== base.consultationFeeCreditable ||
    JSON.stringify(specialties) !== JSON.stringify(base.specialties)
  )
  const specialtySummary =
    specialties.length > 0
      ? specialties.slice(0, 4).join(' · ') + (specialties.length > 4 ? ` +${specialties.length - 4} more` : '')
      : 'Choose the styles customers can book you for.'
  const currencyLabel = CURRENCY_OPTIONS.find((option) => option.value === currency)?.label ?? currency

  function applySellerType(nextType: SellerType) {
    setSellerType(nextType)
    if (nextType === 'BOUTIQUE') {
      setSupportsCustomOrders(false)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(false)
      setShopPaused(false)
    } else if (nextType === 'TAILOR_SHOP') {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(false)
    } else {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(false)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(true)
    }
  }

  function toggleSupportsCustomOrders() {
    setSupportsCustomOrders((value) => {
      const next = !value
      if (!next) setAcceptsCustomOrdersNow(false)
      if (next) setAcceptsCustomOrdersNow(true)
      return next
    })
  }

  function toggleSupportsReadyMade() {
    setSupportsReadyMade((value) => {
      const next = !value
      if (!next) setShopPaused(true)
      if (next) setShopPaused(false)
      return next
    })
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      setFetchError(false)
      return
    }
    setFetchError(false)
    try {
      const [{ data, error }, { data: pickupData, error: pickupError }] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, bio, specialty_tags, languages, availability, currency, id_verification_status, seller_type, supports_custom_orders, supports_ready_made, accepts_custom_orders_now, shop_paused, pickup_available, delivery_available, shipping_available, delivery_fee, shipping_fee, consultation_mode, consultation_requirement, consultation_fee_amount, consultation_duration_minutes, consultation_call_type, consultation_fee_creditable')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('tailor_pickup_details')
          .select('pickup_address, pickup_address_line1, pickup_city, pickup_region, pickup_postal_code, pickup_country_code, pickup_instructions')
          .eq('user_id', userId)
          .maybeSingle(),
      ])

      if (error) throw error
      if (pickupError) throw pickupError

      if (data) {
        const d = data as TailorEditProfileRow
        const pickup = pickupData as PickupDetailsRow | null
        const snap = {
          displayName:  d.display_name    ?? '',
          location:     d.location        ?? '',
          bio:          d.bio             ?? '',
          specialties:  asStringList(d.specialty_tags),
          availability: (d.availability   ?? 'OPEN') as Availability,
          currency:     (d.currency       ?? 'GBP') as Currency,
          sellerType:   (d.seller_type ?? 'TAILOR') as SellerType,
          supportsCustomOrders: d.supports_custom_orders ?? true,
          supportsReadyMade: d.supports_ready_made ?? false,
          acceptsCustomOrdersNow: d.accepts_custom_orders_now ?? true,
          shopPaused: d.shop_paused ?? false,
          pickupAvailable: d.pickup_available ?? true,
          pickupAddress: pickup?.pickup_address ?? '',
          pickupCity: pickup?.pickup_city ?? '',
          pickupRegion: pickup?.pickup_region ?? '',
          pickupPostalCode: pickup?.pickup_postal_code ?? '',
          pickupCountryCode: pickup?.pickup_country_code ?? '',
          pickupInstructions: pickup?.pickup_instructions ?? '',
          deliveryAvailable: d.delivery_available ?? false,
          shippingAvailable: d.shipping_available ?? false,
          consultationMode: d.consultation_mode ?? 'FREE',
          consultationRequirement: d.consultation_requirement ?? 'OPTIONAL',
          consultationFee: d.consultation_fee_amount ? formatMoneyInputValue(String(d.consultation_fee_amount / 100)) : '',
          consultationDurationMinutes: d.consultation_duration_minutes ?? 30,
          consultationCallType: d.consultation_call_type ?? 'VIDEO',
          consultationFeeCreditable: d.consultation_fee_creditable ?? false,
        }
        setBase(snap)
        setDisplayName(snap.displayName)
        setLocation(snap.location)
        setBio(snap.bio)
        setSpecialties(snap.specialties)
        setProfileLanguages(asStringList(d.languages))
        setAvailability(snap.availability)
        setCurrency(snap.currency)
        setSellerType(snap.sellerType)
        setSupportsCustomOrders(snap.supportsCustomOrders)
        setSupportsReadyMade(snap.supportsReadyMade)
        setAcceptsCustomOrdersNow(snap.acceptsCustomOrdersNow)
        setShopPaused(snap.shopPaused)
        setPickupAvailable(snap.pickupAvailable)
        setPickupAddress(snap.pickupAddress)
        setPickupCity(snap.pickupCity)
        setPickupRegion(snap.pickupRegion)
        setPickupPostalCode(snap.pickupPostalCode)
        setPickupCountryCode(snap.pickupCountryCode)
        setPickupInstructions(snap.pickupInstructions)
        setDeliveryAvailable(snap.deliveryAvailable)
        setShippingAvailable(snap.shippingAvailable)
        setConsultationMode(snap.consultationMode)
        setConsultationRequirement(snap.consultationRequirement)
        setConsultationFee(snap.consultationFee)
        setConsultationDurationMinutes(snap.consultationDurationMinutes)
        setConsultationCallType(snap.consultationCallType)
        setConsultationFeeCreditable(snap.consultationFeeCreditable)
        setVerifyStatus(normalizeVerificationStatus(d.id_verification_status))

        const { count, error: countError } = await supabase
          .from('portfolio_items')
          .select('*', { count: 'exact', head: true })
          .eq('tailor_profile_id', d.id)
        if (countError) {
          setPortfolioCount(0)
        } else {
          setPortfolioCount(count ?? 0)
        }
      } else {
        const snap = {
          displayName: '',
          location: '',
          bio: '',
          specialties: [] as string[],
          availability: 'OPEN' as Availability,
          currency: 'GBP' as Currency,
          sellerType: 'TAILOR' as SellerType,
          supportsCustomOrders: true,
          supportsReadyMade: false,
          acceptsCustomOrdersNow: true,
          shopPaused: false,
          pickupAvailable: true,
          pickupAddress: '',
          pickupCity: '',
          pickupRegion: '',
          pickupPostalCode: '',
          pickupCountryCode: '',
          pickupInstructions: '',
          deliveryAvailable: false,
          shippingAvailable: false,
          consultationMode: 'FREE' as ConsultationMode,
          consultationRequirement: 'OPTIONAL' as ConsultationRequirement,
          consultationFee: '',
          consultationDurationMinutes: 30 as const,
          consultationCallType: 'VIDEO' as const,
          consultationFeeCreditable: false,
        }
        setBase(snap)
        setDisplayName(snap.displayName)
        setLocation(snap.location)
        setBio(snap.bio)
        setSpecialties(snap.specialties)
        setProfileLanguages([])
        setAvailability(snap.availability)
        setCurrency(snap.currency)
        setSellerType(snap.sellerType)
        setSupportsCustomOrders(snap.supportsCustomOrders)
        setSupportsReadyMade(snap.supportsReadyMade)
        setAcceptsCustomOrdersNow(snap.acceptsCustomOrdersNow)
        setShopPaused(snap.shopPaused)
        setPickupAvailable(snap.pickupAvailable)
        setPickupAddress(snap.pickupAddress)
        setPickupInstructions(snap.pickupInstructions)
        setDeliveryAvailable(snap.deliveryAvailable)
        setShippingAvailable(snap.shippingAvailable)
        setConsultationMode(snap.consultationMode)
        setConsultationRequirement(snap.consultationRequirement)
        setConsultationFee(snap.consultationFee)
        setConsultationDurationMinutes(snap.consultationDurationMinutes)
        setConsultationCallType(snap.consultationCallType)
        setConsultationFeeCreditable(snap.consultationFeeCreditable)
        setVerifyStatus('NOT_SUBMITTED')
        setPortfolioCount(0)
      }
    } catch (error) {
      if (__DEV__) {
        const safeError = error && typeof error === 'object'
          ? {
              code: 'code' in error ? String(error.code) : 'UNKNOWN',
              message: 'message' in error ? String(error.message) : 'Profile load failed',
            }
          : { code: 'UNKNOWN', message: 'Profile load failed' }
        console.warn('[tailor-profile-edit-load]', safeError)
      }
      Sentry.captureException(error, {
        tags: {
          surface: 'tailor_profile_edit',
          focus: isFulfillmentFocus ? 'fulfillment' : 'full_profile',
        },
        extra: {
          context: 'load_tailor_profile_editor',
        },
      })
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [isFulfillmentFocus, userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  // ── Avatar ───────────────────────────────────────────────────────────────────

  function handleAvatarPress() {
    Alert.alert('Profile photo', 'Take a new photo or choose one from your library.', [
      { text: 'Take photo', onPress: () => void updateAvatarFromSource('camera') },
      { text: 'Choose from library', onPress: () => void updateAvatarFromSource('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function updateAvatarFromSource(source: AvatarImageSource) {
    const imageUri = await pickAvatarImageUri(source)
    if (!imageUri) return

    setUploadingAvatar(true)
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )
      if (!userId) throw new Error('Session expired. Please sign in again.')
      const fileName = `${userId}/avatar.jpg`
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'avatars',
        path: fileName,
        uri: compressed.uri,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        upsert: true,
      })
      const bustUrl = `${publicUrl}?t=${new Date().getTime()}`
      const { data, error: profileError } = await invokeFunction<{ pendingReview?: boolean }>('tailor-profile-action', {
        body: { action: 'update-avatar', avatarUrl: bustUrl },
      })
      if (profileError) throw profileError
      setAvatarUrl(bustUrl)
      if (data?.pendingReview) {
        Alert.alert('Submitted for review', 'Your new profile photo is saved as a pending draft. Customers keep seeing the approved photo until ops clears it.')
      }
    } catch (error) {
      Alert.alert(
        'Upload failed',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not update your photo yet. Retry when the signal improves.'
          : 'Could not update your photo right now. Please try again in a moment.',
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ── Location autocomplete ────────────────────────────────────────────────────

  function onLocationChange(text: string) {
    setLocation(text)
    setShowSuggestions(false)
    if (errors.location) setErrors((e) => ({ ...e, location: undefined }))
    if (locationDebounce.current) clearTimeout(locationDebounce.current)
    if (text.trim().length < 3) { setLocationSuggestions([]); return }
    locationDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=6&featuretype=city`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drapeon/1.0' } }
        )
        const data = (await res.json()) as NominatimSuggestion[]
        const labels = data.map((item) => {
          const a = item.address ?? {}
          const city = a.city ?? a.town ?? a.village ?? a.county ?? item.display_name?.split(',')[0]
          const country = a.country ?? ''
          return country ? `${city}, ${country}` : city
        }).filter(Boolean)
        const unique = [...new Set(labels)] as string[]
        setLocationSuggestions(unique)
        setShowSuggestions(unique.length > 0)
      } catch { /* Nominatim unavailable — let user type freely */ }
    }, 400)
  }

  // ── Validate + Save ─────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: typeof errors = {}
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) errs.name = displayNameError
    if (!location.trim())    errs.location  = 'Location is required.'
    if (specialties.length === 0) errs.specialties = 'Select at least one specialty.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function validateBio(text: string): boolean {
    if (!text.trim()) { setBioError(''); return true } // bio is optional in edit
    const res = filterContactInfo(text)
    if (res.blocked) { setBioError("Contact details aren't allowed in your bio."); return false }
    setBioError('')
    return true
  }

  async function handleSave() {
    if (!validate() || !user?.id) return
    if (!validateBio(bio)) return
    if (pickupAvailable && pickupAddress.trim().length < 8) {
      Alert.alert('Pickup address needed', 'Add a fuller private pickup address before offering pickup.')
      return
    }
    if (pickupAvailable && (!pickupCity.trim() || !/^[A-Za-z]{2}$/u.test(pickupCountryCode.trim()))) {
      Alert.alert('Confirm pickup location', 'Add the pickup city and 2-letter country code so local collection can be checked correctly.')
      return
    }
    const consultationFeeMinor = parseMoneyInputToMinorUnits(consultationFee)
    if (consultationMode === 'PAID' && !consultationFeeMinor) {
      Alert.alert('Consultation fee needed', 'Enter the amount customers see before starting a custom brief.')
      return
    }

    setSaving(true)
    const { data, error } = await invokeFunction<{ pendingReview?: boolean }>('tailor-profile-action', {
      body: {
        action: 'update-profile',
        profile: {
          displayName: displayName.trim(),
          location: location.trim(),
          bio: bio.trim() || null,
          specialties,
          languages: profileLanguages,
          availability,
          currency,
          sellerType,
          supportsCustomOrders,
          supportsReadyMade,
          acceptsCustomOrdersNow,
          shopPaused,
          pickupAvailable,
          pickupAddress: pickupAddress.trim() || null,
          pickupAddressLine1: pickupAddress.trim() || null,
          pickupCity: pickupCity.trim() || null,
          pickupRegion: pickupRegion.trim() || null,
          pickupPostalCode: pickupPostalCode.trim() || null,
          pickupCountryCode: pickupCountryCode.trim().toUpperCase() || null,
          pickupLocationVerificationSource: pickupAvailable ? 'TAILOR_CONFIRMED_STRUCTURED' : null,
          pickupLocationVerificationReference: null,
          pickupLocationVerifiedAt: pickupAvailable ? new Date().toISOString() : null,
          pickupInstructions: pickupInstructions.trim() || null,
          deliveryAvailable,
          shippingAvailable,
          deliveryFee: 0,
          shippingFee: 0,
          priceRangeMin: null,
          priceRangeMax: null,
          consultationMode,
          consultationRequirement,
          consultationFeeAmount: consultationMode === 'PAID' ? consultationFeeMinor : null,
          consultationDurationMinutes,
          consultationCallType,
          consultationFeeCreditable: consultationMode === 'PAID' && consultationFeeCreditable,
        },
      },
    })
    setSaving(false)
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save these profile changes yet. Your edits are still here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save these profile changes right now. Please try again in a moment.')
      Alert.alert('Save failed', message)
      return
    }
    setBase({
      displayName: displayName.trim(),
      location: location.trim(),
      bio: bio.trim(),
      specialties,
      availability,
      currency,
      sellerType,
      supportsCustomOrders,
      supportsReadyMade,
      acceptsCustomOrdersNow,
      shopPaused,
      pickupAvailable,
      pickupAddress: pickupAddress.trim(),
      pickupCity: pickupCity.trim(),
      pickupRegion: pickupRegion.trim(),
      pickupPostalCode: pickupPostalCode.trim(),
      pickupCountryCode: pickupCountryCode.trim().toUpperCase(),
      pickupInstructions: pickupInstructions.trim(),
      deliveryAvailable,
      shippingAvailable,
      consultationMode,
      consultationRequirement,
      consultationFee: consultationMode === 'PAID' ? consultationFee : '',
      consultationDurationMinutes,
      consultationCallType,
      consultationFeeCreditable: consultationMode === 'PAID' && consultationFeeCreditable,
    })
    if (isFulfillmentFocus) {
      Alert.alert(
        'Fulfillment location saved',
        data?.pendingReview
          ? 'Your fulfillment location is ready. Separate public-profile edits were submitted for review.'
          : 'Customers can now use the delivery, collection, or shipping options you enabled.',
        [{ text: 'Back to dashboard', onPress: goBack }],
      )
      return
    }
    if (data?.pendingReview) {
      Alert.alert('Submitted for review', 'Trust-sensitive profile changes are saved as a pending draft. Your approved public profile stays live while ops reviews them.')
      return
    }
    goBack()
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your profile…</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>
              {isFulfillmentFocus ? "Couldn't load fulfillment settings." : "Couldn't load your profile."}
            </Text>
            <Text style={styles.stateHint}>
              {isFulfillmentFocus
                ? 'Your dashboard is unchanged. Try again to add the location orders start from.'
                : 'This is where you manage how customers find and book you.'}
            </Text>
            <TouchableOpacity
              style={styles.errorRetry}
              onPress={() => {
                setLoading(true)
                load()
              }}
            >
              <Text style={styles.errorRetryText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.errorSecondary}
              onPress={goBack}
            >
              <Text style={styles.errorSecondaryText}>
                {isFulfillmentFocus ? 'Back to dashboard' : 'Open profile'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isFulfillmentFocus ? 'Fulfillment location' : 'Edit profile'}</Text>
        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!dirty || saving}
        >
          {saving
            ? <ActivityIndicator size="small" color={Colors.textInverse} />
            : <Text style={styles.saveBtnText}>Save</Text>
          }
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── Identity card: avatar + name + location ─────────────────── */}
        <View style={styles.identityCard}>
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={handleAvatarPress}
              disabled={uploadingAvatar}
              activeOpacity={0.8}
            >
              {uploadingAvatar ? (
                <View style={[styles.avatar, styles.avatarLoading]}>
                  <ActivityIndicator color={Colors.textInverse} />
                </View>
              ) : (
                <AvatarImage
                  uri={avatarUrl}
                  initials={initials}
                  size={88}
                  style={styles.avatarImage}
                  shadow
                />
              )}
              <View style={styles.cameraBadge}>
                <Feather name="camera" size={12} color={Colors.textInverse} />
              </View>
            </TouchableOpacity>
            <Text style={styles.avatarHint}>Tap to change photo</Text>
          </View>

          <View style={styles.identityDivider} />

          <TextInput
            style={[styles.identityInput, errors.name && styles.identityInputError]}
            value={displayName}
            onChangeText={(v) => { setDisplayName(v); setErrors((e) => ({ ...e, name: undefined })) }}
            placeholder="Your name"
            placeholderTextColor={Colors.midGrey}
            autoCapitalize="words"
          />
          {errors.name ? <Text style={styles.inlineError}>{errors.name}</Text> : null}

          <View style={styles.identityDivider} />

          <TextInput
            style={[styles.identityInput, styles.identityInputSub, errors.location && styles.identityInputError]}
            value={location}
            onChangeText={onLocationChange}
            onBlur={() => setShowSuggestions(false)}
            placeholder="City, country"
            placeholderTextColor={Colors.midGrey}
            autoCorrect={false}
            autoComplete="off"
          />
          {errors.location ? <Text style={styles.inlineError}>{errors.location}</Text> : null}
          {showSuggestions && locationSuggestions.length > 0 && (
            <View style={styles.suggestBox}>
              {locationSuggestions.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.suggestRow, i === locationSuggestions.length - 1 && styles.suggestRowLast]}
                  onPress={() => { setLocation(s); setLocationSuggestions([]); setShowSuggestions(false) }}
                >
                  <Text style={styles.suggestText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── Bio card ─────────────────────────────────────────────────── */}
        <View style={styles.bioCard}>
          <Text style={styles.cardMicro}>About your work</Text>
          <TextInput
            style={[styles.bioInput, bioError ? styles.bioInputError : undefined]}
            value={bio}
            onChangeText={(v) => { setBio(v); if (bioError) validateBio(v) }}
            onBlur={() => validateBio(bio)}
            placeholder={'e.g. Lagos-based tailor specialising in Agbada and bespoke suits. 10+ years of experience…'}
            placeholderTextColor={Colors.midGrey}
            multiline
            numberOfLines={5}
            maxLength={500}
          />
          {bioError ? <Text style={styles.inlineError}>{bioError}</Text> : null}
          <View style={styles.bioFooter}>
            <View style={styles.bioPrompts}>
              {BIO_PROMPTS.map((p) => (
                <Text key={p} style={styles.bioPromptItem}>{'·'} {p}</Text>
              ))}
            </View>
            <Text style={styles.charCount}>{bio.trim().length}/500</Text>
          </View>
        </View>

        {/* ── Specialties + Currency list card ─────────────────────────── */}
        <View style={styles.listCard}>
          <TouchableOpacity
            style={[styles.listRow, errors.specialties ? styles.listRowError : undefined]}
            activeOpacity={0.75}
            onPress={() => setShowSpecialtySheet(true)}
          >
            <View style={styles.listRowBody}>
              <Text style={styles.listRowLabel}>Specialties</Text>
              {specialties.length > 0 ? (
                <Text style={styles.listRowValue} numberOfLines={1}>
                  {specialties.slice(0, 3).join(' · ')}{specialties.length > 3 ? ` +${specialties.length - 3}` : ''}
                </Text>
              ) : (
                <Text style={styles.listRowPlaceholder}>What do you make?</Text>
              )}
            </View>
            <Feather name="chevron-right" size={18} color={Colors.midGrey} />
          </TouchableOpacity>
          {errors.specialties ? (
            <Text style={[styles.inlineError, { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs }]}>
              {errors.specialties}
            </Text>
          ) : null}

          <View style={styles.listDivider} />

          <TouchableOpacity style={styles.listRow} activeOpacity={0.75} onPress={() => setShowCurrencySheet(true)}>
            <View style={styles.listRowBody}>
              <Text style={styles.listRowLabel}>Prices shown in</Text>
              <Text style={styles.listRowValue}>{currencyLabel}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.midGrey} />
          </TouchableOpacity>
        </View>

        {/* ── How you sell ─────────────────────────────────────────────── */}
        <Text style={styles.sectionMicro}>How you sell</Text>

        <View style={styles.sellerTypeRow}>
          {([
            { value: 'TAILOR',      label: 'Tailor',   icon: 'scissors'     as const, sub: 'Custom orders' },
            { value: 'BOUTIQUE',    label: 'Boutique',  icon: 'shopping-bag' as const, sub: 'Ready-made' },
            { value: 'TAILOR_SHOP', label: 'Shop',      icon: 'briefcase'    as const, sub: 'Both' },
          ] as const).map((opt) => {
            const active = sellerType === opt.value
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.sellerCard, active && styles.sellerCardActive]}
                onPress={() => applySellerType(opt.value)}
                activeOpacity={0.75}
              >
                <Feather name={opt.icon} size={20} color={active ? Colors.needleGreen : Colors.midGrey} />
                <Text style={[styles.sellerLabel, active && styles.sellerLabelActive]}>{opt.label}</Text>
                <Text style={styles.sellerSub}>{opt.sub}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={styles.listCard}>
          {sellerType !== 'BOUTIQUE' ? (
            <>
              <TouchableOpacity style={styles.serviceRow} onPress={toggleSupportsCustomOrders} activeOpacity={0.75}>
                <View style={[styles.serviceIconWrap, supportsCustomOrders && styles.serviceIconWrapActive]}>
                  <Feather name="edit-2" size={15} color={supportsCustomOrders ? Colors.needleGreen : Colors.midGrey} />
                </View>
                <View style={styles.serviceBody}>
                  <Text style={[styles.serviceTitle, supportsCustomOrders && styles.serviceTitleActive]}>Custom orders</Text>
                  <Text style={styles.serviceHint}>
                    {supportsCustomOrders && acceptsCustomOrdersNow ? 'Accepting new briefs'
                      : supportsCustomOrders ? 'On — currently paused' : 'Off'}
                  </Text>
                </View>
                <View style={[styles.serviceCheck, supportsCustomOrders && styles.serviceCheckActive]}>
                  {supportsCustomOrders && <Feather name="check" size={12} color={Colors.needleGreen} />}
                </View>
              </TouchableOpacity>
              {supportsCustomOrders ? (
                <View style={styles.statusChipRow}>
                  <TouchableOpacity
                    style={[styles.statusChip, acceptsCustomOrdersNow && styles.statusChipActive]}
                    onPress={() => setAcceptsCustomOrdersNow(true)}
                  >
                    <Text style={[styles.statusChipText, acceptsCustomOrdersNow && styles.statusChipTextActive]}>Open</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.statusChip, !acceptsCustomOrdersNow && styles.statusChipActive]}
                    onPress={() => setAcceptsCustomOrdersNow(false)}
                  >
                    <Text style={[styles.statusChipText, !acceptsCustomOrdersNow && styles.statusChipTextActive]}>Paused</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {sellerType === 'TAILOR_SHOP' && <View style={styles.listDivider} />}
            </>
          ) : null}

          {sellerType !== 'TAILOR' ? (
            <>
              <TouchableOpacity style={styles.serviceRow} onPress={toggleSupportsReadyMade} activeOpacity={0.75}>
                <View style={[styles.serviceIconWrap, supportsReadyMade && styles.serviceIconWrapActive]}>
                  <Feather name="shopping-bag" size={15} color={supportsReadyMade ? Colors.needleGreen : Colors.midGrey} />
                </View>
                <View style={styles.serviceBody}>
                  <Text style={[styles.serviceTitle, supportsReadyMade && styles.serviceTitleActive]}>Shop</Text>
                  <Text style={styles.serviceHint}>
                    {supportsReadyMade && !shopPaused ? 'Checkout open'
                      : supportsReadyMade ? 'On — checkout paused' : 'Off'}
                  </Text>
                </View>
                <View style={[styles.serviceCheck, supportsReadyMade && styles.serviceCheckActive]}>
                  {supportsReadyMade && <Feather name="check" size={12} color={Colors.needleGreen} />}
                </View>
              </TouchableOpacity>
              {supportsReadyMade ? (
                <View style={styles.statusChipRow}>
                  <TouchableOpacity
                    style={[styles.statusChip, !shopPaused && styles.statusChipActive]}
                    onPress={() => setShopPaused(false)}
                  >
                    <Text style={[styles.statusChipText, !shopPaused && styles.statusChipTextActive]}>Open</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.statusChip, shopPaused && styles.statusChipActive]}
                    onPress={() => setShopPaused(true)}
                  >
                    <Text style={[styles.statusChipText, shopPaused && styles.statusChipTextActive]}>Paused</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        {supportsCustomOrders ? (
          <>
            <Text style={styles.sectionMicro}>Before a custom brief</Text>
            <View style={styles.listCard}>
              <View style={styles.serviceRow}>
                <View style={[styles.serviceIconWrap, styles.serviceIconWrapActive]}>
                  <Feather name="video" size={15} color={Colors.needleGreen} />
                </View>
                <View style={styles.serviceBody}>
                  <Text style={styles.serviceTitleActive}>Consultation policy</Text>
                  <Text style={styles.serviceHint}>Customers see these terms before they start their brief.</Text>
                </View>
              </View>
              <View style={styles.statusChipRow}>
                {(['UNAVAILABLE', 'FREE', 'PAID'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.statusChip, consultationMode === mode && styles.statusChipActive]}
                    onPress={() => {
                      setConsultationMode(mode)
                      if (mode !== 'PAID') {
                        setConsultationFee('')
                        setConsultationFeeCreditable(false)
                      }
                    }}
                  >
                    <Text style={[styles.statusChipText, consultationMode === mode && styles.statusChipTextActive]}>
                      {mode === 'UNAVAILABLE' ? 'Not offered' : mode === 'FREE' ? 'Free' : 'Paid'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {consultationMode !== 'UNAVAILABLE' ? (
                <>
                  <View style={styles.listDivider} />
                  <View style={styles.statusChipRow}>
                    {(['OPTIONAL', 'REQUIRED'] as const).map((requirement) => (
                      <TouchableOpacity
                        key={requirement}
                        style={[styles.statusChip, consultationRequirement === requirement && styles.statusChipActive]}
                        onPress={() => setConsultationRequirement(requirement)}
                      >
                        <Text style={[styles.statusChipText, consultationRequirement === requirement && styles.statusChipTextActive]}>
                          {requirement === 'OPTIONAL' ? 'Optional' : 'Required'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.statusChipRow}>
                    {([15, 30, 45, 60] as const).map((duration) => (
                      <TouchableOpacity
                        key={duration}
                        style={[styles.statusChip, consultationDurationMinutes === duration && styles.statusChipActive]}
                        onPress={() => setConsultationDurationMinutes(duration)}
                      >
                        <Text style={[styles.statusChipText, consultationDurationMinutes === duration && styles.statusChipTextActive]}>{duration} min</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.statusChipRow}>
                    {(['AUDIO', 'VIDEO', 'AUDIO_OR_VIDEO'] as const).map((callType) => (
                      <TouchableOpacity
                        key={callType}
                        style={[styles.statusChip, consultationCallType === callType && styles.statusChipActive]}
                        onPress={() => setConsultationCallType(callType)}
                      >
                        <Text style={[styles.statusChipText, consultationCallType === callType && styles.statusChipTextActive]}>
                          {callType === 'AUDIO' ? 'Audio' : callType === 'VIDEO' ? 'Video' : 'Either'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {consultationMode === 'PAID' ? (
                    <View style={styles.pickupBlock}>
                      <Text style={styles.pickupNote}>Fee in {currency}. Payment is collected before the call.</Text>
                      <MoneyInput
                        label="Consultation fee"
                        value={consultationFee}
                        onChangeText={setConsultationFee}
                        currency={currency as AccountCurrencyCode}
                        required
                      />
                      <TouchableOpacity
                        style={styles.serviceRow}
                        onPress={() => setConsultationFeeCreditable((value) => !value)}
                        activeOpacity={0.75}
                      >
                        <View style={[styles.serviceCheck, consultationFeeCreditable && styles.serviceCheckActive]}>
                          {consultationFeeCreditable ? <Feather name="check" size={12} color={Colors.needleGreen} /> : null}
                        </View>
                        <View style={styles.serviceBody}>
                          <Text style={styles.serviceTitle}>Credit this fee toward an accepted order</Text>
                          <Text style={styles.serviceHint}>Prevents the customer paying for the same value twice.</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <Text style={styles.deliveryFeeNote}>More than 24 hours: full refund. Inside 24 hours: 50%. Tailor cancellation or verified call failure: full refund or agreed reschedule.</Text>
                </>
              ) : null}
            </View>
          </>
        ) : null}

        {/* ── Availability ─────────────────────────────────────────────── */}
        <Text style={styles.sectionMicro}>Availability</Text>
        <View style={styles.listCard}>
          {AVAIL_OPTIONS.map((opt, i) => (
            <View key={opt.value}>
              <TouchableOpacity style={styles.availRow} onPress={() => setAvailability(opt.value)} activeOpacity={0.75}>
                <View style={[styles.availDot, {
                  backgroundColor: i === 0 ? Colors.success : i === 1 ? Colors.warning : Colors.error,
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.availLabel, availability === opt.value && styles.availLabelActive]}>{opt.label}</Text>
                  <Text style={styles.availHint}>{opt.hint}</Text>
                </View>
                {availability === opt.value
                  ? <Feather name="check" size={16} color={Colors.needleGreen} />
                  : null}
              </TouchableOpacity>
              {i < AVAIL_OPTIONS.length - 1 && <View style={styles.listDivider} />}
            </View>
          ))}
        </View>

        {/* ── Delivery options ─────────────────────────────────────────── */}
        <View
          onLayout={(event) => {
            const sectionY = event.nativeEvent.layout.y
            if (isFulfillmentFocus && !hasFocusedFulfillment.current && sectionY > 0) {
              setTimeout(() => {
                scrollRef.current?.scrollTo({
                  y: Math.max(0, sectionY - Spacing.md),
                  animated: true,
                })
                hasFocusedFulfillment.current = true
              }, 120)
            }
          }}
          style={isFulfillmentFocus ? styles.focusedSection : undefined}
        >
        {isFulfillmentFocus ? (
          <View style={styles.focusedSectionIntro}>
            <Text style={styles.focusedSectionTitle}>Where orders start</Text>
            <Text style={styles.focusedSectionBody}>
              Add the private address Drapeon uses to check collection, delivery, shipping, and tax eligibility. Customers only see it when the order requires it.
            </Text>
          </View>
        ) : null}
        <Text style={styles.sectionMicro}>Delivery options</Text>
        <View style={styles.deliveryRow}>
          {([
            { key: 'pickup',   label: 'Pickup',  icon: 'map-pin'    as const, active: pickupAvailable,   toggle: () => setPickupAvailable((v) => !v) },
            { key: 'delivery', label: 'Deliver', icon: 'navigation' as const, active: deliveryAvailable, toggle: () => setDeliveryAvailable((v) => !v) },
            { key: 'shipping', label: 'Ship',    icon: 'package'    as const, active: shippingAvailable, toggle: () => setShippingAvailable((v) => !v) },
          ]).map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.deliveryChip, opt.active && styles.deliveryChipActive]}
              onPress={opt.toggle}
              activeOpacity={0.75}
            >
              <Feather name={opt.icon} size={16} color={opt.active ? Colors.needleGreen : Colors.midGrey} />
              <Text style={[styles.deliveryChipLabel, opt.active && styles.deliveryChipLabelActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {pickupAvailable ? (
          <View style={styles.pickupBlock}>
            <Text style={styles.pickupNote}>Customers only see this after an order is marked ready for collection.</Text>
            <AddressAutocompleteInput
              label="Pickup address"
              value={pickupAddress}
              onChangeText={setPickupAddress}
              onSelectAddress={(address) => {
                setPickupAddress(address.line1 || address.displayValue)
                setPickupCity(address.city)
                setPickupRegion(address.stateRegion)
                setPickupPostalCode(address.postcode)
                if (address.countryCode) setPickupCountryCode(address.countryCode)
              }}
              placeholder="e.g. 12 Marina Road, Victoria Island"
              hint="Search or type your full pickup address. Include street, city, and country."
              multiline
            />
            <TextInput
              style={styles.input}
              value={pickupCity}
              onChangeText={setPickupCity}
              placeholder="Pickup city"
              placeholderTextColor={Colors.midGrey}
            />
            <TextInput
              style={styles.input}
              value={pickupRegion}
              onChangeText={setPickupRegion}
              placeholder="State / region"
              placeholderTextColor={Colors.midGrey}
            />
            <TextInput
              style={styles.input}
              value={pickupPostalCode}
              onChangeText={setPickupPostalCode}
              placeholder="Postcode / ZIP (optional)"
              placeholderTextColor={Colors.midGrey}
            />
            <TextInput
              style={styles.input}
              value={pickupCountryCode}
              onChangeText={(value) => setPickupCountryCode(value.toUpperCase().slice(0, 2))}
              autoCapitalize="characters"
              placeholder="2-letter country code, e.g. GH"
              placeholderTextColor={Colors.midGrey}
            />
            <TextInput
              style={styles.input}
              value={pickupInstructions}
              onChangeText={setPickupInstructions}
              placeholder="Pickup instructions (optional)"
              placeholderTextColor={Colors.midGrey}
            />
            {pickupAddress.trim().length === 0 ? (
              <Text style={styles.helperError}>Enter your pickup address to keep this on.</Text>
            ) : pickupAddress.trim().length < 8 ? (
              <Text style={styles.helperError}>Add a more complete address before enabling pickup.</Text>
            ) : null}
          </View>
        ) : null}
        {(deliveryAvailable || shippingAvailable) ? (
          <Text style={styles.deliveryFeeNote}>
            Drapeon calculates and collects the delivery fee at checkout. Keep your location accurate and you're set.
          </Text>
        ) : null}
        </View>

        {/* ── Portfolio + Verification nav card ────────────────────────── */}
        <View style={[styles.listCard, { marginTop: Spacing.xs }]}>
          <TouchableOpacity
            style={styles.listRow}
            onPress={() => router.push({
              pathname: '/(tailor)/profile/portfolio',
              params: {
                returnTo: '/(tailor)/profile/edit',
                historyChain: appendToHistory(undefined, '/(tailor)/profile/edit'),
              },
            })}
            activeOpacity={0.75}
          >
            <View style={[styles.navIcon, { backgroundColor: Colors.needleGreenLight }]}>
              <Feather name="image" size={16} color={Colors.needleGreen} />
            </View>
            <View style={styles.listRowBody}>
              <Text style={styles.listRowLabel}>Portfolio</Text>
              <Text style={styles.listRowValue}>
                {portfolioCount > 0 ? `${portfolioCount} item${portfolioCount !== 1 ? 's' : ''}` : 'Add your work'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.midGrey} />
          </TouchableOpacity>

          <View style={styles.listDivider} />

          <TouchableOpacity
            style={styles.listRow}
            onPress={() => router.push('/(tailor)/profile/trust-access' as never)}
            activeOpacity={0.75}
          >
            <View style={[styles.navIcon, { backgroundColor: VERIFY_COLOR[verifyStatus] + '1a' }]}>
              <View style={[styles.verifyDot, { backgroundColor: VERIFY_COLOR[verifyStatus] }]} />
            </View>
            <View style={styles.listRowBody}>
              <Text style={styles.listRowLabel}>Verification</Text>
              <Text style={styles.listRowValue}>{VERIFY_LABEL[verifyStatus]}</Text>
            </View>
            <Text style={styles.trustAction}>
              {verifyStatus === 'NOT_SUBMITTED' ? 'Start' : verifyStatus === 'REJECTED' ? 'Retry' : 'View'}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.midGrey} />
          </TouchableOpacity>
        </View>

      </ScrollView>
      </KeyboardAvoidingView>
      <SpecialtyPickerSheet
        visible={showSpecialtySheet}
        selected={specialties}
        onChange={(v) => { setSpecialties(v); setErrors((e) => ({ ...e, specialties: undefined })) }}
        onClose={() => setShowSpecialtySheet(false)}
      />
      <CurrencyPickerSheet
        visible={showCurrencySheet}
        selected={currency}
        onSelect={(value) => {
          setCurrency(value)
          setShowCurrencySheet(false)
        }}
        onClose={() => setShowCurrencySheet(false)}
      />
    </SafeAreaView>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SpecialtyPickerSheet({
  visible,
  selected,
  onChange,
  onClose,
}: {
  visible: boolean
  selected: string[]
  onChange: (selected: string[]) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const sheetBottomPadding =
    Platform.OS === 'android'
      ? Math.max(insets.bottom + 52, 76)
      : Math.max(insets.bottom + Spacing.lg, Spacing.xxl)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.specialtySheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.specialtySheetHeader}>
            <View style={styles.selectorSummaryText}>
              <Text style={styles.specialtySheetTitle}>Specialties</Text>
              <Text style={styles.specialtySheetSubtitle}>
                Pick the work you want customers to find you for. Keep it focused.
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
              <Feather name="x" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.specialtySheetScroll}
            contentContainerStyle={styles.specialtySheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <TagSelector
              label=""
              options={SPECIALTY_GROUPS}
              selected={selected}
              onChange={onChange}
              searchable
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function CurrencyPickerSheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean
  selected: Currency
  onSelect: (currency: Currency) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const sheetBottomPadding =
    Platform.OS === 'android'
      ? Math.max(insets.bottom + 52, 76)
      : Math.max(insets.bottom + Spacing.lg, Spacing.xxl)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.currencySheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.specialtySheetHeader}>
            <View style={styles.selectorSummaryText}>
              <Text style={styles.specialtySheetTitle}>Pricing currency</Text>
              <Text style={styles.specialtySheetSubtitle}>
                Choose the currency customers see on your quotes and shop items.
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
              <Feather name="x" size={18} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.currencyOptionList}>
            {CURRENCY_OPTIONS.map((option) => {
              const active = selected === option.value
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.currencyOptionRow, active && styles.currencyOptionRowActive]}
                  activeOpacity={0.75}
                  onPress={() => onSelect(option.value)}
                >
                  <Text style={[styles.currencyOptionText, active && styles.currencyOptionTextActive]}>
                    {option.label}
                  </Text>
                  {active ? <Feather name="check" size={18} color={Colors.needleGreen} /> : null}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.boneDeep,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    minWidth: 60, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },

  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%', maxWidth: 440, backgroundColor: Colors.white,
    borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md,
    alignItems: 'center', ...Shadow.lg,
  },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center', fontFamily: Fonts.display },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  errorRetry: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl,
  },
  errorRetryText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorSecondary: {
    backgroundColor: Colors.white, borderColor: Colors.lightGrey,
    borderRadius: Radius.full, borderWidth: 1,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl,
  },
  errorSecondaryText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 56 },

  // ── Identity card ──────────────────────────────────────────────────────────
  identityCard: {
    backgroundColor: Colors.white, borderRadius: Radius.xl,
    overflow: 'hidden', ...Shadow.md,
  },
  avatarSection: { alignItems: 'center', gap: Spacing.xs, paddingTop: Spacing.xl, paddingBottom: Spacing.md },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.needleGreen + '40',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: Colors.needleGreen + '40' },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.white,
  },
  avatarHint: { fontSize: FontSize.xs, color: Colors.midGrey },
  identityDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.boneDeep },
  identityInput: {
    fontSize: FontSize.lg, fontWeight: FontWeight.semibold,
    color: Colors.ink, fontFamily: Fonts.display,
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
  },
  identityInputSub: {
    fontSize: FontSize.md, fontWeight: FontWeight.regular,
    color: Colors.inkLight, fontFamily: Fonts.body,
  },
  identityInputError: { color: Colors.error },
  inlineError: { fontSize: FontSize.xs, color: Colors.error, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },

  // ── Bio card ───────────────────────────────────────────────────────────────
  bioCard: {
    backgroundColor: Colors.white, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.md,
  },
  cardMicro: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  bioInput: {
    fontSize: FontSize.md, color: Colors.ink,
    minHeight: 96, textAlignVertical: 'top', lineHeight: 22,
    borderWidth: 1, borderColor: Colors.boneDeep,
    borderRadius: Radius.md, padding: Spacing.md,
  },
  bioInputError: { borderColor: Colors.error },
  bioFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bioPrompts: { flex: 1, gap: 3 },
  bioPromptItem: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  charCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right' },

  // ── Generic list card ──────────────────────────────────────────────────────
  listCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, overflow: 'hidden', ...Shadow.md },
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    minHeight: 64, gap: Spacing.md,
  },
  listRowError: { backgroundColor: Colors.error + '06' },
  listRowBody: { flex: 1, gap: 2 },
  listRowLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  listRowValue: { fontSize: FontSize.sm, color: Colors.midGrey },
  listRowPlaceholder: { fontSize: FontSize.sm, color: Colors.lightGrey },
  listDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.boneDeep, marginHorizontal: Spacing.lg },

  // ── Section micro-label (above card groups) ────────────────────────────────
  sectionMicro: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: Spacing.xs, paddingTop: Spacing.xs,
  },

  // ── Seller type cards ──────────────────────────────────────────────────────
  sellerTypeRow: { flexDirection: 'row', gap: Spacing.sm },
  sellerCard: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.xl,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm,
    alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: 'transparent', ...Shadow.sm,
  },
  sellerCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  sellerLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight, textAlign: 'center' },
  sellerLabelActive: { color: Colors.needleGreen },
  sellerSub: { fontSize: 10, color: Colors.midGrey, textAlign: 'center' },

  // ── Service toggle rows ────────────────────────────────────────────────────
  serviceRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  serviceIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.bone, alignItems: 'center', justifyContent: 'center',
  },
  serviceIconWrapActive: { backgroundColor: Colors.needleGreenLight },
  serviceBody: { flex: 1, gap: 2 },
  serviceTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  serviceTitleActive: { color: Colors.ink },
  serviceHint: { fontSize: FontSize.xs, color: Colors.midGrey },
  serviceCheck: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  serviceCheckActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  statusChipRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  statusChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  statusChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  statusChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.midGrey },
  statusChipTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },

  // ── Availability rows ──────────────────────────────────────────────────────
  availRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  availLabelActive: { color: Colors.ink },
  availHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 1, lineHeight: 18 },

  // ── Delivery chips ─────────────────────────────────────────────────────────
  deliveryRow: { flexDirection: 'row', gap: Spacing.sm },
  deliveryChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: Spacing.md, borderRadius: Radius.xl,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white, ...Shadow.sm,
  },
  deliveryChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  deliveryChipLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.midGrey },
  deliveryChipLabelActive: { color: Colors.needleGreen },

  // ── Pickup block ───────────────────────────────────────────────────────────
  pickupBlock: { gap: Spacing.sm },
  pickupNote: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  deliveryFeeNote: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, paddingHorizontal: Spacing.xs },
  focusedSection: {
    marginHorizontal: -Spacing.xs,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '24',
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
  },
  focusedSectionIntro: {
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.md,
  },
  focusedSectionTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    color: Colors.ink,
  },
  focusedSectionBody: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    lineHeight: 21,
    color: Colors.inkLight,
  },
  input: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
    borderWidth: 1, borderColor: Colors.boneDeep,
  },
  helperError: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },

  // ── Nav rows (portfolio + verification) ────────────────────────────────────
  navIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  verifyDot: { width: 8, height: 8, borderRadius: 4 },
  trustAction: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold },

  // ── Location suggestions ───────────────────────────────────────────────────
  suggestBox: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.lightGrey,
    marginTop: 2, overflow: 'hidden', ...Shadow.sm,
  },
  suggestRow: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  suggestRowLast: { borderBottomWidth: 0 },
  suggestText: { fontSize: FontSize.sm, color: Colors.ink },

  // ── Bottom sheets ──────────────────────────────────────────────────────────
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.34)' },
  specialtySheet: {
    maxHeight: '86%', backgroundColor: Colors.bone,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm, paddingHorizontal: Spacing.xl, gap: Spacing.md, ...Shadow.lg,
  },
  sheetHandle: {
    width: 42, height: 4, borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey, alignSelf: 'center',
  },
  specialtySheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  specialtySheetTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  specialtySheetSubtitle: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },
  sheetClose: {
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  specialtySheetScroll: { marginHorizontal: -Spacing.xs },
  specialtySheetContent: { paddingHorizontal: Spacing.xs, paddingBottom: Spacing.md },
  selectorSummaryText: { flex: 1, gap: 3 },
  currencySheet: {
    backgroundColor: Colors.bone, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm, paddingHorizontal: Spacing.xl, gap: Spacing.md, ...Shadow.lg,
  },
  currencyOptionList: { gap: Spacing.sm },
  currencyOptionRow: {
    minHeight: 58, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.lightGrey, backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  currencyOptionRowActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  currencyOptionText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  currencyOptionTextActive: { color: Colors.needleGreen },
})
