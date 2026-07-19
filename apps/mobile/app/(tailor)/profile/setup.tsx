/**
 * Tailor profile setup wizard — 4 steps
 * Step 0: Identity (display name, phone, location, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (at least one work sample)
 * Step 3: Fulfillment + ID verification upload
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Modal,
  TextInput,
  UIManager,
  Vibration,
  PanResponder,
  useWindowDimensions,
  Linking,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { detectDeviceCurrencyPreference, fetchCurrencyPreferenceContext } from '@/lib/currency'
import { isDuplicatePhoneError, isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { syncUserRow } from '@/lib/syncUserRow'
import { stripExif } from '@/lib/stripExif'
import { createValidatedUploadPayload, uploadPublicStorageImage } from '@/lib/storage-upload'
import { appendToHistory, resetTo } from '@/lib/navigation'
import {
  checkAccountPhoneAvailability,
  DUPLICATE_PHONE_MESSAGE,
  sendAccountPhoneOtp,
  verifyAccountPhoneOtp,
} from '@/lib/account-profile-actions'
import { Sentry } from '@/lib/sentry'
import { useKeyboardState } from '@/lib/useKeyboardState'
import { hapticSuccess, hapticWarning } from '@/lib/haptics'
import {
  launchImagePickerSafely,
  preferCompatibleVideoRepresentation,
  preferCurrentAssetRepresentation,
} from '@/lib/image-picker-safe'
import {
  pickerVideoContentType as portfolioVideoContentType,
  pickerVideoExtension as portfolioVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import {
  AddressAutocompleteInput,
  Button,
  Input,
  RemoteImage,
  AvatarImage,
  PortfolioVideoPreview,
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
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'
import {
  IDENTITY_CONSENT_COPY,
  IDENTITY_CONSENT_POLICY_VERSION,
  isValidLegalName,
  normalizeLegalName,
} from '@drape/shared/identity-trust'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { Availability } from '@/lib/shared-types'

type SellerType = 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
type ProfilePhotoSource = AvatarImageSource
type PortfolioMediaSource = 'camera-photo' | 'camera-video' | 'library'
type IdDocumentSource = 'camera'
type PortfolioItem = { type: 'photo' | 'video'; url: string }
type PortfolioGridEntry = { item: PortfolioItem; originalIndex: number }
type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
type MediaSheetMode = 'profile-photo' | 'portfolio-media' | 'id-document' | null
type SetupChoiceSheetMode = 'seller-type' | 'capacity' | 'shop-status' | 'fulfillment' | 'currency' | null
type SetupView = 'hub' | 'section'
type SetupToast = { type: 'success' | 'error'; message: string }

type TailorSetupProfileRow = {
  display_name: string | null
  legal_name?: string | null
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
  id_selfie_document_url?: string | null
  id_verification_rejection_reason?: string | null
  id_verification_rejected_at?: string | null
  id_verification_metadata?: Record<string, unknown> | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  delivery_fee: number | null
  shipping_fee: number | null
  accepts_custom_orders_now: boolean | null
  shop_paused: boolean | null
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
const MAX_PORTFOLIO_VIDEOS = 4
const MAX_PORTFOLIO_VIDEO_BYTES = MEDIA_LIMITS_BYTES.portfolioVideo
const MAX_PORTFOLIO_VIDEO_SECONDS = MEDIA_LIMITS_SECONDS.portfolioVideo
const MAX_LANGUAGE_TAGS = 12
const MAX_SPECIALTY_TAGS = 20
const SUPPORTED_CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'] as const
const PORTFOLIO_MIN_MARKER_LEFT = `${(MIN_PORTFOLIO_ITEMS / MAX_PORTFOLIO_ITEMS) * 100}%` as `${number}%`
const PORTFOLIO_GRID_COLUMNS = 3
const PORTFOLIO_GRID_TILE_SIZE = 100
const PORTFOLIO_GRID_CELL_SIZE = PORTFOLIO_GRID_TILE_SIZE + Spacing.sm

const STEP_TITLES = ['Your identity', 'What you make', 'Portfolio', 'Setup & verification']
const STEP_SUBS = [
  'This is your public tailor profile. No contact details here. Buyers find you through Drapeon.',
  'Tell people what you make, your business type, and what to expect on price.',
  'Add at least one real work sample. More photos help buyers trust your profile faster.',
  'Confirm handoff options, order status, and submit your identity selfie for review.',
]
const INVALID_PROFILE_IMAGE_REJECTION_CODE = 'INVALID_PROFILE_IMAGE'
const PROFILE_IMAGE_REJECTION_MESSAGE =
  'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.'
const SETUP_STEP_IDS: TailorSetupStep[] = [0, 1, 2, 3]
const STEP_LABELS = ['Identity', 'Specialties', 'Portfolio', 'Setup']
const SETUP_ERROR_FIELD_PRIORITY: Record<TailorSetupStep, TailorSetupField[]> = {
  0: ['profilePhoto', 'displayName', 'phone', 'location', 'bio', 'languages'],
  1: ['specialties', 'priceRange'],
  2: ['portfolio'],
  3: ['orderMode', 'fulfillment', 'pickupAddress', 'idDocument'],
}
const SELLER_TYPE_OPTIONS: Array<{ value: SellerType; label: string; hint: string }> = [
  { value: 'TAILOR', label: 'Tailor', hint: 'Custom and bespoke work made to order.' },
  { value: 'BOUTIQUE', label: 'Boutique', hint: 'Ready-made garments and stock collections.' },
  { value: 'TAILOR_SHOP', label: 'Tailor shop', hint: 'A full studio handling custom orders and ready-made collections together.' },
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
const FOCUSED_FIELD_SCROLL_DELAY_MS = 140
const FOCUSED_FIELD_TOP_OFFSET = 96
const PHONE_AVAILABILITY_DEBOUNCE_MS = 650

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

function getPortfolioDropTargetIndex(fromIndex: number, dx: number, dy: number, itemCount: number) {
  if (itemCount <= 0 || fromIndex < 0 || fromIndex >= itemCount) return null
  const columnDelta = Math.round(dx / PORTFOLIO_GRID_CELL_SIZE)
  const rowDelta = Math.round(dy / PORTFOLIO_GRID_CELL_SIZE)
  const rawTargetIndex = fromIndex + columnDelta + rowDelta * PORTFOLIO_GRID_COLUMNS
  return Math.max(0, Math.min(itemCount - 1, rawTargetIndex))
}

function previewPortfolioGridEntries(
  items: PortfolioItem[],
  dragIndex: number | null,
  hoverIndex: number | null,
): PortfolioGridEntry[] {
  const entries = items.map((item, originalIndex) => ({ item, originalIndex }))
  if (
    dragIndex == null ||
    hoverIndex == null ||
    dragIndex < 0 ||
    dragIndex >= entries.length ||
    hoverIndex < 0 ||
    hoverIndex >= entries.length ||
    dragIndex === hoverIndex
  ) {
    return entries
  }
  const next = [...entries]
  const [dragged] = next.splice(dragIndex, 1)
  if (!dragged) return entries
  next.splice(hoverIndex, 0, dragged)
  return next
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function readStringField(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function readIdentityRejectionCode(row: {
  id_verification_metadata?: Record<string, unknown> | null
}) {
  const metadata = row.id_verification_metadata && typeof row.id_verification_metadata === 'object'
    ? row.id_verification_metadata
    : null
  const nested = metadata?.identity_verification && typeof metadata.identity_verification === 'object'
    ? metadata.identity_verification as Record<string, unknown>
    : null
  return (
    readStringField(metadata, ['rejection_code', 'rejectionCode']) ??
    readStringField(nested, ['rejection_code', 'rejectionCode']) ??
    ''
  ).toUpperCase()
}

function isProfileImageRejectionCode(code: string | null | undefined) {
  return (code ?? '').trim().toUpperCase() === INVALID_PROFILE_IMAGE_REJECTION_CODE
}

function readIdentityRejectionMessage(row: {
  id_verification_rejection_reason?: string | null
  id_verification_metadata?: Record<string, unknown> | null
}) {
  const rejectionCode = readIdentityRejectionCode(row)
  if (isProfileImageRejectionCode(rejectionCode)) return PROFILE_IMAGE_REJECTION_MESSAGE

  const direct = row.id_verification_rejection_reason?.trim()
  if (direct) return direct

  const metadata = row.id_verification_metadata && typeof row.id_verification_metadata === 'object'
    ? row.id_verification_metadata
    : null
  const nested = metadata?.identity_verification && typeof metadata.identity_verification === 'object'
    ? metadata.identity_verification as Record<string, unknown>
    : null
  return (
    readStringField(metadata, ['rejection_reason', 'rejectionReason', 'moderation_note', 'moderationMessage', 'reason', 'note']) ??
    readStringField(nested, ['rejection_reason', 'rejectionReason', 'moderation_note', 'moderationMessage', 'reason', 'note']) ??
    'Identity review needs a clearer retake. Capture a sharp live selfie with your face and physical ID fully visible.'
  )
}

function portfolioAssetDuplicateKey(asset: ImagePicker.ImagePickerAsset) {
  const assetId = typeof asset.assetId === 'string' ? asset.assetId.trim() : ''
  if (assetId.length > 0) return `${asset.type ?? 'media'}:asset:${assetId}`

  const contentType = asset.mimeType?.split(';')[0]?.trim().toLowerCase() ?? asset.type ?? 'media'
  const fileName = typeof asset.fileName === 'string' ? asset.fileName.trim().toLowerCase() : ''
  const fileSize = typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize)
    ? String(asset.fileSize)
    : ''
  const dimensions =
    typeof asset.width === 'number' && typeof asset.height === 'number'
      ? `${asset.width}x${asset.height}`
      : ''
  const duration =
    typeof asset.duration === 'number' && Number.isFinite(asset.duration)
      ? String(Math.round(asset.duration))
      : ''
  const metadataKey = [contentType, fileName, fileSize, dimensions, duration]
    .filter((part) => part.length > 0)
    .join(':')

  return metadataKey ? `${asset.type ?? 'media'}:meta:${metadataKey}` : `${asset.type ?? 'media'}:uri:${asset.uri}`
}

function validatePortfolioVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  return validateVideoPickerAsset(asset, {
    maxBytes: MAX_PORTFOLIO_VIDEO_BYTES,
    maxSeconds: MAX_PORTFOLIO_VIDEO_SECONDS,
    maxBytesMessage: `Choose portfolio videos under ${Math.round(MAX_PORTFOLIO_VIDEO_BYTES / (1024 * 1024))} MB.`,
    durationMessage: VIDEO_DURATION_LIMIT_MESSAGE,
    skipNonVideo: true,
  })
}

export default function TailorSetupScreen() {
  const router = useRouter()
  const routeParams = useLocalSearchParams<{
    handoffToken?: string | string[]
    openIdentity?: string | string[]
    view?: string | string[]
    step?: string | string[]
    historyChain?: string | string[]
  }>()
  const insets = useSafeAreaInsets()
  const { user, signOut, switchRole } = useAuth()
  const keyboard = useKeyboardState()
  const handoffToken = useMemo(() => firstParam(routeParams.handoffToken)?.trim() || null, [routeParams.handoffToken])
  const routeRequestedStep = useMemo<TailorSetupStep | null>(() => {
    if (firstParam(routeParams.view) !== 'section') return null
    const parsed = Number(firstParam(routeParams.step))
    return parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3 ? (parsed as TailorSetupStep) : null
  }, [routeParams.step, routeParams.view])
  const openIdentityFromHandoff = handoffToken !== null || firstParam(routeParams.openIdentity) === '1'
  const scrollRef = useRef<ScrollView | null>(null)
  const bioFieldYRef = useRef(0)
  const setupFieldYRef = useRef<Partial<Record<TailorSetupField, number>>>({})
  const setupToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detectedCurrency = useMemo(() => detectDeviceCurrencyPreference(), [])
  const oauthName =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    ''
  const oauthPhone = typeof user?.user_metadata?.phone === 'string' ? user.user_metadata.phone : ''
  const oauthLegalName =
    typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : ''
  const oauthVerifiedPhone =
    typeof user?.user_metadata?.verified_phone === 'string'
      ? user.user_metadata.verified_phone
      : typeof user?.user_metadata?.phone_verified_at === 'string'
        ? oauthPhone
        : ''

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
                resetTo(router, '/(customer)')
              })
              .finally(() => setSwitchingToCustomer(false))
          },
        },
      ]
    )
  }

  const [step, setStep] = useState<TailorSetupStep>(0)
  const [setupView, setSetupView] = useState<SetupView>('hub')
  const [saving, setSaving] = useState(false)
  const [switchingToCustomer, setSwitchingToCustomer] = useState(false)
  const [visibleErrors, setVisibleErrors] = useState<TailorSetupFieldErrors>({})
  const [setupToast, setSetupToast] = useState<SetupToast | null>(null)
  const [focusedTextField, setFocusedTextField] = useState<string | null>(null)
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [pickupHydrated, setPickupHydrated] = useState(false)
  const [mediaSheetMode, setMediaSheetMode] = useState<MediaSheetMode>(null)
  const [choiceSheetMode, setChoiceSheetMode] = useState<SetupChoiceSheetMode>(null)
  const initialStepResolved = useRef(false)
  const routeSectionRestoreKey = useRef<string | null>(null)

  // Step 0
  const [displayName, setDisplayName] = useState(oauthName)
  const [legalName, setLegalName] = useState(oauthLegalName)
  const [legalNameError, setLegalNameError] = useState('')
  const [identityConsentGranted, setIdentityConsentGranted] = useState(false)
  const [identityConsentError, setIdentityConsentError] = useState('')
  const [nameError, setNameError] = useState('')
  const [phone, setPhone] = useState(oauthPhone)
  const [phoneError, setPhoneError] = useState('')
  const [phoneAvailabilityChecking, setPhoneAvailabilityChecking] = useState(false)
  const [phoneOtpVisible, setPhoneOtpVisible] = useState(false)
  const [phoneOtpCode, setPhoneOtpCode] = useState('')
  const [phoneOtpError, setPhoneOtpError] = useState('')
  const [phoneOtpSending, setPhoneOtpSending] = useState(false)
  const [phoneOtpVerifying, setPhoneOtpVerifying] = useState(false)
  const [verifiedPhone, setVerifiedPhone] = useState(() => normalizePhoneForStorage(oauthVerifiedPhone))
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [bio, setBio] = useState('')
  const [bioError, setBioError] = useState('')
  const [location, setLocation] = useState('')
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const locationDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPhoneRef = useRef(phone)
  const phoneAvailabilityRequestRef = useRef(0)
  const verifiedPhoneRef = useRef(verifiedPhone)
  const phoneOtpAfterVerifyRef = useRef<'advance' | 'finish' | null>(null)

  useEffect(() => {
    return () => {
      if (setupToastTimerRef.current) {
        clearTimeout(setupToastTimerRef.current)
      }
    }
  }, [])
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
  const [portfolioMediaStatus, setPortfolioMediaStatus] = useState<string | null>(null)
  const [selectedPortfolioIndex, setSelectedPortfolioIndex] = useState<number | null>(null)
  const [portfolioReplaceIndex, setPortfolioReplaceIndex] = useState<number | null>(null)
  const [portfolioDragIndex, setPortfolioDragIndex] = useState<number | null>(null)
  const [portfolioHoverIndex, setPortfolioHoverIndex] = useState<number | null>(null)
  const pickedUris = useRef<Set<string>>(new Set())
  const pickedAssetKeys = useRef<Set<string>>(new Set())

  // Step 3
  const [availability, setAvailability] = useState<Availability>('OPEN')
  const [sellerType, setSellerType] = useState<SellerType>('TAILOR')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [acceptsCustomOrdersNow, setAcceptsCustomOrdersNow] = useState(true)
  const [shopPaused, setShopPaused] = useState(false)
  const [readyMadeItemCount, setReadyMadeItemCount] = useState(0)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupInstructions, setPickupInstructions] = useState('')
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null)
  const [savedIdSelfieUrl, setSavedIdSelfieUrl] = useState('')
  const [idVerificationStatus, setIdVerificationStatus] =
    useState<VerificationStatus>('NOT_SUBMITTED')
  const [idError, setIdError] = useState('')
  const [idRejectionReason, setIdRejectionReason] = useState('')
  const [idRejectionCode, setIdRejectionCode] = useState('')
  const [avatarRejectionCleared, setAvatarRejectionCleared] = useState(false)
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
        display_name, legal_name, avatar_url, bio, location, languages, specialty_tags,
        price_range_min, price_range_max, currency, seller_type,
        id_verification_status, id_selfie_document_url,
        id_verification_rejection_reason, id_verification_rejected_at, id_verification_metadata,
        supports_custom_orders, supports_ready_made,
        pickup_available, delivery_available, shipping_available,
        delivery_fee, shipping_fee, accepts_custom_orders_now, shop_paused,
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
        const nextLegalName = row.legal_name?.trim() || oauthLegalName
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
        const nextIdSelfieUrl = typeof row.id_selfie_document_url === 'string' ? row.id_selfie_document_url.trim() : ''
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
        if (nextLegalName) {
          setLegalName(nextLegalName)
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
        setSavedIdSelfieUrl(nextIdSelfieUrl)
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
        if (typeof row.accepts_custom_orders_now === 'boolean')
          setAcceptsCustomOrdersNow(row.accepts_custom_orders_now)
        if (typeof row.shop_paused === 'boolean') setShopPaused(row.shop_paused)
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
          if (row.id_verification_status === 'REJECTED') {
            setIdRejectionCode(readIdentityRejectionCode(row))
            setIdRejectionReason(readIdentityRejectionMessage(row))
            setAvatarRejectionCleared(false)
          } else {
            setIdRejectionCode('')
            setIdRejectionReason('')
            setAvatarRejectionCleared(false)
          }
        }
        setProfileHydrated(true)
      })

    supabase
      .from('tailor_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled || !data?.id) return
        const { count } = await supabase
          .from('seller_items')
          .select('id', { count: 'exact', head: true })
          .eq('tailor_profile_id', data.id)
        if (!cancelled) setReadyMadeItemCount(count ?? 0)
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

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return undefined
      let cancelled = false

      async function refreshReadyMadeItemCount() {
        const { data } = await supabase
          .from('tailor_profiles')
          .select('id')
          .eq('user_id', user!.id)
          .maybeSingle()

        if (cancelled) return
        if (!data?.id) {
          setReadyMadeItemCount(0)
          return
        }

        const { count } = await supabase
          .from('seller_items')
          .select('id', { count: 'exact', head: true })
          .eq('tailor_profile_id', data.id)

        if (!cancelled) setReadyMadeItemCount(count ?? 0)
      }

      void refreshReadyMadeItemCount()
      return () => {
        cancelled = true
      }
    }, [user?.id])
  )

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

  const phoneValidationMessage = useCallback((value: string) => {
    if (!value.trim()) {
      return TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE
    }
    const error = validatePhoneForProfile(value)
    if (error) {
      return error
    }
    return ''
  }, [])

  function validatePhone(value: string) {
    const error = phoneValidationMessage(value)
    setPhoneError(error)
    return !error
  }

  async function validatePhoneAvailability(value: string) {
    const formatError = phoneValidationMessage(value)
    const normalizedPhone = normalizePhoneForStorage(value)
    const requestId = phoneAvailabilityRequestRef.current + 1
    phoneAvailabilityRequestRef.current = requestId

    if (formatError) {
      setPhoneAvailabilityChecking(false)
      setPhoneError(formatError)
      return formatError
    }

    setPhoneAvailabilityChecking(true)
    const result = await checkAccountPhoneAvailability(normalizedPhone)

    if (
      requestId !== phoneAvailabilityRequestRef.current ||
      normalizePhoneForStorage(latestPhoneRef.current) !== normalizedPhone
    ) {
      return result.error ?? ''
    }

    setPhoneAvailabilityChecking(false)
    const availabilityError = result.available ? '' : result.error || DUPLICATE_PHONE_MESSAGE
    setPhoneError(availabilityError)
    return availabilityError
  }

  function markPhoneVerified(value: string) {
    const normalizedPhone = normalizePhoneForStorage(value)
    verifiedPhoneRef.current = normalizedPhone
    setVerifiedPhone(normalizedPhone)
    setPhoneOtpError('')
    setPhoneError('')
    clearVisibleError('phone')
  }

  function isCurrentPhoneVerified(value = phone) {
    const normalizedPhone = normalizePhoneForStorage(value)
    return !!normalizedPhone && verifiedPhoneRef.current === normalizedPhone
  }

  async function ensurePhoneVerifiedForSetup(afterVerify: 'advance' | 'finish') {
    const formatError = phoneValidationMessage(phone)
    const normalizedPhone = normalizePhoneForStorage(phone)
    if (formatError) {
      setPhoneError(formatError)
      setVisibleErrors({ phone: formatError })
      focusFirstSetupError({ phone: formatError }, 0)
      return false
    }

    if (isCurrentPhoneVerified(normalizedPhone)) return true

    setPhoneOtpSending(true)
    const result = await sendAccountPhoneOtp(normalizedPhone)
    setPhoneOtpSending(false)

    if (result.error) {
      setPhoneError(result.error)
      setVisibleErrors({ phone: result.error })
      focusFirstSetupError({ phone: result.error }, 0)
      hapticWarning()
      return false
    }

    if (result.bypassed) {
      markPhoneVerified(normalizedPhone)
      showSetupToast('Phone check passed for this environment', 'success')
      return true
    }

    phoneOtpAfterVerifyRef.current = afterVerify
    setPhoneOtpCode('')
    setPhoneOtpError('')
    setPhoneOtpVisible(true)
    showSetupToast('We sent a 6-digit code to verify your phone', 'success')
    return false
  }

  async function verifyPhoneOtpCode() {
    const normalizedPhone = normalizePhoneForStorage(phone)
    const code = phoneOtpCode.replace(/\D/g, '')
    if (code.length !== 6) {
      setPhoneOtpError('Enter the 6-digit code from the SMS.')
      hapticWarning()
      return
    }

    setPhoneOtpVerifying(true)
    const result = await verifyAccountPhoneOtp({ phone: normalizedPhone, code })
    setPhoneOtpVerifying(false)

    if (result.error) {
      setPhoneOtpError(result.error)
      hapticWarning()
      return
    }

    const action = phoneOtpAfterVerifyRef.current
    phoneOtpAfterVerifyRef.current = null
    markPhoneVerified(normalizedPhone)
    setPhoneOtpVisible(false)
    setPhoneOtpCode('')
    showSetupToast(result.bypassed ? 'Phone check passed for this environment' : 'Phone number verified', 'success')
    hapticSuccess()

    requestAnimationFrame(() => {
      if (action === 'advance') {
        openSetupSection(1)
        return
      }
      if (action === 'finish') {
        void finish()
      }
    })
  }

  async function resendPhoneOtpCode() {
    const normalizedPhone = normalizePhoneForStorage(phone)
    setPhoneOtpSending(true)
    const result = await sendAccountPhoneOtp(normalizedPhone)
    setPhoneOtpSending(false)

    if (result.error) {
      setPhoneOtpError(result.error)
      hapticWarning()
      return
    }

    if (result.bypassed) {
      const action = phoneOtpAfterVerifyRef.current
      phoneOtpAfterVerifyRef.current = null
      markPhoneVerified(normalizedPhone)
      setPhoneOtpVisible(false)
      setPhoneOtpCode('')
      showSetupToast('Phone check passed for this environment', 'success')
      requestAnimationFrame(() => {
        if (action === 'advance') {
          openSetupSection(1)
          return
        }
        if (action === 'finish') {
          void finish()
        }
      })
      return
    }

    setPhoneOtpError('')
    showSetupToast('Code resent', 'success')
  }

  useEffect(() => {
    latestPhoneRef.current = phone

    const formatError = phoneValidationMessage(phone)
    const requestId = phoneAvailabilityRequestRef.current + 1
    phoneAvailabilityRequestRef.current = requestId

    if (!phone.trim() || formatError) {
      return undefined
    }

    const normalizedPhone = normalizePhoneForStorage(phone)
    const timer = setTimeout(() => {
      setPhoneAvailabilityChecking(true)
      void checkAccountPhoneAvailability(normalizedPhone).then((result) => {
        if (
          requestId !== phoneAvailabilityRequestRef.current ||
          normalizePhoneForStorage(latestPhoneRef.current) !== normalizedPhone
        ) {
          return
        }

        setPhoneAvailabilityChecking(false)
        setPhoneError(result.available ? '' : result.error || DUPLICATE_PHONE_MESSAGE)
      })
    }, PHONE_AVAILABILITY_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [phone, phoneValidationMessage])

  function getBioValidationError(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) {
      return "Contact details aren't allowed in your bio."
    }
    if (text.trim().length < 80) {
      return `About you needs at least 80 characters (${text.trim().length}/80).`
    }
    if (isBioGibberish(text)) {
      return 'Please enter a meaningful description of your work and experience.'
    }
    return ''
  }

  function validateBio(text: string) {
    const error = getBioValidationError(text)
    setBioError(error)
    return !error
  }

  const profileImageRejectionActive =
    idVerificationStatus === 'REJECTED' &&
    isProfileImageRejectionCode(idRejectionCode) &&
    !avatarRejectionCleared

  const hasIdDocumentForSetup = useCallback(() => {
    if (idPhotoUri) return true
    if (isProfileImageRejectionCode(idRejectionCode) && savedIdSelfieUrl) return true
    return idVerificationStatus !== 'NOT_SUBMITTED' && idVerificationStatus !== 'REJECTED'
  }, [idPhotoUri, idRejectionCode, idVerificationStatus, savedIdSelfieUrl])

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
      profilePhotoPresent: !!avatarUrl && !profileImageRejectionActive,
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
      readyMadeItemCount,
      sellerType,
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
    profileImageRejectionActive,
    location,
    bio,
    bioError,
    languages,
    specialties,
    priceMin,
    priceMax,
    currency,
    portfolioItems.length,
    readyMadeItemCount,
    sellerType,
    supportsCustomOrders,
    supportsReadyMade,
    pickupAvailable,
    deliveryAvailable,
    shippingAvailable,
    pickupAddress,
    hasIdDocumentForSetup,
  ])

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
    clearVisibleError('orderMode')
    clearVisibleError('portfolio')
  }

  function clearVisibleError(field: TailorSetupField) {
    setVisibleErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setSetupToast((current) => (current?.type === 'error' ? null : current))
  }

  const rememberSetupFieldY = useCallback((field: TailorSetupField) => {
    return (event: { nativeEvent: { layout: { y: number } } }) => {
      setupFieldYRef.current[field] = event.nativeEvent.layout.y
    }
  }, [])

  const showSetupToast = useCallback(
    (message: string, type: SetupToast['type'] = 'success', autoDismiss = type === 'success') => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      if (setupToastTimerRef.current) {
        clearTimeout(setupToastTimerRef.current)
        setupToastTimerRef.current = null
      }
      setSetupToast({ type, message })
      if (autoDismiss) {
        setupToastTimerRef.current = setTimeout(() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          setSetupToast(null)
          setupToastTimerRef.current = null
        }, 2200)
      }
    },
    []
  )

  const scrollSetupFieldIntoView = useCallback((field: TailorSetupField) => {
    Keyboard.dismiss()
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    hapticWarning()
    setTimeout(() => {
      const y = setupFieldYRef.current[field] ?? 0
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - FOCUSED_FIELD_TOP_OFFSET),
        animated: true,
      })
    }, FOCUSED_FIELD_SCROLL_DELAY_MS)
  }, [])

  const focusFirstSetupError = useCallback(
    (errors: TailorSetupFieldErrors, currentStep: TailorSetupStep) => {
      const priority = SETUP_ERROR_FIELD_PRIORITY[currentStep]
      const field = priority.find((candidate) => errors[candidate]) ?? priority[0]
      const message = (field && errors[field]) || 'Finish the highlighted section to continue.'
      showSetupToast(message, 'error', false)
      if (field) {
        scrollSetupFieldIntoView(field)
      } else {
        hapticWarning()
      }
    },
    [scrollSetupFieldIntoView, showSetupToast]
  )

  useEffect(() => {
    if (initialStepResolved.current || !profileHydrated || !pickupHydrated) return
    initialStepResolved.current = true
    if (openIdentityFromHandoff) {
      openSetupSection(3)
      showSetupToast('Secure handoff opened. Capture your live identity selfie.', 'success')
      return
    }
    const progress = getSetupProgress()
    if (routeRequestedStep !== null) {
      openSetupSection(progress.firstIncompleteStep)
      return
    }
    setStep(progress.firstIncompleteStep)
  }, [getSetupProgress, openIdentityFromHandoff, pickupHydrated, profileHydrated, routeRequestedStep, showSetupToast])

  useEffect(() => {
    if (!profileHydrated || !pickupHydrated || routeRequestedStep === null) return
    const restoreKey = `section:${routeRequestedStep}`
    if (routeSectionRestoreKey.current === restoreKey) return
    routeSectionRestoreKey.current = restoreKey
    const progress = getSetupProgress()
    openSetupSection(progress.firstIncompleteStep)
  }, [getSetupProgress, pickupHydrated, profileHydrated, routeRequestedStep])

  function openProfilePhotoPicker() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    setMediaSheetMode('profile-photo')
  }

  async function pickProfilePhoto(source: ProfilePhotoSource) {
    const imageUri = await pickAvatarImageUri(source)
    if (!imageUri || !user?.id) return

    setUploadingAvatar(true)
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'avatars',
        path: `${user.id}/avatar.jpg`,
        uri: compressed.uri,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        upsert: true,
      })
      setAvatarUrl(`${publicUrl}?t=${new Date().getTime()}`)
      if (isProfileImageRejectionCode(idRejectionCode)) setAvatarRejectionCleared(true)
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
    setPortfolioReplaceIndex(null)
    setMediaSheetMode('portfolio-media')
  }

  function openPortfolioReplacePicker(index: number) {
    setPortfolioReplaceIndex(index)
    setSelectedPortfolioIndex(null)
    setMediaSheetMode('portfolio-media')
  }

  function syncPortfolioMediaOrder(nextItems: PortfolioItem[]) {
    if (!user?.id) return
    void invokeFunction('tailor-profile-action', {
      body: {
        action: 'update-portfolio-media',
        photoUrls: nextItems.filter((item) => item.type === 'photo').map((item) => item.url),
        videoUrls: nextItems.filter((item) => item.type === 'video').map((item) => item.url),
      },
    }).then(({ error }) => {
      if (error) {
        Sentry.captureException(error, {
          extra: { context: 'tailor_setup_portfolio_media_order_sync', userId: user?.id },
        })
      }
    }).catch((error) => {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_portfolio_media_order_sync', userId: user?.id },
      })
    })
  }

  function movePortfolioItem(fromIndex: number, toIndex: number) {
    let reorderedItems: PortfolioItem[] | null = null
    setPortfolioItems((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      if (!item) return prev
      next.splice(toIndex, 0, item)
      reorderedItems = next
      return next
    })
    if (reorderedItems) syncPortfolioMediaOrder(reorderedItems)
    setSelectedPortfolioIndex(toIndex)
    setPortfolioDragIndex(null)
    setPortfolioHoverIndex(null)
    clearVisibleError('portfolio')
  }

  function handlePortfolioDragMove(fromIndex: number, dx: number, dy: number) {
    const targetIndex = getPortfolioDropTargetIndex(fromIndex, dx, dy, portfolioItems.length)
    if (targetIndex == null) return
    setPortfolioHoverIndex((current) => current === targetIndex ? current : targetIndex)
  }

  function handlePortfolioDragEnd(fromIndex: number, dx: number, dy: number) {
    const targetIndex = getPortfolioDropTargetIndex(fromIndex, dx, dy, portfolioItems.length)
    if (targetIndex != null && targetIndex !== fromIndex) {
      movePortfolioItem(fromIndex, targetIndex)
      hapticSuccess()
      return
    }
    setPortfolioDragIndex(null)
    setPortfolioHoverIndex(null)
  }

  function removePortfolioItem(index: number) {
    let nextItems: PortfolioItem[] = []
    setPortfolioItems((prev) => {
      nextItems = prev.filter((_, idx) => idx !== index)
      return nextItems
    })
    syncPortfolioMediaOrder(nextItems)
    setSelectedPortfolioIndex(null)
    clearVisibleError('portfolio')
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
      const extension = portfolioVideoExtension(asset)
      const filename = `portfolio/${user.id}/${stamp}.${extension}`
      const contentType = portfolioVideoContentType(asset)
      const payload = await createValidatedUploadPayload(asset.uri, {
        maxBytes: MAX_PORTFOLIO_VIDEO_BYTES,
        contentType,
        allowedContentTypes: ALLOWED_VIDEO_CONTENT_TYPES,
        purpose: 'PORTFOLIO',
      })
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
    const replacingIndex =
      portfolioReplaceIndex != null &&
      portfolioReplaceIndex >= 0 &&
      portfolioReplaceIndex < portfolioItems.length
        ? portfolioReplaceIndex
        : null
    const replacingItem = replacingIndex != null ? portfolioItems[replacingIndex] : null
    const isReplacing = replacingIndex != null

    if (!isReplacing && portfolioItems.length >= MAX_PORTFOLIO_ITEMS) {
      Alert.alert('Maximum reached', `You can add up to ${MAX_PORTFOLIO_ITEMS} photos or videos.`)
      return
    }
    const videoCount =
      portfolioItems.filter((i) => i.type === 'video').length -
      (replacingItem?.type === 'video' ? 1 : 0)
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

    if (source !== 'camera-photo') {
      setPortfolioMediaStatus(
        source === 'library'
          ? 'Preparing selected media. Videos can take a few seconds.'
          : 'Preparing video. This can take a few seconds.'
      )
    }

    const res = await launchImagePickerSafely(
      () =>
        source === 'library'
          ? ImagePicker.launchImageLibraryAsync(
              preferCompatibleVideoRepresentation({
                mediaTypes: ['images', 'videos'],
                allowsMultipleSelection: !isReplacing,
                orderedSelection: true,
                selectionLimit: Math.min(
                  isReplacing ? 1 : MAX_PORTFOLIO_ITEMS - portfolioItems.length,
                  MAX_PORTFOLIO_ITEMS
                ),
                quality: 0.85,
                videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS,
              })
            )
          : source === 'camera-video'
            ? ImagePicker.launchCameraAsync({
                mediaTypes: 'videos',
                quality: 0.8,
                videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS,
              })
            : ImagePicker.launchCameraAsync({
                mediaTypes: 'images',
                quality: 0.85,
              }),
      {
        context: 'tailor_setup_portfolio_media_picker',
        mediaLabel: source === 'library' ? 'portfolio media file' : 'portfolio media',
        extra: { source, userId: user?.id },
      }
    )
    if (!res) {
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
      return
    }
    if (res.canceled || !res.assets[0]) {
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
      return
    }

    const remainingSlots = isReplacing ? 1 : MAX_PORTFOLIO_ITEMS - portfolioItems.length
    const candidates = res.assets.slice(0, remainingSlots)
    const acceptedAssets: ImagePicker.ImagePickerAsset[] = []
    let skippedDuplicates = 0
    let skippedVideos = 0
    const validationMessages = new Set<string>()
    let nextVideoCount = videoCount
    const seenAssetKeys = new Set(pickedAssetKeys.current)

    for (const asset of candidates) {
      const duplicateKey = portfolioAssetDuplicateKey(asset)
      if (pickedUris.current.has(asset.uri) || seenAssetKeys.has(duplicateKey)) {
        skippedDuplicates += 1
        continue
      }
      if (asset.type === 'video') {
        const validationMessage = validatePortfolioVideoAsset(asset)
        if (validationMessage) {
          validationMessages.add(validationMessage)
          continue
        }
        if (nextVideoCount >= MAX_PORTFOLIO_VIDEOS) {
          skippedVideos += 1
          continue
        }
        nextVideoCount += 1
      }
      acceptedAssets.push(asset)
      seenAssetKeys.add(duplicateKey)
    }

    if (acceptedAssets.length === 0) {
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
      const reason = validationMessages.size
        ? Array.from(validationMessages)[0]
        : skippedDuplicates > 0
          ? 'Those files are already in your portfolio.'
          : `You can include up to ${MAX_PORTFOLIO_VIDEOS} videos in your portfolio.`
      Alert.alert('Nothing added', reason)
      return
    }

    setUploadingMedia(true)
    setPortfolioMediaStatus(
      acceptedAssets.some((asset) => asset.type === 'video')
        ? 'Uploading video. Keep this screen open.'
        : 'Uploading media. Keep this screen open.'
    )
    acceptedAssets.forEach((asset) => {
      pickedUris.current.add(asset.uri)
      pickedAssetKeys.current.add(portfolioAssetDuplicateKey(asset))
    })

    const uploadedItems: PortfolioItem[] = []
    const failedAssets: ImagePicker.ImagePickerAsset[] = []
    try {
      for (let i = 0; i < acceptedAssets.length; i += 1) {
        try {
          uploadedItems.push(await uploadPortfolioAsset(acceptedAssets[i], i))
        } catch (assetError) {
          failedAssets.push(acceptedAssets[i])
          pickedUris.current.delete(acceptedAssets[i].uri)
          pickedAssetKeys.current.delete(portfolioAssetDuplicateKey(acceptedAssets[i]))
          Sentry.captureException(assetError, {
            extra: { context: 'tailor_setup_media_asset_upload', userId: user?.id },
          })
        }
      }

      if (uploadedItems.length > 0) {
        if (isReplacing && uploadedItems[0]) {
          setPortfolioItems((prev) =>
            prev.map((item, idx) => (idx === replacingIndex ? uploadedItems[0] : item))
          )
          setSelectedPortfolioIndex(replacingIndex)
        } else {
          setPortfolioItems((prev) => [...prev, ...uploadedItems].slice(0, MAX_PORTFOLIO_ITEMS))
        }
        clearVisibleError('portfolio')
      }

      if (
        failedAssets.length > 0 ||
        skippedDuplicates > 0 ||
        skippedVideos > 0 ||
        validationMessages.size > 0 ||
        res.assets.length > candidates.length
      ) {
        const notes = [
          uploadedItems.length > 0 ? `${uploadedItems.length} added` : null,
          failedAssets.length > 0 ? `${failedAssets.length} failed` : null,
          skippedDuplicates > 0 ? `${skippedDuplicates} duplicate` : null,
          skippedVideos > 0 ? `${skippedVideos} over video limit` : null,
          validationMessages.size > 0 ? Array.from(validationMessages)[0] : null,
          res.assets.length > candidates.length
            ? `${res.assets.length - candidates.length} over portfolio limit`
            : null,
        ].filter(Boolean)
        Alert.alert('Portfolio update', notes.join(' · '))
      }
    } catch (error) {
      const capturedError = error as ErrorWithStatus
      acceptedAssets.forEach((asset) => {
        pickedUris.current.delete(asset.uri)
        pickedAssetKeys.current.delete(portfolioAssetDuplicateKey(asset))
      })
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
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
    }
  }

  function openIdPhotoPicker() {
    setMediaSheetMode('id-document')
  }

  async function pickIdPhoto(_source: IdDocumentSource) {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Allow camera access to capture a live selfie while holding your ID beside your face.'
      )
      return
    }

    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchCameraAsync({
          mediaTypes: 'images',
          quality: 0.9,
          allowsEditing: false,
        }),
      {
        context: 'tailor_setup_id_document_picker',
        mediaLabel: 'identity selfie image',
        extra: { source: 'camera', userId: user?.id },
      }
    )
    if (!res) return
    if (res.canceled || !res.assets[0]) return
    setIdPhotoUri(res.assets[0].uri)
    clearVisibleError('idDocument')
    setIdError('')
  }

  async function submitIdentitySelfieForReview(): Promise<boolean> {
    if (!idPhotoUri || !user?.id) return false
    const normalizedLegalName = normalizeLegalName(legalName)
    if (!isValidLegalName(normalizedLegalName)) {
      setLegalNameError('Enter your legal name exactly as shown on your ID. Numbers, emojis, handles, and business symbols are not permitted.')
      return false
    }
    if (!identityConsentGranted) {
      setIdentityConsentError('Consent is required before identity review can begin.')
      return false
    }
    setUploadingId(true)
    try {
      let token = handoffToken
      if (token) {
        const resolved = await invokeFunction<{
          handoffId?: string
        }>('identity-handoff-action', {
          body: { action: 'resolve-token', token },
        })
        if (resolved.error) throw resolved.error
        if (!resolved.data?.handoffId) throw new Error('Identity handoff could not be found. Start a new session and try again.')
      } else {
        const created = await invokeFunction<{
          token?: string
        }>('identity-handoff-action', {
          body: { action: 'create' },
        })
        if (created.error) throw created.error
        token = created.data?.token?.trim() || null
      }
      if (!token) throw new Error('Could not start identity verification. Try again.')

      const upload = await invokeFunction<{
        path?: string
        uploadToken?: string
      }>('identity-handoff-action', {
        body: { action: 'create-upload-url', token },
      })
      if (upload.error) throw upload.error
      const path = upload.data?.path
      const uploadToken = upload.data?.uploadToken
      if (!path || !uploadToken) throw new Error('Could not prepare secure identity upload. Try again.')

      const cleanUri = await stripExif(idPhotoUri)
      const payload = await createValidatedUploadPayload(cleanUri, 20 * 1024 * 1024)
      const { error: uploadError } = await supabase.storage
        .from('id-documents')
        .uploadToSignedUrl(path, uploadToken, payload.data, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const submitted = await invokeFunction<{
        status?: string
      }>('identity-handoff-action', {
        body: {
          action: 'submit',
          token,
          storagePath: path,
          consentGranted: true,
          consentVersion: IDENTITY_CONSENT_POLICY_VERSION,
          consentSource: 'MOBILE_SETUP',
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
        },
      })
      if (submitted.error) throw submitted.error

      setIdVerificationStatus('PENDING')
      setIdRejectionReason('')
      setUploadingId(false)
      return true
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_identity_handoff_submit', userId: user?.id },
      })
      setUploadingId(false)
      Alert.alert(
        'Identity review not submitted',
        await readFunctionErrorMessage(
          error,
          'We saved your profile, but identity review still needs your live selfie before review can start.'
        )
      )
      return false
    }
  }

  function openReadyMadeItemCreator() {
    const setupReturnPath = '/(tailor)/profile/setup?view=section&step=2' as const
    const historyChain = appendToHistory(firstParam(routeParams.historyChain), setupReturnPath)
    const readyMadeItemRoute: Href = {
      pathname: '/(tailor)/shop/new',
      params: {
        returnTo: setupReturnPath,
        historyChain,
        onboarding: 'tailor_setup',
      },
    }

    router.push(readyMadeItemRoute)
  }

  async function finish() {
    if (saving || uploadingId || uploadingMedia) return

    const phoneVerifiedForSubmit = await ensurePhoneVerifiedForSetup('finish')
    if (!phoneVerifiedForSubmit) {
      setStep(0)
      setSetupView('section')
      return
    }

    if (!hasIdDocumentForSetup()) {
      setStep(3)
      setSetupView('section')
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      focusFirstSetupError({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE }, 3)
      return
    }

    if (idPhotoUri && !isValidLegalName(legalName)) {
      setStep(3)
      setSetupView('section')
      setLegalNameError('Enter your legal name exactly as shown on your ID. Numbers, emojis, handles, and business symbols are not permitted.')
      return
    }

    if (idPhotoUri && !identityConsentGranted) {
      setStep(3)
      setSetupView('section')
      setIdentityConsentError('Consent is required before identity review can begin.')
      return
    }

    setSaving(true)

    if (!user?.id) {
      setSaving(false)
      Alert.alert('Session expired', 'Please sign in again and retry profile setup.')
      return
    }

    const normalizedPhone = normalizePhoneForStorage(phone)

    const { error } = await invokeFunction('tailor-profile-action', {
      body: {
        action: 'upsert-setup',
        profile: {
          displayName: displayName.trim(),
          ...(legalName.trim() ? { legalName: normalizeLegalName(legalName) } : {}),
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
          acceptsCustomOrdersNow,
          shopPaused,
          pickupAvailable,
          pickupAddress: pickupAddress.trim() || null,
          pickupInstructions: pickupInstructions.trim() || null,
          deliveryAvailable,
          shippingAvailable,
          deliveryFee: 0,
          shippingFee: 0,
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
        setSetupView('section')
        setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
        setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
        focusFirstSetupError({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE }, 3)
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

    const phoneVerifiedAt = isCurrentPhoneVerified(normalizedPhone) ? new Date().toISOString() : null

    const { error: authError } = await supabase.auth.updateUser({
      data: {
        display_name: displayName.trim(),
        phone: normalizedPhone,
        ...(phoneVerifiedAt ? { phone_verified_at: phoneVerifiedAt, verified_phone: normalizedPhone } : {}),
      },
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

    if (!idPhotoUri && isProfileImageRejectionCode(idRejectionCode) && avatarRejectionCleared) {
      setIdVerificationStatus('PENDING')
      setIdRejectionReason('')
      setIdRejectionCode('')
    }

    if (idPhotoUri) {
      const identitySubmitted = await submitIdentitySelfieForReview()
      if (!identitySubmitted) {
        setStep(3)
        setSetupView('section')
        return
      }
    }

    Alert.alert(
      'Profile submitted',
      idPhotoUri
        ? "We'll review your live identity selfie within 24 hours. You'll be notified when your profile goes live."
        : 'Your profile is saved. Capture your identity selfie to submit for review. Payout setup can be completed after your account is created.',
      [{ text: 'OK', onPress: () => resetTo(router, { pathname: '/(auth)/onboarding', params: { role: 'TAILOR', userId: user.id } }) }]
    )
  }

  function openSetupSection(targetStep: TailorSetupStep) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    setStep(targetStep)
    setSetupView('section')
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    })
  }

  function returnToSetupHub() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    setSetupToast(null)
    setSetupView('hub')
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    })
  }

  async function next() {
    if (saving || uploadingId || uploadingMedia) return
    const shouldValidateIdentity = setupView === 'hub' || step === 0
    const nextNameError = shouldValidateIdentity ? (validateDisplayName(displayName) ?? '') : nameError
    const nextPhoneError =
      shouldValidateIdentity
        ? await validatePhoneAvailability(phone)
        : phoneError
    const nextBioError = shouldValidateIdentity ? getBioValidationError(bio) : bioError

    if (shouldValidateIdentity) {
      setNameError(nextNameError)
      setPhoneError(nextPhoneError)
      setBioError(nextBioError)
    }

    const progress = getSetupProgress({
      nameError: nextNameError,
      phoneError: nextPhoneError,
      bioError: nextBioError,
    })

    if (setupView === 'hub') {
      if (SETUP_STEP_IDS.every((stepId) => progress.stepValid[stepId]) && hasIdDocumentForSetup()) {
        setVisibleErrors({})
        void finish()
        return
      }
      openSetupSection(progress.firstIncompleteStep)
      return
    }

    if (!progress.stepValid[step]) {
      const currentErrors = progress.stepErrors[step]
      setVisibleErrors(currentErrors)
      if (currentErrors.idDocument) {
        setIdError(currentErrors.idDocument)
      }
      focusFirstSetupError(currentErrors, step)
      return
    }

    if (step === 0) {
      const phoneVerifiedForAdvance = await ensurePhoneVerifiedForSetup('advance')
      if (!phoneVerifiedForAdvance) return
    }

    setVisibleErrors({})
    if (step === 3 && !hasIdDocumentForSetup()) {
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      focusFirstSetupError({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE }, 3)
      return
    }
    setIdError('')
    if (step < 3) {
      showSetupToast(`${stepLabels[step]} section completed`, 'success')
      hapticSuccess()
      openSetupSection((step + 1) as TailorSetupStep)
      return
    }
    void finish()
  }

  function goBack() {
    if (setupView === 'section') {
      if (step > 0) {
        openSetupSection((step - 1) as TailorSetupStep)
        return
      }
      returnToSetupHub()
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

  const setupProgress = getSetupProgress({
    nameError: validateDisplayName(displayName) ?? '',
    phoneError: !phone.trim() ? TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE : (validatePhoneForProfile(phone) ?? ''),
    bioError: getBioValidationError(bio),
  })
  const proofChecklistLabel =
    sellerType === 'BOUTIQUE'
      ? 'Ready-made listing'
      : sellerType === 'TAILOR_SHOP'
        ? 'Portfolio + ready-made item'
        : 'Portfolio sample'
  const proofChecklistDetail =
    sellerType === 'BOUTIQUE'
      ? 'Add one ready-made item customers can inspect.'
      : sellerType === 'TAILOR_SHOP'
        ? 'Add a work sample and a ready-made item customers can inspect.'
        : 'Add at least one real work sample customers can inspect.'
  const setupChecklist = [
    {
      label: 'Contact + public profile',
      detail: 'Verified phone, display name, photo, location, and bio.',
      complete: setupProgress.stepValid[0] && isCurrentPhoneVerified(phone) && !profileImageRejectionActive,
      targetStep: 0 as TailorSetupStep,
    },
    {
      label: 'Business type + pricing',
      detail: 'Choose Tailor, Boutique, or Tailor shop and set a visible price guide.',
      complete: setupProgress.stepValid[1],
      targetStep: 1 as TailorSetupStep,
    },
    {
      label: proofChecklistLabel,
      detail: proofChecklistDetail,
      complete: setupProgress.stepValid[2],
      targetStep: 2 as TailorSetupStep,
    },
    {
      label: 'Identity & handoff',
      detail: 'Capture your live ID selfie and add customer handoff details. Payout setup comes after account creation.',
      complete: setupProgress.stepValid[3],
      targetStep: 3 as TailorSetupStep,
    },
  ]
  const checklistRemaining = setupChecklist.filter((item) => !item.complete).length
  const setupReadyToSubmit = SETUP_STEP_IDS.every((stepId) => setupProgress.stepValid[stepId]) && hasIdDocumentForSetup()
  const selectedSellerType = SELLER_TYPE_OPTIONS.find((item) => item.value === sellerType) ?? SELLER_TYPE_OPTIONS[0]
  const proofStepTitle = sellerType === 'BOUTIQUE' ? 'Shop proof' : sellerType === 'TAILOR_SHOP' ? 'Public proof' : 'Portfolio'
  const proofStepBody = sellerType === 'BOUTIQUE'
    ? 'Add your first ready-made item so customers can inspect what your shop sells.'
    : sellerType === 'TAILOR_SHOP'
      ? 'Add portfolio media and one ready-made item so customers can inspect both sides of your shop.'
      : STEP_SUBS[2]
  const stepTitles = [STEP_TITLES[0], STEP_TITLES[1], proofStepTitle, STEP_TITLES[3]]
  const stepSubs = [STEP_SUBS[0], STEP_SUBS[1], proofStepBody, STEP_SUBS[3]]
  const stepLabels = [STEP_LABELS[0], STEP_LABELS[1], proofStepTitle, STEP_LABELS[3]]
  const hasPortfolioProof = portfolioItems.length >= MIN_PORTFOLIO_ITEMS
  const hasReadyMadeProof = readyMadeItemCount > 0
  const proofCountText = sellerType === 'BOUTIQUE'
    ? hasReadyMadeProof
      ? String(readyMadeItemCount) + ' ready-made item' + (readyMadeItemCount === 1 ? '' : 's') + ' added'
      : 'Add 1 ready-made item to continue'
    : sellerType === 'TAILOR_SHOP'
      ? hasPortfolioProof && hasReadyMadeProof
        ? String(portfolioItems.length) + '/' + String(MAX_PORTFOLIO_ITEMS) + ' portfolio media · ' + String(readyMadeItemCount) + ' ready-made item' + (readyMadeItemCount === 1 ? '' : 's')
        : !hasPortfolioProof && !hasReadyMadeProof
          ? 'Add portfolio media and 1 ready-made item to continue'
          : !hasPortfolioProof
            ? 'Add portfolio media to continue'
            : 'Add 1 ready-made item to continue'
      : hasPortfolioProof
        ? String(portfolioItems.length) + '/' + String(MAX_PORTFOLIO_ITEMS) + ' portfolio media added'
        : 'Add 1 work sample to continue'
  const proofVideoText = sellerType !== 'BOUTIQUE'
    ? ' · ' + String(portfolioItems.filter((i) => i.type === 'video').length) + '/' + String(MAX_PORTFOLIO_VIDEOS) + ' videos'
    : ''
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
      : step === 2 && setupProgress.fieldErrors.portfolio
        ? setupProgress.fieldErrors.portfolio
        : step === 3 && !(supportsCustomOrders || supportsReadyMade)
          ? 'Choose at least one way customers can order from you'
          : step === 3 && !(pickupAvailable || deliveryAvailable || shippingAvailable)
            ? 'Choose at least one way customers receive orders'
            : step === 3 && !hasIdDocumentForSetup()
              ? TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE
            : ''
  const primaryCtaLabel = uploadingMedia
    ? 'Uploading…'
    : setupView === 'hub'
      ? saving || uploadingId
        ? 'Submitting…'
        : setupReadyToSubmit
          ? 'Submit for review'
          : 'Resume setup'
      : saving || uploadingId
        ? 'Submitting…'
        : step === 3
          ? 'Submit for review'
          : 'Save and continue'
  const editingLayoutActive = keyboard.visible || focusedTextField !== null
  const ctaBottomPadding = editingLayoutActive
    ? Math.max(insets.bottom + Spacing.xs, Spacing.sm)
    : Math.max(insets.bottom + Spacing.sm, Spacing.xl)
  const scrollBottomPadding = editingLayoutActive ? 96 : 160
  const portfolioGridEntries = useMemo(
    () => previewPortfolioGridEntries(portfolioItems, portfolioDragIndex, portfolioHoverIndex),
    [portfolioDragIndex, portfolioHoverIndex, portfolioItems]
  )
  const selectedPortfolioItem =
    selectedPortfolioIndex != null &&
    selectedPortfolioIndex >= 0 &&
    selectedPortfolioIndex < portfolioItems.length
      ? portfolioItems[selectedPortfolioIndex]
      : null
  const portfolioVideoLimitReached =
    portfolioItems.filter((i) => i.type === 'video').length -
      (portfolioReplaceIndex != null && portfolioItems[portfolioReplaceIndex]?.type === 'video' ? 1 : 0) >=
    MAX_PORTFOLIO_VIDEOS

  const animateEditingLayout = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
  }, [])

  const focusTextField = useCallback((field: string) => {
    animateEditingLayout()
    setFocusedTextField(field)
  }, [animateEditingLayout])

  const blurTextField = useCallback((field: string) => {
    animateEditingLayout()
    setFocusedTextField((current) => (current === field ? null : current))
  }, [animateEditingLayout])

  const scrollFocusedBioIntoView = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, bioFieldYRef.current - FOCUSED_FIELD_TOP_OFFSET),
        animated: true,
      })
    }, FOCUSED_FIELD_SCROLL_DELAY_MS)
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <AuthBackButton onPress={goBack} />
          <Text style={styles.stepCount}>{setupView === 'hub' ? 'Setup' : `${step + 1} / 4`}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Progress stepper with step labels */}
        {setupView === 'section' ? <ProgressStepper steps={stepLabels} current={step} /> : null}

        {setupToast ? (
          <View
            style={[
              styles.setupToast,
              setupToast.type === 'error' ? styles.setupToastError : styles.setupToastSuccess,
            ]}
          >
            <Text
              style={[
                styles.setupToastText,
                setupToast.type === 'error' ? styles.setupToastTextError : styles.setupToastTextSuccess,
              ]}
            >
              {setupToast.message}
            </Text>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={portfolioDragIndex === null}
          contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
        >
          <View style={styles.content}>
            {setupView === 'hub' ? (
              <>
                <AuthEntryHeader
                  eyebrow="Tailor profile"
                  title="Finish tailor profile"
                  body="Complete the profile pieces Drapeon needs before review."
                  showWordmark={false}
                />

                {idVerificationStatus === 'REJECTED' ? (
                  <View style={styles.identityRejectedCard}>
                    <Text style={styles.identityRejectedTitle}>
                      {profileImageRejectionActive ? 'Profile photo needs replacement' : 'Identity retake needed'}
                    </Text>
                    <Text style={styles.identityRejectedText}>{idRejectionReason || readIdentityRejectionMessage({})}</Text>
                  </View>
                ) : null}

                <View style={styles.setupChecklistCard}>
                  <View style={styles.setupChecklistHeader}>
                    <Text style={styles.setupChecklistTitle}>Go-live checklist</Text>
                    <Text style={styles.setupChecklistMeta}>
                      {checklistRemaining === 0 ? 'Ready to submit' : `${checklistRemaining} needed`}
                    </Text>
                  </View>
                  {setupChecklist.map((item) => {
                    const isCurrentStep = item.targetStep === setupProgress.firstIncompleteStep
                    const isActionable = !setupReadyToSubmit && isCurrentStep
                    const stateLabel = item.complete ? 'Done' : isActionable ? 'Next' : 'Locked'
                    return (
                      <TouchableOpacity
                        key={item.label}
                        style={[
                          styles.setupChecklistRow,
                          isActionable && styles.setupChecklistRowActive,
                          !item.complete && !isActionable && styles.setupChecklistRowDeferred,
                        ]}
                        onPress={() => {
                          if (isActionable) openSetupSection(item.targetStep)
                        }}
                        disabled={!isActionable}
                        activeOpacity={0.85}
                      >
                        <View
                          style={[
                            styles.setupChecklistMark,
                            item.complete && styles.setupChecklistMarkDone,
                            !item.complete && !isActionable && styles.setupChecklistMarkDeferred,
                          ]}
                        >
                          <Text
                            style={[
                              styles.setupChecklistMarkText,
                              item.complete && styles.setupChecklistMarkTextDone,
                            ]}
                          >
                            {item.complete ? '✓' : isActionable ? '!' : '•'}
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
                            !item.complete && !isActionable && styles.setupChecklistStateDeferred,
                          ]}
                        >
                          {stateLabel}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                  <View style={styles.setupChecklistFooter}>
                    <Text style={styles.setupChecklistFooterText}>
                      Drapeon reviews your public profile, proof, and identity before account access expands. Paid work opens after payout setup is verified.
                    </Text>
                  </View>
                </View>
              </>
            ) : !editingLayoutActive ? (
              <AuthEntryHeader
                eyebrow="Tailor profile"
                title={stepTitles[step]}
                body={stepSubs[step]}
                showWordmark={false}
              />
            ) : null}

            {/* ── Step 0: Identity ── */}
            {setupView === 'section' && step === 0 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  {!editingLayoutActive ? (
                    <View onLayout={rememberSetupFieldY('profilePhoto')}>
                      <TouchableOpacity
                        style={[
                          styles.profilePhotoPicker,
                          !!visibleErrors.profilePhoto && styles.profilePhotoPickerError,
                          profileImageRejectionActive && styles.profilePhotoPickerRejected,
                        ]}
                        onPress={openProfilePhotoPicker}
                        disabled={uploadingAvatar}
                        activeOpacity={0.86}
                      >
                        <View style={[styles.profilePhotoPreview, profileImageRejectionActive && styles.profilePhotoPreviewRejected]}>
                          {uploadingAvatar ? (
                            <ActivityIndicator color={Colors.needleGreen} />
                          ) : avatarUrl ? (
                            <AvatarImage
                              uri={avatarUrl}
                              initials={displayName || user?.email}
                              size={68}
                              borderWidth={0}
                            />
                          ) : (
                            <Text style={styles.profilePhotoInitial}>
                              {(displayName.trim()[0] || 'D').toUpperCase()}
                            </Text>
                          )}
                          {profileImageRejectionActive ? (
                            <Text style={styles.profilePhotoRejectedBadge}>Invalid</Text>
                          ) : null}
                        </View>
                        <View style={styles.profilePhotoCopy}>
                          <Text style={styles.profilePhotoTitle}>Profile photo</Text>
                          <Text style={[styles.profilePhotoHint, profileImageRejectionActive && styles.profilePhotoHintRejected]}>
                            {profileImageRejectionActive
                              ? PROFILE_IMAGE_REJECTION_MESSAGE
                              : 'Take or choose a clear face photo. Customers see this before booking.'}
                          </Text>
                        </View>
                        <Text style={styles.profilePhotoAction}>{profileImageRejectionActive ? 'Replace' : avatarUrl ? 'Change' : 'Add'}</Text>
                      </TouchableOpacity>
                      {!!visibleErrors.profilePhoto && (
                        <Text style={styles.helperError}>{visibleErrors.profilePhoto}</Text>
                      )}
                    </View>
                  ) : null}
                  <View onLayout={rememberSetupFieldY('displayName')}>
                    <Input
                      label="Display name"
                      placeholder="e.g. John Doe"
                      value={displayName}
                      onChangeText={(value) => {
                        setDisplayName(value)
                        clearVisibleError('displayName')
                        if (nameError) validateName(value)
                      }}
                      onFocus={() => focusTextField('displayName')}
                      onBlur={() => {
                        blurTextField('displayName')
                        validateName(displayName)
                      }}
                      error={nameError || visibleErrors.displayName}
                      required
                      autoCapitalize="words"
                      hint="No @, URLs, or phone numbers. This is your public name."
                      testID="display-name-input"
                    />
                  </View>
                  <View onLayout={rememberSetupFieldY('phone')}>
                    <Input
                      label="Phone number"
                      placeholder="For order updates and account recovery"
                      value={phone}
                      onChangeText={(value) => {
                        setPhone(value)
                        if (phoneValidationMessage(value)) setPhoneAvailabilityChecking(false)
                        clearVisibleError('phone')
                        if (phoneError) validatePhone(value)
                      }}
                      onFocus={() => focusTextField('phone')}
                      onBlur={() => {
                        blurTextField('phone')
                        void validatePhoneAvailability(phone)
                      }}
                      error={phoneError || visibleErrors.phone}
                      required
                      keyboardType="phone-pad"
                      autoCapitalize="none"
                      hint={phoneAvailabilityChecking ? 'Checking phone number…' : PHONE_STORAGE_HINT}
                      testID="phone-input"
                    />
                  </View>
                  <View onLayout={rememberSetupFieldY('location')}>
                    <Input
                      label="Location"
                      placeholder="e.g. Lagos, Nigeria"
                      value={location}
                      onChangeText={onLocationChange}
                      onFocus={() => focusTextField('location')}
                      onBlur={() => {
                        blurTextField('location')
                        setShowSuggestions(false)
                      }}
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
                  <View
                    onLayout={(event) => {
                      bioFieldYRef.current = event.nativeEvent.layout.y
                      setupFieldYRef.current.bio = event.nativeEvent.layout.y
                    }}
                  >
                    <Input
                      label="About you"
                      placeholder="Tell people who you are, what you make, and your experience. Min 80 characters."
                      value={bio}
                      onChangeText={(v) => {
                        setBio(v)
                        clearVisibleError('bio')
                        validateBio(v)
                      }}
                      onFocus={() => {
                        focusTextField('bio')
                        scrollFocusedBioIntoView()
                      }}
                      onBlur={() => {
                        blurTextField('bio')
                        validateBio(bio)
                      }}
                      error={bioError || visibleErrors.bio}
                      required
                      multiline
                      numberOfLines={5}
                      maxLength={500}
                      filterContact
                      hint={`Min 80 characters · ${bio.trim().length}/500. No social handles, phone numbers, or URLs.`}
                      testID="bio-input"
                    />
                  </View>
                  <Text style={styles.fieldHint}>What customers look for</Text>
                  <View style={styles.helperList}>
                    {BIO_PROMPTS.map((prompt) => (
                      <View key={prompt} style={styles.helperListRow}>
                        <View style={styles.helperBullet} />
                        <Text style={styles.helperListText}>{prompt}</Text>
                      </View>
                    ))}
                  </View>

                  <View onLayout={rememberSetupFieldY('languages')}>
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
                      searchOnly
                    />
                    {!!visibleErrors.languages && (
                      <Text style={styles.helperError}>{visibleErrors.languages}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 1: Specialties + pricing ── */}
            {setupView === 'section' && step === 1 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <View onLayout={rememberSetupFieldY('specialties')}>
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
                  </View>

                  <View>
                    <Text style={styles.fieldLabel}>Business type</Text>
                    <SetupSelectorCard
                      title={selectedSellerType.label}
                      body={selectedSellerType.hint}
                      meta="Business type"
                      onPress={() => setChoiceSheetMode('seller-type')}
                    />
                  </View>

                  <View onLayout={rememberSetupFieldY('priceRange')}>
                    <Text style={styles.fieldLabel}>
                      Typical price range <Text style={styles.required}>*</Text>
                    </Text>
                    <Text style={styles.fieldHint}>
                      This shows on your profile as a guide, not a fixed price. For {currency}, use
                      at least {priceMinGuide} and keep the high end at {priceMaxGuide} or less.
                    </Text>
                    <Text style={styles.fieldHint}>
                      {currencySource === 'UNSUPPORTED_FALLBACK'
                        ? 'Currency starts from your region when available. USD is the fallback for regions we do not support yet.'
                        : 'Currency starts from your region when available. You can change it before saving.'}
                    </Text>
                    <SetupSelectorCard
                      title={currency}
                      body="This is the currency customers see for your profile price guide."
                      meta="Pricing currency"
                      onPress={() => setChoiceSheetMode('currency')}
                    />
                    <View style={[styles.infoBox, styles.currencyProviderNote]}>
                      <Text style={styles.infoText}>
                        Customers see this currency. Payout setup follows it later, so choose one you can accept payouts in.
                      </Text>
                    </View>
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
                        onFocus={() => focusTextField('priceMin')}
                        onBlur={() => blurTextField('priceMin')}
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
                        onFocus={() => focusTextField('priceMax')}
                        onBlur={() => blurTextField('priceMax')}
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
            {setupView === 'section' && step === 2 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <View style={styles.portfolioStatus} onLayout={rememberSetupFieldY('portfolio')}>
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
                      {proofCountText}{proofVideoText}
                    </Text>
                    {!!visibleErrors.portfolio && (
                      <Text style={styles.helperError}>{visibleErrors.portfolio}</Text>
                    )}
                    {portfolioMediaStatus ? (
                      <View style={styles.portfolioMediaStatus}>
                        <ActivityIndicator size="small" color={Colors.needleGreen} />
                        <Text style={styles.portfolioMediaStatusText}>{portfolioMediaStatus}</Text>
                      </View>
                    ) : null}
                  </View>

                  {sellerType === 'BOUTIQUE' || sellerType === 'TAILOR_SHOP' ? (
                    <View style={styles.infoBox}>
                      <Text style={styles.infoText}>
                        {readyMadeItemCount > 0
                          ? 'Ready-made item added: ' + String(readyMadeItemCount) + ' item' + (readyMadeItemCount === 1 ? '' : 's') + ' in your shop.'
                          : sellerType === 'TAILOR_SHOP'
                            ? 'Add one ready-made item so customers can inspect your shop side too.'
                            : 'Add one ready-made item customers can inspect before review.'}
                      </Text>
                      <TouchableOpacity
                        style={styles.inlineActionButton}
                        onPress={() => { void openReadyMadeItemCreator() }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.inlineActionText}>Create ready-made item</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {sellerType !== 'BOUTIQUE' ? (
                  <View style={styles.portfolioGrid}>
                    {portfolioGridEntries.map(({ item, originalIndex }, visualIndex) => (
                      <PortfolioSortableTile
                        key={`${item.type}-${item.url}-${originalIndex}`}
                        item={item}
                        index={visualIndex}
                        isCover={visualIndex === 0}
                        dragging={portfolioDragIndex === originalIndex}
                        onOpen={() => setSelectedPortfolioIndex(originalIndex)}
                        onDelete={() => removePortfolioItem(originalIndex)}
                        onDragStart={() => {
                          setPortfolioDragIndex(originalIndex)
                          setPortfolioHoverIndex(originalIndex)
                        }}
                        onDragMove={(dx, dy) => handlePortfolioDragMove(originalIndex, dx, dy)}
                        onDragEnd={(dx, dy) => handlePortfolioDragEnd(originalIndex, dx, dy)}
                      />
                    ))}
                    {uploadingMedia ? (
                      <View style={[styles.portfolioAdd, styles.portfolioPending]}>
                        <ActivityIndicator size="small" color={Colors.needleGreen} />
                        <Text style={styles.portfolioAddLabel}>Adding</Text>
                      </View>
                    ) : null}
                    {portfolioItems.length < MAX_PORTFOLIO_ITEMS && (
                      <TouchableOpacity
                        style={styles.portfolioAdd}
                        onPress={openPortfolioMediaPicker}
                        disabled={uploadingMedia}
                      >
                        <Text style={styles.portfolioAddIcon}>+</Text>
                        <Text style={styles.portfolioAddLabel}>Add media</Text>
                        <Text style={styles.portfolioAddHint}>Multi-select from library</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  ) : null}
                </View>
              </View>
            )}

            {selectedPortfolioItem ? (
              <PortfolioMediaManagerModal
                items={portfolioItems}
                index={selectedPortfolioIndex ?? 0}
                onIndexChange={setSelectedPortfolioIndex}
                onClose={() => setSelectedPortfolioIndex(null)}
                onReplace={() => {
                  if (selectedPortfolioIndex != null) {
                    const replaceIndex = selectedPortfolioIndex
                    setSelectedPortfolioIndex(null)
                    openPortfolioReplacePicker(replaceIndex)
                  }
                }}
                onDelete={() => {
                  if (selectedPortfolioIndex != null) removePortfolioItem(selectedPortfolioIndex)
                }}
              />
            ) : null}

            {/* ── Step 3: Selling setup + ID verification ── */}
            {setupView === 'section' && step === 3 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  {supportsCustomOrders ? (
                    <View>
                      <Text style={styles.fieldLabel}>Custom order status</Text>
                      <SetupSelectorCard
                        title={acceptsCustomOrdersNow ? 'Taking custom orders' : 'Custom orders paused'}
                        body={acceptsCustomOrdersNow
                          ? 'Customers can send custom briefs for quotes.'
                          : 'Your profile stays visible, but custom brief requests are paused.'}
                        meta="Custom orders"
                        onPress={() => setChoiceSheetMode('capacity')}
                      />
                    </View>
                  ) : null}

                  {supportsReadyMade ? (
                    <View>
                      <Text style={styles.fieldLabel}>Ready-made shop status</Text>
                      <SetupSelectorCard
                        title={shopPaused ? 'Shop checkout paused' : 'Shop checkout open'}
                        body={shopPaused
                          ? 'Customers can browse your items, but checkout is paused.'
                          : 'Customers can buy ready-made items when inventory is live.'}
                        meta="Shop status"
                        onPress={() => setChoiceSheetMode('shop-status')}
                      />
                    </View>
                  ) : null}

                  <View onLayout={rememberSetupFieldY('fulfillment')}>
                    <Text style={styles.fieldLabel}>How customers receive orders</Text>
                    <SetupSelectorCard
                      title={fulfillmentLabel}
                      body={fulfillmentHint}
                      meta="Customer handoff"
                      warning={!!visibleErrors.fulfillment || fulfillmentSelections.length === 0}
                      onPress={() => setChoiceSheetMode('fulfillment')}
                    />
                    {!!visibleErrors.fulfillment && (
                      <Text style={styles.helperError}>{visibleErrors.fulfillment}</Text>
                    )}
                    {pickupAvailable ? (
                      <View style={styles.fulfillmentFeeBlock} onLayout={rememberSetupFieldY('pickupAddress')}>
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
                          onFocus={() => focusTextField('pickupAddress')}
                          onBlur={() => blurTextField('pickupAddress')}
                          hint="Search and tap a suggestion to autofill, or type the full address manually. Include street or building, district or city, state or region, postal code if used, and country."
                          multiline
                        />
                        <Input
                          label="Pickup instructions (optional)"
                          placeholder="e.g. Ask for the front desk and bring your collection code."
                          value={pickupInstructions}
                          onChangeText={setPickupInstructions}
                          onFocus={() => focusTextField('pickupInstructions')}
                          onBlur={() => blurTextField('pickupInstructions')}
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
                        <Text style={styles.fieldLabel}>Drapeon-coordinated dispatch</Text>
                        <Text style={styles.fieldHint}>
                          Drapeon coordinates delivery and shipping with you when an order needs it.
                          Choose the handoff options you can support.
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View onLayout={rememberSetupFieldY('idDocument')}>
                    <Text style={styles.fieldLabel}>Identity verification</Text>
                    <Text style={styles.fieldHint}>
                      Capture a live selfie while holding your physical passport, national ID, or
                      driver's licence beside your face. Payout setup can be completed after your account is created.
                    </Text>
                    {!hasIdDocumentForSetup() || idPhotoUri ? (
                      <Input
                        label="Legal name"
                        placeholder="Exactly as shown on your ID"
                        value={legalName}
                        onChangeText={(value) => {
                          setLegalName(value)
                          setLegalNameError('')
                        }}
                        autoCapitalize="words"
                        autoCorrect={false}
                        hint="This stays private and is separate from your public display or business name."
                        error={legalNameError || undefined}
                      />
                    ) : null}
                    {idVerificationStatus === 'REJECTED' ? (
                      <View style={styles.identityRejectedCardCompact}>
                        <Text style={styles.identityRejectedTitle}>
                          {profileImageRejectionActive ? 'Profile photo needs replacement' : 'Retake guidance'}
                        </Text>
                        <Text style={styles.identityRejectedText}>{idRejectionReason || readIdentityRejectionMessage({})}</Text>
                      </View>
                    ) : null}
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
                          <Text style={styles.idExistingTitle}>Identity selfie submitted</Text>
                          <Text style={styles.idExistingHint}>Identity review is already in progress or complete for this profile.</Text>
                        </View>
                        <TouchableOpacity onPress={openIdPhotoPicker} hitSlop={8}>
                          <Text style={styles.idExistingAction}>Retake live photo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.idPickBtn, !!idError && styles.idPickBtnError]}
                        onPress={openIdPhotoPicker}
                        accessibilityRole="button"
                        accessibilityLabel="Take live identity selfie"
                      >
                        <View style={styles.idPickIconWrap}>
                          <Feather name="credit-card" size={22} color={Colors.needleGreen} />
                        </View>
                        <Text style={styles.idPickLabel}>Take live ID selfie</Text>
                        <Text style={styles.idPickHint}>
                          Face + physical ID in one live camera photo
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!!(idError || visibleErrors.idDocument) && (
                      <Text style={styles.helperError}>{idError || visibleErrors.idDocument}</Text>
                    )}
                    {idPhotoUri ? (
                      <>
                        <TouchableOpacity
                          style={styles.identityConsentRow}
                          onPress={() => {
                            setIdentityConsentGranted((current) => !current)
                            setIdentityConsentError('')
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: identityConsentGranted }}
                          accessibilityLabel="Consent to identity verification processing"
                        >
                          <View style={[
                            styles.identityConsentBox,
                            identityConsentGranted && styles.identityConsentBoxChecked,
                          ]}>
                            {identityConsentGranted ? (
                              <Feather name="check" size={15} color={Colors.white} />
                            ) : null}
                          </View>
                          <Text style={styles.identityConsentCopy}>{IDENTITY_CONSENT_COPY}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { void Linking.openURL('https://drapeon.co/privacy') }}
                          accessibilityRole="link"
                          accessibilityLabel="Read Drapeon privacy policy"
                        >
                          <Text style={styles.identityPrivacyLink}>Read the Privacy Policy</Text>
                        </TouchableOpacity>
                        {identityConsentError ? (
                          <Text style={styles.helperError}>{identityConsentError}</Text>
                        ) : null}
                      </>
                    ) : null}
                  </View>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* CTA */}
        <View style={[styles.cta, editingLayoutActive && styles.ctaCompact, { paddingBottom: ctaBottomPadding }]}>
          <Button
            label={primaryCtaLabel}
            onPress={next}
            loading={saving || uploadingId || uploadingMedia || phoneAvailabilityChecking || phoneOtpSending || phoneOtpVerifying}
            disabled={saving || uploadingId || uploadingMedia || phoneAvailabilityChecking || phoneOtpSending || phoneOtpVerifying}
          />
          {setupView === 'hub' && !editingLayoutActive && (
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
          {setupView === 'section' && stepBlockingNote && !editingLayoutActive ? (
            <Text style={styles.minNote}>{stepBlockingNote}</Text>
          ) : null}
        </View>
        <MediaChoiceSheet
          mode={mediaSheetMode}
          onClose={() => {
            setMediaSheetMode(null)
            setPortfolioReplaceIndex(null)
          }}
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
          videoLimitReached={portfolioVideoLimitReached}
        />
        <SetupChoiceSheet
          mode={choiceSheetMode}
          onClose={() => setChoiceSheetMode(null)}
          sellerType={sellerType}
          acceptsCustomOrdersNow={acceptsCustomOrdersNow}
          shopPaused={shopPaused}
          pickupAvailable={pickupAvailable}
          deliveryAvailable={deliveryAvailable}
          shippingAvailable={shippingAvailable}
          currency={currency}
          onSellerType={(value) => {
            applySellerType(value)
            setChoiceSheetMode(null)
          }}
          onToggleCustomOrdersNow={() => {
            setAcceptsCustomOrdersNow((value) => !value)
          }}
          onToggleShopPaused={() => {
            setShopPaused((value) => !value)
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
        <PhoneOtpModal
          visible={phoneOtpVisible}
          phone={normalizePhoneForStorage(phone)}
          code={phoneOtpCode}
          error={phoneOtpError}
          sending={phoneOtpSending}
          verifying={phoneOtpVerifying}
          onChangeCode={(value) => {
            setPhoneOtpCode(value.replace(/\D/g, '').slice(0, 6))
            if (phoneOtpError) setPhoneOtpError('')
          }}
          onVerify={verifyPhoneOtpCode}
          onResend={resendPhoneOtpCode}
          onClose={() => {
            phoneOtpAfterVerifyRef.current = null
            setPhoneOtpVisible(false)
            setPhoneOtpCode('')
            setPhoneOtpError('')
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function PhoneOtpModal({
  visible,
  phone,
  code,
  error,
  sending,
  verifying,
  onChangeCode,
  onVerify,
  onResend,
  onClose,
}: {
  visible: boolean
  phone: string
  code: string
  error: string
  sending: boolean
  verifying: boolean
  onChangeCode: (value: string) => void
  onVerify: () => void
  onResend: () => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.otpOverlay}>
        <TouchableOpacity style={styles.otpScrim} activeOpacity={1} onPress={onClose} />
        <View style={styles.otpCard}>
          <View style={styles.otpHeader}>
            <View style={styles.otpIcon}>
              <Feather name="shield" size={18} color={Colors.needleGreen} />
            </View>
            <TouchableOpacity style={styles.otpClose} onPress={onClose} accessibilityLabel="Close phone verification">
              <Feather name="x" size={20} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
          <Text style={styles.otpTitle}>Verify phone number</Text>
          <Text style={styles.otpBody}>
            Enter the 6-digit code sent to {phone}. This keeps random numbers off Drapeon accounts.
          </Text>
          <TextInput
            value={code}
            onChangeText={onChangeCode}
            placeholder="000000"
            placeholderTextColor={Colors.midGrey}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            style={[styles.otpInput, !!error && styles.otpInputError]}
            editable={!verifying}
            autoFocus
          />
          {!!error && <Text style={styles.otpError}>{error}</Text>}
          <View style={styles.otpActions}>
            <Button
              label="Verify code"
              onPress={onVerify}
              loading={verifying}
              disabled={verifying || sending || code.length !== 6}
            />
            <Button
              label={sending ? 'Sending...' : 'Resend code'}
              onPress={onResend}
              variant="secondary"
              size="md"
              loading={sending}
              disabled={sending || verifying}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

function PortfolioSortableTile({
  item,
  index,
  isCover,
  dragging,
  onOpen,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: PortfolioItem
  index: number
  isCover: boolean
  dragging: boolean
  onOpen: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragMove: (dx: number, dy: number) => void
  onDragEnd: (dx: number, dy: number) => void
}) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragActiveRef = useRef(false)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const opacityAnim = useRef(new Animated.Value(1)).current
  // Stable callback refs so the PanResponder (created once) always calls current props
  const onDragStartRef = useRef(onDragStart)
  const onDragMoveRef = useRef(onDragMove)
  const onDragEndRef = useRef(onDragEnd)
  const onOpenRef = useRef(onOpen)
  onDragStartRef.current = onDragStart
  onDragMoveRef.current = onDragMove
  onDragEndRef.current = onDragEnd
  onOpenRef.current = onOpen

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragActiveRef.current = false
          longPressTimerRef.current = setTimeout(() => {
            dragActiveRef.current = true
            Vibration.vibrate(30)
            onDragStartRef.current()
            Animated.spring(scaleAnim, { toValue: 1.05, useNativeDriver: true, friction: 6, tension: 200 }).start()
            Animated.spring(opacityAnim, { toValue: 0.7, useNativeDriver: true, friction: 6, tension: 200 }).start()
          }, 400)
        },
        onPanResponderMove: (_, gesture) => {
          if (!dragActiveRef.current && (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5)) {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
            return
          }
          if (dragActiveRef.current) {
            onDragMoveRef.current(gesture.dx, gesture.dy)
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          const wasDrag = dragActiveRef.current
          dragActiveRef.current = false
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          Animated.spring(opacityAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          if (wasDrag) {
            onDragEndRef.current(gesture.dx, gesture.dy)
          } else {
            onOpenRef.current()
          }
        },
        onPanResponderTerminate: (_, gesture) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          const wasDrag = dragActiveRef.current
          dragActiveRef.current = false
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          Animated.spring(opacityAnim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 200 }).start()
          if (wasDrag) {
            onDragEndRef.current(gesture.dx, gesture.dy)
          }
        },
      }),
    []
  )

  return (
    <View style={styles.portfolioThumb}>
      <Animated.View
        style={[
          styles.portfolioThumbPress,
          dragging && styles.portfolioThumbDragging,
          { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        ]}
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={`Open portfolio media ${index + 1}`}
      >
        {item.type === 'photo' ? (
          <RemoteImage
            uri={item.url}
            style={styles.portfolioImg}
            contentFit="cover"
            contentPosition="top"
            transition={120}
            surface="tailor_setup_portfolio_preview"
          />
        ) : (
          <View style={[styles.portfolioImg, styles.videoThumb]}>
            <PortfolioVideoPreview uri={item.url} style={styles.portfolioImg} autoplay={false} />
            <View style={styles.videoBadge}>
              <Feather name="play" size={12} color={Colors.textInverse} />
              <Text style={styles.videoLabel}>Video</Text>
            </View>
          </View>
        )}
        {isCover ? (
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeText}>Cover</Text>
          </View>
        ) : null}
        {dragging ? (
          <View style={styles.portfolioDragBadge}>
            <Text style={styles.portfolioDragBadgeText}>Drop to reorder</Text>
          </View>
        ) : null}
      </Animated.View>
      <TouchableOpacity
        style={styles.portfolioRemove}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Remove portfolio media"
      >
        <Text style={styles.portfolioRemoveText}>x</Text>
      </TouchableOpacity>
    </View>
  )
}

function PortfolioMediaManagerModal({
  items,
  index,
  onIndexChange,
  onClose,
  onReplace,
  onDelete,
}: {
  items: PortfolioItem[]
  index: number
  onIndexChange: (index: number | null) => void
  onClose: () => void
  onReplace: () => void
  onDelete: () => void
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const pageWidth = Math.max(280, width - Spacing.lg * 2)
  const activeIndex = Math.max(0, Math.min(index, items.length - 1))
  const activeItem = items[activeIndex] ?? null
  const listRef = useRef<FlatList<PortfolioItem> | null>(null)

  useEffect(() => {
    if (!activeItem) return
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: activeIndex, animated: false })
    })
  }, [activeIndex, activeItem, pageWidth])

  if (!activeItem) return null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mediaManagerOverlay}>
        <TouchableOpacity style={styles.mediaManagerScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.mediaManagerSheet, { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.mediaManagerHeader}>
            <View>
              <Text style={styles.mediaManagerEyebrow}>Portfolio media</Text>
              <Text style={styles.mediaManagerTitle}>
                {activeIndex === 0 ? 'Cover media' : `Media ${activeIndex + 1} of ${items.length}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close media preview">
              <Text style={styles.sheetCloseText}>x</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.mediaManagerPreview, { width: pageWidth }]}>
            <FlatList
              ref={listRef}
              data={items}
              keyExtractor={(item, itemIndex) => `${item.type}-${item.url}-${itemIndex}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={activeIndex}
              getItemLayout={(_, itemIndex) => ({ length: pageWidth, offset: pageWidth * itemIndex, index: itemIndex })}
              onScrollToIndexFailed={() => undefined}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth)
                onIndexChange(Math.max(0, Math.min(items.length - 1, nextIndex)))
              }}
              renderItem={({ item, index: itemIndex }) => (
                <View style={[styles.mediaManagerCarouselPage, { width: pageWidth }]}>
                  {item.type === 'photo' ? (
                    <RemoteImage
                      uri={item.url}
                      style={styles.mediaManagerPreviewMedia}
                      contentFit="cover"
                      contentPosition="top"
                      transition={120}
                      surface="tailor_setup_portfolio_manager"
                    />
                  ) : (
                    <PortfolioVideoPreview
                      uri={item.url}
                      style={styles.mediaManagerPreviewMedia}
                      contentFit="contain"
                      nativeControls
                      autoplay={itemIndex === activeIndex}
                    />
                  )}
                </View>
              )}
            />
          </View>

          <View style={styles.mediaManagerDots}>
            {items.map((item, itemIndex) => (
              <View
                key={`${item.type}-${item.url}-${itemIndex}-dot`}
                style={[styles.mediaManagerDot, itemIndex === activeIndex && styles.mediaManagerDotActive]}
              />
            ))}
          </View>

          <Text style={styles.mediaManagerHint}>Drag thumbnails in the grid to change the cover and order.</Text>

          <View style={styles.mediaManagerActions}>
            <View style={styles.mediaManagerActionRow}>
              <TouchableOpacity style={[styles.mediaManagerAction, styles.mediaManagerActionCompact]} onPress={onReplace} activeOpacity={0.82}>
                <Feather name="refresh-cw" size={16} color={Colors.needleGreen} />
                <Text style={styles.mediaManagerActionText}>Replace</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.mediaManagerAction, styles.mediaManagerActionCompact, styles.mediaManagerActionDestructive]} onPress={onDelete} activeOpacity={0.82}>
                <Feather name="trash-2" size={16} color={Colors.kanteRust} />
                <Text style={[styles.mediaManagerActionText, styles.mediaManagerActionTextDestructive]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
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
  sellerType,
  acceptsCustomOrdersNow,
  shopPaused,
  pickupAvailable,
  deliveryAvailable,
  shippingAvailable,
  currency,
  onSellerType,
  onToggleCustomOrdersNow,
  onToggleShopPaused,
  onTogglePickup,
  onToggleDelivery,
  onToggleShipping,
  onCurrency,
}: {
  mode: SetupChoiceSheetMode
  onClose: () => void
  sellerType: SellerType
  acceptsCustomOrdersNow: boolean
  shopPaused: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  currency: (typeof SUPPORTED_CURRENCIES)[number]
  onSellerType: (value: SellerType) => void
  onToggleCustomOrdersNow: () => void
  onToggleShopPaused: () => void
  onTogglePickup: () => void
  onToggleDelivery: () => void
  onToggleShipping: () => void
  onCurrency: (value: (typeof SUPPORTED_CURRENCIES)[number]) => void
}) {
  const insets = useSafeAreaInsets()
  const visible = mode !== null
  const sheetBottomPadding = Math.max(insets.bottom + Spacing.lg, Spacing.xxl)
  const title =
    mode === 'seller-type'
      ? 'Business type'
      : mode === 'capacity'
        ? 'Custom order status'
        : mode === 'shop-status'
          ? 'Ready-made shop status'
          : mode === 'fulfillment'
            ? 'Customer handoff'
            : 'Pricing currency'
  const body =
    mode === 'seller-type'
      ? 'Pick the description that best matches how your business works.'
      : mode === 'capacity'
        ? 'Pause or reopen custom brief requests without hiding your profile.'
        : mode === 'shop-status'
          ? 'Pause or reopen checkout for ready-made inventory.'
          : mode === 'fulfillment'
            ? 'Choose how customers receive orders. Drapeon coordinates delivery and shipping details with you.'
            : 'Choose the currency customers see on your public profile price guide.'
  const isMulti = mode === 'fulfillment'

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

            {mode === 'capacity' ? (
              <>
                <ChoiceSheetRow
                  title="Taking custom orders"
                  body="Customers can send custom briefs for quotes."
                  selected={acceptsCustomOrdersNow}
                  onPress={onToggleCustomOrdersNow}
                />
                <ChoiceSheetRow
                  title="Custom orders paused"
                  body="Your profile stays visible, but custom brief requests are paused."
                  selected={!acceptsCustomOrdersNow}
                  onPress={onToggleCustomOrdersNow}
                />
              </>
            ) : null}

            {mode === 'shop-status' ? (
              <>
                <ChoiceSheetRow
                  title="Shop checkout open"
                  body="Customers can buy ready-made items when inventory is live."
                  selected={!shopPaused}
                  onPress={onToggleShopPaused}
                />
                <ChoiceSheetRow
                  title="Shop checkout paused"
                  body="Customers can browse your items, but checkout is paused."
                  selected={shopPaused}
                  onPress={onToggleShopPaused}
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
                  body="Drapeon coordinates nearby delivery with you."
                  selected={deliveryAvailable}
                  onPress={onToggleDelivery}
                  multi
                />
                <ChoiceSheetRow
                  title="Shipping"
                  body="Drapeon coordinates courier shipping with you."
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
        : 'Identity selfie'
  const body =
    mode === 'profile-photo'
      ? 'Use a clear face photo customers can recognize before they book you.'
      : mode === 'portfolio-media'
        ? 'Add real work samples. Photos build trust fastest; short videos help with movement and finish.'
        : 'Take one live selfie while holding your passport, national ID, or driver’s licence beside your face.'

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
                body={
                  videoLimitReached
                    ? 'Video limit reached for this portfolio.'
                    : `Record up to ${MAX_PORTFOLIO_VIDEO_SECONDS} seconds.`
                }
                onPress={() => onPortfolioMedia('camera-video')}
                disabled={videoLimitReached}
              />
            </>
          ) : null}

          {mode === 'id-document' ? (
            <>
              <SheetOption title="Capture live selfie + ID" body="Camera only. Hold the physical ID beside your face." onPress={() => onIdDocument('camera')} />
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
  setupToast: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  setupToastSuccess: {
    backgroundColor: Colors.needleGreenLight,
    borderColor: Colors.needleGreen + '33',
  },
  setupToastError: {
    backgroundColor: Colors.errorLight,
    borderColor: Colors.kanteRust,
  },
  setupToastText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    lineHeight: 20,
    textAlign: 'center',
  },
  setupToastTextSuccess: { color: Colors.needleGreen },
  setupToastTextError: { color: Colors.kanteRust },
  otpOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  otpScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 12, 11, 0.38)',
  },
  otpCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.md,
  },
  otpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  otpIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  otpClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  otpTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  otpBody: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 22,
  },
  otpInput: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    fontSize: 24,
    letterSpacing: 4,
    color: Colors.ink,
    fontFamily: Fonts.bodyBold,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    backgroundColor: Colors.white,
  },
  otpInputError: {
    borderColor: Colors.kanteRust,
  },
  otpError: {
    color: Colors.kanteRust,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  otpActions: {
    gap: Spacing.sm,
  },

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
  setupChecklistRowDeferred: { opacity: 0.62 },
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
  identityRejectedCard: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.kanteRust,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  identityRejectedCardCompact: {
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.kanteRust,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  identityRejectedTitle: {
    fontSize: FontSize.sm,
    color: Colors.kanteRust,
    fontWeight: FontWeight.bold,
  },
  identityRejectedText: {
    fontSize: FontSize.xs,
    color: Colors.kanteRust,
    lineHeight: 18,
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
  profilePhotoPickerRejected: {
    borderColor: Colors.kanteRust,
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
  profilePhotoPreviewRejected: {
    borderWidth: 2,
    borderColor: Colors.kanteRust,
  },
  profilePhotoRejectedBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.kanteRust,
    color: Colors.textInverse,
    textAlign: 'center',
    fontSize: 9,
    fontWeight: FontWeight.bold,
    paddingVertical: 2,
  },
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
  profilePhotoHintRejected: {
    color: Colors.kanteRust,
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
  portfolioMediaStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '24',
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  portfolioMediaStatusText: {
    flex: 1,
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioThumb: {
    width: 100,
    height: 100,
    borderRadius: Radius.md,
    position: 'relative',
  },
  portfolioThumbDragging: {
    borderWidth: 2,
    borderColor: Colors.needleGreen,
  },
  portfolioThumbPress: { width: '100%', height: '100%', overflow: 'hidden', borderRadius: Radius.md },
  portfolioImg: { width: '100%', height: '100%' },
  videoThumb: {
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.ink,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  videoLabel: { fontSize: 10, color: Colors.textInverse, fontWeight: FontWeight.semibold },
  coverBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  coverBadgeText: {
    fontSize: 10,
    color: Colors.textInverse,
    fontWeight: FontWeight.bold,
  },
  portfolioDragBadge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.ink + 'CC',
    paddingHorizontal: 7,
    paddingVertical: 4,
    alignItems: 'center',
  },
  portfolioDragBadgeText: {
    fontSize: 9,
    color: Colors.textInverse,
    fontWeight: FontWeight.bold,
  },
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
  portfolioPending: {
    borderStyle: 'solid',
    borderColor: Colors.needleGreen + '40',
    backgroundColor: Colors.needleGreenLight,
  },
  mediaManagerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  mediaManagerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  mediaManagerSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  mediaManagerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  mediaManagerEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
  },
  mediaManagerTitle: {
    fontSize: FontSize.lg,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  mediaManagerPreview: {
    height: 320,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  mediaManagerPreviewMedia: {
    width: '100%',
    height: '100%',
  },
  mediaManagerCarouselPage: {
    height: '100%',
  },
  mediaManagerDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  mediaManagerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.lightGrey,
  },
  mediaManagerDotActive: {
    width: 18,
    backgroundColor: Colors.needleGreen,
  },
  mediaManagerHint: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.midGrey,
    textAlign: 'center',
  },
  mediaManagerActions: {
    gap: Spacing.sm,
  },
  mediaManagerActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  mediaManagerAction: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  mediaManagerActionCompact: {
    flex: 1,
  },
  mediaManagerActionDisabled: {
    backgroundColor: Colors.bone,
    opacity: 0.72,
  },
  mediaManagerActionDestructive: {
    borderColor: Colors.kanteRust + '24',
    backgroundColor: Colors.kanteRustLight,
  },
  mediaManagerActionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
  },
  mediaManagerActionTextDisabled: {
    color: Colors.midGrey,
  },
  mediaManagerActionTextDestructive: {
    color: Colors.kanteRust,
  },

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
  idPickIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
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
  identityConsentRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  identityConsentBox: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.midGrey,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  identityConsentBoxChecked: {
    backgroundColor: Colors.needleGreen,
    borderColor: Colors.needleGreen,
  },
  identityConsentCopy: {
    flex: 1,
    color: Colors.inkLight,
    fontSize: FontSize.xs,
    lineHeight: 19,
  },
  identityPrivacyLink: {
    minHeight: 44,
    paddingVertical: Spacing.sm,
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
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
  inlineActionButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  inlineActionText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  currencyProviderNote: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },

  cta: {
    padding: Spacing.xl,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    gap: Spacing.sm,
  },
  ctaCompact: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    gap: 0,
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
