import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
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
import {
  isLikelyConnectivityIssue,
  isMachineErrorCodeMessage,
  readFunctionErrorMessage,
} from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import { goBackOrReturnTo } from '@/lib/navigation'
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
import { composeStructuredAddress, parseNominatimSuggestion } from '@/lib/address'
import { stripExif } from '@/lib/stripExif'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { Button, Input, RemoteImage } from '@/components/ui'
import {
  CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS,
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_GARMENT_TAXONOMY,
  CUSTOM_ORDER_GENDER_PRESENTATIONS,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  CUSTOM_ORDER_RESUMABLE_STAGES,
  CUSTOM_ORDER_SHIPPING_PREFERENCES,
  CUSTOM_ORDER_STYLE_ATTRIBUTES,
  ORDER_CANCELLATION_ACK_COPY,
  ORDER_CANCELLATION_POLICY_ROWS,
  customOrderDefaultDeadline,
  customOrderMinimumDeliveryDate,
  isAllowedCustomStyleReference,
  isCustomOrderBriefLongEnough,
  normalizeAccountCurrency,
} from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared/phone'
import { phoneHintForContext } from '@/lib/phone-context'
import { DRAPE_VISION_ROUTE } from '@/constants/drapeVision'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const MEAS_PROMPT_KEY = 'drape_meas_prompt_shown'

// ─── Types ────────────────────────────────────────────────────────────────────

type FabricSource = 'CUSTOMER_SUPPLIES' | 'TAILOR_SOURCES'
type DeliveryMethod = 'SHIPPING' | 'LOCAL_DELIVERY' | 'LOCAL_COLLECTION'
type RecipientMode = 'SELF' | 'OTHER'
type GenderPresentation = (typeof CUSTOM_ORDER_GENDER_PRESENTATIONS)[number]
type ShippingPreference = (typeof CUSTOM_ORDER_SHIPPING_PREFERENCES)[number]
type MeasurementRecord = Record<string, unknown>
type NominatimSuggestion = {
  place_id?: string | number
  display_name?: string
  address?: Record<string, string | undefined>
}

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

function buildBriefRoute(
  tailorId: string,
  options?: { draftSession?: string | null; resumeDraft?: boolean }
) {
  const search = new URLSearchParams()
  if (options?.draftSession) search.set('draftSession', options.draftSession)
  if (options?.resumeDraft) search.set('resumeDraft', '1')
  const query = search.toString()
  return query.length > 0
    ? `/(customer)/brief/${tailorId}?${query}`
    : `/(customer)/brief/${tailorId}`
}

function defaultDeadline() {
  return customOrderDefaultDeadline()
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function hasCompleteMeasurementProfile(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const measurement = value as MeasurementRecord
  const hasCore =
    measurement.chest != null &&
    measurement.waist != null &&
    measurement.hips != null &&
    measurement.height != null &&
    typeof measurement.fitStyle === 'string'
  const hasContext =
    typeof measurement.garmentContext === 'string' && measurement.garmentContext.length > 0
  const bodyShapes = Array.isArray(measurement.bodyShape)
    ? measurement.bodyShape
    : measurement.bodyShape
      ? [measurement.bodyShape]
      : []
  return hasCore && hasContext && bodyShapes.length > 0
}

function createBriefPhotoPath(userId: string | undefined) {
  const owner = userId ?? 'guest'
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `briefs/${owner}/${suffix}.jpg`
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
  const { tailorId, returnTo, draftSession, freshStart, resumeDraft } = useLocalSearchParams<{
    tailorId: string
    returnTo?: string
    draftSession?: string
    freshStart?: string
    resumeDraft?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, `/(customer)/tailor/${tailorId}`)
  }

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [cancellationPolicyAcknowledged, setCancellationPolicyAcknowledged] = useState(false)
  const [showMeasPrompt, setShowMeasPrompt] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

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

  // Step 2
  const [photos, setPhotos] = useState<string[]>([])
  const [inspirationLinks, setInspirationLinks] = useState<string[]>([])
  const [inspirationInput, setInspirationInput] = useState('')
  const [linkError, setLinkError] = useState('')
  const [styleNotes, setStyleNotes] = useState('')
  const [styleAttributes, setStyleAttributes] = useState<string[]>([])

  // Step 3 — measurement profile summary
  const [measurements, setMeasurements] = useState<MeasurementRecord | null>(null)
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
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('SELF')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [recipientContactError, setRecipientContactError] = useState('')
  const [deliveryAddressError, setDeliveryAddressError] = useState('')
  const [deliveryAddressSearch, setDeliveryAddressSearch] = useState('')
  const [deliveryAddressSuggestions, setDeliveryAddressSuggestions] = useState<
    NominatimSuggestion[]
  >([])
  const [showDeliverySuggestions, setShowDeliverySuggestions] = useState(false)
  const [accountCurrency, setAccountCurrency] = useState('USD')
  const suppressNextDeliveryLookup = useRef(false)
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
  const recipientPhoneHint = phoneHintForContext(deliveryCountry)

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
    setDeliveryAddressSuggestions([])
    setShowDeliverySuggestions(false)
    setAccountCurrency('USD')
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
          `You already have a custom order with this tailor in progress (${existingOrder.reference ?? existingOrder.stage}). Drape keeps one active custom order per customer-tailor pair so details, payments, and production updates stay clean.`,
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
                    tab: 'active',
                  },
                }),
            },
          ]
        )
      }
    }

    const [tailorRes, measRes, accountRes] = await Promise.allSettled([
      supabase.from('tailor_profiles').select('id').eq('id', tailorId).maybeSingle(),
      supabase.from('customer_profiles').select('measurements').eq('user_id', userId).maybeSingle(),
      supabase.from('users').select('default_currency').eq('id', userId).maybeSingle(),
    ])

    const tailorData =
      tailorRes.status === 'fulfilled' && !tailorRes.value.error ? tailorRes.value.data : null
    const measurementData =
      measRes.status === 'fulfilled' && !measRes.value.error ? measRes.value.data : null
    const accountData =
      accountRes.status === 'fulfilled' && !accountRes.value.error ? accountRes.value.data : null

    if (!tailorData?.id) {
      setFetchError(true)
    }

    setAccountCurrency(normalizeAccountCurrency(accountData?.default_currency) ?? 'USD')

    const hasMeasurements = hasCompleteMeasurementProfile(measurementData?.measurements)
    if (hasMeasurements) {
      setMeasurements(enrichMeasurementSnapshot(measurementData?.measurements ?? null))
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

  function validateFabricStep() {
    if (!fabricSource) return false
    if (fabricSource === 'CUSTOMER_SUPPLIES') return !!fabricHandoffMode
    const budget = Number.parseInt(fabricBudgetAmount, 10)
    const validBudget = !fabricBudgetAmount.trim() || (Number.isFinite(budget) && budget >= 0)
    return fabricDescription.trim().length >= 8 && validBudget
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

  useEffect(() => {
    const text = deliveryAddressSearch.trim()
    if (suppressNextDeliveryLookup.current) {
      suppressNextDeliveryLookup.current = false
      return
    }
    if (text.length < 5) {
      const resetTimer = setTimeout(() => {
        setDeliveryAddressSuggestions([])
        setShowDeliverySuggestions(false)
      }, 0)
      return () => clearTimeout(resetTimer)
    }

    const hideTimer = setTimeout(() => {
      setShowDeliverySuggestions(false)
    }, 0)
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drape/1.0' } }
        )
        const data = (await res.json()) as unknown
        const filtered = Array.isArray(data)
          ? data.filter(
              (item): item is NominatimSuggestion =>
                !!item &&
                typeof item === 'object' &&
                typeof (item as NominatimSuggestion).display_name === 'string' &&
                !!(item as NominatimSuggestion).address
            )
          : []
        setDeliveryAddressSuggestions(filtered)
        setShowDeliverySuggestions(filtered.length > 0)
      } catch {
        setDeliveryAddressSuggestions([])
        setShowDeliverySuggestions(false)
      }
    }, 400)

    return () => {
      clearTimeout(hideTimer)
      clearTimeout(timeout)
    }
  }, [deliveryAddressSearch])

  function selectDeliverySuggestion(item: NominatimSuggestion) {
    const parsed = parseNominatimSuggestion(item)

    suppressNextDeliveryLookup.current = true
    setDeliveryAddressSearch(parsed.displayValue)
    setDeliveryAddressLine1(parsed.line1)
    setDeliveryAddressLine2(parsed.line2)
    setDeliveryCity(parsed.city)
    setDeliveryStateRegion(parsed.stateRegion)
    setDeliveryPostalCode(parsed.postcode)
    setDeliveryCountry(parsed.country)
    setDeliveryAddressError('')
    setDeliveryAddressSuggestions([])
    setShowDeliverySuggestions(false)
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

  async function pickPhoto() {
    if (submitting) return
    if (photos.length >= CUSTOM_ORDER_MAX_REFERENCE_PHOTOS) {
      Alert.alert(
        `Maximum ${CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} reference photos`,
        'Remove one of your current references before adding another.'
      )
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    })
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri])
    }
  }

  function canProceed(): boolean {
    if (step === 0) {
      const bulkCount = Number.parseInt(bulkRecipientCount, 10)
      if (isBulkOrder && (!Number.isFinite(bulkCount) || bulkCount < 2)) return false
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
    if (step === 2) return !!measurements && fitNote.trim().length >= 20 && !fitNoteError
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
          !!measurements &&
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
    // Final guard — catches any placeholder values that bypassed per-field validation
    if (!validateDescription(description)) return
    if (!validateDeadline(deadline)) return
    if (!validateStyleReferences()) return
    if (!validateFitNote(fitNote)) return
    if (!validateFabricStep()) {
      Alert.alert(
        'Fabric details needed',
        fabricSource === 'TAILOR_SOURCES'
          ? 'Describe the fabric you want the tailor to source before submitting.'
          : 'Choose how your fabric will reach the tailor before submitting.'
      )
      return
    }
    if (deliveryMethod !== 'LOCAL_COLLECTION' && !validateDeliveryAddress()) return
    if (deliveryMethod !== 'LOCAL_COLLECTION' && !validateRecipientContact()) return
    setSubmitting(true)

    const measurementSnapshot = enrichMeasurementSnapshot(measurements)
    const fitProfile = buildOrderFitProfile(measurementSnapshot)
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
              'If fabric suitability is disputed, Drape reviews the timeline before work continues.',
            prepRequirements: [
              'Share the handoff plan before the order is submitted',
              'Keep any shipping reference inside the order thread',
              'Do not expect cutting to start before receipt is confirmed',
              'Prewash, press, or stabilize the fabric first when the tailor asks for it',
            ],
          }
        : {
            approvalRequiredForTailorSourcing: true,
            replacementRule:
              'Tailor-sourced fabric should only be replaced after customer approval inside Drape.',
            disagreementRule:
              'If sourcing changes the agreed design or budget, Drape should review before work continues.',
            prepRequirements: [
              'Fabric sourcing is covered by the accepted quote',
              'Tailor should not buy replacement fabric without approval',
            ],
          }
    const bulkCount = Number.parseInt(bulkRecipientCount, 10)
    const bulkOrder = isBulkOrder
      ? {
          enabled: true,
          mode: 'OPS_MANAGED_SPECIAL_CASE' as const,
          label: bulkLabel.trim() || null,
          recipientCount: Number.isFinite(bulkCount) && bulkCount >= 2 ? bulkCount : null,
          payerModel: 'SINGLE_PAYER' as const,
          measurementPrivacy: 'TAILOR_ONLY' as const,
          statusPolicy: 'OPS_MANAGED_LINKED_CHILDREN' as const,
          dyeLotConsistencyRequired: true,
          notes: bulkNotes.trim() || null,
        }
      : null
    const supportMeta =
      fabricSource === 'CUSTOMER_SUPPLIES'
        ? {
            fabricHandoffMode,
            fabricHandoffLabel: fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null,
            fabricPolicy,
            bulkOrder,
            fitProfile,
            styleInspirationLinks: inspirationLinks,
            styleAttributes,
            styleNotes: styleNotes.trim() || null,
            bodyNote: fitNote.trim() || null,
          }
        : {
            fabricHandoffMode: 'NO_CUSTOMER_HANDOFF_REQUIRED' as const,
            fabricHandoffLabel: FABRIC_HANDOFF_LABELS.NO_CUSTOMER_HANDOFF_REQUIRED,
            fabricPolicy,
            bulkOrder,
            fitProfile,
            styleInspirationLinks: inspirationLinks,
            styleAttributes,
            styleNotes: styleNotes.trim() || null,
            bodyNote: fitNote.trim() || null,
            fabricSourcing: {
              description: fabricDescription.trim() || null,
              budgetAmount: fabricBudgetAmount.trim()
                ? Number.parseInt(fabricBudgetAmount, 10)
                : null,
              budgetCurrency: fabricBudgetAmount.trim() ? accountCurrency : null,
              deadlineBusinessDays: fabricSourcingDeadlineDays,
            },
          }

    const composedFitNote = fitNote.trim() || null

    const buildOrderPayload = (
      action: 'preflight-create-order' | 'create-order',
      uploadedReferencePhotos: string[]
    ) => ({
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
      supportMeta,
      deliveryMethod,
      garmentTypeOther: garmentType === 'Other' ? garmentTypeOther.trim() : null,
      genderPresentation,
      styleReferenceLinks: inspirationLinks,
      styleNotes: styleNotes.trim() || null,
      bodyNote: composedFitNote,
      fabricDescription: fabricSource === 'TAILOR_SOURCES' ? fabricDescription.trim() : null,
      fabricBudgetAmount: fabricBudgetAmount.trim()
        ? Number.parseInt(fabricBudgetAmount, 10)
        : null,
      fabricBudgetCurrency: fabricBudgetAmount.trim() ? accountCurrency : null,
      fabricSourcingDeadlineDays:
        fabricSource === 'TAILOR_SOURCES' ? fabricSourcingDeadlineDays : null,
      shippingPreference: deliveryMethod === 'SHIPPING' ? shippingPreference : null,
      deliveryInstructions: deliveryInstructions.trim() || null,
      deliveryAddress: deliveryMethod !== 'LOCAL_COLLECTION' ? composeDeliveryAddress() : null,
      deliveryCity: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryCity.trim() : null,
      deliveryRegion: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryStateRegion.trim() : null,
      deliveryPostalCode: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryPostalCode.trim() : null,
      deliveryCountryCode: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryCountry.trim() : null,
      recipientName: deliveryMethod !== 'LOCAL_COLLECTION' ? recipientName.trim() : null,
      recipientPhone:
        deliveryMethod !== 'LOCAL_COLLECTION' ? normalizePhoneForStorage(recipientPhone) : null,
      cancellationPolicyAcknowledged,
    })

    const { data: preflightData, error: preflightError } = await invokeFunction<{
      ok: boolean
      preflight?: boolean
    }>('custom-order-action', {
      body: buildOrderPayload('preflight-create-order', []),
    })

    if (preflightError || !preflightData?.ok) {
      setSubmitting(false)
      if (preflightError)
        Sentry.captureException(preflightError, {
          extra: { context: 'custom_order_preflight', tailorId },
        })
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

    const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>(
      'custom-order-action',
      {
        body: buildOrderPayload('create-order', uploadedUrls),
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
      has_measurements: !!measurementSnapshot,
      measurement_source: measurementSnapshot?.measurementSource ?? null,
      fabric_source: fabricSource,
      fabric_handoff_mode: supportMeta.fabricHandoffMode ?? null,
      delivery_method: deliveryMethod,
      bulk_order: isBulkOrder,
      has_deadline: !!deadline,
    })

    router.replace({
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
              router.push({
                pathname: '/(customer)/profile/measurements',
                params: {
                  returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }),
                },
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

  async function dismissMeasPrompt(goToMeasurements: boolean) {
    await AsyncStorage.setItem(MEAS_PROMPT_KEY, '1')
    setShowMeasPrompt(false)
    if (goToMeasurements) {
      router.push({
        pathname: '/(customer)/profile/measurements',
        params: { returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }) },
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
                router.push({
                  pathname: '/(customer)/profile/measurements',
                  params: {
                    returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }),
                  },
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

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(180, insets.bottom + 152) }}
        >
          <View style={styles.content}>
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
                        Browse cultural, formal, modest, and group order categories.
                      </Text>
                    </View>
                    <Text style={styles.garmentSelectAction}>
                      {garmentType ? 'Change' : 'Open'}
                    </Text>
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
                  hint={`${description.length}/1200 · 3 short lines or one clear paragraph`}
                  testID="description-input"
                />

                <Input
                  label="Occasion (optional)"
                  placeholder="e.g. Wedding, graduation, Eid"
                  value={occasion}
                  onChangeText={setOccasion}
                  testID="occasion-input"
                />

                <View>
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
                </View>

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
                      label="Group notes (optional)"
                      placeholder="Anything ops and the tailor should know about dye-lot consistency, measurement privacy, or linked recipients..."
                      value={bulkNotes}
                      onChangeText={setBulkNotes}
                      multiline
                      numberOfLines={3}
                      maxLength={300}
                    />
                    <Text style={styles.measureSubcardHint}>
                      Bulk custom orders stay inside Drape, but ops may help manage linked
                      recipients, dye-lot consistency, and measurement privacy before quote
                      acceptance.
                    </Text>
                  </View>
                ) : null}

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
                  hint={`${styleNotes.length}/1200`}
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
                    <View style={styles.measureSummaryGrid}>
                      {[
                        { key: 'chest', label: 'Chest', value: measurements.chest },
                        { key: 'waist', label: 'Waist', value: measurements.waist },
                        { key: 'hips', label: 'Hips', value: measurements.hips },
                        {
                          key: 'shoulderWidth',
                          label: 'Shoulders',
                          value: measurements.shoulderWidth,
                        },
                        { key: 'inseam', label: 'Inseam', value: measurements.inseam },
                        { key: 'sleeveLength', label: 'Sleeve', value: measurements.sleeveLength },
                        {
                          key: 'neckCircumference',
                          label: 'Neck',
                          value: measurements.neckCircumference,
                        },
                        { key: 'height', label: 'Height', value: measurements.height },
                        { key: 'underBust', label: 'Under bust', value: measurements.underBust },
                        { key: 'backLength', label: 'Back', value: measurements.backLength },
                        { key: 'outseam', label: 'Outseam', value: measurements.outseam },
                        {
                          key: 'thighCircumference',
                          label: 'Thigh',
                          value: measurements.thighCircumference,
                        },
                        {
                          key: 'kneeCircumference',
                          label: 'Knee',
                          value: measurements.kneeCircumference,
                        },
                        {
                          key: 'bicepCircumference',
                          label: 'Bicep',
                          value: measurements.bicepCircumference,
                        },
                        {
                          key: 'wristCircumference',
                          label: 'Wrist',
                          value: measurements.wristCircumference,
                        },
                        {
                          key: 'headCircumference',
                          label: 'Head',
                          value: measurements.headCircumference,
                        },
                        { key: 'hatBandLine', label: 'Hat band', value: measurements.hatBandLine },
                        { key: 'headLength', label: 'Head length', value: measurements.headLength },
                        { key: 'headWidth', label: 'Head width', value: measurements.headWidth },
                        {
                          key: 'earToEarOverCrown',
                          label: 'Crown E-E',
                          value: measurements.earToEarOverCrown,
                        },
                        {
                          key: 'frontToBackOverCrown',
                          label: 'Crown F-B',
                          value: measurements.frontToBackOverCrown,
                        },
                        { key: 'filaHeight', label: 'Fila height', value: measurements.filaHeight },
                        { key: 'torsoLength', label: 'Torso', value: measurements.torsoLength },
                      ].map(({ key, label, value }) => (
                        <TouchableOpacity
                          key={key}
                          style={styles.measureSummaryItem}
                          onPress={() => {
                            setEditingField({ key, label, value: value ? String(value) : '' })
                            setEditValue(value ? String(value) : '')
                          }}
                        >
                          <Text style={styles.measureSummaryLabel}>{label}</Text>
                          <Text
                            style={[
                              styles.measureSummaryValue,
                              !value && { color: Colors.lightGrey },
                            ]}
                          >
                            {value ? `${value} ${measurements.unit}` : 'Not added'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {getAdditionalMeasurementRows(measurements).length > 0 && (
                      <View style={styles.additionalMeasurePreview}>
                        <Text style={styles.additionalMeasurePreviewTitle}>
                          Garment-specific measurements
                        </Text>
                        <View style={styles.measureSummaryGrid}>
                          {getAdditionalMeasurementRows(measurements).map(({ label, value }) => (
                            <View key={label} style={styles.measureSummaryItem}>
                              <Text style={styles.measureSummaryLabel}>{label}</Text>
                              <Text style={styles.measureSummaryValue}>
                                {String(value)} {String(measurements.unit ?? '')}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
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
                        <Text style={styles.measureSourceLabel}>Guided fit intake</Text>
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
                              : 'This fit intake will be attached to the order for pre-cutting review.'}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.measureSubcardHint}>
                            Add posture, stretch, coverage, and symmetry notes once so future quotes
                            start from a fuller fit brief.
                          </Text>
                          <TouchableOpacity
                            style={styles.measureActionBtn}
                            onPress={() =>
                              router.push({
                                pathname: '/(customer)/profile/guided-fit',
                                params: {
                                  returnTo: buildBriefRoute(tailorId, {
                                    draftSession,
                                    resumeDraft: true,
                                  }),
                                },
                              })
                            }
                          >
                            <Text style={styles.measureActionBtnText}>Add guided fit intake</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={styles.noMeasureCard}>
                    <Text style={styles.noMeasureTitle}>Choose how to add measurements</Text>
                    <Text style={styles.noMeasureHint}>
                      Your tailor needs your fit profile before they can quote accurately. Scan with
                      Drape Vision or enter measurements manually, then return to this brief.
                    </Text>
                    <View style={styles.optionCards}>
                      <OptionCard
                        title="Scan with Drape Vision"
                        hint="Guided rotation scan. Your progress in this order will stay here when you come back."
                        active={false}
                        onPress={() =>
                          router.push({
                            pathname: DRAPE_VISION_ROUTE,
                            params: {
                              mode: 'customer_scan',
                              returnTo: buildBriefRoute(tailorId, {
                                draftSession,
                                resumeDraft: true,
                              }),
                            },
                          } as never)
                        }
                      />
                      <OptionCard
                        title="Enter measurements manually"
                        hint="Guided manual profile. Your progress in this order will stay here when you come back."
                        active={false}
                        onPress={() =>
                          router.push({
                            pathname: '/(customer)/profile/measurements',
                            params: {
                              returnTo: buildBriefRoute(tailorId, {
                                draftSession,
                                resumeDraft: true,
                              }),
                            },
                          })
                        }
                      />
                    </View>
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
                  hint={`${fitNote.length}/500 · min 20 characters`}
                />
                <View style={styles.inlineChipRow}>
                  {FIT_NOTE_PRESETS.map((value) => (
                    <TouchableOpacity
                      key={value}
                      style={styles.inlineChip}
                      onPress={() => {
                        const next =
                          fitNote.trim().length > 0 ? `${fitNote.trim()}. ${value}` : value
                        setFitNote(next)
                        if (fitNoteError) validateFitNote(next)
                      }}
                    >
                      <Text style={styles.inlineChipText}>{value}</Text>
                    </TouchableOpacity>
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
                      hint={`${fabricDescription.length}/1000`}
                    />
                    <Input
                      label={`Fabric budget (optional, ${accountCurrency})`}
                      placeholder="e.g. 75000"
                      value={fabricBudgetAmount}
                      onChangeText={(value) => setFabricBudgetAmount(value.replace(/[^\d]/g, ''))}
                      keyboardType="number-pad"
                      hint="The tailor will still quote the final amount before you pay."
                    />
                    <View>
                      <Text style={styles.fieldLabel}>
                        Sourcing deadline <Text style={styles.required}>*</Text>
                      </Text>
                      <Text style={styles.fieldHint}>
                        How long should the tailor have to source fabric before you are updated?
                      </Text>
                      <View style={styles.inlineChipRow}>
                        {CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS.map((days) => (
                          <TouchableOpacity
                            key={days}
                            style={[
                              styles.inlineChip,
                              fabricSourcingDeadlineDays === days && styles.inlineChipActive,
                            ]}
                            onPress={() => setFabricSourcingDeadlineDays(days)}
                          >
                            <Text
                              style={[
                                styles.inlineChipText,
                                fabricSourcingDeadlineDays === days && styles.inlineChipTextActive,
                              ]}
                            >
                              {days} business days
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={styles.guideCard}>
                      <Text style={styles.guideTitle}>Approval required</Text>
                      <Text style={styles.guideText}>
                        The tailor cannot cut until you approve the sourced fabric inside Drape.
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
                      onPress={() => setDeliveryMethod('LOCAL_DELIVERY')}
                    />
                    <OptionCard
                      title="Ship to me"
                      hint="Tailor ships your finished garment directly to you."
                      active={deliveryMethod === 'SHIPPING'}
                      onPress={() => setDeliveryMethod('SHIPPING')}
                    />
                    <OptionCard
                      title="Local collection"
                      hint="You collect in person. A 4-digit code confirms the handover."
                      active={deliveryMethod === 'LOCAL_COLLECTION'}
                      onPress={() => setDeliveryMethod('LOCAL_COLLECTION')}
                    />
                  </View>
                </View>

                {deliveryMethod === 'SHIPPING' ? (
                  <View>
                    <Text style={styles.fieldLabel}>
                      Shipping preference <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.inlineChipRow}>
                      {CUSTOM_ORDER_SHIPPING_PREFERENCES.map((value) => (
                        <TouchableOpacity
                          key={value}
                          style={[
                            styles.inlineChip,
                            shippingPreference === value && styles.inlineChipActive,
                          ]}
                          onPress={() => setShippingPreference(value)}
                        >
                          <Text
                            style={[
                              styles.inlineChipText,
                              shippingPreference === value && styles.inlineChipTextActive,
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
                      required
                    />
                    <Input
                      label="Recipient phone"
                      placeholder="e.g. +2348012345678 or +447700900123"
                      value={recipientPhone}
                      onChangeText={(v) => {
                        setRecipientPhone(normalizePhoneForStorage(v))
                        if (recipientContactError) setRecipientContactError('')
                      }}
                      onBlur={validateRecipientContact}
                      keyboardType="phone-pad"
                      autoCapitalize="none"
                      hint={
                        recipientMode === 'SELF'
                          ? recipientPhoneHint
                          : `Use the actual recipient phone number so the courier or rider can reach them. ${recipientPhoneHint}`
                      }
                      required
                    />
                    <Input
                      label="Search address"
                      placeholder="Search address, area, or landmark"
                      value={deliveryAddressSearch}
                      onChangeText={(v) => {
                        setDeliveryAddressSearch(v)
                        if (deliveryAddressError) setDeliveryAddressError('')
                      }}
                    />
                    {showDeliverySuggestions ? (
                      <View style={styles.suggestionsBox}>
                        {deliveryAddressSuggestions.map((item, index) => (
                          <TouchableOpacity
                            key={`${item.place_id ?? item.display_name}-${index}`}
                            style={[
                              styles.suggestionRow,
                              index === deliveryAddressSuggestions.length - 1 &&
                                styles.suggestionRowLast,
                            ]}
                            onPress={() => selectDeliverySuggestion(item)}
                          >
                            <Text style={styles.suggestionText}>{item.display_name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    <Input
                      label="Address line 1"
                      placeholder="Street address"
                      value={deliveryAddressLine1}
                      onChangeText={(v) => {
                        setDeliveryAddressLine1(v)
                        if (deliveryAddressError) setDeliveryAddressError('')
                      }}
                      onBlur={validateDeliveryAddress}
                      required
                    />
                    <Input
                      label="Address line 2 (optional)"
                      placeholder="Apartment, suite, building"
                      value={deliveryAddressLine2}
                      onChangeText={(v) => {
                        setDeliveryAddressLine2(v)
                        if (deliveryAddressError) setDeliveryAddressError('')
                      }}
                    />
                    <View style={styles.addressRow}>
                      <View style={styles.addressHalf}>
                        <Input
                          label="City"
                          placeholder="City"
                          value={deliveryCity}
                          onChangeText={(v) => {
                            setDeliveryCity(v)
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
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
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
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
                            if (deliveryAddressError) setDeliveryAddressError('')
                          }}
                          onBlur={validateDeliveryAddress}
                        />
                      </View>
                      <View style={styles.addressHalf}>
                        <Input
                          label="Country"
                          placeholder="Country"
                          value={deliveryCountry}
                          onChangeText={(v) => {
                            setDeliveryCountry(v)
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
                    <Text style={styles.fieldHint}>
                      Drape includes a standard{' '}
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
                      When the garment is ready, Drape creates a collection code. Share it only when
                      you have collected the order.
                    </Text>
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
                  <SummaryRow label="Body note" value={fitNote.trim()} />
                </ReviewSection>

                <ReviewSection title="Fabric" onEdit={() => setStep(3)}>
                  <SummaryRow label="Fabric" value={fabricSourceLabel(fabricSource)} />
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
                            ? `${accountCurrency} ${fabricBudgetAmount.trim()}`
                            : 'Not set'
                        }
                      />
                      <SummaryRow
                        label="Sourcing update"
                        value={`${fabricSourcingDeadlineDays} business days`}
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
        </ScrollView>

        {/* Bottom CTA */}
        <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom + Spacing.sm, 14) }]}>
          <Button
            label={step < STEP_TITLES.length - 1 ? 'Continue' : 'Submit order'}
            onPress={next}
            loading={submitting}
            disabled={submitting || !canProceed()}
            testID={step < STEP_TITLES.length - 1 ? 'brief-continue-btn' : 'brief-send-btn'}
          />
        </View>
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
    color: Colors.needleGreen,
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
  backText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
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
    color: Colors.needleGreen,
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
  inlineChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  inlineChip: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    justifyContent: 'center',
  },
  inlineChipActive: { backgroundColor: Colors.white, borderColor: Colors.needleGreen },
  inlineChipText: { fontSize: FontSize.xs, color: Colors.ink, fontWeight: FontWeight.medium },
  inlineChipTextActive: { color: Colors.needleGreen },
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
  garmentSelectAction: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
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
  pickerItemTextSelected: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  pickerItemCheck: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
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
  measureSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  measureSummaryItem: { width: '47%', gap: 2 },
  measureSummaryLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureSummaryValue: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  additionalMeasurePreview: { gap: Spacing.sm, paddingTop: Spacing.xs },
  additionalMeasurePreviewTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
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
  measureEditNote: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureEditHint: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },

  // Inline edit sheet
  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
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
  handleChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  handleChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  handleChipTextActive: { color: Colors.needleGreen },
  inspirationInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
    flexShrink: 1,
  },
  selectedLinkRemove: { fontSize: 10, color: Colors.needleGreen },
  linkError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs, lineHeight: 18 },

  // Fabric & delivery options
  optionCards: { gap: Spacing.sm },
  optionCard: {
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
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },

  // CTA
  cta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },

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
