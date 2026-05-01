import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform, Modal, TextInput,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Image as ExpoImage } from 'expo-image'
import { isLikelyConnectivityIssue, readFunctionErrorPayload } from '@/lib/function-errors'
import { goBackOrReturnTo } from '@/lib/navigation'
import {
  buildOrderFitProfile,
  COVERAGE_PREFERENCE_LABELS,
  enrichMeasurementSnapshot,
  FABRIC_HANDOFF_LABELS,
  FABRIC_STRETCH_LABELS,
  FIT_INTENT_LABELS,
  MEASUREMENT_SOURCE_LABELS,
  MEASUREMENT_SCAN_STATUS_LABELS,
  WEAR_DAY_SUPPORT_LABELS,
  type FabricHandoffMode,
} from '@/lib/order-support'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { composeStructuredAddress, parseNominatimSuggestion } from '@/lib/address'
import { stripExif } from '@/lib/stripExif'
import { Button, Input } from '@/components/ui'
import { CUSTOM_ORDER_RESUMABLE_STAGES } from '@drape/shared'
import { filterContactInfo, rejectPlaceholder, filterStyleReference } from '@drape/shared/contact-filter'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared/phone'
import { phoneHintForContext } from '@/lib/phone-context'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const MEAS_PROMPT_KEY = 'drape_meas_prompt_shown'

// ─── Types ────────────────────────────────────────────────────────────────────

type FabricSource = 'CUSTOMER_SUPPLIES' | 'TAILOR_SOURCES'
type DeliveryMethod = 'SHIPPING' | 'LOCAL_DELIVERY' | 'LOCAL_COLLECTION'
type RecipientMode = 'SELF' | 'OTHER'

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

const GARMENT_TYPES = [
  'Agbada', 'Suit', 'Kaftan', 'Ankara Dress', 'Lehenga', 'Saree Blouse',
  'Trousers', 'Shirt', 'Bespoke Dress', 'Wedding Gown', 'Blazer', 'Skirt', 'Other',
]
const OCCASION_PRESETS = ['Wedding', 'Birthday', 'Work', 'Casual', 'Travel', 'Event'] as const
const FIT_NOTE_PRESETS = [
  'Relaxed fit preferred',
  'Fitted look preferred',
  'I need this before my event',
  'I have broad shoulders',
  'Please keep it modest',
] as const

const STEP_TITLES = ['Garment details', 'Style references', 'Your measurements', 'Fabric & delivery']
const STEP_SUBS = [
  'Tell the seller exactly what you want to make, what it is for, and when you need it by.',
  'Show visual references so the seller can understand your taste, shape, and finishing direction faster.',
  'Share the fit context your maker needs to quote accurately and make the garment feel right on your body.',
  'Clarify who handles fabric and how the finished garment gets to you, so the order can move cleanly once quoted.',
]

const SUPPORTED_STYLE_LINK_LABELS = [
  'Instagram posts',
  'Instagram reels',
  'Pinterest pins',
  'TikTok videos',
  'YouTube videos',
  'X posts',
]

function newBriefDraftSession() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function buildBriefRoute(
  tailorId: string,
  options?: { draftSession?: string | null; resumeDraft?: boolean },
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
  const next = new Date()
  next.setDate(next.getDate() + 28)
  return next
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function hasCompleteMeasurementProfile(value: any): boolean {
  if (!value || typeof value !== 'object') return false
  const hasCore = value.chest != null && value.waist != null && typeof value.fitStyle === 'string'
  const hasContext = typeof value.garmentContext === 'string' && value.garmentContext.length > 0
  const bodyShapes = Array.isArray(value.bodyShape) ? value.bodyShape : value.bodyShape ? [value.bodyShape] : []
  return hasCore && hasContext && bodyShapes.length > 0
}

async function resolveOrderSubmitErrorMessage(error: Error | null) {
  const payload = error ? await readFunctionErrorPayload(error) : null
  const rawMessage =
    (typeof payload?.error === 'string' && payload.error.trim().length > 0
      ? payload.error.trim()
      : error?.message?.trim()) || 'Could not submit your order. Please try again.'
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

  if (normalized.includes('fabric_handoff_required') || normalized.includes('how your fabric will reach them')) {
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
    return "Remove phone numbers, social handles, or off-platform contact details from your brief before sending it. Fit measurements like bust, waist, and hips are still fine."
  }

  return rawMessage
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
  const { user } = useAuth()

  function goBack() {
    goBackOrReturnTo(router, navigation, returnTo, `/(customer)/tailor/${tailorId}`)
  }

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [showMeasPrompt, setShowMeasPrompt] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  // Step 1
  const [garmentType, setGarmentType] = useState('')
  const [description, setDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [occasion, setOccasion] = useState('')
  const [deadline, setDeadline] = useState<Date | null>(() => defaultDeadline())
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

  // Step 3 — measurement profile summary
  const [measurements, setMeasurements] = useState<any>(null)
  const [fitNote, setFitNote] = useState('')
  const [fitNoteError, setFitNoteError] = useState('')

  // Inline measurement editing
  const [editingField, setEditingField] = useState<{ key: string; label: string; value: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  // Step 4
  const [fabricSource, setFabricSource] = useState<FabricSource | null>(null)
  const [fabricHandoffMode, setFabricHandoffMode] = useState<FabricHandoffMode | null>(null)
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | null>(null)
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
  const [deliveryAddressSuggestions, setDeliveryAddressSuggestions] = useState<any[]>([])
  const [showDeliverySuggestions, setShowDeliverySuggestions] = useState(false)
  const suppressNextDeliveryLookup = useRef(false)
  const handledLaunchRef = useRef<string | null>(null)
  const guidedFitProfile = buildOrderFitProfile(measurements)
  const recipientPhoneHint = phoneHintForContext(deliveryCountry)

  function resetBriefState() {
    setStep(0)
    setSubmitting(false)
    setShowMeasPrompt(false)
    setFetchError(false)
    setInitialLoading(true)
    setGarmentType('')
    setDescription('')
    setDescriptionError('')
    setOccasion('')
    setDeadline(defaultDeadline())
    setShowDatePicker(false)
    setIsBulkOrder(false)
    setBulkRecipientCount('')
    setBulkLabel('')
    setBulkNotes('')
    setPhotos([])
    setInspirationLinks([])
    setInspirationInput('')
    setLinkError('')
    setMeasurements(null)
    setFitNote('')
    setFitNoteError('')
    setEditingField(null)
    setEditValue('')
    setFabricSource(null)
    setFabricHandoffMode(null)
    setDeliveryMethod(null)
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
  }

  useEffect(() => {
    if (resumeDraft === '1') return
    resetBriefState()
  }, [tailorId, draftSession, freshStart, resumeDraft])

  useEffect(() => {
    if (!user || recipientMode !== 'SELF') return
    setRecipientName((current) => current || String(user.user_metadata?.display_name ?? '').trim())
    setRecipientPhone((current) => current || normalizePhoneForStorage(String(user.user_metadata?.phone ?? '')))
  }, [user, recipientMode])

  async function loadInitialData() {
    setFetchError(false)
    setInitialLoading(true)
    setMeasurements(null)

    const launchKey = `${tailorId}:${draftSession ?? 'default'}:${freshStart ?? '0'}`
    if (freshStart === '1' && handledLaunchRef.current !== launchKey && user?.id) {
      handledLaunchRef.current = launchKey
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, reference, stage')
        .eq('customer_id', user.id)
        .eq('tailor_profile_id', tailorId)
        .eq('order_kind', 'CUSTOM')
        .in('stage', [...CUSTOM_ORDER_RESUMABLE_STAGES])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingOrder?.id) {
        Alert.alert(
          'Continue your current custom order?',
          `You already have a custom order with this tailor in progress (${existingOrder.reference ?? existingOrder.stage}). Continue it or start a new brief from scratch.`,
          [
            { text: 'Start new', style: 'destructive' },
            {
              text: 'Continue order',
              onPress: () =>
                router.replace({
                  pathname: `/(customer)/orders/${existingOrder.id}` as any,
                  params: { returnTo: '/(customer)/orders?tab=active', tab: 'active' },
                }),
            },
          ],
        )
      }
    }

    const [tailorRes, measRes] = await Promise.allSettled([
      supabase
        .from('tailor_profiles')
        .select('id')
        .eq('id', tailorId)
        .maybeSingle(),
      supabase
        .from('customer_profiles')
        .select('measurements')
        .eq('user_id', user?.id)
        .maybeSingle(),
    ])

    const tailorData =
      tailorRes.status === 'fulfilled' && !tailorRes.value.error
        ? tailorRes.value.data
        : null
    const measurementData =
      measRes.status === 'fulfilled' && !measRes.value.error
        ? measRes.value.data
        : null

    if (!tailorData?.id) {
      setFetchError(true)
    }

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
  }

  // Load tailor profile existence + customer measurements; show one-time completeness prompt
  useFocusEffect(
    useCallback(() => {
      void loadInitialData()
    }, [tailorId, user?.id])
  )

  function validateDescription(text: string) {
    const placeholder = rejectPlaceholder(text, 'Description')
    if (placeholder) { setDescriptionError(placeholder); return false }
    const res = filterContactInfo(text)
    if (res.blocked) { setDescriptionError("Contact details can't be included here."); return false }
    setDescriptionError('')
    return true
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
    setShowDeliverySuggestions(false)
    if (suppressNextDeliveryLookup.current) {
      suppressNextDeliveryLookup.current = false
      return
    }
    if (text.length < 5) {
      setDeliveryAddressSuggestions([])
      return
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drape/1.0' } }
        )
        const data: any[] = await res.json()
        const filtered = data.filter((item) => item && item.display_name && item.address)
        setDeliveryAddressSuggestions(filtered)
        setShowDeliverySuggestions(filtered.length > 0)
      } catch {
        setDeliveryAddressSuggestions([])
        setShowDeliverySuggestions(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [deliveryAddressSearch])

  function selectDeliverySuggestion(item: any) {
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
    if (placeholder) { setDeliveryAddressError(placeholder); return false }
    if (!deliveryAddressLine1.trim()) { setDeliveryAddressError('Please enter the first line of your address.'); return false }
    if (!deliveryCity.trim()) { setDeliveryAddressError('Please enter your city.'); return false }
    if (!deliveryStateRegion.trim()) { setDeliveryAddressError('Please enter your state, region, or county.'); return false }
    if (!deliveryCountry.trim()) { setDeliveryAddressError('Please enter your country.'); return false }
    setDeliveryAddressError('')
    return true
  }

  function validateRecipientContact() {
    const trimmedName = recipientName.trim()
    const normalizedPhone = normalizePhoneForStorage(recipientPhone)
    const namePlaceholder = rejectPlaceholder(trimmedName, 'Recipient name')
    if (namePlaceholder) { setRecipientContactError(namePlaceholder); return false }
    if (!trimmedName) { setRecipientContactError('Please enter the recipient name.'); return false }
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) { setRecipientContactError(phoneError); return false }
    setRecipientContactError('')
    return true
  }

  function validateFitNote(text: string) {
    if (text.trim().length < 20) {
      setFitNoteError('Tell your tailor about your deadline and any key fit details. Use at least 20 characters.')
      return false
    }
    const placeholder = rejectPlaceholder(text, 'Note')
    if (placeholder) { setFitNoteError(placeholder); return false }
    const res = filterContactInfo(text)
    if (res.blocked) { setFitNoteError("Contact details can't be included here."); return false }
    setFitNoteError('')
    return true
  }

  async function pickPhoto() {
    if (submitting) return
    if (photos.length >= 5) { Alert.alert('Maximum 5 reference photos'); return }
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
      return !!garmentType && description.trim().length >= 1 && !descriptionError && !!deadline
    }
    if (step === 1) return true // photos optional
    if (step === 2) return !!measurements && fitNote.trim().length >= 20 && !fitNoteError
    if (step === 3) {
      if (!fabricSource || !deliveryMethod) return false
      if (fabricSource === 'CUSTOMER_SUPPLIES' && !fabricHandoffMode) return false
      if (deliveryMethod !== 'LOCAL_COLLECTION') {
        const normalizedRecipientPhone = normalizePhoneForStorage(recipientPhone)
        const hasCoreAddress = !!deliveryAddressLine1.trim() && !!deliveryCity.trim() && !!deliveryStateRegion.trim() && !!deliveryCountry.trim()
        if (!hasCoreAddress || !!deliveryAddressError || !!recipientContactError || !recipientName.trim() || !normalizedRecipientPhone || !!validatePhoneForProfile(normalizedRecipientPhone)) {
          return false
        }
      }
      return true
    }
    return false
  }

  function addCustomInspirationLink() {
    const trimmed = inspirationInput.trim()
    if (!trimmed) return
    if (inspirationLinks.length >= 5) {
      setLinkError('Maximum 5 style references per order.')
      return
    }
    if (inspirationLinks.includes(trimmed)) {
      setLinkError("That link is already added.")
      return
    }
    const result = filterStyleReference(trimmed)
    if (!result.allowed) {
      setLinkError(result.reason ?? 'This link isn\'t accepted.')
      return
    }
    setLinkError('')
    setInspirationLinks((prev) => [...prev, result.cleaned!])
    setInspirationInput('')
  }

  function removeInspirationLink(link: string) {
    setInspirationLinks((prev) => prev.filter((l) => l !== link))
  }

  async function submit() {
    if (submitting) return
    // Final guard — catches any placeholder values that bypassed per-field validation
    if (!validateDescription(description)) return
    if (!validateFitNote(fitNote)) return
    if (deliveryMethod !== 'LOCAL_COLLECTION' && !validateDeliveryAddress()) return
    if (deliveryMethod !== 'LOCAL_COLLECTION' && !validateRecipientContact()) return
    setSubmitting(true)

    // Upload reference photos to Supabase Storage (EXIF stripped before upload)
    const uploadedUrls: string[] = []
    for (const uri of photos) {
      try {
        const cleanUri = await stripExif(uri)
        const ext = 'jpg' // stripExif always outputs JPEG
        const filename = `briefs/${user?.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const response = await fetch(cleanUri)
        const blob = await response.blob()
        const { data } = await supabase.storage.from('order-photos').upload(filename, blob, { contentType: `image/${ext}` })
        if (data) {
          const { data: urlData } = supabase.storage.from('order-photos').getPublicUrl(filename)
          uploadedUrls.push(urlData.publicUrl)
        }
      } catch (error) {
        setSubmitting(false)
        Alert.alert(
          'Upload failed',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. One of your reference photos could not be uploaded yet. Retry when the signal improves.'
            : 'One of your reference photos could not be uploaded right now. Please try again in a moment.',
        )
        return
      }
    }

    const measurementSnapshot = enrichMeasurementSnapshot(measurements)
    const fitProfile = buildOrderFitProfile(measurementSnapshot)
    const fabricPolicy = fabricSource === 'CUSTOMER_SUPPLIES'
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
          missingFabricRule: 'If the fabric never arrives, the customer can resend, ask the tailor to source, revise the design, or request cancellation review.',
          replacementRule: 'Replacement fabric must be confirmed inside the order before cutting resumes.',
          disagreementRule: 'If fabric suitability is disputed, Drape reviews the timeline before work continues.',
          prepRequirements: [
            'Share the handoff plan before the order is submitted',
            'Keep any shipping reference inside the order thread',
            'Do not expect cutting to start before receipt is confirmed',
            'Prewash, press, or stabilize the fabric first when the tailor asks for it',
          ],
        }
      : {
          approvalRequiredForTailorSourcing: true,
          replacementRule: 'Tailor-sourced fabric should only be replaced after customer approval inside Drape.',
          disagreementRule: 'If sourcing changes the agreed design or budget, Drape should review before work continues.',
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
    const supportMeta = fabricSource === 'CUSTOMER_SUPPLIES'
      ? {
          fabricHandoffMode,
          fabricHandoffLabel: fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null,
          fabricPolicy,
          bulkOrder,
          fitProfile,
          styleInspirationLinks: inspirationLinks,
        }
      : {
          fabricHandoffMode: 'NO_CUSTOMER_HANDOFF_REQUIRED' as const,
          fabricHandoffLabel: FABRIC_HANDOFF_LABELS.NO_CUSTOMER_HANDOFF_REQUIRED,
          fabricPolicy,
          bulkOrder,
          fitProfile,
          styleInspirationLinks: inspirationLinks,
        }

    const composedFitNote = fitNote.trim() || null

    const { data, error } = await invokeFunction<{ ok: boolean; orderId?: string }>('custom-order-action', {
      body: {
        action: 'create-order',
        tailorProfileId: tailorId,
        garmentType,
        description: description.trim(),
        occasion: occasion.trim() || null,
        deadline: deadline?.toISOString() ?? null,
        referencePhotos: uploadedUrls,
        customerMeasurementsSnapshot: measurementSnapshot,
        fitNote: composedFitNote,
        fabricSource,
        supportMeta,
        deliveryMethod,
        deliveryAddress: deliveryMethod !== 'LOCAL_COLLECTION' ? composeDeliveryAddress() : null,
        deliveryCity: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryCity.trim() : null,
        deliveryRegion: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryStateRegion.trim() : null,
        deliveryPostalCode: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryPostalCode.trim() : null,
        deliveryCountryCode: deliveryMethod !== 'LOCAL_COLLECTION' ? deliveryCountry.trim() : null,
        recipientName: deliveryMethod !== 'LOCAL_COLLECTION' ? recipientName.trim() : null,
        recipientPhone: deliveryMethod !== 'LOCAL_COLLECTION' ? normalizePhoneForStorage(recipientPhone) : null,
      },
    })

    setSubmitting(false)

    if (error || !data?.orderId) {
      console.error('Order create error:', JSON.stringify(error))
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
      pathname: `/(customer)/orders/${data.orderId}` as any,
      params: {
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
            onPress: () => router.push({
              pathname: '/(customer)/profile/measurements',
              params: { returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }) },
            }),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      )
      return
    }
    if (!canProceed() && step !== 1) return
    if (step < 3) { setStep(step + 1) }
    else { submit() }
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

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.errorState}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order brief</Text>
            <Text style={styles.errorTitle}>Couldn't load this order form</Text>
            <Text style={styles.errorHint}>Please go back and try again in a moment.</Text>
            <View style={styles.stateGuideCard}>
              <Text style={styles.stateGuideTitle}>Best recovery move</Text>
              <Text style={styles.stateGuideText}>
                Refresh here first. If it still fails, explore tailors first, then open your measurements if needed, so the next booking can keep moving.
              </Text>
            </View>
            <TouchableOpacity style={styles.errorBtn} onPress={() => void loadInitialData()}>
              <Text style={styles.errorBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.errorBtn, styles.errorBtnSecondary]} onPress={() => router.replace('/(customer)')}>
              <Text style={[styles.errorBtnText, styles.errorBtnTextSecondary]}>Explore tailors</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.errorBtn, styles.errorBtnSecondary]}
              onPress={() => router.push({
                pathname: '/(customer)/profile/measurements',
                params: { returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }) },
              })}
            >
              <Text style={[styles.errorBtnText, styles.errorBtnTextSecondary]}>Open measurements</Text>
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
            <Text style={styles.loadingHint}>We’re loading your tailor details and measurement profile so the quote can start from the right context.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepLabel}>Step {step + 1} of 4</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Progress bar */}
        <View style={styles.progressRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.progressSeg, i <= step && styles.progressSegDone]} />
          ))}
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.content}>
            <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
            <View style={styles.stepIntroCard}>
              <Text style={styles.stepIntroEyebrow}>Why this step matters</Text>
              <Text style={styles.stepIntroText}>{STEP_SUBS[step]}</Text>
            </View>
            {/* ── Step 0: Garment details ── */}
            {step === 0 && (
              <View style={styles.fields}>
                {/* Garment type picker */}
                <View>
                  <Text style={styles.fieldLabel}>Garment type <Text style={styles.required}>*</Text></Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.garmentRow}>
                      {GARMENT_TYPES.map((g) => (
                        <TouchableOpacity
                          key={g}
                          style={[styles.garmentChip, garmentType === g && styles.garmentChipActive]}
                          onPress={() => setGarmentType(g)}
                        >
                          <Text style={[styles.garmentChipText, garmentType === g && styles.garmentChipTextActive]}>{g}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                <Input
                  label="Description"
                  placeholder="Describe your garment: style, details, fabric preferences..."
                  value={description}
                  onChangeText={(v) => { setDescription(v); if (descriptionError) validateDescription(v) }}
                  onBlur={() => validateDescription(description)}
                  error={descriptionError}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  filterContact
                  required
                  hint={`${description.length}/500`}
                  testID="description-input"
                />

                <Input
                  label="Occasion (optional)"
                  placeholder="e.g. Wedding, graduation, Eid"
                  value={occasion}
                  onChangeText={setOccasion}
                  testID="occasion-input"
                />
                <View style={styles.inlineChipRow}>
                  {OCCASION_PRESETS.map((value) => (
                    <TouchableOpacity
                      key={value}
                      style={[styles.inlineChip, occasion === value && styles.inlineChipActive]}
                      onPress={() => setOccasion(occasion === value ? '' : value)}
                    >
                      <Text style={[styles.inlineChipText, occasion === value && styles.inlineChipTextActive]}>{value}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Who is this order for?</Text>
                  <View style={styles.optionCards}>
                    <OptionCard
                      title="One person"
                      hint="Standard custom order flow for a single recipient."
                      active={!isBulkOrder}
                      onPress={() => setIsBulkOrder(false)}
                    />
                    <OptionCard
                      title="Group or family order"
                      hint="Best for ashoebi, wedding parties, or family sets. Drape may manage this as a linked special case."
                      active={isBulkOrder}
                      onPress={() => setIsBulkOrder(true)}
                    />
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
                      Bulk custom orders stay inside Drape, but ops may help manage linked recipients, dye-lot consistency, and measurement privacy before quote acceptance.
                    </Text>
                  </View>
                ) : null}

                <View>
                  <Text style={styles.fieldLabel}>Deadline <Text style={styles.required}>*</Text></Text>
                  <Text style={styles.fieldHint}>When do you need this by? Default is 4 weeks from today.</Text>
                  <TouchableOpacity style={[styles.dateButton, !deadline && styles.dateButtonRequired]} onPress={() => setShowDatePicker(true)}>
                    <Text style={[styles.dateText, !deadline && styles.datePlaceholder]}>
                      {deadline
                        ? deadline.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
                        : 'Select your deadline'}
                    </Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={deadline ?? (() => { const d = new Date(); d.setDate(d.getDate() + 28); return d })()}
                      mode="date"
                      minimumDate={new Date()}
                      onChange={(_, date) => { setShowDatePicker(false); if (date) setDeadline(date) }}
                    />
                  )}
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
                    Inspiration photos, sketches, or similar garments you love.
                  </Text>
                  <View style={[styles.photoGrid, { marginTop: Spacing.md }]}>
                    {photos.map((uri, i) => (
                      <View key={i} style={styles.photoThumb}>
                        <ExpoImage source={{ uri }} style={styles.photoImage} contentFit="cover" transition={120} />
                        <TouchableOpacity
                          style={styles.photoRemove}
                          onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Text style={styles.photoRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {photos.length < 5 && (
                      <TouchableOpacity style={styles.photoAdd} onPress={pickPhoto}>
                        <Text style={styles.photoAddIcon}>+</Text>
                        <Text style={styles.photoAddLabel}>Add photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.photoCount}>{photos.length}/5 photos</Text>
                </View>

                {/* Style inspiration */}
                <View style={styles.inspirationSection}>
                  <Text style={styles.fieldLabel}>Style inspiration</Text>
                  <Text style={styles.fieldHint}>
                    Add Instagram, Pinterest, or TikTok post links to styles you like — up to 5. We've suggested some accounts below.
                  </Text>

                  {/* Supported link types */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.handlesScroll}>
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
                        onChangeText={(v) => { setInspirationInput(v); if (linkError) setLinkError('') }}
                        containerStyle={{ marginBottom: 0 }}
                        onSubmitEditing={addCustomInspirationLink}
                        returnKeyType="done"
                      />
                    </View>
                    <TouchableOpacity style={styles.inspirationAddBtn} onPress={addCustomInspirationLink}>
                      <Text style={styles.inspirationAddText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                  {linkError ? <Text style={styles.linkError}>{linkError}</Text> : null}

                  {/* Selected inspiration links */}
                  {inspirationLinks.length > 0 && (
                    <View style={styles.selectedLinks}>
                      {inspirationLinks.map((link) => (
                        <View key={link} style={styles.selectedLinkBadge}>
                          <Text style={styles.selectedLinkText} numberOfLines={1}>{link}</Text>
                          <TouchableOpacity onPress={() => removeInspirationLink(link)}>
                            <Text style={styles.selectedLinkRemove}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* ── Step 2: Measurements ── */}
            {step === 2 && (
              <View style={styles.fields}>
                {measurements ? (
                  <View style={styles.measureSummaryCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.measureSummaryTitle}>Your measurements</Text>
                      <Text style={styles.measureEditHint}>
                        {(() => {
                          const FIELDS = ['chest','waist','hips','shoulderWidth','inseam','sleeveLength','neckCircumference','height']
                          const filled = FIELDS.filter((k) => measurements[k] != null).length
                          return filled < FIELDS.length ? `${filled}/${FIELDS.length} · Tap to edit` : 'Tap any field to edit'
                        })()}
                      </Text>
                    </View>
                    {typeof measurements.measurementSource === 'string' ? (
                      <View style={styles.measureSourceRow}>
                        <Text style={styles.measureSourceLabel}>Source</Text>
                        <Text style={styles.measureSourceValue}>
                          {MEASUREMENT_SOURCE_LABELS[measurements.measurementSource as keyof typeof MEASUREMENT_SOURCE_LABELS] ?? measurements.measurementSource}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.measureSummaryGrid}>
                      {[
                        { key: 'chest', label: 'Chest', value: measurements.chest },
                        { key: 'waist', label: 'Waist', value: measurements.waist },
                        { key: 'hips', label: 'Hips', value: measurements.hips },
                        { key: 'shoulderWidth', label: 'Shoulders', value: measurements.shoulderWidth },
                        { key: 'inseam', label: 'Inseam', value: measurements.inseam },
                        { key: 'sleeveLength', label: 'Sleeve', value: measurements.sleeveLength },
                        { key: 'neckCircumference', label: 'Neck', value: measurements.neckCircumference },
                        { key: 'height', label: 'Height', value: measurements.height },
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
                          <Text style={[styles.measureSummaryValue, !value && { color: Colors.lightGrey }]}>
                            {value ? `${value} ${measurements.unit}` : 'Not added'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {asStringList(measurements.fitFlags).length > 0 && (
                      <View style={styles.flagsRow}>
                        {asStringList(measurements.fitFlags).map((f) => (
                          <View key={f} style={styles.flagBadge}>
                            <Text style={styles.flagBadgeText}>{f.replace(/_/g, ' ').toLowerCase()}</Text>
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
                              <Text style={styles.measureSourceValue}>{FIT_INTENT_LABELS[guidedFitProfile.fitIntent]}</Text>
                            </View>
                          ) : null}
                          {guidedFitProfile.fabricStretch ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Stretch</Text>
                              <Text style={styles.measureSourceValue}>{FABRIC_STRETCH_LABELS[guidedFitProfile.fabricStretch]}</Text>
                            </View>
                          ) : null}
                          {guidedFitProfile.wearDaySupport ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Support</Text>
                              <Text style={styles.measureSourceValue}>{WEAR_DAY_SUPPORT_LABELS[guidedFitProfile.wearDaySupport]}</Text>
                            </View>
                          ) : null}
                          {guidedFitProfile.coveragePreference ? (
                            <View style={styles.measureSourceRow}>
                              <Text style={styles.measureSourceLabel}>Coverage</Text>
                              <Text style={styles.measureSourceValue}>{COVERAGE_PREFERENCE_LABELS[guidedFitProfile.coveragePreference]}</Text>
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
                            Add posture, stretch, coverage, and symmetry notes once so future quotes start from a fuller fit brief.
                          </Text>
                          <TouchableOpacity
                            style={styles.measureActionBtn}
                            onPress={() => router.push({
                              pathname: '/(customer)/profile/guided-fit',
                              params: { returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }) },
                            })}
                          >
                            <Text style={styles.measureActionBtnText}>Add guided fit intake</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={styles.noMeasureCard}>
                    <Text style={styles.noMeasureTitle}>Measurements required</Text>
                    <Text style={styles.noMeasureHint}>
                      Your tailor needs your full measurement profile to give an accurate quote. Set it up once and it carries into future orders.
                    </Text>
                    <TouchableOpacity
                      style={styles.noMeasureBtn}
                      onPress={() => router.push({
                        pathname: '/(customer)/profile/measurements',
                        params: { returnTo: buildBriefRoute(tailorId, { draftSession, resumeDraft: true }) },
                      })}
                    >
                      <Text style={styles.noMeasureBtnText}>Complete measurement profile</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Input
                  label="Note to your tailor"
                  placeholder="Tell your tailor anything they need to know. e.g. I'd like a relaxed fit, I have broad shoulders, and I need this for a wedding on 14 June."
                  value={fitNote}
                  onChangeText={(v) => { setFitNote(v); if (fitNoteError) validateFitNote(v) }}
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
                        const next = fitNote.trim().length > 0 ? `${fitNote.trim()}. ${value}` : value
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

            {/* ── Step 3: Fabric & delivery ── */}
            {step === 3 && (
              <View style={styles.fields}>
                <View>
                  <Text style={styles.fieldLabel}>Fabric <Text style={styles.required}>*</Text></Text>
                  <View style={styles.optionCards}>
                    <OptionCard
                      title="I'll supply the fabric"
                      hint="You can ship it, drop it off locally, let the tailor pick it up, or bring it to consultation."
                      active={fabricSource === 'CUSTOMER_SUPPLIES'}
                      onPress={() => setFabricSource('CUSTOMER_SUPPLIES')}
                    />
                    <OptionCard
                      title="Tailor to source"
                      hint="Tailor buys the fabric. Cost is included in their quote."
                      active={fabricSource === 'TAILOR_SOURCES'}
                      onPress={() => setFabricSource('TAILOR_SOURCES')}
                    />
                  </View>
                </View>

                {fabricSource === 'CUSTOMER_SUPPLIES' && (
                  <View>
                    <Text style={styles.fieldLabel}>How will the fabric reach the tailor? <Text style={styles.required}>*</Text></Text>
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

                <View>
                  <Text style={styles.fieldLabel}>Delivery <Text style={styles.required}>*</Text></Text>
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

                {deliveryMethod !== 'LOCAL_COLLECTION' && (
                  <View style={styles.addressFields}>
                    <View>
                      <Text style={styles.fieldLabel}>Who should receive this order? <Text style={styles.required}>*</Text></Text>
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
                      hint={recipientMode === 'SELF' ? 'This is the name the courier or rider should ask for.' : 'Use the name of the person collecting this on your behalf.'}
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
                              index === deliveryAddressSuggestions.length - 1 && styles.suggestionRowLast,
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
                      onChangeText={(v) => { setDeliveryAddressLine1(v); if (deliveryAddressError) setDeliveryAddressError('') }}
                      onBlur={validateDeliveryAddress}
                      required
                    />
                    <Input
                      label="Address line 2 (optional)"
                      placeholder="Apartment, suite, building"
                      value={deliveryAddressLine2}
                      onChangeText={(v) => { setDeliveryAddressLine2(v); if (deliveryAddressError) setDeliveryAddressError('') }}
                    />
                    <View style={styles.addressRow}>
                      <View style={styles.addressHalf}>
                        <Input
                          label="City"
                          placeholder="City"
                          value={deliveryCity}
                          onChangeText={(v) => { setDeliveryCity(v); if (deliveryAddressError) setDeliveryAddressError('') }}
                          onBlur={validateDeliveryAddress}
                          required
                        />
                      </View>
                      <View style={styles.addressHalf}>
                        <Input
                          label="State / region"
                          placeholder="State"
                          value={deliveryStateRegion}
                          onChangeText={(v) => { setDeliveryStateRegion(v); if (deliveryAddressError) setDeliveryAddressError('') }}
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
                          onChangeText={(v) => { setDeliveryPostalCode(v); if (deliveryAddressError) setDeliveryAddressError('') }}
                          onBlur={validateDeliveryAddress}
                        />
                      </View>
                      <View style={styles.addressHalf}>
                        <Input
                          label="Country"
                          placeholder="Country"
                          value={deliveryCountry}
                          onChangeText={(v) => { setDeliveryCountry(v); if (deliveryAddressError) setDeliveryAddressError('') }}
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
                    {recipientContactError ? <Text style={styles.linkError}>{recipientContactError}</Text> : null}
                    {deliveryAddressError ? <Text style={styles.linkError}>{deliveryAddressError}</Text> : null}
                  </View>
                )}

                {/* Summary */}
                {garmentType && (
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>Order summary</Text>
                    <SummaryRow label="Garment" value={garmentType} />
                    <SummaryRow label="Photos" value={`${photos.length} reference photos`} />
                    {deadline && (
                      <SummaryRow
                        label="Deadline"
                        value={deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      />
                    )}
                    {fabricSource && (
                      <SummaryRow label="Fabric" value={fabricSource === 'CUSTOMER_SUPPLIES' ? 'You supply' : 'Tailor sources'} />
                    )}
                    {measurements?.measurementSource ? (
                      <SummaryRow
                        label="Measurement source"
                        value={MEASUREMENT_SOURCE_LABELS[measurements.measurementSource as keyof typeof MEASUREMENT_SOURCE_LABELS] ?? measurements.measurementSource}
                      />
                    ) : null}
                    {fabricSource === 'CUSTOMER_SUPPLIES' && fabricHandoffMode ? (
                      <SummaryRow label="Fabric handoff" value={FABRIC_HANDOFF_LABELS[fabricHandoffMode]} />
                    ) : null}
                    {deliveryMethod && (
                      <SummaryRow
                        label="Delivery"
                        value={
                          deliveryMethod === 'SHIPPING'
                            ? 'Shipping'
                            : deliveryMethod === 'LOCAL_DELIVERY'
                              ? 'Local delivery'
                              : 'Local collection'
                        }
                      />
                    )}
                    {deliveryMethod !== 'LOCAL_COLLECTION' && recipientName.trim() && (
                      <SummaryRow label={recipientMode === 'SELF' ? 'Receiving contact' : 'Recipient'} value={recipientName.trim()} />
                    )}
                    {deliveryMethod !== 'LOCAL_COLLECTION' && recipientPhone.trim() && (
                      <SummaryRow label="Recipient phone" value={normalizePhoneForStorage(recipientPhone)} />
                    )}
                    {deliveryMethod !== 'LOCAL_COLLECTION' && composeDeliveryAddress().trim() && (
                      <SummaryRow label={deliveryMethod === 'SHIPPING' ? 'Ship to' : 'Deliver to'} value={composeDeliveryAddress()} />
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.cta}>
          <View style={styles.ctaGuideCard}>
            <Text style={styles.ctaGuideTitle}>Best next move</Text>
            <Text style={styles.ctaGuideText}>
              {step === 0
                ? 'Be clear about what you want made so the tailor can tell quickly whether they are the right fit.'
                : step === 1
                  ? 'Use references that show the outcome you want, not just the category you are shopping for.'
                  : step === 2
                    ? 'Accurate measurements and delivery details help the tailor quote with much less guesswork.'
                    : 'Send the brief once it feels complete enough that a tailor could price and plan the work confidently.'}
            </Text>
          </View>
          <Button
            label={step < 3 ? 'Continue' : 'Send order'}
            onPress={next}
            loading={submitting}
            disabled={submitting || (!canProceed() && step !== 1)}
            testID={step < 3 ? 'brief-continue-btn' : 'brief-send-btn'}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Inline measurement edit modal */}
      <Modal visible={!!editingField} transparent animationType="slide" onRequestClose={() => setEditingField(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.editOverlay} activeOpacity={1} onPress={() => setEditingField(null)} />
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
                          Alert.alert('Could not update profile', 'Your measurement was updated for this order only. Please try again from your profile.')
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
                          Alert.alert('Could not update profile', 'Your measurement was updated for this order only. Please try again from your profile.')
                          return
                        }

                        setMeasurements(nextMeasurements)
                      },
                    },
                  ]
                )
              }}
            />
            <TouchableOpacity onPress={() => setEditingField(null)} style={{ alignItems: 'center', paddingVertical: Spacing.sm }}>
              <Text style={{ color: Colors.midGrey, fontSize: FontSize.sm }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Profile completeness prompt — one-time modal */}
      <Modal visible={showMeasPrompt} transparent animationType="fade" onRequestClose={() => dismissMeasPrompt(false)}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.promptEmoji}>📐</Text>
            <Text style={styles.promptTitle}>Add your measurements first?</Text>
            <Text style={styles.promptBody}>
              Tailors give more accurate quotes when they have your body measurements on file. It only takes a minute and you only do it once.
            </Text>
            <TouchableOpacity
              style={styles.promptPrimary}
              onPress={() => dismissMeasPrompt(true)}
            >
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

function OptionCard({ title, hint, active, onPress }: { title: string; hint: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.optionCard, active && styles.optionCardActive]} onPress={onPress} accessibilityLabel={title}>
      <View style={[styles.optionRadio, active && styles.optionRadioActive]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{title}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
    </TouchableOpacity>
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
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
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
  loadingTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  loadingHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  errorTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
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
  errorBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  errorBtnTextSecondary: { color: Colors.ink },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  stepLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.lg, marginBottom: 6 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.lightGrey },
  progressSegDone: { backgroundColor: Colors.needleGreen },

  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  stepTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink },
  stepIntroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  stepIntroEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stepIntroText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
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
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: 6 },
  required: { color: Colors.error },
  fieldHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  inlineChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  inlineChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    justifyContent: 'center',
  },
  inlineChipActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  inlineChipText: { fontSize: FontSize.xs, color: Colors.ink, fontWeight: FontWeight.medium },
  inlineChipTextActive: { color: Colors.needleGreen },
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

  // Garment type chips
  garmentRow: { flexDirection: 'row', gap: 8, paddingBottom: Spacing.xs },
  garmentChip: {
    minHeight: 38,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    justifyContent: 'center',
  },
  garmentChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  garmentChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  garmentChipTextActive: { color: Colors.needleGreen },

  // Date picker
  dateButton: {
    backgroundColor: Colors.white, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.lightGrey, padding: 14, marginTop: 6, minHeight: 44,
  },
  dateButtonRequired: { borderColor: Colors.error + '60' },
  dateText: { fontSize: FontSize.sm, color: Colors.ink },
  datePlaceholder: { color: Colors.midGrey },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: { width: 84, height: 84, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  photoRemoveText: { color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold },
  photoAdd: {
    width: 84, height: 84, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.lightGrey, borderStyle: 'dashed',
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  photoAddIcon: { fontSize: 24, color: Colors.midGrey },
  photoAddLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  photoCount: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Measurements summary
  measureSummaryCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: Spacing.sm, ...Shadow.sm },
  measureSummaryTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
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
  measureSummaryValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  flagBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, backgroundColor: Colors.kanteRustLight, borderRadius: Radius.full },
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
    color: Colors.white,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  measureEditNote: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureEditHint: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium },

  // Inline edit sheet
  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  editSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing.xxxl,
  },
  editSheetTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  editSheetInput: {
    backgroundColor: Colors.bone, borderRadius: Radius.md, padding: Spacing.lg,
    fontSize: FontSize.xl, fontWeight: FontWeight.semibold, color: Colors.ink,
    borderWidth: 1.5, borderColor: Colors.needleGreen,
  },

  noMeasureCard: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md,
    padding: 14, gap: Spacing.xs, alignItems: 'center',
  },
  noMeasureTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  noMeasureHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  noMeasureBtn: {
    marginTop: Spacing.sm, backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md, minHeight: 44, paddingVertical: 10, paddingHorizontal: Spacing.xl,
  },
  noMeasureBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },

  // Style inspiration
  inspirationSection: { gap: Spacing.sm },
  handlesScroll: { marginTop: Spacing.sm },
  handlesRow: { flexDirection: 'row', gap: 8, paddingBottom: Spacing.xs },
  handleChip: {
    minHeight: 38,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    justifyContent: 'center',
  },
  handleChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  handleChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  handleChipTextActive: { color: Colors.needleGreen },
  inspirationInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inspirationAddBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    minHeight: 44, paddingVertical: 10, paddingHorizontal: Spacing.lg, justifyContent: 'center',
  },
  inspirationAddText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  selectedLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectedLinkBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.full,
    minHeight: 34,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.needleGreen, maxWidth: 200,
  },
  selectedLinkText: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium, flexShrink: 1 },
  selectedLinkRemove: { fontSize: 10, color: Colors.needleGreen },
  linkError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs, lineHeight: 18 },

  // Fabric & delivery options
  optionCards: { gap: Spacing.sm },
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14,
    borderWidth: 1.5, borderColor: Colors.lightGrey, ...Shadow.sm,
  },
  optionCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  optionRadio: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
  },
  optionRadioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  optionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  optionTitleActive: { color: Colors.needleGreen },
  optionHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 18 },

  // Summary card
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, gap: Spacing.sm, ...Shadow.sm },
  summaryTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  summaryValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  // CTA
  cta: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },
  ctaGuideCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  ctaGuideTitle: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  ctaGuideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  // Profile completeness prompt modal
  promptOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  promptCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.lg, gap: Spacing.md, alignItems: 'center', ...Shadow.lg,
  },
  promptEmoji: { fontSize: 40 },
  promptTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  promptBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22, textAlign: 'center' },
  promptPrimary: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    minHeight: 44,
    paddingVertical: 10, paddingHorizontal: Spacing.xxl, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center',
  },
  promptPrimaryText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
  promptSecondary: { fontSize: FontSize.sm, color: Colors.midGrey, textDecorationLine: 'underline' },
})
