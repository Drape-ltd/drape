import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TextInput,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Feather } from '@expo/vector-icons'
import {
  isLikelyConnectivityIssue,
  isMachineErrorCodeMessage,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo, resetTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import {
  buildOrderFitProfile,
  COVERAGE_PREFERENCE_LABELS,
  enrichMeasurementSnapshot,
  FABRIC_HANDOFF_LABELS,
  FABRIC_STRETCH_LABELS,
  FIT_INTENT_LABELS,
  getAdditionalMeasurementRows,
  MEASUREMENT_SOURCE_LABELS,
  MEASUREMENT_SCAN_STATUS_LABELS,
  WEAR_DAY_SUPPORT_LABELS,
  labelFitContextFlag,
  type FabricHandoffMode,
} from '@/lib/order-support'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import { composeStructuredAddress } from '@/lib/address'
import { stripExif } from '@/lib/stripExif'
import { createValidatedUploadPayload, uploadPublicStorageImage } from '@/lib/storage-upload'
import {
  Button,
  AddressAutocompleteInput,
  ChoiceSheet,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  Input,
  KeyboardAwareScrollView,
  MoneyInput,
  MeasurementModule,
  PhoneNumberInput,
  PortfolioVideoPreview,
  RemoteImage,
} from '@/components/ui'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import {
  launchImagePickerSafely,
  preferCompatibleVideoRepresentation,
  preferCurrentAssetRepresentation,
} from '@/lib/image-picker-safe'
import { useKeyboardState } from '@/lib/useKeyboardState'
import {
  pickerVideoContentType,
  pickerVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/currency'
import {
  CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS,
  CUSTOM_ORDER_DRAFT_VERSION,
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_GARMENT_TAXONOMY,
  CUSTOM_ORDER_GENDER_PRESENTATIONS,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  CUSTOM_ORDER_RESUMABLE_STAGES,
  CUSTOM_ORDER_SHIPPING_PREFERENCES,
  CUSTOM_ORDER_STYLE_ATTRIBUTES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  BULK_FABRIC_MODE_OPTIONS,
  FABRIC_SUBSTITUTION_OPTIONS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  MEDIA_CACHE_CONTROL_SECONDS,
  ORDER_CANCELLATION_ACK_COPY,
  ORDER_CANCELLATION_POLICY_ROWS,
  customOrderDefaultDeadline,
  customOrderMinimumDeliveryDate,
  getCustomOrderFabricIssues,
  isAllowedCustomStyleReference,
  isCustomOrderBriefLongEnough,
  isMeaningfulCustomOrderDraft,
  measurementCoreCompleteness,
  hasCustomOrderMeasurementFallback,
  missingCustomOrderMeasurements,
  normalizeAccountCurrency,
  parseMajorCurrencyAmountToMinor,
  promoteSpecialistMeasurementsToProfileValues,
  stripDrapeVisionFit360DraftFields,
} from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import {
  fulfillmentEligibilityCopy,
  type FulfillmentEligibilityResult,
} from '@drape/shared/fulfillment-eligibility'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared/phone'
import { phoneHintForContext } from '@/lib/phone-context'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const MEAS_PROMPT_KEY = 'drape_meas_prompt_shown'

// ─── Types ────────────────────────────────────────────────────────────────────

type FabricSource = 'CUSTOMER_SUPPLIES' | 'TAILOR_SOURCES'
type MediaPickerSource = 'camera' | 'library'
type DeliveryMethod = 'SHIPPING' | 'LOCAL_DELIVERY' | 'LOCAL_COLLECTION'
type RecipientMode = 'SELF' | 'OTHER'
type WearerMode = 'SELF' | 'OTHER'
type GenderPresentation = (typeof CUSTOM_ORDER_GENDER_PRESENTATIONS)[number]
type ShippingPreference = (typeof CUSTOM_ORDER_SHIPPING_PREFERENCES)[number]
type MeasurementRecord = Record<string, unknown>
type MeasurementProfileRow = {
  id: string
  label: string
  relationship: string | null
  measurements: MeasurementRecord | null
  unit_preference: string | null
  source: string | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}
type BriefMediaAsset = {
  id: string
  uri: string
  kind: 'photo' | 'video'
  contentType?: string
  extension?: string
}

type FabricSubstitutionPreference = (typeof FABRIC_SUBSTITUTION_OPTIONS)[number]['value']
type BulkFabricMode = (typeof BULK_FABRIC_MODE_OPTIONS)[number]['value']

const MAX_FABRIC_REFERENCE_MEDIA = 4
const FABRIC_REFERENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.portfolioVideo
const FABRIC_REFERENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.portfolioVideo

const FABRIC_HANDOFF_OPTIONS: Array<{ value: FabricHandoffMode; title: string; hint: string }> = [
  {
    value: 'CUSTOMER_SHIPS_TO_TAILOR',
    title: 'I will ship the fabric',
    hint: 'You send fabric to the tailor and can save tracking details inside the order.',
  },
  {
    value: 'CUSTOMER_DROPS_OFF_LOCALLY',
    title: 'I will drop it off locally',
    hint: 'Best when you and the tailor can meet for a direct handoff.',
  },
  {
    value: 'TAILOR_PICKS_UP_LOCALLY',
    title: 'Tailor will pick it up',
    hint: 'Use this when the tailor is collecting fabric from you locally.',
  },
  {
    value: 'BRINGS_TO_CONSULTATION',
    title: 'I will bring it to consultation',
    hint: 'Useful when you expect to hand it over during a fitting or consultation.',
  },
]

const FIT_NOTE_PRESETS = [
  'Relaxed fit preferred',
  'Fitted look preferred',
  'I need this before my event',
  'I have broad shoulders',
  'Please keep it modest',
] as const

const STEP_TITLES = [
  'Garment details',
  'Style references',
  'Measurements',
  'Fabric',
  'Delivery',
  'Review',
]
const STEP_SUBS = [
  'Tell the seller exactly what you want to make, what it is for, and when you need it by.',
  'Show visual references so the seller can understand your taste, shape, and finishing direction faster.',
  'Share the fit context your maker needs to quote accurately and make the garment feel right on your body.',
  'Choose who provides fabric and set the approval checkpoint before cutting begins.',
  'Choose how the finished garment gets to you and keep delivery details structured.',
  'Check every detail before sending. You can jump back to edit any section.',
]

const SUPPORTED_STYLE_LINK_LABELS = ['Instagram posts / reels', 'Pinterest pins', 'TikTok videos']
const STALE_MEASUREMENT_MONTHS = 6
const DRAPE_VISION_FIT_360_CAPTURE_METHOD = 'DRAPE_VISION_ROTATION'
const GROUP_ORDERS_ENABLED = MOBILE_FEATURE_FLAGS.groupOrdersV1

type MeasurementAgeSummary = {
  lastUpdatedAt: string
  ageMonths: number
  stale: boolean
  label: string
}

function buildBriefRoute(
  tailorId: string,
  options?: { draftSession?: string | null; resumeDraft?: boolean; historyChain?: string | null }
) {
  const search = new URLSearchParams()
  if (options?.draftSession) search.set('draftSession', options.draftSession)
  if (options?.resumeDraft) search.set('resumeDraft', '1')
  if (options?.historyChain) search.set('historyChain', options.historyChain)
  const query = search.toString()
  return query.length > 0
    ? `/(customer)/brief/${tailorId}?${query}`
    : `/(customer)/brief/${tailorId}`
}

function defaultDeadline() {
  return customOrderDefaultDeadline()
}

function deadlineContextNotice(value: Date | null) {
  if (!value) return null
  const month = value.getMonth()
  const day = value.getDate()
  const inDecemberRush = month === 11 && day >= 15
  const inNewYearRush = month === 0 && day <= 7
  const nearIndependenceDay = month === 9 && day >= 1 && day <= 3
  if (!inDecemberRush && !inNewYearRush && !nearIndependenceDay) return null
  return 'This date falls around a busy holiday period. Add buffer for fabric sourcing, courier availability, and last-mile delays if the garment is event-critical.'
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function isRecord(value: unknown): value is MeasurementRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFit360VisionProfile(measurements: MeasurementRecord) {
  const latestFitProfile = isRecord(measurements.latestFitProfile) ? measurements.latestFitProfile : null
  return measurements.captureMethod === DRAPE_VISION_FIT_360_CAPTURE_METHOD ||
    latestFitProfile?.captureMethod === DRAPE_VISION_FIT_360_CAPTURE_METHOD ||
    measurements.scanFlow === 'FIT_TURN_360_V1' ||
    latestFitProfile?.scanFlow === 'FIT_TURN_360_V1'
}

function normalizeLoadedMeasurementProfile(measurements: MeasurementRecord | null | undefined) {
  if (!measurements) return null
  const promoted = promoteSpecialistMeasurementsToProfileValues(measurements).measurements
  if (!isFit360VisionProfile(promoted)) return promoted
  return stripDrapeVisionFit360DraftFields(promoted)
}

function hasCompleteMeasurementProfile(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const measurement = value as MeasurementRecord
  const coreFields = measurementCoreCompleteness(measurement).present.map((field) => field.key)
  const hasChestAndWaist = coreFields.includes('chest') && coreFields.includes('waist')
  const hasVisionCore =
    hasChestAndWaist &&
    (coreFields.includes('hips') || coreFields.includes('shoulderWidth') || coreFields.includes('height'))
  const hasFitStyle = typeof measurement.fitStyle === 'string'
  const hasContext =
    typeof measurement.garmentContext === 'string' && measurement.garmentContext.length > 0
  const bodyShapes = Array.isArray(measurement.bodyShape)
    ? measurement.bodyShape
    : measurement.bodyShape
      ? [measurement.bodyShape]
      : []
  const hasManualProfileContext = hasFitStyle && hasContext && bodyShapes.length > 0
  return hasChestAndWaist && (hasManualProfileContext || hasVisionCore)
}

function measurementTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const measurement = value as MeasurementRecord
  const fields = ['measurementProfileUpdatedAt', 'capturedAt', 'confirmedAt']
  for (const field of fields) {
    const raw = measurement[field]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const date = new Date(raw)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}

function measurementAgeFromSnapshot(value: unknown, now = new Date()): MeasurementAgeSummary | null {
  const lastUpdated = measurementTimestamp(value)
  if (!lastUpdated) return null
  const ageMonths = Math.max(
    0,
    Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
  )
  return {
    lastUpdatedAt: lastUpdated.toISOString(),
    ageMonths,
    stale: ageMonths >= STALE_MEASUREMENT_MONTHS,
    label:
      ageMonths <= 0
        ? 'Updated this month'
        : `Updated ${ageMonths} month${ageMonths === 1 ? '' : 's'} ago`,
  }
}

function createBriefMediaPath(
  userId: string | undefined,
  folder: 'style' | 'fabric',
  extension: string,
) {
  const owner = userId ?? 'guest'
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `briefs/${owner}/${folder}/${suffix}.${extension.replace(/[^a-z0-9]/gi, '') || 'jpg'}`
}

function createBriefPhotoPath(userId: string | undefined) {
  return createBriefMediaPath(userId, 'style', 'jpg')
}

function createBriefMediaId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function resolveOrderSubmitErrorMessage(error: Error | null) {
  const fallback = 'Could not submit your order. Please try again.'
  const safeMessage = await readFunctionErrorMessage(error, fallback)
  const rawMessage = safeMessage || fallback
  const normalized = rawMessage.toLowerCase()

  if (normalized.includes('delivery address is required')) {
    return 'Add your full delivery address before submitting this order.'
  }

  if (normalized.includes('recipient name is required')) {
    return 'Add the recipient name before submitting this order.'
  }

  if (normalized.includes('recipient phone is required')) {
    return 'Add the recipient phone before submitting this order.'
  }

  if (normalized.includes('seller not found')) {
    return 'This tailor profile is no longer available. Go back and choose another seller.'
  }

  if (
    normalized.includes('fabric_handoff_required') ||
    normalized.includes('how your fabric will reach them')
  ) {
    return 'Choose how your fabric will reach the tailor before submitting this order.'
  }

  if (normalized.includes('not accepting custom orders right now')) {
    return 'This tailor is not accepting custom orders right now. Refresh their profile before trying again.'
  }

  if (normalized.includes('too many order attempts') || normalized.includes('too many requests')) {
    return 'You have tried a few times quickly. Wait a moment, then submit again.'
  }

  if (normalized.includes('sign in again')) {
    return 'Your session has expired. Sign in again before placing this order.'
  }

  if (normalized.includes("contact details can't be included")) {
    return 'Remove phone numbers, social handles, or off-platform contact details from your brief before sending it. Fit measurements like bust, waist, and hips are still fine.'
  }

  return isMachineErrorCodeMessage(rawMessage) ? fallback : rawMessage
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderBriefScreen() {
  const { tailorId, returnTo, historyChain, draftSession, freshStart, resumeDraft } = useLocalSearchParams<{
    tailorId: string
    returnTo?: string
    historyChain?: string
    draftSession?: string
    freshStart?: string
    resumeDraft?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardState()
  const actionDockScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const userId = user?.id

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      `/(customer)/tailor/${tailorId}`,
    )
  }

  function buildResumeBriefReturnParams() {
    const returnTarget = buildBriefRoute(tailorId, { draftSession, resumeDraft: true })
    return {
      returnTo: returnTarget,
      historyChain: appendToHistory(historyChain, returnTarget),
    }
  }

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [cancellationPolicyAcknowledged, setCancellationPolicyAcknowledged] = useState(false)
  const [showMeasPrompt, setShowMeasPrompt] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [draftStatus, setDraftStatus] = useState<'loading' | 'restored' | 'saving' | 'saved' | 'error' | null>(null)
  const [draftAttachmentWarning, setDraftAttachmentWarning] = useState(false)
  const draftLoadStartedRef = useRef(false)
  const draftHydratedRef = useRef(false)

  // Step 1
  const [garmentType, setGarmentType] = useState('')
  const [garmentTypeOther, setGarmentTypeOther] = useState('')
  const [showGarmentPicker, setShowGarmentPicker] = useState(false)
  const [showFocusAreasPicker, setShowFocusAreasPicker] = useState(false)
  const [garmentSearch, setGarmentSearch] = useState('')
  const [genderPresentation, setGenderPresentation] = useState<GenderPresentation | null>(null)
  const [description, setDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [occasion, setOccasion] = useState('')
  const [deadline, setDeadline] = useState<Date | null>(() => defaultDeadline())
  const [deadlineError, setDeadlineError] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [isBulkOrder, setIsBulkOrder] = useState(false)
  const [bulkRecipientCount, setBulkRecipientCount] = useState('')
  const [bulkLabel, setBulkLabel] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkMemberNames, setBulkMemberNames] = useState('')
  const [wearerMode, setWearerMode] = useState<WearerMode>('SELF')
  const [wearerName, setWearerName] = useState('')

  // Step 2
  const [photos, setPhotos] = useState<string[]>([])
  const [inspirationLinks, setInspirationLinks] = useState<string[]>([])
  const [inspirationInput, setInspirationInput] = useState('')
  const [linkError, setLinkError] = useState('')
  const [styleNotes, setStyleNotes] = useState('')
  const [styleAttributes, setStyleAttributes] = useState<string[]>([])

  // Step 3 — measurement profile summary
  const [measurements, setMeasurements] = useState<MeasurementRecord | null>(null)
  const [measurementProfiles, setMeasurementProfiles] = useState<MeasurementProfileRow[]>([])
  const [measurementProfileSheetOpen, setMeasurementProfileSheetOpen] = useState(false)
  const [measurementReviewOpen, setMeasurementReviewOpen] = useState(false)
  const [fitNote, setFitNote] = useState('')
  const [fitNoteError, setFitNoteError] = useState('')

  // Inline measurement editing
  const [editingField, setEditingField] = useState<{
    key: string
    label: string
    value: string
  } | null>(null)
  const [editValue, setEditValue] = useState('')

  // Step 4
  const [fabricSource, setFabricSource] = useState<FabricSource | null>(null)
  const [fabricHandoffMode, setFabricHandoffMode] = useState<FabricHandoffMode | null>(null)
  const [fabricDescription, setFabricDescription] = useState('')
  const [fabricBudgetAmount, setFabricBudgetAmount] = useState('')
  const [fabricBudgetCurrency, setFabricBudgetCurrency] = useState<CurrencyCode>('USD')
  const [fabricCurrencySheetOpen, setFabricCurrencySheetOpen] = useState(false)
  const [fabricReferenceMedia, setFabricReferenceMedia] = useState<BriefMediaAsset[]>([])
  const [fabricReferenceLinks, setFabricReferenceLinks] = useState<string[]>([])
  const [fabricReferenceInput, setFabricReferenceInput] = useState('')
  const [fabricReferenceLinkError, setFabricReferenceLinkError] = useState('')
  const [fabricSubstitutionPreference, setFabricSubstitutionPreference] =
    useState<FabricSubstitutionPreference | null>(null)
  const [bulkFabricMode, setBulkFabricMode] = useState<BulkFabricMode | null>(null)
  const [fabricVendorName, setFabricVendorName] = useState('')
  const [fabricVendorLocation, setFabricVendorLocation] = useState('')
  const [fabricVendorLink, setFabricVendorLink] = useState('')
  const [fabricVendorNotes, setFabricVendorNotes] = useState('')
  const [fabricVendorLinkError, setFabricVendorLinkError] = useState('')
  const [fabricSourcingDeadlineDays, setFabricSourcingDeadlineDays] = useState(
    CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS
  )
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | null>(null)
  const [shippingPreference, setShippingPreference] = useState<ShippingPreference>('STANDARD')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [deliveryAddressLine1, setDeliveryAddressLine1] = useState('')
  const [deliveryAddressLine2, setDeliveryAddressLine2] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryStateRegion, setDeliveryStateRegion] = useState('')
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('')
  const [deliveryCountry, setDeliveryCountry] = useState('')
  const [deliveryVerificationSource, setDeliveryVerificationSource] = useState('')
  const [deliveryVerificationReference, setDeliveryVerificationReference] = useState('')
  const [deliveryVerifiedAt, setDeliveryVerifiedAt] = useState('')
  const [fulfillmentEligibility, setFulfillmentEligibility] = useState<FulfillmentEligibilityResult | null>(null)
  const [checkingFulfillment, setCheckingFulfillment] = useState(false)
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('SELF')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [recipientContactError, setRecipientContactError] = useState('')
  const [deliveryAddressError, setDeliveryAddressError] = useState('')
  const [deliveryAddressSearch, setDeliveryAddressSearch] = useState('')
  const handledLaunchRef = useRef<string | null>(null)

  const garmentSearchTerm = garmentSearch.trim().toLowerCase()
  const garmentPickerGroups = CUSTOM_ORDER_GARMENT_TAXONOMY.map((group) => {
    const categoryMatches = group.category.toLowerCase().includes(garmentSearchTerm)
    const items = garmentSearchTerm
      ? group.items.filter(
          (item) => categoryMatches || item.toLowerCase().includes(garmentSearchTerm)
        )
      : group.items
    return { category: group.category, items }
  }).filter((group) => group.items.length > 0)
  const selectedGarmentLabel =
    garmentType === 'Other' && garmentTypeOther.trim() ? garmentTypeOther.trim() : garmentType

  function closeGarmentPicker() {
    setShowGarmentPicker(false)
    setGarmentSearch('')
  }

  function selectGarmentType(value: string) {
    setGarmentType(value)
    if (value !== 'Other') setGarmentTypeOther('')
    closeGarmentPicker()
  }
  const guidedFitProfile = buildOrderFitProfile(measurements)
  const missingOrderMeasurements = missingCustomOrderMeasurements(measurements, garmentType)
  const hasMeasurementFallback = hasCustomOrderMeasurementFallback(fitNote)
  const measurementsReadyForOrder =
    !!measurements && (missingOrderMeasurements.length === 0 || hasMeasurementFallback)
  const recipientPhoneHint = phoneHintForContext(deliveryCountry)
  const savedMeasurementProfileLabel =
    typeof measurements?.measurementProfileLabel === 'string' && measurements.measurementProfileLabel.trim()
      ? measurements.measurementProfileLabel.trim()
      : 'Me'
  const measurementAgeSummary = measurementAgeFromSnapshot(measurements)
  const deadlineNotice = deadlineContextNotice(deadline)
  const measurementUnit = typeof measurements?.unit === 'string' ? measurements.unit : 'in'
  const measurementProfileOptions = measurementProfiles.map((profile) => ({
    value: profile.id,
    title: profile.is_default ? `${profile.label} · default` : profile.label,
    body: profile.last_measured_at
      ? `Updated ${new Date(profile.last_measured_at).toLocaleDateString()}`
      : profile.source
        ? profile.source.replace(/_/g, ' ').toLowerCase()
        : 'Saved profile',
    icon: profile.relationship === 'SELF' ? 'user' as const : 'users' as const,
  }))
  const measurementReviewFields = [
    { key: 'chest', label: 'Chest', value: measurements?.chest },
    { key: 'waist', label: 'Waist', value: measurements?.waist },
    { key: 'hips', label: 'Hips', value: measurements?.hips },
    { key: 'shoulderWidth', label: 'Shoulders', value: measurements?.shoulderWidth },
    { key: 'inseam', label: 'Inseam', value: measurements?.inseam },
    { key: 'sleeveLength', label: 'Sleeve', value: measurements?.sleeveLength },
    { key: 'neckCircumference', label: 'Neck', value: measurements?.neckCircumference },
    { key: 'height', label: 'Height', value: measurements?.height },
    { key: 'underBust', label: 'Under bust', value: measurements?.underBust },
    { key: 'backLength', label: 'Back', value: measurements?.backLength },
    { key: 'outseam', label: 'Outseam', value: measurements?.outseam },
    { key: 'thighCircumference', label: 'Thigh', value: measurements?.thighCircumference },
    { key: 'kneeCircumference', label: 'Knee', value: measurements?.kneeCircumference },
    { key: 'bicepCircumference', label: 'Bicep', value: measurements?.bicepCircumference },
    { key: 'wristCircumference', label: 'Wrist', value: measurements?.wristCircumference },
    { key: 'headCircumference', label: 'Head', value: measurements?.headCircumference },
    { key: 'hatBandLine', label: 'Hat band', value: measurements?.hatBandLine },
    { key: 'headLength', label: 'Head length', value: measurements?.headLength },
    { key: 'headWidth', label: 'Head width', value: measurements?.headWidth },
    { key: 'earToEarOverCrown', label: 'Crown E-E', value: measurements?.earToEarOverCrown },
    { key: 'frontToBackOverCrown', label: 'Crown F-B', value: measurements?.frontToBackOverCrown },
    { key: 'filaHeight', label: 'Fila height', value: measurements?.filaHeight },
    { key: 'torsoLength', label: 'Torso', value: measurements?.torsoLength },
  ]
  const coreMeasurementReviewFields = measurementReviewFields.slice(0, 4)
  const filledMeasurementCount = measurementReviewFields.filter((field) => field.value != null).length

  function resetBriefState() {
    setStep(0)
    setSubmitting(false)
    setShowMeasPrompt(false)
    setFetchError(false)
    setInitialLoading(true)
    setGarmentType('')
    setGarmentTypeOther('')
    setGenderPresentation(null)
    setDescription('')
    setDescriptionError('')
    setOccasion('')
    setDeadline(defaultDeadline())
    setDeadlineError('')
    setShowDatePicker(false)
    setIsBulkOrder(false)
    setBulkRecipientCount('')
    setBulkLabel('')
    setBulkNotes('')
    setBulkMemberNames('')
    setWearerMode('SELF')
    setWearerName('')
    setPhotos([])
    setInspirationLinks([])
    setInspirationInput('')
    setLinkError('')
    setStyleNotes('')
    setStyleAttributes([])
    setMeasurements(null)
    setFitNote('')
    setFitNoteError('')
    setEditingField(null)
    setEditValue('')
    setFabricSource(null)
    setFabricHandoffMode(null)
    setFabricDescription('')
    setFabricBudgetAmount('')
    setFabricBudgetCurrency('USD')
    setFabricCurrencySheetOpen(false)
    setFabricReferenceMedia([])
    setFabricReferenceLinks([])
    setFabricReferenceInput('')
    setFabricReferenceLinkError('')
    setFabricSubstitutionPreference(null)
    setBulkFabricMode(null)
    setFabricVendorName('')
    setFabricVendorLocation('')
    setFabricVendorLink('')
    setFabricVendorNotes('')
    setFabricVendorLinkError('')
    setFabricSourcingDeadlineDays(CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS)
    setDeliveryMethod(null)
    setShippingPreference('STANDARD')
    setDeliveryInstructions('')
    setDeliveryAddressLine1('')
    setDeliveryAddressLine2('')
    setDeliveryCity('')
    setDeliveryStateRegion('')
    setDeliveryPostalCode('')
    setDeliveryCountry('')
    setRecipientMode('SELF')
    setRecipientName('')
    setRecipientPhone('')
    setRecipientContactError('')
    setDeliveryAddressError('')
    setDeliveryAddressSearch('')
    setFabricBudgetCurrency('USD')
  }

  useEffect(() => {
    if (resumeDraft === '1') return
    const timer = setTimeout(resetBriefState, 0)
    return () => clearTimeout(timer)
  }, [tailorId, draftSession, freshStart, resumeDraft])

  useEffect(() => {
    if (!user || recipientMode !== 'SELF') return
    const timer = setTimeout(() => {
      setRecipientName((current) => current || String(user.user_metadata?.display_name ?? '').trim())
      setRecipientPhone(
        (current) => current || normalizePhoneForStorage(String(user.user_metadata?.phone ?? ''))
      )
    }, 0)
    return () => clearTimeout(timer)
  }, [user, recipientMode])

  const loadInitialData = useCallback(async () => {
    setFetchError(false)
    setInitialLoading(true)
    setMeasurements(null)

    const launchKey = `${tailorId}:${draftSession ?? 'default'}:${freshStart ?? '0'}`
    if (!userId) {
      setFetchError(true)
      setInitialLoading(false)
      return
    }

    if (freshStart === '1' && handledLaunchRef.current !== launchKey) {
      handledLaunchRef.current = launchKey
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, reference, stage')
        .eq('customer_id', userId)
        .eq('tailor_profile_id', tailorId)
        .eq('order_kind', 'CUSTOM')
        .in('stage', [...CUSTOM_ORDER_RESUMABLE_STAGES])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingOrder?.id) {
        Alert.alert(
          'Continue your current custom order?',
          `You already have a custom order with this tailor in progress (${existingOrder.reference ?? existingOrder.stage}). Drapeon keeps one active custom order per customer-tailor pair so details, payments, and production updates stay clean.`,
          [
            {
              text: 'Browse others',
              style: 'cancel',
              onPress: () => router.replace('/(customer)' as never),
            },
            {
              text: 'Open order',
              onPress: () =>
                router.replace({
                  pathname: '/(customer)/orders/[id]',
                  params: {
                    id: existingOrder.id,
                    returnTo: '/(customer)/orders?tab=active',
                    historyChain: appendToHistory(undefined, '/(customer)/orders?tab=active'),
                    tab: 'active',
                  },
                }),
            },
          ]
        )
      }
    }

    const [tailorRes, measRes, profileRes, accountRes] = await Promise.allSettled([
      supabase.from('tailor_profiles').select('id').eq('id', tailorId).maybeSingle(),
      supabase.from('customer_profiles').select('measurements').eq('user_id', userId).maybeSingle(),
      supabase
        .from('customer_measurement_profiles')
        .select('id, label, relationship, measurements, unit_preference, source, is_default, last_measured_at, updated_at')
        .eq('customer_id', userId)
        .order('is_default', { ascending: false })
        .order('updated_at', { ascending: false }),
      supabase.from('users').select('default_currency').eq('id', userId).maybeSingle(),
    ])

    const tailorData =
      tailorRes.status === 'fulfilled' && !tailorRes.value.error ? tailorRes.value.data : null
    const measurementData =
      measRes.status === 'fulfilled' && !measRes.value.error ? measRes.value.data : null
    const profileData =
      profileRes.status === 'fulfilled' && !profileRes.value.error ? profileRes.value.data : []
    const accountData =
      accountRes.status === 'fulfilled' && !accountRes.value.error ? accountRes.value.data : null

    if (!tailorData?.id) {
      setFetchError(true)
    }

    const resolvedAccountCurrency = normalizeAccountCurrency(accountData?.default_currency) ?? 'USD'
    setFabricBudgetCurrency(resolvedAccountCurrency)
    setMeasurementProfiles((profileData ?? []) as MeasurementProfileRow[])

    const defaultProfile = (profileData ?? []).find((profile) => profile.is_default)
    const defaultProfileMeasurements = defaultProfile?.measurements
      ? normalizeLoadedMeasurementProfile({
          ...defaultProfile.measurements,
          unit: defaultProfile.measurements.unit ?? defaultProfile.unit_preference,
          measurementProfileLabel: defaultProfile.label,
        })
      : null
    const storedMeasurements = normalizeLoadedMeasurementProfile(measurementData?.measurements ?? null)
    const selectedMeasurements = defaultProfileMeasurements ?? storedMeasurements
    const hasMeasurements = hasCompleteMeasurementProfile(selectedMeasurements)
    if (hasMeasurements) {
      setMeasurements(enrichMeasurementSnapshot(selectedMeasurements))
      setInitialLoading(false)
      return
    }

    setMeasurements(null)
    const alreadyShown = await AsyncStorage.getItem(MEAS_PROMPT_KEY)
    if (!alreadyShown) setShowMeasPrompt(true)
    setInitialLoading(false)
  }, [draftSession, freshStart, router, tailorId, userId])

  // Load tailor profile existence + customer measurements; show one-time completeness prompt
  useFocusEffect(
    useCallback(() => {
      void loadInitialData()
    }, [loadInitialData])
  )

  const draftFields = useMemo(() => ({
    garmentType, garmentTypeOther, genderPresentation, description, occasion,
    deadline: deadline?.toISOString() ?? null,
    isBulkOrder, bulkRecipientCount, bulkLabel, bulkNotes, bulkMemberNames,
    wearerMode, wearerName, photos, inspirationLinks, styleNotes, styleAttributes,
    measurements, fitNote, fabricSource, fabricHandoffMode, fabricDescription,
    fabricBudgetAmount, fabricBudgetCurrency,
    fabricReferenceMedia, fabricReferenceLinks, fabricSubstitutionPreference,
    bulkFabricMode, fabricVendorName, fabricVendorLocation, fabricVendorLink,
    fabricVendorNotes, fabricSourcingDeadlineDays, deliveryMethod, shippingPreference,
    deliveryInstructions, deliveryAddressLine1, deliveryAddressLine2, deliveryCity,
    deliveryStateRegion, deliveryPostalCode, deliveryCountry, deliveryVerificationSource,
    deliveryVerificationReference, deliveryVerifiedAt, recipientMode,
    recipientName, recipientPhone, cancellationPolicyAcknowledged,
  }), [
    garmentType, garmentTypeOther, genderPresentation, description, occasion, deadline,
    isBulkOrder, bulkRecipientCount, bulkLabel, bulkNotes, bulkMemberNames, wearerMode,
    wearerName, photos, inspirationLinks, styleNotes, styleAttributes, measurements,
    fitNote, fabricSource, fabricHandoffMode, fabricDescription, fabricBudgetAmount,
    fabricBudgetCurrency, fabricReferenceMedia, fabricReferenceLinks,
    fabricSubstitutionPreference, bulkFabricMode, fabricVendorName, fabricVendorLocation,
    fabricVendorLink, fabricVendorNotes, fabricSourcingDeadlineDays, deliveryMethod,
    shippingPreference, deliveryInstructions, deliveryAddressLine1, deliveryAddressLine2,
    deliveryCity, deliveryStateRegion, deliveryPostalCode, deliveryCountry,
    deliveryVerificationSource, deliveryVerificationReference, deliveryVerifiedAt, recipientMode,
    recipientName, recipientPhone, cancellationPolicyAcknowledged,
  ])

  useEffect(() => {
    if (!userId || !tailorId || initialLoading || draftLoadStartedRef.current) return
    draftLoadStartedRef.current = true
    setDraftStatus('loading')
    void invokeFunction<{
      ok: boolean
      draft?: { version: string; current_step: number; fields: Record<string, unknown>; has_device_only_attachments: boolean } | null
    }>('custom-order-draft-action', { body: { action: 'load', tailorProfileId: tailorId } })
      .then(({ data, error }) => {
        const draft = data?.draft
        if (error || !draft || draft.version !== CUSTOM_ORDER_DRAFT_VERSION) {
          draftHydratedRef.current = true
          setDraftStatus(error ? 'error' : null)
          return
        }
        const f = draft.fields ?? {}
        const text = (key: string) => typeof f[key] === 'string' ? f[key] as string : ''
        const list = (key: string) => Array.isArray(f[key]) ? f[key] as string[] : []
        const dateValue = text('deadline')
        setStep(Number.isInteger(draft.current_step) ? Math.max(0, Math.min(STEP_TITLES.length - 1, draft.current_step)) : 0)
        setGarmentType(text('garmentType')); setGarmentTypeOther(text('garmentTypeOther'))
        if (f.genderPresentation === 'Menswear' || f.genderPresentation === 'Womenswear' || f.genderPresentation === 'Unisex') setGenderPresentation(f.genderPresentation)
        setDescription(text('description')); setOccasion(text('occasion'))
        if (dateValue && Number.isFinite(new Date(dateValue).getTime())) setDeadline(new Date(dateValue))
        setIsBulkOrder(GROUP_ORDERS_ENABLED && f.isBulkOrder === true); setBulkRecipientCount(text('bulkRecipientCount'))
        setBulkLabel(text('bulkLabel')); setBulkNotes(text('bulkNotes')); setBulkMemberNames(text('bulkMemberNames'))
        if (f.wearerMode === 'SELF' || f.wearerMode === 'OTHER') setWearerMode(f.wearerMode)
        setWearerName(text('wearerName')); setPhotos(list('photos')); setInspirationLinks(list('inspirationLinks'))
        setStyleNotes(text('styleNotes')); setStyleAttributes(list('styleAttributes'))
        if (f.measurements && typeof f.measurements === 'object' && !Array.isArray(f.measurements)) setMeasurements(f.measurements as MeasurementRecord)
        setFitNote(text('fitNote'))
        if (f.fabricSource === 'TAILOR_SOURCES' || f.fabricSource === 'CUSTOMER_SUPPLIES') setFabricSource(f.fabricSource)
        if (typeof f.fabricHandoffMode === 'string') setFabricHandoffMode(f.fabricHandoffMode as FabricHandoffMode)
        setFabricDescription(text('fabricDescription')); setFabricBudgetAmount(text('fabricBudgetAmount'))
        if (typeof f.fabricBudgetCurrency === 'string') setFabricBudgetCurrency(f.fabricBudgetCurrency as CurrencyCode)
        if (Array.isArray(f.fabricReferenceMedia)) setFabricReferenceMedia(f.fabricReferenceMedia as BriefMediaAsset[])
        setFabricReferenceLinks(list('fabricReferenceLinks'))
        if (typeof f.fabricSubstitutionPreference === 'string') setFabricSubstitutionPreference(f.fabricSubstitutionPreference as FabricSubstitutionPreference)
        if (typeof f.bulkFabricMode === 'string') setBulkFabricMode(f.bulkFabricMode as BulkFabricMode)
        setFabricVendorName(text('fabricVendorName')); setFabricVendorLocation(text('fabricVendorLocation'))
        setFabricVendorLink(text('fabricVendorLink')); setFabricVendorNotes(text('fabricVendorNotes'))
        if (typeof f.fabricSourcingDeadlineDays === 'number') setFabricSourcingDeadlineDays(f.fabricSourcingDeadlineDays)
        if (f.deliveryMethod === 'SHIPPING' || f.deliveryMethod === 'LOCAL_DELIVERY' || f.deliveryMethod === 'LOCAL_COLLECTION') setDeliveryMethod(f.deliveryMethod)
        if (f.shippingPreference === 'STANDARD' || f.shippingPreference === 'EXPRESS') setShippingPreference(f.shippingPreference)
        setDeliveryInstructions(text('deliveryInstructions')); setDeliveryAddressLine1(text('deliveryAddressLine1'))
        setDeliveryAddressLine2(text('deliveryAddressLine2')); setDeliveryCity(text('deliveryCity'))
        setDeliveryStateRegion(text('deliveryStateRegion')); setDeliveryPostalCode(text('deliveryPostalCode'))
        setDeliveryCountry(text('deliveryCountry'))
        setDeliveryVerificationSource(text('deliveryVerificationSource'))
        setDeliveryVerificationReference(text('deliveryVerificationReference'))
        setDeliveryVerifiedAt(text('deliveryVerifiedAt'))
        if (f.recipientMode === 'SELF' || f.recipientMode === 'OTHER') setRecipientMode(f.recipientMode)
        setRecipientName(text('recipientName')); setRecipientPhone(text('recipientPhone'))
        setCancellationPolicyAcknowledged(f.cancellationPolicyAcknowledged === true)
        setDraftAttachmentWarning(draft.has_device_only_attachments)
        draftHydratedRef.current = true
        setDraftStatus('restored')
      })
  }, [initialLoading, tailorId, userId])

  useEffect(() => {
    if (!userId || !tailorId || !draftHydratedRef.current || submitting || !isMeaningfulCustomOrderDraft(draftFields)) return
    setDraftStatus((current) => current === 'restored' ? current : 'saving')
    const timer = setTimeout(() => {
      void invokeFunction<{ ok: boolean; updatedAt?: string; fulfillment?: FulfillmentEligibilityResult }>('custom-order-draft-action', {
        body: {
          action: 'save', tailorProfileId: tailorId, version: CUSTOM_ORDER_DRAFT_VERSION,
          currentStep: step, fields: draftFields,
          hasDeviceOnlyAttachments: photos.length > 0 || fabricReferenceMedia.length > 0,
        },
      }).then(({ data, error }) => {
        setDraftStatus(error || !data?.ok ? 'error' : 'saved')
        if (data?.fulfillment) setFulfillmentEligibility(data.fulfillment)
      })
    }, 650)
    return () => clearTimeout(timer)
  }, [draftFields, fabricReferenceMedia.length, photos.length, step, submitting, tailorId, userId])

  function validateDescription(text: string) {
    const placeholder = rejectPlaceholder(text, 'Description')
    if (placeholder) {
      setDescriptionError(placeholder)
      return false
    }
    const res = filterContactInfo(text)
    if (res.blocked) {
      setDescriptionError("Contact details can't be included here.")
      return false
    }
    if (!isCustomOrderBriefLongEnough(text)) {
      setDescriptionError(
        'Use 3 short lines or one clear paragraph so the tailor can understand the shape, details, and finish.'
      )
      return false
    }
    setDescriptionError('')
    return true
  }

  function validateDeadline(date: Date | null) {
    if (!date) {
      setDeadlineError('Choose a target delivery date.')
      return false
    }
    const selected = new Date(date)
    selected.setHours(0, 0, 0, 0)
    if (selected.getTime() < customOrderMinimumDeliveryDate().getTime()) {
      setDeadlineError('Target delivery date must be at least 2 weeks from today.')
      return false
    }
    setDeadlineError('')
    return true
  }

  function validateStyleReferences() {
    if (photos.length + inspirationLinks.length < 1) {
      setLinkError('Add at least one reference photo or supported style link.')
      return false
    }
    const unsupported = inspirationLinks.find((link) => !isAllowedCustomStyleReference(link))
    if (unsupported) {
      setLinkError('Style links must be from Instagram, Pinterest, or TikTok.')
      return false
    }
    setLinkError('')
    return true
  }

  function fabricBudgetAmountValue() {
    return parseMajorCurrencyAmountToMinor(fabricBudgetAmount)
  }

  function fabricBulkRecipientCount() {
    const count = Number.parseInt(bulkRecipientCount, 10)
    return Number.isFinite(count) ? count : null
  }

  function normalizedVendorLink() {
    const trimmed = fabricVendorLink.trim()
    if (!trimmed) return null
    try {
      const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
    } catch {
      return null
    }
  }

  function currentFabricIssues() {
    return getCustomOrderFabricIssues({
      fabricSource,
      fabricDescription,
      fabricBudgetAmount: fabricBudgetAmountValue(),
      fabricBudgetCurrency,
      fabricReferenceMediaCount: fabricReferenceMedia.length,
      fabricReferenceLinkCount: fabricReferenceLinks.length,
      fabricSubstitutionPreference,
      fabricHandoffMode,
      isBulkOrder,
      bulkRecipientCount: fabricBulkRecipientCount(),
      bulkFabricMode,
      suggestedVendorName: fabricVendorName,
      suggestedVendorLocation: fabricVendorLocation,
      suggestedVendorLink: normalizedVendorLink(),
      suggestedVendorNotes: fabricVendorNotes,
    })
  }

  function validateFabricStep() {
    const vendorLinkInvalid = fabricVendorLink.trim().length > 0 && !normalizedVendorLink()
    return (
      currentFabricIssues().length === 0 &&
      !fabricReferenceLinkError &&
      !fabricVendorLinkError &&
      !vendorLinkInvalid
    )
  }

  function composeDeliveryAddress() {
    return composeStructuredAddress({
      line1: deliveryAddressLine1,
      line2: deliveryAddressLine2,
      city: deliveryCity,
      stateRegion: deliveryStateRegion,
      postcode: deliveryPostalCode,
      country: deliveryCountry,
    })
  }

  function clearDeliveryVerification() {
    setDeliveryVerificationSource('')
    setDeliveryVerificationReference('')
    setDeliveryVerifiedAt('')
    setFulfillmentEligibility(null)
  }

  async function resolveFulfillment(
    method: DeliveryMethod,
    override?: {
      addressLine1: string
      city: string
      regionCode: string
      postalCode: string
      countryCode: string
      verificationSource: string
      verificationReference: string
      verifiedAt: string
    },
  ) {
    if (checkingFulfillment) return null
    setCheckingFulfillment(true)
    const destination = method === 'LOCAL_COLLECTION' ? null : {
      addressLine1: override?.addressLine1 ?? deliveryAddressLine1.trim(),
      city: override?.city ?? deliveryCity.trim(),
      regionCode: override?.regionCode ?? deliveryStateRegion.trim(),
      postalCode: override?.postalCode ?? deliveryPostalCode.trim(),
      countryCode: (override?.countryCode ?? deliveryCountry.trim()).toUpperCase(),
      verificationSource: override?.verificationSource ?? deliveryVerificationSource,
      verificationReference: override?.verificationReference ?? deliveryVerificationReference,
      verifiedAt: override?.verifiedAt ?? deliveryVerifiedAt,
    }
    const { data, error } = await invokeFunction<{ ok: boolean; fulfillment?: FulfillmentEligibilityResult }>(
      'custom-order-draft-action',
      { body: { action: 'resolve-fulfillment', tailorProfileId: tailorId, method, destination } },
    )
    setCheckingFulfillment(false)
    if (error || !data?.fulfillment) {
      setDeliveryAddressError('Could not check this fulfillment option. Try again.')
      return null
    }
    const result = data.fulfillment
    setFulfillmentEligibility(result)
    setDeliveryAddressError(result.status === 'BLOCKED' ? fulfillmentEligibilityCopy(result) : '')
    if (result.status === 'BLOCKED' && result.reason === 'LOCAL_DELIVERY_COUNTRY_MISMATCH') {
      Alert.alert(
        'Switch to international shipping?',
        `This address is outside ${result.originCountryCode ?? 'the tailor’s country'}.`,
        [
          { text: 'Edit address', style: 'cancel' },
          {
            text: 'Switch to shipping',
            onPress: () => {
              setDeliveryMethod('SHIPPING')
              void resolveFulfillment('SHIPPING', override)
            },
          },
        ],
      )
    }
    return result
  }

  function chooseDeliveryMethod(method: DeliveryMethod) {
    setDeliveryMethod(method)
    setFulfillmentEligibility(null)
    setDeliveryAddressError('')
    if (method === 'LOCAL_COLLECTION') void resolveFulfillment(method)
  }

  async function confirmStructuredDeliveryAddress() {
    if (!validateDeliveryAddress()) return
    const verifiedAt = new Date().toISOString()
    setDeliveryVerificationSource('CUSTOMER_CONFIRMED_STRUCTURED')
    setDeliveryVerificationReference('')
    setDeliveryVerifiedAt(verifiedAt)
    await resolveFulfillment(deliveryMethod ?? 'LOCAL_DELIVERY', {
      addressLine1: deliveryAddressLine1.trim(),
      city: deliveryCity.trim(),
      regionCode: deliveryStateRegion.trim(),
      postalCode: deliveryPostalCode.trim(),
      countryCode: deliveryCountry.trim(),
      verificationSource: 'CUSTOMER_CONFIRMED_STRUCTURED',
      verificationReference: '',
      verifiedAt,
    })
  }

  function validateDeliveryAddress() {
    const fullAddress = composeDeliveryAddress()
    const placeholder = rejectPlaceholder(fullAddress, 'Delivery address')
    if (placeholder) {
      setDeliveryAddressError(placeholder)
      return false
    }
    if (!deliveryAddressLine1.trim()) {
      setDeliveryAddressError('Please enter the first line of your address.')
      return false
    }
    if (!deliveryCity.trim()) {
      setDeliveryAddressError('Please enter your city.')
      return false
    }
    if (!deliveryStateRegion.trim()) {
      setDeliveryAddressError('Please enter your state, region, or county.')
      return false
    }
    if (!deliveryCountry.trim()) {
      setDeliveryAddressError('Please enter your country.')
      return false
    }
    setDeliveryAddressError('')
    return true
  }

  function validateRecipientContact() {
    const trimmedName = recipientName.trim()
    const normalizedPhone = normalizePhoneForStorage(recipientPhone)
    const namePlaceholder = rejectPlaceholder(trimmedName, 'Recipient name')
    if (namePlaceholder) {
      setRecipientContactError(namePlaceholder)
      return false
    }
    if (!trimmedName) {
      setRecipientContactError('Please enter the recipient name.')
      return false
    }
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) {
      setRecipientContactError(phoneError)
      return false
    }
    setRecipientContactError('')
    return true
  }

  function validateFitNote(text: string) {
    if (text.trim().length < 20) {
      setFitNoteError(
        'Tell your tailor about your deadline and any key fit details. Use at least 20 characters.'
      )
      return false
    }
    const placeholder = rejectPlaceholder(text, 'Note')
    if (placeholder) {
      setFitNoteError(placeholder)
      return false
    }
    const res = filterContactInfo(text)
    if (res.blocked) {
      setFitNoteError("Contact details can't be included here.")
      return false
    }
    setFitNoteError('')
    return true
  }

  function selectMeasurementProfile(profileId: string) {
    const profile = measurementProfiles.find((item) => item.id === profileId)
    if (!profile?.measurements) {
      setMeasurementProfileSheetOpen(false)
      return
    }
    const normalizedMeasurements = normalizeLoadedMeasurementProfile({
      ...profile.measurements,
      unit: profile.measurements.unit ?? profile.unit_preference ?? measurements?.unit ?? 'in',
      measurementProfileLabel: profile.label,
    })
    if (!normalizedMeasurements) {
      setMeasurementProfileSheetOpen(false)
      return
    }
    setMeasurements(enrichMeasurementSnapshot(normalizedMeasurements))
    setMeasurementProfileSheetOpen(false)
  }

  async function pickPhoto() {
    if (submitting) return
    if (photos.length >= CUSTOM_ORDER_MAX_REFERENCE_PHOTOS) {
      Alert.alert(
        'Maximum ' + CUSTOM_ORDER_MAX_REFERENCE_PHOTOS + ' reference photos',
        'Remove one of your current references before adding another.'
      )
      return
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to upload style references.')
      return
    }
    const pickerOptions = preferCurrentAssetRepresentation({
      mediaTypes: 'images' as const,
      quality: 0.8,
    })
    const result = await launchImagePickerSafely(
      () => ImagePicker.launchImageLibraryAsync(pickerOptions),
      {
        context: 'custom_order_style_reference_picker',
        mediaLabel: 'style reference image',
        extra: { userId },
      }
    )
    if (!result) return
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri])
    }
  }

  function openFabricMediaPicker() {
    if (submitting) return
    if (fabricReferenceMedia.length >= MAX_FABRIC_REFERENCE_MEDIA) {
      Alert.alert(
        'Maximum ' + MAX_FABRIC_REFERENCE_MEDIA + ' fabric references',
        'Remove one fabric photo or video before adding another.'
      )
      return
    }
    Alert.alert('Fabric reference', 'Add fabric proof or sourcing inspiration.', [
      { text: 'Take photo', onPress: () => void pickFabricPhoto('camera') },
      { text: 'Choose photo', onPress: () => void pickFabricPhoto('library') },
      { text: 'Record video', onPress: () => void pickFabricVideo('camera') },
      { text: 'Choose video', onPress: () => void pickFabricVideo('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function pickFabricPhoto(source: MediaPickerSource) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to take fabric photos.'
          : 'Allow photo access to upload fabric photos.'
      )
      return
    }
    const pickerOptions = preferCurrentAssetRepresentation({
      mediaTypes: 'images' as const,
      quality: 0.85,
    })
    const result = await launchImagePickerSafely(
      () =>
        source === 'camera'
          ? ImagePicker.launchCameraAsync(pickerOptions)
          : ImagePicker.launchImageLibraryAsync(pickerOptions),
      {
        context: 'custom_order_fabric_photo_picker',
        mediaLabel: 'fabric photo',
        extra: { source, userId },
      }
    )
    if (!result) return
    if (result.canceled || !result.assets[0]) return
    setFabricReferenceMedia((prev) => [
      ...prev,
      { id: createBriefMediaId(), uri: result.assets[0].uri, kind: 'photo' as const, contentType: 'image/jpeg', extension: 'jpg' },
    ].slice(0, MAX_FABRIC_REFERENCE_MEDIA))
  }

  async function pickFabricVideo(source: MediaPickerSource) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to record fabric videos.'
          : 'Allow photo access to upload fabric videos.'
      )
      return
    }
    const result = await launchImagePickerSafely(
      () =>
        source === 'camera'
          ? ImagePicker.launchCameraAsync({
              mediaTypes: 'videos' as const,
              quality: 0.8,
              videoMaxDuration: FABRIC_REFERENCE_VIDEO_MAX_SECONDS,
            })
          : ImagePicker.launchImageLibraryAsync(
              preferCompatibleVideoRepresentation({
                mediaTypes: 'videos' as const,
                quality: 0.8,
                videoMaxDuration: FABRIC_REFERENCE_VIDEO_MAX_SECONDS,
              })
            ),
      {
        context: 'custom_order_fabric_video_picker',
        mediaLabel: 'fabric video',
        extra: { source, userId },
      }
    )
    if (!result) return
    if (result.canceled || !result.assets[0]) return

    const asset = result.assets[0]
    const validationMessage = validateVideoPickerAsset(asset, {
      maxBytes: FABRIC_REFERENCE_VIDEO_MAX_BYTES,
      maxSeconds: FABRIC_REFERENCE_VIDEO_MAX_SECONDS,
      maxBytesMessage: 'Fabric videos must be 30 MB or smaller.',
      unsupportedMessage: 'Choose an MP4 or MOV fabric video.',
      durationMessage: 'Fabric videos can be up to 30 seconds.',
    })
    if (validationMessage) {
      Alert.alert('Video not added', validationMessage)
      return
    }

    setFabricReferenceMedia((prev) => [
      ...prev,
      {
        id: createBriefMediaId(),
        uri: asset.uri,
        kind: 'video' as const,
        contentType: pickerVideoContentType(asset),
        extension: pickerVideoExtension(asset),
      },
    ].slice(0, MAX_FABRIC_REFERENCE_MEDIA))
  }

  function removeFabricReferenceMedia(id: string) {
    setFabricReferenceMedia((prev) => prev.filter((item) => item.id !== id))
  }

  function addFabricReferenceLink() {
    const trimmed = fabricReferenceInput.trim()
    if (!trimmed) return
    if (fabricReferenceLinks.length >= CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setFabricReferenceLinkError('Maximum ' + CUSTOM_ORDER_MAX_STYLE_LINKS + ' fabric links per order.')
      return
    }
    if (fabricReferenceLinks.includes(trimmed)) {
      setFabricReferenceLinkError('That link is already added.')
      return
    }
    if (!isAllowedCustomStyleReference(trimmed)) {
      setFabricReferenceLinkError('Fabric links must be from Instagram, Pinterest, or TikTok.')
      return
    }
    setFabricReferenceLinkError('')
    setFabricReferenceLinks((prev) => [...prev, trimmed])
    setFabricReferenceInput('')
  }

  function removeFabricReferenceLink(link: string) {
    setFabricReferenceLinks((prev) => prev.filter((item) => item !== link))
  }

  function validateFabricVendorLink(value = fabricVendorLink) {
    const trimmed = value.trim()
    if (!trimmed) {
      setFabricVendorLinkError('')
      return true
    }
    try {
      const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : 'https://' + trimmed)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        setFabricVendorLinkError('')
        return true
      }
    } catch {
      setFabricVendorLinkError('Enter a valid vendor website or social link.')
      return false
    }
    setFabricVendorLinkError('Enter a valid vendor website or social link.')
    return false
  }

  async function uploadFabricReferenceAsset(asset: BriefMediaAsset) {
    if (asset.kind === 'photo') {
      const cleanUri = await stripExif(asset.uri)
      return uploadPublicStorageImage({
        bucket: 'order-photos',
        path: createBriefMediaPath(user?.id, 'fabric', 'jpg'),
        uri: cleanUri,
        contentType: 'image/jpeg',
        maxBytes: MEDIA_LIMITS_BYTES.image,
        purpose: 'ORDER_REFERENCE',
      })
    }

    const contentType = asset.contentType ?? 'video/mp4'
    const extension = asset.extension ?? 'mp4'
    const payload = await createValidatedUploadPayload(asset.uri, {
      maxBytes: FABRIC_REFERENCE_VIDEO_MAX_BYTES,
      contentType,
      allowedContentTypes: ALLOWED_VIDEO_CONTENT_TYPES,
      purpose: 'ORDER_REFERENCE',
    })
    const path = createBriefMediaPath(user?.id, 'fabric', extension)
    const { error: uploadError } = await supabase.storage
      .from('order-photos')
      .upload(path, payload.data, { contentType, cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable })
    if (uploadError) throw uploadError
    return supabase.storage.from('order-photos').getPublicUrl(path).data.publicUrl
  }

  function canProceed(): boolean {
    if (step === 0) {
      const bulkCount = Number.parseInt(bulkRecipientCount, 10)
      if (isBulkOrder && (!Number.isFinite(bulkCount) || bulkCount < 2)) return false
      if (!isBulkOrder && wearerMode === 'OTHER' && wearerName.trim().length < 2) return false
      const hasGarment =
        !!garmentType && (garmentType !== 'Other' || garmentTypeOther.trim().length >= 2)
      return (
        hasGarment &&
        !!genderPresentation &&
        isCustomOrderBriefLongEnough(description) &&
        !descriptionError &&
        !!deadline &&
        !deadlineError &&
        deadline.getTime() >= customOrderMinimumDeliveryDate().getTime()
      )
    }
    if (step === 1) return photos.length + inspirationLinks.length >= 1 && !linkError
    if (step === 2) return measurementsReadyForOrder && fitNote.trim().length >= 20 && !fitNoteError
    if (step === 3) {
      return validateFabricStep()
    }
    if (step === 4) {
      if (!fabricSource || !deliveryMethod) return false
      if (deliveryMethod !== 'LOCAL_COLLECTION') {
        const normalizedRecipientPhone = normalizePhoneForStorage(recipientPhone)
        const hasCoreAddress =
          !!deliveryAddressLine1.trim() &&
          !!deliveryCity.trim() &&
          !!deliveryStateRegion.trim() &&
          !!deliveryCountry.trim()
        if (
          !hasCoreAddress ||
          !!deliveryAddressError ||
          !!recipientContactError ||
          !recipientName.trim() ||
          !normalizedRecipientPhone ||
          !!validatePhoneForProfile(normalizedRecipientPhone)
        ) {
          return false
        }
      }
      return true
    }
    if (step === 5) return canProceedReview()
    return false
  }

  function canProceedReview() {
    const originalStep = step
    return (
      originalStep === 5 &&
      (() => {
        const hasGarment =
          !!garmentType && (garmentType !== 'Other' || garmentTypeOther.trim().length >= 2)
        const hasDelivery =
          !!deliveryMethod &&
          (deliveryMethod === 'LOCAL_COLLECTION' ||
            (!!deliveryAddressLine1.trim() &&
              !!deliveryCity.trim() &&
              !!deliveryStateRegion.trim() &&
              !!deliveryCountry.trim() &&
              !!recipientName.trim() &&
              !!normalizePhoneForStorage(recipientPhone)))
        return (
          hasGarment &&
          !!genderPresentation &&
          isCustomOrderBriefLongEnough(description) &&
          !!deadline &&
          deadline.getTime() >= customOrderMinimumDeliveryDate().getTime() &&
          photos.length + inspirationLinks.length >= 1 &&
          measurementsReadyForOrder &&
          fitNote.trim().length >= 20 &&
          validateFabricStep() &&
          hasDelivery &&
          cancellationPolicyAcknowledged
        )
      })()
    )
  }

  function addCustomInspirationLink() {
    const trimmed = inspirationInput.trim()
    if (!trimmed) return
    if (inspirationLinks.length >= CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setLinkError(`Maximum ${CUSTOM_ORDER_MAX_STYLE_LINKS} style links per order.`)
      return
    }
    if (inspirationLinks.includes(trimmed)) {
      setLinkError('That link is already added.')
      return
    }
    if (!isAllowedCustomStyleReference(trimmed)) {
      setLinkError('Style links must be from Instagram, Pinterest, or TikTok.')
      return
    }
    setLinkError('')
    setInspirationLinks((prev) => [...prev, trimmed])
    setInspirationInput('')
  }

  function removeInspirationLink(link: string) {
    setInspirationLinks((prev) => prev.filter((l) => l !== link))
  }

  async function submit() {
    if (submitting) return
    if (isBulkOrder && !GROUP_ORDERS_ENABLED) {
      Alert.alert('Group orders are not available yet', 'Send one custom request for one wearer. Drapeon Support can help plan a larger coordinated order.')
      setIsBulkOrder(false)
      return
    }
    // Final guard — catches any placeholder values that bypassed per-field validation
    if (!validateDescription(description)) return
    if (!validateDeadline(deadline)) return
    if (!validateStyleReferences()) return
    if (!validateFitNote(fitNote)) return
    if (!validateFabricVendorLink()) return
    const fabricIssues = currentFabricIssues()
    if (fabricIssues.length > 0 || fabricReferenceLinkError) {
      Alert.alert(
        'Fabric details needed',
        fabricReferenceLinkError || fabricIssues[0]?.message || 'Complete the fabric details before submitting.'
      )
      return
    }
    if (deliveryMethod !== 'LOCAL_COLLECTION' && !validateDeliveryAddress()) return
    if (deliveryMethod !== 'LOCAL_COLLECTION' && !validateRecipientContact()) return
    if (!deliveryMethod) return
    const eligibility = await resolveFulfillment(deliveryMethod)
    if (!eligibility || eligibility.status !== 'ELIGIBLE') return
    setSubmitting(true)

    const wearerLabel = isBulkOrder
      ? bulkLabel.trim() || 'Group order'
      : wearerMode === 'SELF'
        ? savedMeasurementProfileLabel
        : wearerName.trim()
    const wearerContext = {
      mode: isBulkOrder ? 'GROUP' as const : wearerMode,
      label: wearerLabel,
      measurementProfileLabel: wearerLabel,
      relationship: isBulkOrder ? 'GROUP' as const : wearerMode === 'SELF' ? 'BUYER' as const : 'NAMED_OTHER' as const,
      selectedAt: new Date().toISOString(),
      note: isBulkOrder
        ? 'Group order measurements are handled per recipient before quote acceptance.'
        : wearerMode === 'OTHER'
          ? 'Customer confirmed the attached measurements are for this named wearer.'
          : null,
    }
    const measurementSnapshot = enrichMeasurementSnapshot({
      ...measurements,
      wearerContext,
      measurementProfileLabel: wearerContext.measurementProfileLabel,
    })
    const missingSnapshotMeasurements = missingCustomOrderMeasurements(
      measurementSnapshot,
      garmentType,
    )
    if (
      missingSnapshotMeasurements.length > 0 &&
      !hasCustomOrderMeasurementFallback(fitNote)
    ) {
      setSubmitting(false)
      const labels = missingSnapshotMeasurements
        .map((field) => field === 'height' ? 'height' : field)
        .join(', ')
      Alert.alert(
        'Measurements need attention',
        `Your saved profile is missing ${labels} for this order. Update the profile, or add a clear note asking the tailor to follow up before quoting.`,
      )
      return
    }
    const fitProfile = buildOrderFitProfile(measurementSnapshot)
    const measurementAge = measurementAgeFromSnapshot(measurementSnapshot)
    const measurementAgeMeta = measurementAge
      ? {
          lastUpdatedAt: measurementAge.lastUpdatedAt,
          ageMonths: measurementAge.ageMonths,
          stale: measurementAge.stale,
          warningShown: measurementAge.stale,
        }
      : null
    const fabricBudget = fabricBudgetAmountValue()
    const fabricSubstitutionOption = FABRIC_SUBSTITUTION_OPTIONS.find(
      (option) => option.value === fabricSubstitutionPreference
    )
    const bulkFabricOption = BULK_FABRIC_MODE_OPTIONS.find((option) => option.value === bulkFabricMode)
    const suggestedFabricVendor =
      fabricVendorName.trim() || fabricVendorLocation.trim() || fabricVendorLink.trim() || fabricVendorNotes.trim()
        ? {
            name: fabricVendorName.trim() || null,
            location: fabricVendorLocation.trim() || null,
            link: normalizedVendorLink(),
            notes: fabricVendorNotes.trim() || null,
          }
        : null
    const fabricReferenceSummary = {
      mediaCount: fabricReferenceMedia.length,
      linkCount: fabricReferenceLinks.length,
      links: fabricReferenceLinks,
      sourceMode: fabricSource,
    }
    const fabricPolicy =
      fabricSource === 'CUSTOMER_SUPPLIES'
        ? {
            approvalRequiredForTailorSourcing: true,
            rejectionReasons: [
              'Poor fabric quality',
              'Insufficient yardage',
              'Wrong fabric type',
              'Fabric damaged or mismatched',
              'Non-continuous remnants or unusable width',
            ],
            lateFabricRule: 'Production stays paused until the tailor confirms fabric receipt.',
            missingFabricRule:
              'If the fabric never arrives, the customer can resend, ask the tailor to source, revise the design, or request cancellation review.',
            replacementRule:
              'Replacement fabric must be confirmed inside the order before cutting resumes.',
            disagreementRule:
              'If fabric suitability is disputed, Drapeon reviews the timeline before work continues.',
            prepRequirements: [
              'Share the handoff plan before the order is submitted',
              'Keep any shipping reference inside the order thread',
              'Keep receipt or dropoff proof in Drapeon if fabric value is material',
              'Do not expect cutting to start before receipt is confirmed',
              'Prewash, press, or stabilize the fabric first when the tailor asks for it',
            ],
          }
        : {
            approvalRequiredForTailorSourcing: true,
            replacementRule:
              'Tailor-sourced fabric should only be replaced after customer approval inside Drapeon.',
            disagreementRule:
              'If sourcing changes the agreed design or budget, Drapeon should review before work continues.',
            prepRequirements: [
              'Fabric sourcing is covered by the accepted quote',
              'Tailor should not buy replacement fabric without approval',
              'Fabric proof should be photographed in natural light with a white paper reference when color matters',
            ],
          }
    const bulkCount = Number.parseInt(bulkRecipientCount, 10)
    const bulkMembers = bulkMemberNames
      .split(/\n|,/u)
      .map((name) => name.trim())
      .filter(Boolean)
    const bulkOrder = isBulkOrder
      ? {
          enabled: true,
          mode: 'OPS_MANAGED_SPECIAL_CASE' as const,
          label: bulkLabel.trim() || null,
          recipientCount: Number.isFinite(bulkCount) && bulkCount >= 2 ? bulkCount : null,
          memberNames: bulkMembers.length > 0 ? bulkMembers : null,
          memberMeasurementPolicy:
            'Each wearer needs their own measurement profile before quote acceptance. Do not reuse the buyer profile unless the buyer is also that wearer.',
          payerModel: 'SINGLE_PAYER' as const,
          measurementPrivacy: 'TAILOR_ONLY' as const,
          statusPolicy: 'OPS_MANAGED_LINKED_CHILDREN' as const,
          dyeLotConsistencyRequired: true,
          fabricMode: bulkFabricMode,
          fabricModeLabel: bulkFabricOption?.label ?? null,
          notes: bulkNotes.trim() || null,
        }
      : null
    const styleAlignment = {
      requiredBeforeCutting: true,
      referencePhotoCount: photos.length,
      styleReferenceLinkCount: inspirationLinks.length,
      instruction:
        'Before cutting, confirm what can and cannot be matched from the customer references inside Drapeon.',
      customerExpectation:
        'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.',
    }
    const supportMeta =
      fabricSource === 'CUSTOMER_SUPPLIES'
        ? {
            fabricHandoffMode,
            fabricHandoffLabel: fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null,
            fabricPolicy,
            fabricReference: fabricReferenceSummary,
            customerFabricProof: {
              requiredBeforeQuote: true,
              mediaCount: fabricReferenceMedia.length,
              linkCount: fabricReferenceLinks.length,
              referenceLinks: fabricReferenceLinks,
            },
            bulkOrder,
            wearerContext,
            measurementAge: measurementAgeMeta,
            fitProfile,
            styleInspirationLinks: inspirationLinks,
            styleAttributes,
            styleAlignment,
            styleNotes: styleNotes.trim() || null,
            bodyNote: fitNote.trim() || null,
          }
        : {
            fabricHandoffMode: 'NO_CUSTOMER_HANDOFF_REQUIRED' as const,
            fabricHandoffLabel: FABRIC_HANDOFF_LABELS.NO_CUSTOMER_HANDOFF_REQUIRED,
            fabricPolicy,
            fabricReference: fabricReferenceSummary,
            bulkOrder,
            wearerContext,
            measurementAge: measurementAgeMeta,
            fitProfile,
            styleInspirationLinks: inspirationLinks,
            styleAttributes,
            styleAlignment,
            styleNotes: styleNotes.trim() || null,
            bodyNote: fitNote.trim() || null,
            fabricSourcing: {
              description: fabricDescription.trim() || null,
              budgetAmount: fabricBudget,
              budgetCurrency: fabricBudget ? fabricBudgetCurrency : null,
              deadlineBusinessDays: fabricSourcingDeadlineDays,
              referenceLinks: fabricReferenceLinks,
              referenceMediaCount: fabricReferenceMedia.length,
              substitutionPreference: fabricSubstitutionPreference,
              substitutionLabel: fabricSubstitutionOption?.label ?? null,
              suggestedVendor: suggestedFabricVendor,
              bulkFabricMode,
              bulkFabricModeLabel: bulkFabricOption?.label ?? null,
            },
          }

    const composedFitNote = fitNote.trim() || null

    const buildOrderPayload = (
      action: 'preflight-create-order' | 'create-order',
      uploadedReferencePhotos: string[],
      uploadedFabricReferenceMedia: string[] = []
    ) => {
      const supportMetaRecord = supportMeta as Record<string, unknown>
      const fabricReferenceWithUploads = {
        ...fabricReferenceSummary,
        mediaUrls: uploadedFabricReferenceMedia,
      }
      const payloadSupportMeta = {
        ...supportMetaRecord,
        fabricReference: fabricReferenceWithUploads,
        ...(fabricSource === 'TAILOR_SOURCES'
          ? {
              fabricSourcing: {
                ...(supportMetaRecord.fabricSourcing as Record<string, unknown>),
                referenceMediaUrls: uploadedFabricReferenceMedia,
              },
            }
          : {
              customerFabricProof: {
                ...(supportMetaRecord.customerFabricProof as Record<string, unknown>),
                mediaUrls: uploadedFabricReferenceMedia,
              },
            }),
      }

      return {
        action,
        tailorProfileId: tailorId,
        garmentType,
        description: description.trim(),
        occasion: occasion.trim() || null,
        deadline: deadline?.toISOString() ?? null,
        referencePhotos: uploadedReferencePhotos,
        referencePhotoCount: photos.length,
        customerMeasurementsSnapshot: measurementSnapshot,
        fitNote: composedFitNote,
        fabricSource,
        supportMeta: payloadSupportMeta,
        deliveryMethod,
        garmentTypeOther: garmentType === 'Other' ? garmentTypeOther.trim() : null,
        genderPresentation,
        styleReferenceLinks: inspirationLinks,
        styleNotes: styleNotes.trim() || null,
        bodyNote: composedFitNote,
        fabricDescription: fabricSource === 'TAILOR_SOURCES' ? fabricDescription.trim() : null,
        fabricBudgetAmount: fabricSource === 'TAILOR_SOURCES' ? fabricBudget : null,
        fabricBudgetCurrency: fabricSource === 'TAILOR_SOURCES' ? fabricBudgetCurrency : null,
        fabricSourcingDeadlineDays:
          fabricSource === 'TAILOR_SOURCES' ? fabricSourcingDeadlineDays : null,
        fabricReferenceMedia: uploadedFabricReferenceMedia,
        fabricReferenceMediaCount: fabricReferenceMedia.length,
        fabricReferenceLinks,
        fabricSubstitutionPreference:
          fabricSource === 'TAILOR_SOURCES' ? fabricSubstitutionPreference : null,
        bulkFabricMode: isBulkOrder ? bulkFabricMode : null,
        fabricVendorName: fabricSource === 'TAILOR_SOURCES' ? fabricVendorName.trim() || null : null,
        fabricVendorLocation:
          fabricSource === 'TAILOR_SOURCES' ? fabricVendorLocation.trim() || null : null,
        fabricVendorLink: fabricSource === 'TAILOR_SOURCES' ? normalizedVendorLink() : null,
        fabricVendorNotes: fabricSource === 'TAILOR_SOURCES' ? fabricVendorNotes.trim() || null : null,
        shippingPreference: deliveryMethod === 'SHIPPING' ? shippingPreference : null,
        deliveryInstructions: deliveryInstructions.trim() || null,
        deliveryAddress: deliveryMethod !== 'LOCAL_COLLECTION' ? composeDeliveryAddress() : null,
        deliveryCity: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryCity.trim() : null,
        deliveryRegion: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryStateRegion.trim() : null,
        deliveryPostalCode: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryPostalCode.trim() : null,
        deliveryCountryCode: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryCountry.trim() : null,
        deliveryVerificationSource: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryVerificationSource : null,
        deliveryVerificationReference: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryVerificationReference || null : null,
        deliveryVerifiedAt: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryVerifiedAt : null,
        recipientName: deliveryMethod !== 'LOCAL_COLLECTION' ? recipientName.trim() : null,
        recipientPhone:
          deliveryMethod !== 'LOCAL_COLLECTION' ? normalizePhoneForStorage(recipientPhone) : null,
        cancellationPolicyAcknowledged,
      }
    }

    const { data: preflightData, error: preflightError } = await invokeFunction<{
      ok: boolean
      preflight?: boolean
    }>('custom-order-action', {
      body: buildOrderPayload('preflight-create-order', []),
    })

    if (preflightError || !preflightData?.ok) {
      setSubmitting(false)
      if (preflightError) {
        const payload = await readFunctionErrorPayload(preflightError)
        const reportedErrorCode =
          typeof payload?.code === 'string'
            ? payload.code
            : typeof payload?.errorCode === 'string'
              ? payload.errorCode
              : null
        const errorCode = reportedErrorCode ?? 'CUSTOM_ORDER_PREFLIGHT_FAILED'
        const diagnostic = {
          context: 'custom_order_preflight',
          tailorId,
          errorCode,
          missingMeasurements: errorCode === 'MEASUREMENTS_INCOMPLETE' ? missingSnapshotMeasurements : undefined,
        }
        if (reportedErrorCode) {
          // Authoritative business gates are expected outcomes, not application crashes.
          Sentry.addBreadcrumb({
            category: 'custom_order_preflight',
            level: 'warning',
            message: reportedErrorCode,
            data: diagnostic,
          })
        } else {
          Sentry.captureException(preflightError, { extra: diagnostic })
        }
      }
      const message = await resolveOrderSubmitErrorMessage(preflightError)
      if (message.toLowerCase().includes('delivery address')) {
        setDeliveryAddressError('Please enter your full delivery address before continuing.')
      }
      Alert.alert('Order not ready', message)
      return
    }

    // Upload reference photos only after server-side preflight passes.
    const uploadedUrls: string[] = []
    for (const uri of photos) {
      try {
        const cleanUri = await stripExif(uri)
        const publicUrl = await uploadPublicStorageImage({
          bucket: 'order-photos',
          path: createBriefPhotoPath(user?.id),
          uri: cleanUri,
          contentType: 'image/jpeg',
          maxBytes: 10 * 1024 * 1024,
        })
        uploadedUrls.push(publicUrl)
      } catch (error) {
        setSubmitting(false)
        Alert.alert(
          'Upload failed',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. One of your reference photos could not be uploaded yet. Retry when the signal improves.'
            : 'One of your reference photos could not be uploaded right now. Please try again in a moment.'
        )
        return
      }
    }

    const uploadedFabricUrls: string[] = []
    for (const asset of fabricReferenceMedia) {
      try {
        uploadedFabricUrls.push(await uploadFabricReferenceAsset(asset))
      } catch (error) {
        setSubmitting(false)
        Alert.alert(
          'Upload failed',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. One of your fabric references could not be uploaded yet. Retry when the signal improves.'
            : 'One of your fabric references could not be uploaded right now. Please try again in a moment.'
        )
        return
      }
    }

    const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>(
      'custom-order-action',
      {
        body: buildOrderPayload('create-order', uploadedUrls, uploadedFabricUrls),
      }
    )

    setSubmitting(false)

    if (error || !data?.orderId) {
      if (error)
        Sentry.captureException(error, { extra: { context: 'custom_order_create', tailorId } })
      const message = await resolveOrderSubmitErrorMessage(error)
      if (message.toLowerCase().includes('delivery address')) {
        setDeliveryAddressError('Please enter your full delivery address before continuing.')
      }
      Alert.alert('Order not sent', message)
      return
    }

    capture('order_placed', {
      garment_type: garmentType,
      has_photos: uploadedUrls.length > 0,
      fabric_reference_media_count: uploadedFabricUrls.length,
      has_measurements: !!measurementSnapshot,
      measurement_source: measurementSnapshot?.measurementSource ?? null,
      fabric_source: fabricSource,
      fabric_handoff_mode: supportMeta.fabricHandoffMode ?? null,
      delivery_method: deliveryMethod,
      bulk_order: isBulkOrder,
      wearer_mode: wearerContext.mode,
      has_deadline: !!deadline,
    })

    await invokeFunction('custom-order-draft-action', {
      body: { action: 'delete', tailorProfileId: tailorId },
    })

    resetTo(router, {
      pathname: '/(customer)/orders/[id]',
      params: {
        id: data.orderId,
        sent: '1',
        tab: 'active',
        returnTo: '/(customer)/orders?tab=active',
      },
    })
  }

  function next() {
    if (submitting) return
    if (step === 2 && !measurements) {
      Alert.alert(
        'Measurements required',
        'Please complete your measurement profile before placing an order. This gives your tailor the fit context they need for an accurate quote.',
        [
          {
            text: 'Set up now',
            onPress: () =>
              router.replace({
                pathname: '/(customer)/profile/measurements',
                params: buildResumeBriefReturnParams(),
              }),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      )
      return
    }
    if (!canProceed()) return
    if (step < STEP_TITLES.length - 1) {
      setStep(step + 1)
    } else {
      submit()
    }
  }

  function back() {
    if (step > 0) setStep(step - 1)
    else goBack()
  }

  useContextualBackHandler(back)

  async function dismissMeasPrompt(goToMeasurements: boolean) {
    await AsyncStorage.setItem(MEAS_PROMPT_KEY, '1')
    setShowMeasPrompt(false)
    if (goToMeasurements) {
      router.replace({
        pathname: '/(customer)/profile/measurements',
        params: buildResumeBriefReturnParams(),
      })
    }
  }

  function formatDate(value: Date | null) {
    return value
      ? value.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Not set'
  }

  function deliveryMethodLabel(value: DeliveryMethod | null) {
    if (value === 'SHIPPING') return 'Ship to me'
    if (value === 'LOCAL_DELIVERY') return 'Local delivery'
    if (value === 'LOCAL_COLLECTION') return 'Local collection'
    return 'Not set'
  }

  function fabricSourceLabel(value: FabricSource | null) {
    if (value === 'CUSTOMER_SUPPLIES') return 'I will provide the fabric'
    if (value === 'TAILOR_SOURCES') return 'Tailor sources the fabric'
    return 'Not set'
  }

  function fabricSubstitutionLabel() {
    return FABRIC_SUBSTITUTION_OPTIONS.find((option) => option.value === fabricSubstitutionPreference)?.label ?? 'Not set'
  }

  function bulkFabricModeLabel() {
    return BULK_FABRIC_MODE_OPTIONS.find((option) => option.value === bulkFabricMode)?.label ?? 'Not set'
  }

  function renderFabricReferenceSection() {
    if (!fabricSource) return null
    const title = fabricSource === 'CUSTOMER_SUPPLIES' ? 'Fabric proof' : 'Fabric references'
    const hint = fabricSource === 'CUSTOMER_SUPPLIES'
      ? 'Add at least one photo or short video of the fabric you will provide, including color, texture, and available yardage if possible.'
      : 'Add a fabric photo, short video, or sourcing link so the tailor knows what to search for before quoting.'

    return (
      <View>
        <Text style={styles.fieldLabel}>
          {title} <Text style={styles.required}>*</Text>
        </Text>
        <Text style={styles.fieldHint}>{hint}</Text>
        <View style={[styles.photoGrid, { marginTop: Spacing.md }]}>
          {fabricReferenceMedia.map((asset) => (
            <View key={asset.id} style={styles.photoThumb}>
              {asset.kind === 'video' ? (
                <PortfolioVideoPreview
                  uri={asset.uri}
                  style={styles.photoImage}
                  autoplay={false}
                  isLooping={false}
                  nativeControls={false}
                />
              ) : (
                <RemoteImage
                  uri={asset.uri}
                  style={styles.photoImage}
                  contentFit="cover"
                  transition={120}
                  surface="customer_brief_fabric_reference_preview"
                />
              )}
              <View style={styles.mediaKindBadge}>
                <Text style={styles.mediaKindBadgeText}>{asset.kind === 'video' ? 'VIDEO' : 'PHOTO'}</Text>
              </View>
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => removeFabricReferenceMedia(asset.id)}
                accessibilityRole="button"
                accessibilityLabel="Remove fabric reference"
              >
                <Text style={styles.photoRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          {fabricReferenceMedia.length < MAX_FABRIC_REFERENCE_MEDIA && (
            <TouchableOpacity style={styles.photoAdd} onPress={openFabricMediaPicker}>
              <Text style={styles.photoAddIcon}>+</Text>
              <Text style={styles.photoAddLabel}>Add media</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.photoCount}>
          {fabricReferenceMedia.length}/{MAX_FABRIC_REFERENCE_MEDIA} media files
        </Text>

        {fabricSource === 'TAILOR_SOURCES' ? (
          <View style={styles.fabricLinkBlock}>
            <Text style={styles.fieldLabel}>Fabric links</Text>
            <Text style={styles.fieldHint}>
              Optional Instagram, Pinterest, or TikTok fabric references. A media upload or one supported link is required.
            </Text>
            <View style={styles.inspirationInputRow}>
              <View style={{ flex: 1 }}>
                <Input
                  label=""
                  placeholder="Paste an Instagram / Pinterest / TikTok link"
                  value={fabricReferenceInput}
                  onChangeText={(value) => {
                    setFabricReferenceInput(value)
                    if (fabricReferenceLinkError) setFabricReferenceLinkError('')
                  }}
                  containerStyle={{ marginBottom: 0 }}
                  onSubmitEditing={addFabricReferenceLink}
                  returnKeyType="done"
                />
              </View>
              <TouchableOpacity style={styles.inspirationAddBtn} onPress={addFabricReferenceLink}>
                <Text style={styles.inspirationAddText}>Add</Text>
              </TouchableOpacity>
            </View>
            {fabricReferenceLinkError ? <Text style={styles.linkError}>{fabricReferenceLinkError}</Text> : null}
            {fabricReferenceLinks.length > 0 ? (
              <View style={styles.selectedLinks}>
                {fabricReferenceLinks.map((link) => (
                  <View key={link} style={styles.selectedLinkBadge}>
                    <Text style={styles.selectedLinkText} numberOfLines={1}>{link}</Text>
                    <TouchableOpacity onPress={() => removeFabricReferenceLink(link)}>
                      <Text style={styles.selectedLinkRemove}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    )
  }

  function renderBulkFabricModeSection() {
    if (!isBulkOrder || !fabricSource) return null
    return (
      <View>
        <Text style={styles.fieldLabel}>
          Group fabric plan <Text style={styles.required}>*</Text>
        </Text>
        <Text style={styles.fieldHint}>
          Tell the tailor whether this group needs one dye lot, coordinated variations, or separate fabric per wearer.
        </Text>
        <View style={[styles.optionCards, { marginTop: Spacing.sm }]}>
          {BULK_FABRIC_MODE_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              title={option.label}
              hint={option.hint}
              active={bulkFabricMode === option.value}
              onPress={() => setBulkFabricMode(option.value)}
            />
          ))}
        </View>
      </View>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.errorState}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order brief</Text>
            <Text style={styles.errorTitle}>Couldn't load this order form</Text>
            <Text style={styles.errorHint}>Please go back and try again in a moment.</Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Recovery</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, explore tailors first, then open your
                measurements if needed, so the next booking can keep moving.
              </Text>
            </View>
            <TouchableOpacity style={styles.errorBtn} onPress={() => void loadInitialData()}>
              <Text style={styles.errorBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.errorBtn, styles.errorBtnSecondary]}
              onPress={() => router.replace('/(customer)')}
            >
              <Text style={[styles.errorBtnText, styles.errorBtnTextSecondary]}>
                Explore tailors
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.errorBtn, styles.errorBtnSecondary]}
              onPress={() =>
                router.replace({
                  pathname: '/(customer)/profile/measurements',
                  params: buildResumeBriefReturnParams(),
                })
              }
            >
              <Text style={[styles.errorBtnText, styles.errorBtnTextSecondary]}>
                Open measurements
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.errorBtn, styles.errorBtnSecondary]} onPress={goBack}>
              <Text style={[styles.errorBtnText, styles.errorBtnTextSecondary]}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingState}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order brief</Text>
            <Text style={styles.loadingTitle}>Preparing your order brief…</Text>
            <Text style={styles.loadingHint}>
              We’re loading your tailor details and measurement profile so the quote can start from
              the right context.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>
            Step {step + 1} of {STEP_TITLES.length}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Progress bar */}
        <View style={styles.progressRow}>
          {STEP_TITLES.map((_, i) => (
            <View key={i} style={[styles.progressSeg, i <= step && styles.progressSegDone]} />
          ))}
        </View>

        <KeyboardAwareScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE + Spacing.xxxl,
          }}
          {...actionDockScroll}
        >
        <View style={styles.content}>
          {draftStatus ? (
            <View style={styles.guideCard} accessibilityLiveRegion="polite">
              <Text style={styles.guideTitle}>
                {draftStatus === 'loading' ? 'Checking for a saved request…' : draftStatus === 'restored' ? 'Request restored' : draftStatus === 'saving' ? 'Saving request…' : draftStatus === 'saved' ? 'Request saved' : 'Draft could not save'}
              </Text>
              {draftStatus === 'restored' || draftAttachmentWarning ? (
                <Text style={styles.guideText}>
                  {draftAttachmentWarning ? 'Your written details were restored. Recheck photo and video attachments on this device before submitting.' : 'You can continue from where you stopped on any signed-in Drapeon device.'}
                </Text>
              ) : null}
            </View>
          ) : null}
            <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
            <Text style={styles.stepSubtitle}>{STEP_SUBS[step]}</Text>
            {/* ── Step 0: Garment details ── */}
            {step === 0 && (
              <View style={styles.fields}>
                {/* Garment type picker */}
                <View>
                  <Text style={styles.fieldLabel}>
                    Garment type <Text style={styles.required}>*</Text>
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.garmentSelectCard,
                      !!garmentType && styles.garmentSelectCardActive,
                    ]}
                    onPress={() => setShowGarmentPicker(true)}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Choose garment type"
                  >
                    <View style={styles.garmentSelectCopy}>
                      <Text
                        style={[
                          styles.garmentSelectValue,
                          !selectedGarmentLabel && styles.garmentSelectPlaceholder,
                        ]}
                      >
                        {selectedGarmentLabel || 'Choose garment type'}
                      </Text>
                      <Text style={styles.garmentSelectHint}>
                        Browse cultural, formal, modest, and contemporary categories.
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={21} color={Colors.midGrey} />
                  </TouchableOpacity>
                  {garmentType === 'Other' ? (
                    <Input
                      label="What are you having made?"
                      placeholder="e.g. Carnival costume, stage outfit, altar server robe"
                      value={garmentTypeOther}
                      onChangeText={setGarmentTypeOther}
                      required
                    />
                  ) : null}
                </View>

                <View>
                  <Text style={styles.fieldLabel}>
                    Fit category <Text style={styles.required}>*</Text>
                  </Text>
                  <Text style={styles.fieldHint}>
                    Choose the fit convention your tailor should use for this garment.
                  </Text>
                  <View style={styles.segmentedControl}>
                    {CUSTOM_ORDER_GENDER_PRESENTATIONS.map((value) => (
                      <TouchableOpacity
                        key={value}
                        style={[
                          styles.segmentedItem,
                          genderPresentation === value && styles.segmentedItemActive,
                        ]}
                        onPress={() => setGenderPresentation(value)}
                        activeOpacity={0.78}
                        accessibilityRole="button"
                        accessibilityState={{ selected: genderPresentation === value }}
                      >
                        <Text
                          style={[
                            styles.segmentedItemText,
                            genderPresentation === value && styles.segmentedItemTextActive,
                          ]}
                        >
                          {value}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <Input
                  label="Brief description"
                  placeholder={
                    'Line 1: what you want made\nLine 2: silhouette, details, or references\nLine 3: finish, fit, or anything important'
                  }
                  value={description}
                  onChangeText={(v) => {
                    setDescription(v)
                    if (descriptionError) validateDescription(v)
                  }}
                  onBlur={() => validateDescription(description)}
                  error={descriptionError}
                  multiline
                  numberOfLines={5}
                  maxLength={1200}
                  filterContact
                  required
                  hint="3 short lines or one clear paragraph."
                  showCharacterCount
                  testID="description-input"
                />

                <Input
                  label="Occasion (optional)"
                  placeholder="e.g. Wedding, graduation, Eid"
                  value={occasion}
                  onChangeText={setOccasion}
                  testID="occasion-input"
                />

                {GROUP_ORDERS_ENABLED ? <View>
                  <Text style={styles.fieldLabel}>Who is this order for?</Text>
                  <Text style={styles.fieldHint}>
                    Most orders are for one person. Use group when multiple people need linked
                    outfits.
                  </Text>
                  <View style={styles.segmentedControl}>
                    <TouchableOpacity
                      style={[styles.segmentedItem, !isBulkOrder && styles.segmentedItemActive]}
                      onPress={() => setIsBulkOrder(false)}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityState={{ selected: !isBulkOrder }}
                    >
                      <Text
                        style={[
                          styles.segmentedItemText,
                          !isBulkOrder && styles.segmentedItemTextActive,
                        ]}
                      >
                        One person
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.segmentedItem, isBulkOrder && styles.segmentedItemActive]}
                      onPress={() => setIsBulkOrder(true)}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isBulkOrder }}
                    >
                      <Text
                        style={[
                          styles.segmentedItemText,
                          isBulkOrder && styles.segmentedItemTextActive,
                        ]}
                      >
                        Group
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View> : null}

                {isBulkOrder ? (
                  <View style={styles.measureSubcard}>
                    <Input
                      label="How many people?"
                      placeholder="e.g. 4"
                      value={bulkRecipientCount}
                      onChangeText={setBulkRecipientCount}
                      keyboardType="number-pad"
                      hint="Use the expected number of recipients or outfit variations in this group order."
                      required
                    />
                    <Input
                      label="Group label (optional)"
                      placeholder="e.g. Asoebi for Ada's wedding"
                      value={bulkLabel}
                      onChangeText={setBulkLabel}
                    />
                    <Input
                      label="Group member names (optional)"
                      placeholder={'One per line, e.g.\nAda\nTola\nMum'}
                      value={bulkMemberNames}
                      onChangeText={setBulkMemberNames}
                      multiline
                      numberOfLines={4}
                      maxLength={500}
                      hint="This keeps the order legible for the tailor and ops. Each person still needs their own measurements before cutting."
                      showCharacterCount
                    />
                    <Input
                      label="Group notes (optional)"
                      placeholder="Anything ops and the tailor should know about dye-lot consistency, measurement privacy, or linked recipients..."
                      value={bulkNotes}
                      onChangeText={setBulkNotes}
                      multiline
                      numberOfLines={3}
                      maxLength={300}
                      showCharacterCount
                    />
                    <Text style={styles.measureSubcardHint}>
                      Bulk custom orders stay inside Drapeon, but ops may help manage linked
                      recipients, dye-lot consistency, and measurement privacy before quote
                      acceptance.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.measureSubcard}>
                    <Text style={styles.fieldLabel}>Whose measurements should the tailor use?</Text>
                    <Text style={styles.fieldHint}>
                      This prevents gift or family orders from accidentally using the buyer's fit
                      profile.
                    </Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity
                        style={[
                          styles.segmentedItem,
                          wearerMode === 'SELF' && styles.segmentedItemActive,
                        ]}
                        onPress={() => {
                          setWearerMode('SELF')
                          setWearerName('')
                        }}
                        activeOpacity={0.78}
                        accessibilityRole="button"
                        accessibilityState={{ selected: wearerMode === 'SELF' }}
                      >
                        <Text
                          style={[
                            styles.segmentedItemText,
                            wearerMode === 'SELF' && styles.segmentedItemTextActive,
                          ]}
                        >
                          {savedMeasurementProfileLabel}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.segmentedItem,
                          wearerMode === 'OTHER' && styles.segmentedItemActive,
                        ]}
                        onPress={() => setWearerMode('OTHER')}
                        activeOpacity={0.78}
                        accessibilityRole="button"
                        accessibilityState={{ selected: wearerMode === 'OTHER' }}
                      >
                        <Text
                          style={[
                            styles.segmentedItemText,
                            wearerMode === 'OTHER' && styles.segmentedItemTextActive,
                          ]}
                        >
                          Someone else
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {wearerMode === 'OTHER' ? (
                      <Input
                        label="Wearer name"
                        placeholder="e.g. Mum, Tola, my brother"
                        value={wearerName}
                        onChangeText={setWearerName}
                        required
                        hint="Before submitting, make sure the saved measurements above belong to this person."
                      />
                    ) : null}
                  </View>
                )}

                <View>
                  <Text style={styles.fieldLabel}>
                    Deadline <Text style={styles.required}>*</Text>
                  </Text>
                  <Text style={styles.fieldHint}>
                    When do you need this by? Minimum is 2 weeks from today.
                  </Text>
                  <TouchableOpacity
                    style={[styles.dateButton, !deadline && styles.dateButtonRequired]}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Text style={[styles.dateText, !deadline && styles.datePlaceholder]}>
                      {deadline
                        ? deadline.toLocaleDateString('en-GB', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })
                        : 'Select your deadline'}
                    </Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={deadline ?? defaultDeadline()}
                      mode="date"
                      minimumDate={customOrderMinimumDeliveryDate()}
                      onChange={(_, date) => {
                        setShowDatePicker(false)
                        if (date) {
                          setDeadline(date)
                          validateDeadline(date)
                        }
                      }}
                    />
                  )}
                  {deadlineError ? <Text style={styles.linkError}>{deadlineError}</Text> : null}
                  {deadlineNotice ? (
                    <Text style={styles.fieldHint}>{deadlineNotice}</Text>
                  ) : null}
                </View>
              </View>
            )}

            {/* ── Step 1: Reference photos + style inspiration ── */}
            {step === 1 && (
              <View style={styles.fields}>
                {/* Photos */}
                <View>
                  <Text style={styles.fieldLabel}>Reference photos</Text>
                  <Text style={styles.fieldHint}>
                    Inspiration photos, sketches, or similar garments you love. Add at least one
                    photo or link.
                  </Text>
                  <View style={[styles.photoGrid, { marginTop: Spacing.md }]}>
                    {photos.map((uri, i) => (
                      <View key={i} style={styles.photoThumb}>
                        <RemoteImage
                          uri={uri}
                          style={styles.photoImage}
                          contentFit="cover"
                          transition={120}
                          surface="customer_brief_reference_preview"
                        />
                        <TouchableOpacity
                          style={styles.photoRemove}
                          onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Text style={styles.photoRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {photos.length < CUSTOM_ORDER_MAX_REFERENCE_PHOTOS && (
                      <TouchableOpacity style={styles.photoAdd} onPress={pickPhoto}>
                        <Text style={styles.photoAddIcon}>+</Text>
                        <Text style={styles.photoAddLabel}>Add photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.photoCount}>
                    {photos.length}/{CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} photos
                  </Text>
                </View>

                {/* Style inspiration */}
                <View style={styles.inspirationSection}>
                  <Text style={styles.fieldLabel}>Style inspiration</Text>
                  <Text style={styles.fieldHint}>
                    Add Instagram, Pinterest, or TikTok links to styles you like, up to{' '}
                    {CUSTOM_ORDER_MAX_STYLE_LINKS}.
                  </Text>

                  {/* Supported link types */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.handlesScroll}
                  >
                    <View style={styles.handlesRow}>
                      {SUPPORTED_STYLE_LINK_LABELS.map((label) => (
                        <View key={label} style={styles.handleChip}>
                          <Text style={styles.handleChipText}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>

                  {/* Custom link input */}
                  <View style={styles.inspirationInputRow}>
                    <View style={{ flex: 1 }}>
                      <Input
                        label=""
                        placeholder="Paste an Instagram / Pinterest / TikTok post link"
                        value={inspirationInput}
                        onChangeText={(v) => {
                          setInspirationInput(v)
                          if (linkError) setLinkError('')
                        }}
                        containerStyle={{ marginBottom: 0 }}
                        onSubmitEditing={addCustomInspirationLink}
                        returnKeyType="done"
                      />
                    </View>
                    <TouchableOpacity
                      style={styles.inspirationAddBtn}
                      onPress={addCustomInspirationLink}
                    >
                      <Text style={styles.inspirationAddText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                  {linkError ? <Text style={styles.linkError}>{linkError}</Text> : null}

                  {/* Selected inspiration links */}
                  {inspirationLinks.length > 0 && (
                    <View style={styles.selectedLinks}>
                      {inspirationLinks.map((link) => (
                        <View key={link} style={styles.selectedLinkBadge}>
                          <Text style={styles.selectedLinkText} numberOfLines={1}>
                            {link}
                          </Text>
                          <TouchableOpacity onPress={() => removeInspirationLink(link)}>
                            <Text style={styles.selectedLinkRemove}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Style details</Text>
                  <Text style={styles.fieldHint}>
                    Choose focus areas only if they matter. Add anything the references do not
                    capture below.
                  </Text>
                  <TouchableOpacity
                    style={styles.dropdownField}
                    onPress={() => setShowFocusAreasPicker(true)}
                    activeOpacity={0.78}
                    accessibilityRole="button"
                    accessibilityLabel="Choose style focus areas"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dropdownValue} numberOfLines={1}>
                        {styleAttributes.length > 0
                          ? styleAttributes.join(', ')
                          : 'Optional focus areas'}
                      </Text>
                      <Text style={styles.dropdownMeta}>
                        {styleAttributes.length > 0
                          ? `${styleAttributes.length} selected`
                          : 'Sleeves, neckline, fit, finishing...'}
                      </Text>
                    </View>
                    <Text style={styles.dropdownChevron}>⌄</Text>
                  </TouchableOpacity>
                </View>

                <Input
                  label="Style notes (optional)"
                  placeholder="Colours, sleeve shape, neckline, modesty preference, embellishment, lining, pockets..."
                  value={styleNotes}
                  onChangeText={setStyleNotes}
                  multiline
                  numberOfLines={4}
                  maxLength={1200}
                  filterContact
                  hint="Reference style, finish, coverage, and comfort notes."
                  showCharacterCount
                />
              </View>
            )}

            {/* ── Step 2: Measurements ── */}
            {step === 2 && (
              <View style={styles.fields}>
                {measurements ? (
                  <View style={styles.measureSummaryCard}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={styles.measureSummaryTitle}>Your measurements</Text>
                      <Text style={styles.measureEditHint}>
                        {(() => {
                          const FIELDS = [
                            'chest',
                            'waist',
                            'hips',
                            'shoulderWidth',
                            'inseam',
                            'sleeveLength',
                            'neckCircumference',
                            'height',
                            'backLength',
                            'outseam',
                            'thighCircumference',
                            'kneeCircumference',
                            'torsoLength',
                          ]
                          const filled = FIELDS.filter((k) => measurements[k] != null).length
                          return filled < FIELDS.length
                            ? `${filled}/${FIELDS.length} · Tap to edit`
                            : 'Tap any field to edit'
                        })()}
                      </Text>
                    </View>
                    {typeof measurements.measurementSource === 'string' ? (
                      <View style={styles.measureSourceRow}>
                        <Text style={styles.measureSourceLabel}>Source</Text>
                        <Text style={styles.measureSourceValue}>
                          {MEASUREMENT_SOURCE_LABELS[
                            measurements.measurementSource as keyof typeof MEASUREMENT_SOURCE_LABELS
                          ] ?? measurements.measurementSource}
                        </Text>
                      </View>
                    ) : null}
                    {measurementAgeSummary ? (
                      <View style={styles.measureSourceRow}>
                        <Text style={styles.measureSourceLabel}>Last updated</Text>
                        <Text
                          style={[
                            styles.measureSourceValue,
                            measurementAgeSummary.stale && styles.measureSourceValueWarning,
                          ]}
                        >
                          {measurementAgeSummary.label}
                        </Text>
                      </View>
                    ) : null}
                    {measurementAgeSummary?.stale ? (
                      <View style={styles.measureAgeCard}>
                        <View style={styles.measureAgeIcon}>
                          <Feather name="clock" size={16} color={Colors.kanteRust} />
                        </View>
                        <View style={styles.measureAgeCopy}>
                          <Text style={styles.measureAgeTitle}>Refresh if your fit changed</Text>
                          <Text style={styles.measureAgeText}>
                            These measurements are over {STALE_MEASUREMENT_MONTHS} months old. If
                            body shape, comfort, or fit preference changed, update them before this
                            tailor quotes.
                          </Text>
                          <TouchableOpacity
                            style={styles.measureAgeAction}
                            onPress={() =>
                              router.replace({
                                pathname: '/(customer)/profile/measurements',
                                params: buildResumeBriefReturnParams(),
                              })
                            }
                          >
                            <Text style={styles.measureAgeActionText}>Update measurements</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                    <MeasurementModule
                      title="Core fit"
                      subtitle={`${filledMeasurementCount}/${measurementReviewFields.length} saved values. Review the full profile only if this order needs extra detail.`}
                      icon="target"
                      fields={coreMeasurementReviewFields.map(({ key, label, value }) => ({
                        key,
                        label,
                        value: value as string | number | null | undefined,
                        unit: measurementUnit,
                        onPress: () => {
                          setEditingField({ key, label, value: value ? String(value) : '' })
                          setEditValue(value ? String(value) : '')
                        },
                      }))}
                    />
                    <View style={styles.measureActionsRow}>
                      {measurementProfileOptions.length > 0 ? (
                        <TouchableOpacity
                          style={styles.measureActionBtn}
                          onPress={() => setMeasurementProfileSheetOpen(true)}
                          accessibilityRole="button"
                          accessibilityLabel="Change measurement profile"
                        >
                          <Text style={styles.measureActionBtnText}>Change profile</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        style={styles.measureActionBtn}
                        onPress={() => setMeasurementReviewOpen(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Review all measurements"
                      >
                        <Text style={styles.measureActionBtnText}>Review measurements</Text>
                      </TouchableOpacity>
                    </View>
                    {asStringList(measurements.fitFlags).length > 0 && (
                      <View style={styles.flagsRow}>
                        {asStringList(measurements.fitFlags).map((f) => (
                          <View key={f} style={styles.flagBadge}>
                            <Text style={styles.flagBadgeText}>{labelFitContextFlag(f)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    <View style={styles.measureSubcard}>
                      <View style={styles.measureSourceRow}>
                        <Text style={styles.measureSourceLabel}>Fit notes</Text>
                        <Text style={styles.measureSourceValue}>
                          {guidedFitProfile?.status
                            ? MEASUREMENT_SCAN_STATUS_LABELS[guidedFitProfile.status]
                            : 'Recommended'}
                        </Text>
                      </View>
                      {guidedFitProfile ? (
                        <>
                          {guidedFitProfile.fitIntent ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Fit direction</Text>
                              <Text style={styles.measureSourceValue}>
                                {FIT_INTENT_LABELS[guidedFitProfile.fitIntent]}
                              </Text>
                            </View>
                          ) : null}
                          {guidedFitProfile.fabricStretch ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Stretch</Text>
                              <Text style={styles.measureSourceValue}>
                                {FABRIC_STRETCH_LABELS[guidedFitProfile.fabricStretch]}
                              </Text>
                            </View>
                          ) : null}
                          {guidedFitProfile.wearDaySupport ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Support</Text>
                              <Text style={styles.measureSourceValue}>
                                {WEAR_DAY_SUPPORT_LABELS[guidedFitProfile.wearDaySupport]}
                              </Text>
                            </View>
                          ) : null}
                          {guidedFitProfile.coveragePreference ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Coverage</Text>
                              <Text style={styles.measureSourceValue}>
                                {COVERAGE_PREFERENCE_LABELS[guidedFitProfile.coveragePreference]}
                              </Text>
                            </View>
                          ) : null}
                          <Text style={styles.measureSubcardHint}>
                            {guidedFitProfile.requiresTailorReview
                              ? 'This order will carry a tailor-review checkpoint before cutting starts.'
                              : 'These fit notes will be attached to the order for pre-cutting review.'}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.measureSubcardHint}>
                            Add optional posture, stretch, coverage, and symmetry notes when this
                            order needs more context than measurements.
                          </Text>
                          <TouchableOpacity
                            style={styles.measureActionBtn}
                            onPress={() =>
                              router.replace({
                                pathname: '/(customer)/profile/guided-fit',
                                params: buildResumeBriefReturnParams(),
                              })
                            }
                          >
                            <Text style={styles.measureActionBtnText}>Add fit notes</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={styles.noMeasureCard}>
                    <Text style={styles.noMeasureTitle}>Measurements not set up</Text>
                    <Text style={styles.noMeasureHint}>
                      Add saved measurements before sending this brief so the tailor can quote accurately.
                    </Text>
                    <TouchableOpacity
                      style={styles.noMeasureBtn}
                      onPress={() =>
                        router.replace({
                          pathname: '/(customer)/profile/measurements',
                          params: buildResumeBriefReturnParams(),
                        })
                      }
                    >
                      <Text style={styles.noMeasureBtnText}>Set up measurements</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Input
                  label="Body note"
                  placeholder="e.g. I prefer extra room in the shoulders, I have a shorter torso, or I like trousers to sit high on the waist."
                  value={fitNote}
                  onChangeText={(v) => {
                    setFitNote(v)
                    if (fitNoteError) validateFitNote(v)
                  }}
                  onBlur={() => validateFitNote(fitNote)}
                  error={fitNoteError}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  filterContact
                  required
                  hint="Min 20 characters. No contact details."
                  showCharacterCount
                />
                <View style={styles.quickAddList}>
                  {FIT_NOTE_PRESETS.map((value) => (
                    <QuickAddRow
                      key={value}
                      label={value}
                      onPress={() => {
                        const next =
                          fitNote.trim().length > 0 ? `${fitNote.trim()}. ${value}` : value
                        setFitNote(next)
                        if (fitNoteError) validateFitNote(next)
                      }}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* ── Step 3: Fabric ── */}
            {step === 3 && (
              <View style={styles.fields}>
                <View>
                  <Text style={styles.fieldLabel}>
                    Who provides the fabric? <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.optionCards}>
                    <OptionCard
                      title="I will provide the fabric"
                      hint="The tailor confirms receipt with a photo before cutting begins."
                      active={fabricSource === 'CUSTOMER_SUPPLIES'}
                      onPress={() => setFabricSource('CUSTOMER_SUPPLIES')}
                    />
                    <OptionCard
                      title="Tailor sources the fabric"
                      hint="The tailor uploads fabric for your approval before cutting begins."
                      active={fabricSource === 'TAILOR_SOURCES'}
                      onPress={() => setFabricSource('TAILOR_SOURCES')}
                    />
                  </View>
                </View>

                {fabricSource ? renderFabricReferenceSection() : null}
                {renderBulkFabricModeSection()}

                {fabricSource === 'CUSTOMER_SUPPLIES' && (
                  <View>
                    <View style={styles.guideCard}>
                      <Text style={styles.guideTitle}>Fabric handoff</Text>
                      <Text style={styles.guideText}>
                        Production stays paused until the tailor confirms the fabric has arrived. If
                        the fabric is unsuitable, the order goes to customer and ops review before
                        work continues.
                      </Text>
                    </View>
                    <Text style={styles.fieldLabel}>
                      How will the fabric reach the tailor? <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.optionCards}>
                      {FABRIC_HANDOFF_OPTIONS.map((option) => (
                        <OptionCard
                          key={option.value}
                          title={option.title}
                          hint={option.hint}
                          active={fabricHandoffMode === option.value}
                          onPress={() => setFabricHandoffMode(option.value)}
                        />
                      ))}
                    </View>
                  </View>
                )}

                {fabricSource === 'TAILOR_SOURCES' && (
                  <View style={styles.fields}>
                    <Input
                      label="Fabric description"
                      placeholder="Colour, fabric type, texture, weight, print size, stretch, lining needs..."
                      value={fabricDescription}
                      onChangeText={setFabricDescription}
                      multiline
                      numberOfLines={4}
                      maxLength={1000}
                      filterContact
                      required
                      hint="Describe enough for sourcing approval."
                      showCharacterCount
                    />
                    <View>
                      <MoneyInput
                        label="Fabric budget"
                        value={fabricBudgetAmount}
                        onChangeText={setFabricBudgetAmount}
                        currency={fabricBudgetCurrency}
                        required
                        hint="Set the maximum fabric sourcing budget before the tailor quotes."
                      />
                      <Text style={styles.fieldLabel}>
                        Budget currency <Text style={styles.required}>*</Text>
                      </Text>
                      <TouchableOpacity
                        style={styles.dropdownField}
                        onPress={() => setFabricCurrencySheetOpen(true)}
                        activeOpacity={0.78}
                        accessibilityRole="button"
                        accessibilityLabel="Choose fabric budget currency"
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.dropdownValue}>{fabricBudgetCurrency}</Text>
                          <Text style={styles.dropdownMeta}>
                            {SUPPORTED_CURRENCIES.find((option) => option.code === fabricBudgetCurrency)?.name ?? 'Budget currency'}
                          </Text>
                        </View>
                        <Text style={styles.dropdownChevron}>⌄</Text>
                      </TouchableOpacity>
                    </View>
                    <View>
                      <Text style={styles.fieldLabel}>
                        Substitution rule <Text style={styles.required}>*</Text>
                      </Text>
                      <Text style={styles.fieldHint}>
                        Decide what should happen if the exact fabric cannot be found.
                      </Text>
                      <View style={[styles.optionCards, { marginTop: Spacing.sm }]}>
                        {FABRIC_SUBSTITUTION_OPTIONS.map((option) => (
                          <OptionCard
                            key={option.value}
                            title={option.label}
                            hint={option.hint}
                            active={fabricSubstitutionPreference === option.value}
                            onPress={() => setFabricSubstitutionPreference(option.value)}
                          />
                        ))}
                      </View>
                    </View>

                    <View>
                      <Text style={styles.fieldLabel}>Suggested vendor</Text>
                      <Text style={styles.fieldHint}>
                        Optional. Share a market stall, shop, or supplier you want the tailor to check first.
                      </Text>
                      <View style={styles.vendorFields}>
                        <Input
                          label="Vendor name"
                          placeholder="e.g. Balogun Market stall"
                          value={fabricVendorName}
                          onChangeText={setFabricVendorName}
                          maxLength={120}
                          filterContact
                        />
                        <Input
                          label="Vendor location"
                          placeholder="City, market, store location"
                          value={fabricVendorLocation}
                          onChangeText={setFabricVendorLocation}
                          maxLength={180}
                          filterContact
                        />
                        <Input
                          label="Vendor link"
                          placeholder="Website or social link"
                          value={fabricVendorLink}
                          onChangeText={(value) => {
                            setFabricVendorLink(value)
                            if (fabricVendorLinkError) setFabricVendorLinkError('')
                          }}
                          onBlur={() => validateFabricVendorLink()}
                          autoCapitalize="none"
                          keyboardType="url"
                          maxLength={240}
                          error={fabricVendorLinkError}
                        />
                        <Input
                          label="Vendor note"
                          placeholder="Anything the tailor should ask or confirm"
                          value={fabricVendorNotes}
                          onChangeText={setFabricVendorNotes}
                          multiline
                          numberOfLines={3}
                          maxLength={400}
                          filterContact
                          showCharacterCount
                        />
                      </View>
                    </View>

                    <View>
                      <Text style={styles.fieldLabel}>
                        Sourcing deadline <Text style={styles.required}>*</Text>
                      </Text>
                      <Text style={styles.fieldHint}>
                        How long should the tailor have to source fabric before you are updated?
                      </Text>
                      <View style={styles.segmentedControl}>
                        {CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS.map((days) => (
                          <TouchableOpacity
                            key={days}
                            style={[
                              styles.segmentedItem,
                              fabricSourcingDeadlineDays === days && styles.segmentedItemActive,
                            ]}
                            onPress={() => setFabricSourcingDeadlineDays(days)}
                          >
                            <Text
                              style={[
                                styles.segmentedItemText,
                                fabricSourcingDeadlineDays === days && styles.segmentedItemTextActive,
                              ]}
                            >
                              {days} days
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={styles.guideCard}>
                      <Text style={styles.guideTitle}>Approval required</Text>
                      <Text style={styles.guideText}>
                        The tailor cannot cut until you approve the sourced fabric inside Drapeon. If
                        color accuracy matters, ask for natural light and a white paper reference in
                        the photo.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ── Step 4: Delivery ── */}
            {step === 4 && (
              <View style={styles.fields}>
                <View>
                  <Text style={styles.fieldLabel}>
                    Delivery <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.optionCards}>
                    <OptionCard
                      title="Local delivery"
                      hint="A local rider or delivery partner brings the finished garment to you."
                      active={deliveryMethod === 'LOCAL_DELIVERY'}
                      onPress={() => chooseDeliveryMethod('LOCAL_DELIVERY')}
                    />
                    <OptionCard
                      title="Ship to me"
                      hint="Tailor ships your finished garment directly to you."
                      active={deliveryMethod === 'SHIPPING'}
                      onPress={() => chooseDeliveryMethod('SHIPPING')}
                    />
                    <OptionCard
                      title="Local collection"
                      hint="You collect in person. A 4-digit code confirms the handover."
                      active={deliveryMethod === 'LOCAL_COLLECTION'}
                      onPress={() => chooseDeliveryMethod('LOCAL_COLLECTION')}
                    />
                  </View>
                </View>

                {deliveryMethod === 'SHIPPING' ? (
                  <View>
                    <Text style={styles.fieldLabel}>
                      Shipping preference <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.segmentedControl}>
                      {CUSTOM_ORDER_SHIPPING_PREFERENCES.map((value) => (
                        <TouchableOpacity
                          key={value}
                          style={[
                            styles.segmentedItem,
                            shippingPreference === value && styles.segmentedItemActive,
                          ]}
                          onPress={() => setShippingPreference(value)}
                        >
                          <Text
                            style={[
                              styles.segmentedItemText,
                              shippingPreference === value && styles.segmentedItemTextActive,
                            ]}
                          >
                            {value === 'EXPRESS' ? 'Express' : 'Standard'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}

                {deliveryMethod && deliveryMethod !== 'LOCAL_COLLECTION' && (
                  <View style={styles.addressFields}>
                    <View>
                      <Text style={styles.fieldLabel}>
                        Who should receive this order? <Text style={styles.required}>*</Text>
                      </Text>
                      <View style={styles.optionCards}>
                        <OptionCard
                          title="I will receive it"
                          hint="Use your own name and phone number for delivery updates."
                          active={recipientMode === 'SELF'}
                          onPress={() => setRecipientMode('SELF')}
                        />
                        <OptionCard
                          title="Someone else will receive it"
                          hint="Use their name and phone number so the courier or rider can reach the right person."
                          active={recipientMode === 'OTHER'}
                          onPress={() => setRecipientMode('OTHER')}
                        />
                      </View>
                    </View>
                    <Input
                      label="Recipient name"
                      placeholder={recipientMode === 'SELF' ? 'Your name' : 'Recipient name'}
                      value={recipientName}
                      onChangeText={(v) => {
                        setRecipientName(v)
                        if (recipientContactError) setRecipientContactError('')
                      }}
                      onBlur={validateRecipientContact}
                      hint={
                        recipientMode === 'SELF'
                          ? 'This is the name the courier or rider should ask for.'
                          : 'Use the name of the person collecting this on your behalf.'
                      }
                      textContentType="name"
                      autoComplete="name"
                      required
                    />
                    <PhoneNumberInput
                      label="Recipient phone"
                      placeholder="Phone number"
                      value={recipientPhone}
                      onChangeText={(v) => {
                        setRecipientPhone(v)
                        if (recipientContactError) setRecipientContactError('')
                      }}
                      onBlur={validateRecipientContact}
                      hint={
                        recipientMode === 'SELF'
                          ? recipientPhoneHint
                          : `Use the actual recipient phone number so the courier or rider can reach them. ${recipientPhoneHint}`
                      }
                      required
                    />
                    <AddressAutocompleteInput
                      label="Search address"
                      placeholder="Search address, area, or landmark"
                      value={deliveryAddressSearch}
                      onChangeText={(v) => {
                        setDeliveryAddressSearch(v)
                        clearDeliveryVerification()
                        if (deliveryAddressError) setDeliveryAddressError('')
                      }}
                      onSelectAddress={(parsed) => {
                        setDeliveryAddressLine1(parsed.line1)
                        setDeliveryAddressLine2(parsed.line2)
                        setDeliveryCity(parsed.city)
                        setDeliveryStateRegion(parsed.stateRegion)
                        setDeliveryPostalCode(parsed.postcode)
                        setDeliveryCountry(parsed.countryCode || parsed.country)
                        const verifiedAt = new Date().toISOString()
                        setDeliveryVerificationSource('ADDRESS_SEARCH')
                        setDeliveryVerificationReference(parsed.reference)
                        setDeliveryVerifiedAt(verifiedAt)
                        setDeliveryAddressError('')
                        if (deliveryMethod) {
                          void resolveFulfillment(deliveryMethod, {
                            addressLine1: parsed.line1,
                            city: parsed.city,
                            regionCode: parsed.stateRegion,
                            postalCode: parsed.postcode,
                            countryCode: parsed.countryCode ?? '',
                            verificationSource: 'ADDRESS_SEARCH',
                            verificationReference: parsed.reference,
                            verifiedAt,
                          })
                        }
                      }}
                    />
                    <Input
                      label="Address line 1"
                      placeholder="Street address"
                      value={deliveryAddressLine1}
                      onChangeText={(v) => {
                        setDeliveryAddressLine1(v)
                        clearDeliveryVerification()
                        if (deliveryAddressError) setDeliveryAddressError('')
                      }}
                      onBlur={validateDeliveryAddress}
                      textContentType="streetAddressLine1"
                      autoComplete="address-line1"
                      required
                    />
                    <Input
                      label="Address line 2 (optional)"
                      placeholder="Apartment, suite, building"
                      value={deliveryAddressLine2}
                      onChangeText={(v) => {
                        setDeliveryAddressLine2(v)
                        clearDeliveryVerification()
                        if (deliveryAddressError) setDeliveryAddressError('')
                      }}
                      textContentType="streetAddressLine2"
                      autoComplete="address-line2"
                    />
                    <View style={styles.addressRow}>
                      <View style={styles.addressHalf}>
                        <Input
                          label="City"
                          placeholder="City"
                          value={deliveryCity}
                          onChangeText={(v) => {
                            setDeliveryCity(v)
                            clearDeliveryVerification()
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
                          textContentType="addressCity"
                          autoComplete="postal-address-locality"
                          required
                        />
                      </View>
                      <View style={styles.addressHalf}>
                        <Input
                          label="State / region"
                          placeholder="State"
                          value={deliveryStateRegion}
                          onChangeText={(v) => {
                            setDeliveryStateRegion(v)
                            clearDeliveryVerification()
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
                          textContentType="addressState"
                          autoComplete="postal-address-region"
                          required
                        />
                      </View>
                    </View>
                    <View style={styles.addressRow}>
                      <View style={styles.addressHalf}>
                        <Input
                          label="Postcode / ZIP"
                          placeholder="Postcode / ZIP (optional)"
                          value={deliveryPostalCode}
                          onChangeText={(v) => {
                            setDeliveryPostalCode(v)
                            clearDeliveryVerification()
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
                          textContentType="postalCode"
                          autoComplete="postal-code"
                        />
                      </View>
                      <View style={styles.addressHalf}>
                        <Input
                          label="Country"
                          placeholder="Country"
                          value={deliveryCountry}
                          onChangeText={(v) => {
                            setDeliveryCountry(v)
                            clearDeliveryVerification()
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
                          required
                        />
                      </View>
                    </View>
                    <Text style={styles.fieldHint}>
                      {deliveryMethod === 'LOCAL_DELIVERY'
                        ? 'Your tailor or a local rider will use these details to deliver the finished garment. If search misses your area, you can still enter the address manually in full.'
                        : 'Your tailor ships the finished garment here. If search misses your area, you can still enter the address manually in full.'}
                    </Text>
                    <Button
                      label={checkingFulfillment ? 'Checking…' : 'Confirm delivery address'}
                      variant="secondary"
                      disabled={checkingFulfillment}
                      onPress={() => void confirmStructuredDeliveryAddress()}
                    />
                    {fulfillmentEligibility?.status === 'ELIGIBLE' ? (
                      <Text style={styles.fieldHint}>{fulfillmentEligibilityCopy(fulfillmentEligibility)}</Text>
                    ) : null}
                    <Text style={styles.fieldHint}>
                      Drapeon includes a standard{' '}
                      {deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} fee when you
                      pay the quote. Carrier surcharges, customs, or import duties are never charged
                      automatically; we will ask you to approve anything extra before dispatch.
                    </Text>
                    {recipientContactError ? (
                      <Text style={styles.linkError}>{recipientContactError}</Text>
                    ) : null}
                    {deliveryAddressError ? (
                      <Text style={styles.linkError}>{deliveryAddressError}</Text>
                    ) : null}
                  </View>
                )}

                {deliveryMethod === 'LOCAL_COLLECTION' ? (
                  <View style={styles.guideCard}>
                    <Text style={styles.guideTitle}>Collection code</Text>
                    <Text style={styles.guideText}>
                      When the garment is ready, Drapeon creates a collection code. Share it only when
                      you have collected the order. Try to collect within 7 days of the ready notice;
                      after 14 days Drapeon may follow up so the tailor is not left storing finished work.
                    </Text>
                    {fulfillmentEligibility ? (
                      <Text style={fulfillmentEligibility.status === 'BLOCKED' ? styles.linkError : styles.fieldHint}>
                        {fulfillmentEligibilityCopy(fulfillmentEligibility)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <Input
                  label="Special delivery instructions (optional)"
                  placeholder="Gate code, landmark, office hours, leave-with-reception details..."
                  value={deliveryInstructions}
                  onChangeText={setDeliveryInstructions}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  filterContact
                  showCharacterCount
                />
              </View>
            )}

            {/* ── Step 5: Review ── */}
            {step === 5 && (
              <View style={styles.fields}>
                <ReviewSection title="Garment details" onEdit={() => setStep(0)}>
                  <SummaryRow
                    label="Garment"
                    value={garmentType === 'Other' ? garmentTypeOther.trim() : garmentType}
                  />
                  <SummaryRow label="Fit category" value={genderPresentation ?? 'Not set'} />
                  <SummaryRow
                    label="Wearer"
                    value={
                      isBulkOrder
                        ? bulkLabel.trim() || 'Group order'
                        : wearerMode === 'SELF'
                          ? savedMeasurementProfileLabel
                          : wearerName.trim()
                    }
                  />
                  {isBulkOrder && bulkMemberNames.trim() ? (
                    <SummaryRow
                      label="Members"
                      value={bulkMemberNames
                        .split(/\n|,/u)
                        .map((name) => name.trim())
                        .filter(Boolean)
                        .join(', ')}
                    />
                  ) : null}
                  <SummaryRow label="Occasion" value={occasion.trim() || 'Not set'} />
                  <SummaryRow label="Target date" value={formatDate(deadline)} />
                  <SummaryRow label="Brief" value={description.trim()} />
                </ReviewSection>

                <ReviewSection title="Style references" onEdit={() => setStep(1)}>
                  <SummaryRow
                    label="Photos"
                    value={`${photos.length} reference photo${photos.length === 1 ? '' : 's'}`}
                  />
                  <SummaryRow
                    label="Links"
                    value={`${inspirationLinks.length} style link${inspirationLinks.length === 1 ? '' : 's'}`}
                  />
                  {styleAttributes.length > 0 ? (
                    <SummaryRow label="Focus areas" value={styleAttributes.join(', ')} />
                  ) : null}
                  {styleNotes.trim() ? (
                    <SummaryRow label="Style notes" value={styleNotes.trim()} />
                  ) : null}
                </ReviewSection>

                <ReviewSection title="Measurements" onEdit={() => setStep(2)}>
                  {measurements?.measurementSource ? (
                    <SummaryRow
                      label="Source"
                      value={
                        MEASUREMENT_SOURCE_LABELS[
                          measurements.measurementSource as keyof typeof MEASUREMENT_SOURCE_LABELS
                        ] ?? measurements.measurementSource
                      }
                    />
                  ) : null}
                  {measurementAgeSummary ? (
                    <SummaryRow
                      label="Last updated"
                      value={
                        measurementAgeSummary.stale
                          ? `${measurementAgeSummary.label} — refresh if your fit changed`
                          : measurementAgeSummary.label
                      }
                    />
                  ) : null}
                  <SummaryRow label="Body note" value={fitNote.trim()} />
                </ReviewSection>

                <ReviewSection title="Fabric" onEdit={() => setStep(3)}>
                  <SummaryRow label="Fabric" value={fabricSourceLabel(fabricSource)} />
                  <SummaryRow
                    label="Fabric proof"
                    value={
                      fabricReferenceMedia.length +
                      ' media' +
                      (fabricReferenceLinks.length
                        ? ' + ' + fabricReferenceLinks.length + ' link' + (fabricReferenceLinks.length === 1 ? '' : 's')
                        : '')
                    }
                  />
                  {isBulkOrder ? (
                    <SummaryRow label="Group fabric" value={bulkFabricModeLabel()} />
                  ) : null}
                  {fabricSource === 'CUSTOMER_SUPPLIES' && fabricHandoffMode ? (
                    <SummaryRow label="Handoff" value={FABRIC_HANDOFF_LABELS[fabricHandoffMode]} />
                  ) : null}
                  {fabricSource === 'TAILOR_SOURCES' ? (
                    <>
                      <SummaryRow label="Description" value={fabricDescription.trim()} />
                      <SummaryRow
                        label="Budget"
                        value={
                          fabricBudgetAmount.trim()
                            ? fabricBudgetCurrency + ' ' + fabricBudgetAmount.trim()
                            : 'Not set'
                        }
                      />
                      <SummaryRow label="Substitution" value={fabricSubstitutionLabel()} />
                      {fabricVendorName.trim() || fabricVendorLocation.trim() || fabricVendorLink.trim() ? (
                        <SummaryRow
                          label="Vendor"
                          value={
                            [fabricVendorName.trim(), fabricVendorLocation.trim()]
                              .filter(Boolean)
                              .join(' · ') || fabricVendorLink.trim() || 'Suggested'
                          }
                        />
                      ) : null}
                      <SummaryRow
                        label="Sourcing update"
                        value={fabricSourcingDeadlineDays + ' business days'}
                      />
                    </>
                  ) : null}
                </ReviewSection>

                <ReviewSection title="Delivery" onEdit={() => setStep(4)}>
                  <SummaryRow label="Method" value={deliveryMethodLabel(deliveryMethod)} />
                  {deliveryMethod === 'SHIPPING' ? (
                    <SummaryRow
                      label="Shipping"
                      value={shippingPreference === 'EXPRESS' ? 'Express' : 'Standard'}
                    />
                  ) : null}
                  {deliveryMethod !== 'LOCAL_COLLECTION' && recipientName.trim() ? (
                    <SummaryRow
                      label={recipientMode === 'SELF' ? 'Receiving contact' : 'Recipient'}
                      value={recipientName.trim()}
                    />
                  ) : null}
                  {deliveryMethod !== 'LOCAL_COLLECTION' && recipientPhone.trim() ? (
                    <SummaryRow
                      label="Recipient phone"
                      value={normalizePhoneForStorage(recipientPhone)}
                    />
                  ) : null}
                  {deliveryMethod !== 'LOCAL_COLLECTION' && composeDeliveryAddress().trim() ? (
                    <SummaryRow
                      label={deliveryMethod === 'SHIPPING' ? 'Ship to' : 'Deliver to'}
                      value={composeDeliveryAddress()}
                    />
                  ) : null}
                  {deliveryInstructions.trim() ? (
                    <SummaryRow label="Instructions" value={deliveryInstructions.trim()} />
                  ) : null}
                </ReviewSection>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Checkout preview</Text>
                  <SummaryRow
                    label="Estimated timeline"
                    value={`Target delivery: ${formatDate(deadline)}`}
                  />
                  <SummaryRow label="Quote" value="Set by tailor after review" />
                  <SummaryRow label="Delivery" value="Calculated after quote" />
                  <SummaryRow label="Tax" value="Calculated at checkout" />
                  <SummaryRow label="Total" value="Shown before payment" />
                  <Text style={styles.fieldHint}>
                    You will see the full checkout breakdown before any payment is confirmed.
                  </Text>
                </View>

                <View style={styles.guideCard}>
                  <Text style={styles.guideTitle}>Handmade garment note</Text>
                  <Text style={styles.guideText}>
                    Bespoke garments can have small handmade variation. Fit, finish, wrong item, or
                    quality issues are still protected through the order concern and aftercare path.
                  </Text>
                </View>

                <View style={styles.policyCard}>
                  <Text style={styles.summaryTitle}>Cancellation policy</Text>
                  <View style={styles.policyList}>
                    {ORDER_CANCELLATION_POLICY_ROWS.map((row) => (
                      <View key={row.title} style={styles.policyRow}>
                        <Text style={styles.policyRowTitle}>{row.title}</Text>
                        <Text style={styles.policyRowBody}>{row.body}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.policyAckRow,
                      cancellationPolicyAcknowledged && styles.policyAckRowActive,
                    ]}
                    onPress={() => setCancellationPolicyAcknowledged((value) => !value)}
                    activeOpacity={0.75}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: cancellationPolicyAcknowledged }}
                    accessibilityLabel="Acknowledge cancellation policy"
                  >
                    <View
                      style={[
                        styles.policyCheck,
                        cancellationPolicyAcknowledged && styles.policyCheckActive,
                      ]}
                    >
                      <Text style={styles.policyCheckText}>
                        {cancellationPolicyAcknowledged ? '✓' : ''}
                      </Text>
                    </View>
                    <Text style={styles.policyAckText}>{ORDER_CANCELLATION_ACK_COPY}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </KeyboardAwareScrollView>

        <DrapeFloatingActionDock
          compactWidth={76}
          forceCompact={keyboard.visible}
          testID="custom-brief-action-dock"
        >
          {(compact) => compact ? (
            <DrapeIconButton
              icon={step < STEP_TITLES.length - 1 ? 'arrow-right' : 'send'}
              accessibilityLabel={step < STEP_TITLES.length - 1 ? 'Continue' : 'Submit order'}
              tone="primary"
              onPress={next}
              disabled={submitting || !canProceed()}
              testID={step < STEP_TITLES.length - 1 ? 'brief-continue-btn' : 'brief-send-btn'}
            />
          ) : (
            <DrapeCapsuleButton
              label={step < STEP_TITLES.length - 1 ? 'Continue' : 'Submit order'}
              icon={step < STEP_TITLES.length - 1 ? 'arrow-right' : 'send'}
              loading={submitting}
              style={styles.actionDockPrimary}
              onPress={next}
              disabled={submitting || !canProceed()}
              testID={step < STEP_TITLES.length - 1 ? 'brief-continue-btn' : 'brief-send-btn'}
            />
          )}
        </DrapeFloatingActionDock>
      </KeyboardAvoidingView>

      {/* Garment type picker */}
      <Modal
        visible={showGarmentPicker}
        transparent
        animationType="slide"
        onRequestClose={closeGarmentPicker}
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={closeGarmentPicker}
          />
          <KeyboardAvoidingView
            style={styles.pickerKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHandle} />
              <View style={styles.pickerHeader}>
                <View style={styles.pickerHeaderCopy}>
                  <Text style={styles.pickerTitle}>Choose garment type</Text>
                  <Text style={styles.pickerSubtitle}>
                    Start with the closest match. Your brief can explain the details.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.pickerClose}
                  onPress={closeGarmentPicker}
                  accessibilityRole="button"
                  accessibilityLabel="Close garment picker"
                >
                  <Text style={styles.pickerCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.pickerSearch}
                value={garmentSearch}
                onChangeText={setGarmentSearch}
                placeholder="Search Agbada, suit, fila..."
                placeholderTextColor={Colors.midGrey}
                autoCorrect={false}
                returnKeyType="search"
              />
              <ScrollView
                style={styles.pickerList}
                contentContainerStyle={styles.pickerListContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {garmentPickerGroups.length === 0 ? (
                  <View style={styles.pickerEmpty}>
                    <Text style={styles.pickerEmptyTitle}>No match yet</Text>
                    <Text style={styles.pickerEmptyText}>
                      Choose Other and describe the garment in your own words.
                    </Text>
                    <TouchableOpacity
                      style={styles.pickerOtherButton}
                      onPress={() => selectGarmentType('Other')}
                    >
                      <Text style={styles.pickerOtherButtonText}>Use Other</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  garmentPickerGroups.map((group) => (
                    <View key={group.category} style={styles.pickerGroup}>
                      <Text style={styles.pickerGroupTitle}>{group.category}</Text>
                      {group.items.map((item) => {
                        const isSelected = garmentType === item
                        return (
                          <TouchableOpacity
                            key={item}
                            style={[
                              styles.pickerItem,
                              isSelected && styles.pickerItemSelected,
                            ]}
                            onPress={() => selectGarmentType(item)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={`Choose ${item}`}
                          >
                            <Text
                              style={[
                                styles.pickerItemText,
                                isSelected && styles.pickerItemTextSelected,
                              ]}
                            >
                              {item}
                            </Text>
                            {isSelected ? (
                              <Text style={styles.pickerItemCheck}>Selected</Text>
                            ) : null}
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Focus areas picker */}
      <Modal
        visible={showFocusAreasPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFocusAreasPicker(false)}
      >
        <View style={styles.pickerOverlay}>
          <KeyboardAvoidingView
            style={styles.pickerKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHandle} />
              <View style={styles.pickerHeader}>
                <View style={styles.pickerHeaderCopy}>
                  <Text style={styles.pickerTitle}>Focus areas</Text>
                  <Text style={styles.pickerSubtitle}>
                    Pick only what your tailor should watch closely. You can leave this blank.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.pickerClose}
                  onPress={() => setShowFocusAreasPicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close focus areas picker"
                >
                  <Text style={styles.pickerCloseText}>Done</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.pickerList}
                contentContainerStyle={styles.pickerListContent}
                showsVerticalScrollIndicator={false}
              >
                {CUSTOM_ORDER_STYLE_ATTRIBUTES.map((value) => {
                  const active = styleAttributes.includes(value)
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[styles.pickerItem, active && styles.pickerItemSelected]}
                      onPress={() =>
                        setStyleAttributes((current) =>
                          current.includes(value)
                            ? current.filter((item) => item !== value)
                            : [...current, value]
                        )
                      }
                      activeOpacity={0.75}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={`Toggle ${value}`}
                    >
                      <Text
                        style={[styles.pickerItemText, active && styles.pickerItemTextSelected]}
                      >
                        {value}
                      </Text>
                      {active ? <Text style={styles.pickerItemCheck}>Selected</Text> : null}
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <ChoiceSheet
        visible={measurementProfileSheetOpen}
        title="Choose measurements"
        subtitle="Pick the wearer profile this tailor should quote against."
        options={measurementProfileOptions}
        selectedValue={measurementProfiles.find((profile) => profile.label === savedMeasurementProfileLabel)?.id}
        onClose={() => setMeasurementProfileSheetOpen(false)}
        onSelect={selectMeasurementProfile}
      />

      <ChoiceSheet
        visible={fabricCurrencySheetOpen}
        title="Fabric budget currency"
        subtitle="Use the currency you expect the tailor to source fabric in."
        options={SUPPORTED_CURRENCIES.map((option) => ({
          value: option.code,
          title: option.code,
          body: option.name,
          meta: option.symbol,
        }))}
        selectedValue={fabricBudgetCurrency}
        onClose={() => setFabricCurrencySheetOpen(false)}
        onSelect={(value) => {
          const normalized = normalizeAccountCurrency(value)
          if (normalized) setFabricBudgetCurrency(normalized)
          setFabricCurrencySheetOpen(false)
        }}
      />

      <Modal
        visible={measurementReviewOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMeasurementReviewOpen(false)}
      >
        <View style={styles.editModalWrap} accessibilityViewIsModal>
          <TouchableOpacity
            style={styles.editOverlay}
            activeOpacity={1}
            onPress={() => setMeasurementReviewOpen(false)}
          />
          <View style={[styles.reviewSheet, { paddingBottom: Math.max(insets.bottom + Spacing.lg, 32) }]}>
            <View style={styles.reviewSheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editSheetTitle}>Review measurements</Text>
                <Text style={styles.reviewSheetSubtitle}>
                  Tap any value to adjust it for this order.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.reviewClose}
                onPress={() => setMeasurementReviewOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close measurement review"
              >
                <Feather name="x" size={18} color={Colors.ink} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewSheetContent}>
              <MeasurementModule
                title="All saved values"
                subtitle="Empty optional fields stay muted. Add missing values only when the garment needs them."
                icon="sliders"
                fields={measurementReviewFields.map(({ key, label, value }) => ({
                  key,
                  label,
                  value: value as string | number | null | undefined,
                  unit: measurementUnit,
                  onPress: () => {
                    setMeasurementReviewOpen(false)
                    setEditingField({ key, label, value: value ? String(value) : '' })
                    setEditValue(value ? String(value) : '')
                  },
                }))}
              />
              {measurements && getAdditionalMeasurementRows(measurements).length > 0 ? (
                <MeasurementModule
                  title="Garment-specific"
                  subtitle="Extra points carried with this profile."
                  icon="plus-circle"
                  fields={getAdditionalMeasurementRows(measurements).map(({ label, value }) => ({
                    key: label,
                    label,
                    value: value as string | number | null | undefined,
                    unit: measurementUnit,
                  }))}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Inline measurement edit modal */}
      <Modal
        visible={!!editingField}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingField(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.editOverlay}
            activeOpacity={1}
            onPress={() => setEditingField(null)}
          />
          <View style={styles.editSheet}>
            <Text style={styles.editSheetTitle}>Edit {editingField?.label}</Text>
            <TextInput
              style={styles.editSheetInput}
              value={editValue}
              onChangeText={setEditValue}
              keyboardType="decimal-pad"
              placeholder={`e.g. 38 ${measurements?.unit ?? 'in'}`}
              autoFocus
            />
            <Button
              label="Save for this order"
              onPress={() => {
                if (!editingField) return
                const parsed = editValue.trim() ? parseFloat(editValue) : null
                const updated = { ...measurements, [editingField.key]: parsed }
                setMeasurements(updated)
                setEditingField(null)
                // Prompt to also update saved profile
                Alert.alert(
                  'Update your saved profile?',
                  `Update your saved ${editingField.label} measurement to ${editValue.trim() || 'empty'} for future orders too?`,
                  [
                    { text: 'No, just this order', style: 'cancel' },
                    {
                      text: 'Yes, update profile',
                      onPress: async () => {
                        const { data, error } = await supabase
                          .from('customer_profiles')
                          .select('measurements')
                          .eq('user_id', user?.id)
                          .maybeSingle()

                        if (error) {
                          Alert.alert(
                            'Could not update profile',
                            'Your measurement was updated for this order only. Please try again from your profile.'
                          )
                          return
                        }

                        const nextMeasurements = {
                          ...(data?.measurements ?? {}),
                          [editingField.key]: parsed,
                        }

                        const { error: updateError } = await supabase
                          .from('customer_profiles')
                          .upsert(
                            {
                              user_id: user?.id,
                              measurements: nextMeasurements,
                              updated_at: new Date().toISOString(),
                            },
                            { onConflict: 'user_id' }
                          )

                        if (updateError) {
                          Alert.alert(
                            'Could not update profile',
                            'Your measurement was updated for this order only. Please try again from your profile.'
                          )
                          return
                        }

                        setMeasurements(nextMeasurements)
                      },
                    },
                  ]
                )
              }}
            />
            <TouchableOpacity
              onPress={() => setEditingField(null)}
              style={{ alignItems: 'center', paddingVertical: Spacing.sm }}
            >
              <Text style={{ color: Colors.midGrey, fontSize: FontSize.sm }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Profile completeness prompt — one-time modal */}
      <Modal
        visible={showMeasPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => dismissMeasPrompt(false)}
      >
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.promptEmoji}>📐</Text>
            <Text style={styles.promptTitle}>Add your measurements first?</Text>
            <Text style={styles.promptBody}>
              Tailors give more accurate quotes when they have your body measurements on file. It
              only takes a minute and you only do it once.
            </Text>
            <TouchableOpacity style={styles.promptPrimary} onPress={() => dismissMeasPrompt(true)}>
              <Text style={styles.promptPrimaryText}>Set up measurements</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => dismissMeasPrompt(false)}>
              <Text style={styles.promptSecondary}>Skip for now — continue with order</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OptionCard({
  title,
  hint,
  active,
  onPress,
}: {
  title: string
  hint: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.optionCard, active && styles.optionCardActive]}
      onPress={onPress}
      accessibilityLabel={title}
    >
      <View style={[styles.optionRadio, active && styles.optionRadioActive]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{title}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
    </TouchableOpacity>
  )
}

function QuickAddRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.quickAddRow} onPress={onPress} accessibilityLabel={`Add ${label}`}>
      <View style={styles.quickAddIcon}>
        <Text style={styles.quickAddIconText}>+</Text>
      </View>
      <Text style={styles.quickAddText}>{label}</Text>
    </TouchableOpacity>
  )
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: ReactNode
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.reviewHeader}>
        <Text style={styles.summaryTitle}>{title}</Text>
        <TouchableOpacity onPress={onEdit} style={styles.reviewEditBtn}>
          <Text style={styles.reviewEditText}>Edit</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
  },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  loadingTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  loadingHint: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  errorHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  stateGuideCard: {
    width: '100%',
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
  },
  stateGuideTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  stateGuideText: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    lineHeight: 20,
  },
  errorBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  errorBtnSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  errorBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  errorBtnTextSecondary: { color: Colors.ink },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  backText: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  stepLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.lg, marginBottom: 6 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.lightGrey },
  progressSegDone: { backgroundColor: Colors.needleGreen },

  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  stepTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  stepSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
    marginTop: -Spacing.sm,
  },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  guideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  fields: { gap: Spacing.lg },
  dropdownField: {
    minHeight: 56,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dropdownValue: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  dropdownMeta: {
    marginTop: 2,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
  dropdownChevron: {
    fontSize: 22,
    color: Colors.needleGreenDark,
    lineHeight: 24,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    marginBottom: 6,
  },
  required: { color: Colors.error },
  fieldHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  quickAddList: { gap: Spacing.sm, marginTop: Spacing.sm },
  quickAddRow: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  quickAddIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddIconText: {
    color: Colors.needleGreenDark,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    lineHeight: 20,
  },
  quickAddText: { flex: 1, fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  segmentedControl: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    padding: 4,
    gap: 4,
  },
  segmentedItem: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentedItemActive: {
    backgroundColor: Colors.needleGreen,
  },
  segmentedItemText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  segmentedItemTextActive: {
    color: Colors.textInverse,
  },
  addressFields: { gap: 8 },
  suggestionsBox: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionText: { fontSize: FontSize.xs, color: Colors.ink, lineHeight: 18 },
  addressRow: { flexDirection: 'row', gap: 8 },
  addressHalf: { flex: 1 },

  // Garment type picker
  garmentSelectCard: {
    minHeight: 72,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  garmentSelectCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.white,
  },
  garmentSelectCopy: { flex: 1, gap: 3 },
  garmentSelectValue: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  garmentSelectPlaceholder: { color: Colors.midGrey },
  garmentSelectHint: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  pickerKeyboardWrap: {
    width: '100%',
  },
  pickerSheet: {
    maxHeight: '86%',
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
    marginBottom: Spacing.xs,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  pickerHeaderCopy: { flex: 1, gap: 4 },
  pickerTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  pickerSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  pickerClose: {
    minHeight: 36,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  pickerCloseText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  pickerSearch: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.lg,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  pickerList: {
    flexGrow: 0,
  },
  pickerListContent: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  pickerGroup: { gap: Spacing.sm },
  pickerGroupTitle: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  pickerItem: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  pickerItemSelected: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  pickerItemText: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  pickerItemTextSelected: { color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  pickerItemCheck: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.semibold,
  },
  pickerEmpty: {
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    padding: Spacing.xl,
  },
  pickerEmptyTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  pickerEmptyText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
    textAlign: 'center',
  },
  pickerOtherButton: {
    minHeight: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
  },
  pickerOtherButtonText: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },

  // Date picker
  dateButton: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: 14,
    marginTop: 6,
    minHeight: 44,
  },
  dateButtonRequired: { borderColor: Colors.error + '60' },
  dateText: { fontSize: FontSize.sm, color: Colors.ink },
  datePlaceholder: { color: Colors.midGrey },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: {
    width: 84,
    height: 84,
    borderRadius: Radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: {
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
  photoRemoveText: { color: Colors.textInverse, fontSize: 11, fontWeight: FontWeight.bold },
  photoAdd: {
    width: 84,
    height: 84,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    borderStyle: 'dashed',
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoAddIcon: { fontSize: 24, color: Colors.midGrey },
  photoAddLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  photoCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  mediaKindBadge: {
    position: 'absolute',
    left: 5,
    top: 5,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  mediaKindBadgeText: {
    color: Colors.textInverse,
    fontSize: 9,
    fontWeight: FontWeight.bold,
    letterSpacing: 0,
  },

  // Measurements summary
  measureSummaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  measureSummaryTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  measureSourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
  },
  measureSourceLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  measureSourceValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  measureSourceValueWarning: { color: Colors.kanteRust },
  measureAgeCard: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.kanteRust + '40',
    backgroundColor: Colors.kanteRustLight,
  },
  measureAgeIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  measureAgeCopy: { flex: 1, gap: 4 },
  measureAgeTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  measureAgeText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  measureAgeAction: { alignSelf: 'flex-start', marginTop: 2 },
  measureAgeActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.kanteRust,
  },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  flagBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    backgroundColor: Colors.kanteRustLight,
    borderRadius: Radius.full,
  },
  flagBadgeText: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.medium },
  measureSubcard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: 12,
    gap: Spacing.xs,
    backgroundColor: Colors.white,
  },
  measureSubcardHint: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  measureActionBtn: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  measureActionBtnText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  measureActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  measureEditHint: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.medium,
  },

  // Inline edit sheet
  editModalWrap: { flex: 1, justifyContent: 'flex-end' },
  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  reviewSheet: {
    maxHeight: '86%',
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  reviewSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  reviewSheetSubtitle: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.inkLight,
    marginTop: 3,
  },
  reviewClose: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  reviewSheetContent: { gap: Spacing.md, paddingBottom: Spacing.md },
  editSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  editSheetTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  editSheetInput: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    borderWidth: 1.5,
    borderColor: Colors.needleGreen,
  },

  noMeasureCard: {
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    alignItems: 'center',
  },
  noMeasureTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.inkLight,
  },
  noMeasureHint: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 20,
  },
  noMeasureBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
  },
  noMeasureBtnText: {
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.sm,
  },
  // Style inspiration
  inspirationSection: { gap: Spacing.sm },
  handlesScroll: { marginTop: Spacing.sm },
  handlesRow: { flexDirection: 'row', gap: 8, paddingBottom: Spacing.xs },
  handleChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    justifyContent: 'center',
  },
  handleChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  inspirationInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fabricLinkBlock: { gap: Spacing.sm, marginTop: Spacing.md },
  vendorFields: { gap: Spacing.sm, marginTop: Spacing.sm },
  inspirationAddBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  inspirationAddText: {
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.sm,
  },
  selectedLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectedLinkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    minHeight: 34,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.needleGreen,
    maxWidth: 200,
  },
  selectedLinkText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.medium,
    flexShrink: 1,
  },
  selectedLinkRemove: { fontSize: 10, color: Colors.needleGreenDark },
  linkError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs, lineHeight: 18 },

  // Fabric & delivery options
  optionCards: { gap: Spacing.sm, alignSelf: 'stretch', width: '100%' },
  optionCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  optionCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.white },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 2,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  optionRadioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  optionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  optionTitleActive: { color: Colors.ink },
  optionHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 18 },

  // Summary card
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  summaryTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  summaryValue: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.ink,
    flex: 1,
    textAlign: 'right',
    marginLeft: Spacing.md,
  },
  policyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  policyList: { gap: Spacing.sm },
  policyRow: { gap: 3 },
  policyRowTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  policyRowBody: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  policyAckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
    minHeight: 52,
  },
  policyAckRowActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  policyCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.midGrey,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  policyCheckActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  policyCheckText: {
    color: Colors.textInverse,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  policyAckText: { flex: 1, fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  reviewEditBtn: {
    minHeight: 34,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  reviewEditText: {
    color: Colors.needleGreenDark,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },

  actionDockPrimary: { flex: 1 },

  // Profile completeness prompt modal
  promptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  promptCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.lg,
  },
  promptEmoji: { fontSize: 40 },
  promptTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  promptBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 22,
    textAlign: 'center',
  },
  promptPrimary: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: Spacing.xxl,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptPrimaryText: {
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.md,
  },
  promptSecondary: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    textDecorationLine: 'underline',
  },
})
