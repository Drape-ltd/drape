import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  UIManager,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImageManipulator from 'expo-image-manipulator'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isDuplicatePhoneError, isLikelyConnectivityIssue } from '@/lib/function-errors'
import { syncUserRow } from '@/lib/syncUserRow'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { resetTo } from '@/lib/navigation'
import {
  checkAccountPhoneAvailability,
  DUPLICATE_PHONE_MESSAGE,
  sendAccountPhoneOtp,
  verifyAccountPhoneOtp,
} from '@/lib/account-profile-actions'
import { Sentry } from '@/lib/sentry'
import { useKeyboardState } from '@/lib/useKeyboardState'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { hapticSuccess, hapticWarning } from '@/lib/haptics'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import {
  SUPPORTED_CURRENCIES,
  detectDeviceCurrencyPreference,
  fetchCurrencyPreferenceContext,
  type CurrencyCode,
} from '@/lib/currency'
import { Button, ChoiceSheet, Input, KeyboardAwareScrollView, PhoneNumberInput } from '@/components/ui'
import { AvatarImage } from '@/components/ui/AvatarImage'
import {
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
} from '@/components/ui/DrapePrimitives'
import {
  useDrapeCapsuleNavMotion,
  useDrapeCapsuleNavScroll,
} from '@/components/ui/DrapeCapsuleNav'
import { validateDisplayName } from '@drape/shared/contact-filter'
import {
  normalizePhoneForStorage,
  PHONE_STORAGE_HINT,
  validatePhoneForProfile,
} from '@drape/shared/phone'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

type Unit = 'in' | 'cm'
type GarmentContext = 'MENSWEAR' | 'WOMENSWEAR' | 'BOTH' | 'PREFER_NOT_TO_SAY'
type CustomerSetupProfileRow = {
  avatar_url?: string | null
  display_name?: string | null
  phone?: string | null
  unit_preference?: string | null
  garment_context?: unknown
  measurements?: {
    unit?: unknown
    garmentContext?: unknown
  } | null
}
type UserCurrencyRow = {
  default_currency?: string | null
  currency_source?: string | null
  region_code?: string | null
}

const GARMENT_OPTIONS: Array<{ value: GarmentContext; label: string; hint: string }> = [
  { value: 'MENSWEAR', label: 'Menswear', hint: 'Suits, Agbada, kaftans, shirts, trousers' },
  { value: 'WOMENSWEAR', label: 'Womenswear', hint: 'Dresses, blouses, skirts, saree blouses' },
  { value: 'BOTH', label: 'Both', hint: 'I order menswear and womenswear' },
  {
    value: 'PREFER_NOT_TO_SAY',
    label: 'Prefer not to say',
    hint: 'Tailor works from measurements only',
  },
]

const PHONE_AVAILABILITY_DEBOUNCE_MS = 650
const CUSTOMER_SETUP_DRAFT_VERSION = 1
const ERROR_SCROLL_TOP_OFFSET = 92
const ERROR_SCROLL_DELAY_MS = 140

function customerSetupDraftKey(userId: string) {
  return `drape:customer-setup-draft:v${CUSTOMER_SETUP_DRAFT_VERSION}:${userId}`
}

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

function normalizeGarmentContext(value: unknown): GarmentContext | null {
  if (value === 'PREFER_NOT') return 'PREFER_NOT_TO_SAY'
  if (
    value === 'MENSWEAR' ||
    value === 'WOMENSWEAR' ||
    value === 'BOTH' ||
    value === 'PREFER_NOT_TO_SAY'
  ) {
    return value
  }
  return null
}

function customerSetupSaveMessage(error: unknown) {
  if (isDuplicatePhoneError(error)) {
    return 'That phone number is already connected to another Drapeon account. Use a different number or contact support.'
  }

  return isLikelyConnectivityIssue(error)
    ? 'Connection looks weak. We could not save your setup yet. Retry when the signal improves.'
    : 'We could not save your setup right now. Please try again in a moment.'
}

export default function CustomerSetupScreen() {
  const router = useRouter()
  const { user, signOut, switchRole } = useAuth()
  const keyboard = useKeyboardState()
  const { compact: actionDockCompact } = useDrapeCapsuleNavMotion()
  const actionDockScroll = useDrapeCapsuleNavScroll()
  const scrollRef = useRef<ScrollView | null>(null)
  const fieldYRef = useRef<Record<'displayName' | 'phone' | 'garmentContext', number>>({
    displayName: 0,
    phone: 0,
    garmentContext: 0,
  })
  const detectedCurrency = useMemo(() => detectDeviceCurrencyPreference(), [])

  // Pre-fill display name from OAuth metadata if available
  const oauthName = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? ''
  const oauthPhone = typeof user?.user_metadata?.phone === 'string' ? user.user_metadata.phone : ''
  const oauthVerifiedPhone =
    typeof user?.user_metadata?.verified_phone === 'string'
      ? user.user_metadata.verified_phone
      : typeof user?.user_metadata?.phone_verified_at === 'string'
        ? oauthPhone
        : ''

  const [displayName, setDisplayName] = useState(oauthName)
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
  const [unit, setUnit] = useState<Unit>('in')
  const [garmentContext, setGarmentContext] = useState<GarmentContext | null>(null)
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(detectedCurrency.currency)
  const [currencySource, setCurrencySource] = useState(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false)
  const [garmentSheetOpen, setGarmentSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [validationNotice, setValidationNotice] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [focusedTextField, setFocusedTextField] = useState<string | null>(null)
  const [leavingSetup, setLeavingSetup] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const latestPhoneRef = useRef(phone)
  const phoneAvailabilityRequestRef = useRef(0)
  const verifiedPhoneRef = useRef(verifiedPhone)
  const phoneOtpAfterVerifyRef = useRef<'save' | null>(null)

  const handleSignOut = useCallback(async () => {
    if (leavingSetup) return
    setLeavingSetup(true)
    try {
      await signOut()
    } catch {
      Alert.alert('Could not sign out', 'Please try again in a moment.')
    } finally {
      setLeavingSetup(false)
    }
  }, [leavingSetup, signOut])

  const handleUseTailorInstead = useCallback(async () => {
    if (leavingSetup) return
    setLeavingSetup(true)
    try {
      const result = await switchRole('TAILOR')
      if (result.error) {
        Alert.alert('Could not switch modes', result.error)
        return
      }
      resetTo(router, '/(tailor)/profile/setup')
    } finally {
      setLeavingSetup(false)
    }
  }, [leavingSetup, router, switchRole])

  const leaveSetup = useCallback(() => {
    if (saving || leavingSetup) return
    Alert.alert(
      'Leave customer setup?',
      'You can return later. Choose another Drapeon mode or switch accounts now.',
      [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Use tailor instead', onPress: () => { void handleUseTailorInstead() } },
        { text: 'Sign out', onPress: () => { void handleSignOut() } },
      ]
    )
  }, [handleSignOut, handleUseTailorInstead, leavingSetup, saving])

  useContextualBackHandler(leaveSetup)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    void Promise.all([
      fetchCurrencyPreferenceContext(),
      supabase
        .from('customer_profiles')
        .select('display_name, phone, unit_preference, garment_context, measurements, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('users')
        .select('default_currency, currency_source, region_code')
        .eq('id', user.id)
        .maybeSingle(),
      AsyncStorage.getItem(customerSetupDraftKey(user.id)),
    ]).then(([resolved, profileResult, currencyResult, storedDraft]) => {
      if (cancelled) return
      setDefaultCurrency(resolved.currency)
      setCurrencySource(resolved.source)
      setRegionCode(resolved.regionCode)

      if (!profileResult.error && profileResult.data) {
        const row = profileResult.data as CustomerSetupProfileRow
        const measurements = row.measurements ?? {}
        const nextDisplayName = row.display_name ?? oauthName
        const nextPhone = row.phone ?? oauthPhone
        const nextUnit = (row.unit_preference ?? measurements.unit) as Unit | undefined
        const nextGarmentContext = normalizeGarmentContext(
          row.garment_context ?? measurements.garmentContext
        )

        if (typeof nextDisplayName === 'string' && nextDisplayName.trim().length > 0) {
          setDisplayName(nextDisplayName)
        }
        if (typeof nextPhone === 'string' && nextPhone.trim().length > 0) {
          setPhone(nextPhone)
        }
        if (nextUnit === 'in' || nextUnit === 'cm') {
          setUnit(nextUnit)
        }
        if (nextGarmentContext) {
          setGarmentContext(nextGarmentContext)
        }
        if (typeof row.avatar_url === 'string' && row.avatar_url.trim().length > 0) {
          setAvatarUrl(row.avatar_url.trim())
        }
      }

      if (!currencyResult.error && currencyResult.data) {
        const row = currencyResult.data as UserCurrencyRow
        const nextCurrency =
          typeof row.default_currency === 'string'
            ? SUPPORTED_CURRENCIES.find((item) => item.code === row.default_currency)
            : null

        if (nextCurrency) {
          setDefaultCurrency(nextCurrency.code)
        }
        if (typeof row.currency_source === 'string' && row.currency_source.trim().length > 0) {
          setCurrencySource(row.currency_source.trim().toUpperCase() as typeof currencySource)
        }
        if (typeof row.region_code === 'string' && row.region_code.trim().length > 0) {
          setRegionCode(row.region_code.trim().toUpperCase())
        }
      }

      if (storedDraft) {
        const draft = JSON.parse(storedDraft) as Record<string, unknown>
        if (draft.version === CUSTOMER_SETUP_DRAFT_VERSION) {
          if (typeof draft.displayName === 'string') setDisplayName(draft.displayName)
          if (typeof draft.phone === 'string') setPhone(draft.phone)
          if (draft.unit === 'in' || draft.unit === 'cm') setUnit(draft.unit)
          const nextGarmentContext = normalizeGarmentContext(draft.garmentContext)
          if (nextGarmentContext) setGarmentContext(nextGarmentContext)
          if (typeof draft.defaultCurrency === 'string' && SUPPORTED_CURRENCIES.some((item) => item.code === draft.defaultCurrency)) {
            setDefaultCurrency(draft.defaultCurrency as CurrencyCode)
          }
          if (typeof draft.currencySource === 'string') setCurrencySource(draft.currencySource as typeof currencySource)
          if (typeof draft.regionCode === 'string') setRegionCode(draft.regionCode)
          if (typeof draft.avatarUrl === 'string' || draft.avatarUrl === null) setAvatarUrl(draft.avatarUrl)
        }
      }
    }).catch((error) => {
      Sentry.captureException(error, { extra: { context: 'customer_setup_draft_restore', userId: user.id } })
    }).finally(() => {
      if (!cancelled) setDraftHydrated(true)
    })

    return () => {
      cancelled = true
    }
  }, [user?.id, oauthName, oauthPhone])

  useEffect(() => {
    if (!user?.id || !draftHydrated) return
    const timer = setTimeout(() => {
      const draft = {
        version: CUSTOMER_SETUP_DRAFT_VERSION,
        updatedAt: new Date().toISOString(),
        displayName,
        phone,
        unit,
        garmentContext,
        defaultCurrency,
        currencySource,
        regionCode,
        avatarUrl,
      }
      void AsyncStorage.setItem(customerSetupDraftKey(user.id), JSON.stringify(draft)).catch((error) => {
        Sentry.captureException(error, { extra: { context: 'customer_setup_draft_save', userId: user.id } })
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [
    avatarUrl, currencySource, defaultCurrency, displayName, draftHydrated,
    garmentContext, phone, regionCode, unit, user?.id,
  ])

  function handleAvatarPress() {
    Alert.alert('Profile photo', 'Take a photo now or choose one from your library.', [
      { text: 'Take photo', onPress: () => void updateAvatarFromSource('camera') },
      { text: 'Choose from library', onPress: () => void updateAvatarFromSource('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function updateAvatarFromSource(source: AvatarImageSource) {
    if (!user?.id || uploadingAvatar) return
    const imageUri = await pickAvatarImageUri(source)
    if (!imageUri) return

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

      setAvatarUrl(`${publicUrl}?t=${Date.now()}`)
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not add your photo yet. Retry when the signal improves.'
        : 'Could not add your photo right now. Please try again in a moment.'
      Alert.alert('Photo not saved', message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  function validateName(name: string) {
    const err = validateDisplayName(name)
    setNameError(err ?? '')
    return !err
  }

  const phoneValidationMessage = useCallback((value: string) => {
    if (!value.trim()) {
      return 'Enter a valid phone number for order updates and account recovery.'
    }

    const error = validatePhoneForProfile(value)
    if (error) {
      return 'Enter a valid phone number for order updates and account recovery.'
    }
    return ''
  }, [])

  function validatePhone(value: string) {
    const error = phoneValidationMessage(value)
    setPhoneError(error)
    return !error
  }

  const rememberFieldY = useCallback((field: 'displayName' | 'phone' | 'garmentContext') => {
    return (event: { nativeEvent: { layout: { y: number } } }) => {
      fieldYRef.current[field] = event.nativeEvent.layout.y
    }
  }, [])

  const focusValidationError = useCallback(
    (field: 'displayName' | 'phone' | 'garmentContext', message: string) => {
      setValidationNotice(message)
      Keyboard.dismiss()
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setFocusedTextField(null)
      hapticWarning()
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, fieldYRef.current[field] - ERROR_SCROLL_TOP_OFFSET),
          animated: true,
        })
      }, ERROR_SCROLL_DELAY_MS)
    },
    []
  )

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
    setPhoneError('')
    setPhoneOtpError('')
  }

  function isCurrentPhoneVerified(value = phone) {
    const normalizedPhone = normalizePhoneForStorage(value)
    return !!normalizedPhone && verifiedPhoneRef.current === normalizedPhone
  }

  async function ensurePhoneVerifiedForSave() {
    const normalizedPhone = normalizePhoneForStorage(phone)
    if (isCurrentPhoneVerified(normalizedPhone)) return true

    setPhoneOtpSending(true)
    const result = await sendAccountPhoneOtp(normalizedPhone)
    setPhoneOtpSending(false)

    if (result.error) {
      setPhoneError(result.error)
      focusValidationError('phone', result.error)
      return false
    }

    if (result.bypassed) {
      markPhoneVerified(normalizedPhone)
      setValidationNotice('Phone check passed for this environment.')
      return true
    }

    phoneOtpAfterVerifyRef.current = 'save'
    setPhoneOtpCode('')
    setPhoneOtpError('')
    setPhoneOtpVisible(true)
    setValidationNotice('We sent a 6-digit code to verify your phone.')
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

    const shouldSave = phoneOtpAfterVerifyRef.current === 'save'
    phoneOtpAfterVerifyRef.current = null
    markPhoneVerified(normalizedPhone)
    setPhoneOtpVisible(false)
    setPhoneOtpCode('')
    setValidationNotice(result.bypassed ? 'Phone check passed for this environment.' : 'Phone number verified.')
    hapticSuccess()

    if (shouldSave) {
      requestAnimationFrame(() => {
        void save()
      })
    }
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
      markPhoneVerified(normalizedPhone)
      setPhoneOtpVisible(false)
      setPhoneOtpCode('')
      setValidationNotice('Phone check passed for this environment.')
      requestAnimationFrame(() => {
        void save()
      })
      return
    }

    setPhoneOtpError('')
    setValidationNotice('Code resent.')
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

  async function save() {
    if (saving) return
    const nextNameError = validateDisplayName(displayName)
    if (nextNameError) {
      setNameError(nextNameError)
      focusValidationError('displayName', nextNameError)
      return
    }
    const nextPhoneError = await validatePhoneAvailability(phone)
    if (nextPhoneError) {
      focusValidationError('phone', nextPhoneError)
      return
    }
    if (!garmentContext) {
      focusValidationError('garmentContext', 'Choose what you typically order to continue.')
      return
    }
    const phoneVerifiedForSave = await ensurePhoneVerifiedForSave()
    if (!phoneVerifiedForSave) return

    setSaveError('')
    setValidationNotice('')
    setSaving(true)
    const now = new Date().toISOString()

    const normalizedPhone = normalizePhoneForStorage(phone)
    const phoneVerifiedAt = isCurrentPhoneVerified(normalizedPhone) ? now : null

    const { error } = await supabase.from('customer_profiles').upsert(
      {
        user_id: user?.id,
        display_name: displayName.trim(),
        phone: normalizedPhone,
        unit_preference: unit,
        garment_context: garmentContext,
        avatar_url: avatarUrl,
        // Seed garment context + unit into measurements so it's available from the start
        measurements: {
          unit,
          garmentContext,
          fitFlags: [],
        },
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )

    if (!error) {
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          display_name: displayName.trim(),
          phone: normalizedPhone,
          ...(phoneVerifiedAt ? { phone_verified_at: phoneVerifiedAt, verified_phone: normalizedPhone } : {}),
        },
      })

      if (authError) {
        setSaving(false)
        const message = isLikelyConnectivityIssue(authError)
          ? 'We saved part of your setup, but could not finish updating your account yet because the connection looks weak. Retry when the signal improves.'
          : 'We saved part of your setup, but could not finish updating your account right now. Please try again in a moment.'
        setSaveError(message)
        Alert.alert('Could not finish account setup', message)
        return
      }

      try {
        await syncUserRow({
          userId: user?.id,
          displayName: displayName.trim(),
          role: 'CUSTOMER',
          phone: normalizedPhone,
          defaultCurrency,
          currencySource,
          regionCode,
          currencyConfirmedAt: now,
          strict: true,
        })
      } catch (syncError: unknown) {
        setSaving(false)
        const message = isDuplicatePhoneError(syncError)
          ? 'That phone number is already connected to another Drapeon account. Use a different number or contact support.'
          : isLikelyConnectivityIssue(syncError)
          ? 'We saved your setup, but could not finish locking your account currency because the connection looks weak. Please retry once the signal improves.'
          : 'We saved your setup, but could not finish locking your account currency right now. Please try again in a moment.'
        setSaveError(message)
        Alert.alert('Could not finish account setup', message)
        return
      }
    }

    setSaving(false)

    if (error) {
      Sentry.captureMessage('Customer setup save failed', {
        level: 'error',
        extra: {
          userId: user?.id ?? null,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
      })
      const message = customerSetupSaveMessage(error)
      setSaveError(message)
      Alert.alert('Could not save your profile', message)
      return
    }

    capture('customer_profile_completed', {
      via: 'sso_gate',
      garment_context: garmentContext,
      unit,
    })
    if (user?.id) {
      await AsyncStorage.removeItem(customerSetupDraftKey(user.id)).catch((draftError) => {
        Sentry.captureException(draftError, {
          extra: { context: 'customer_setup_draft_clear', userId: user.id },
        })
      })
    }
    resetTo(router, { pathname: '/(auth)/onboarding', params: { role: 'CUSTOMER', userId: user?.id ?? '' } })
  }

  const editingLayoutActive = keyboard.visible || focusedTextField !== null
  const customerSetupBlockingNote = validateDisplayName(displayName)
    ? 'Add a valid display name to continue.'
    : phoneValidationMessage(phone)
      ? 'Add a valid international phone number to continue.'
      : !garmentContext
        ? 'Choose what you typically order to continue.'
        : ''
  const customerSetupBlocked = customerSetupBlockingNote.length > 0
  const scrollBottomPadding =
    DRAPE_FLOATING_ACTION_DOCK_CLEARANCE + (editingLayoutActive ? Spacing.lg : Spacing.xxxl)

  const animateEditingLayout = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
  }

  const focusTextField = (field: string) => {
    animateEditingLayout()
    setFocusedTextField(field)
  }

  const blurTextField = (field: string) => {
    animateEditingLayout()
    setFocusedTextField((current) => (current === field ? null : current))
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <AuthBackButton onPress={leaveSetup} />
          <Text style={styles.headerLabel}>Customer setup</Text>
          <View style={styles.headerSpacer} />
        </View>
        <KeyboardAwareScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPadding }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={actionDockScroll.onScroll}
          scrollEventThrottle={actionDockScroll.scrollEventThrottle}
        >
          <View style={styles.content}>
            {!editingLayoutActive ? (
              <AuthEntryHeader
                eyebrow="Finish customer setup"
                title="Set up your side of Drapeon."
                body="These basics shape your fit profile, order updates, account currency, and first booking."
                showWordmark={false}
              />
            ) : null}

            <View style={styles.formCard}>
              {!editingLayoutActive ? (
                <View style={styles.photoCard}>
                  <TouchableOpacity
                    style={styles.avatarTap}
                    onPress={handleAvatarPress}
                    disabled={uploadingAvatar}
                    accessibilityRole="button"
                    accessibilityLabel="Add profile photo"
                  >
                    <AvatarImage
                      uri={avatarUrl}
                      initials={displayName || user?.email}
                      size={76}
                      shadow
                    />
                    {uploadingAvatar ? (
                      <View style={styles.avatarUploading}>
                        <ActivityIndicator color={Colors.textInverse} size="small" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                  <View style={styles.photoCopy}>
                    <Text style={styles.photoTitle}>Add a profile photo</Text>
                    <Text style={styles.photoText}>
                      Optional, but it helps tailors recognise you in orders and messages.
                    </Text>
                    <TouchableOpacity
                      onPress={handleAvatarPress}
                      disabled={uploadingAvatar}
                      accessibilityRole="button"
                      accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
                    >
                      <Text style={styles.photoAction}>
                        {avatarUrl ? 'Change photo' : 'Take or choose photo'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <View onLayout={rememberFieldY('displayName')}>
                <Input
                  label="Your name"
                  placeholder="e.g. John Doe"
                  value={displayName}
                  onChangeText={(v) => {
                    setDisplayName(v)
                    setValidationNotice('')
                    if (nameError) validateName(v)
                  }}
                  onFocus={() => focusTextField('displayName')}
                  onBlur={() => {
                    blurTextField('displayName')
                    validateName(displayName)
                  }}
                  error={nameError}
                  required
                  autoCapitalize="words"
                  textContentType="name"
                  autoComplete="name"
                  hint="This is shown to tailors on your orders."
                />
              </View>

              <View onLayout={rememberFieldY('phone')}>
                <PhoneNumberInput
                  label="Phone number"
                  placeholder="For order updates and account recovery"
                  value={phone}
                  onChangeText={(v) => {
                    setPhone(v)
                    setValidationNotice('')
                    if (phoneValidationMessage(v)) setPhoneAvailabilityChecking(false)
                    if (phoneError) validatePhone(v)
                  }}
                  onFocus={() => focusTextField('phone')}
                  onBlur={() => {
                    blurTextField('phone')
                    void validatePhoneAvailability(phone)
                  }}
                  error={phoneError}
                  required
                  hint={phoneAvailabilityChecking ? 'Checking phone number…' : PHONE_STORAGE_HINT}
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>
                  Account currency <Text style={styles.required}>*</Text>
                </Text>
                <Text style={styles.fieldHint}>
                  This becomes the currency you see everywhere and the currency you pay in for new
                  orders.
                </Text>
                {currencySource === 'UNSUPPORTED_FALLBACK' ? (
                  <View style={styles.currencyNotice}>
                    <Text style={styles.currencyNoticeTitle}>USD fallback</Text>
                    <Text style={styles.currencyNoticeCopy}>
                      Your local currency is not supported yet. Prices are shown in USD until you
                      choose another supported currency.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.currencyNotice}>
                    <Text style={styles.currencyNoticeTitle}>Detected from your region</Text>
                    <Text style={styles.currencyNoticeCopy}>
                      We pre-selected {defaultCurrency} from your device region. Change it now if
                      you want your account to use a different supported currency.
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.sheetSelectRow}
                  onPress={() => setCurrencySheetOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Choose account currency"
                >
                  <View style={styles.currencySymbolBadge}>
                    <Text style={styles.currencySymbolText}>
                      {SUPPORTED_CURRENCIES.find((option) => option.code === defaultCurrency)?.symbol ?? '$'}
                    </Text>
                  </View>
                  <View style={styles.currencyOptionCopy}>
                    <Text style={styles.currencyOptionTitle}>{defaultCurrency}</Text>
                    <Text style={styles.currencyOptionHint}>
                      {SUPPORTED_CURRENCIES.find((option) => option.code === defaultCurrency)?.name ?? 'Account currency'}
                    </Text>
                  </View>
                  <Feather name="chevron-down" size={18} color={Colors.midGrey} />
                </TouchableOpacity>
              </View>

              <View>
                <Text style={styles.fieldLabel}>
                  Measurement units <Text style={styles.required}>*</Text>
                </Text>
                <View style={styles.unitRow}>
                  {(['in', 'cm'] as Unit[]).map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                      onPress={() => setUnit(u)}
                    >
                      <Text style={[styles.unitLabel, unit === u && styles.unitLabelActive]}>
                        {u === 'in' ? 'Inches (in)' : 'Centimetres (cm)'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.formCard} onLayout={rememberFieldY('garmentContext')}>
              <Text style={styles.fieldLabel}>
                What do you typically order? <Text style={styles.required}>*</Text>
              </Text>
              <Text style={styles.fieldHint}>Helps tailors understand your fitting needs.</Text>
              <TouchableOpacity
                style={styles.sheetSelectRow}
                onPress={() => setGarmentSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Choose garment context"
              >
                <View style={[styles.radio, garmentContext && styles.radioActive]}>
                  {garmentContext ? <Feather name="check" size={13} color={Colors.textInverse} /> : null}
                </View>
                <View style={styles.optionTextWrap}>
                  <Text style={[styles.optionLabel, garmentContext && styles.optionLabelActive]}>
                    {GARMENT_OPTIONS.find((option) => option.value === garmentContext)?.label ?? 'Choose what you order'}
                  </Text>
                  <Text style={styles.optionHint}>
                    {GARMENT_OPTIONS.find((option) => option.value === garmentContext)?.hint ?? 'Menswear, womenswear, both, or skip.'}
                  </Text>
                </View>
                <Feather name="chevron-down" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            </View>

            {saveError && !editingLayoutActive ? (
              <Text style={styles.saveError} accessibilityRole="alert">{saveError}</Text>
            ) : null}
            {validationNotice ? (
              <Text style={styles.validationNotice} accessibilityLiveRegion="polite">{validationNotice}</Text>
            ) : null}
            {customerSetupBlockingNote ? (
              <Text style={styles.actionBlockingNote} accessibilityLiveRegion="polite">
                {customerSetupBlockingNote}
              </Text>
            ) : null}

            {!editingLayoutActive ? (
              <View style={styles.setupExitLinks}>
                <TouchableOpacity
                  onPress={() => { void handleUseTailorInstead() }}
                  disabled={saving || leavingSetup}
                  accessibilityRole="button"
                >
                  <Text style={styles.modeSwitchText}>Use Drapeon as a tailor instead</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { void handleSignOut() }}
                  disabled={saving || leavingSetup}
                  accessibilityRole="button"
                >
                  <Text style={styles.signOutText}>Sign out or switch account</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/(customer)/profile/delete-account')}
                  disabled={saving || leavingSetup}
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteAccountText}>Delete this account</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </KeyboardAwareScrollView>

        <DrapeFloatingActionDock
          compactWidth={76}
          forceCompact={editingLayoutActive}
          style={styles.actionDock}
          testID="customer-setup-action-dock"
        >
          {actionDockCompact || editingLayoutActive ? (
            <DrapeIconButton
              icon="arrow-right"
              accessibilityLabel="Save customer setup and continue"
              tone="primary"
              style={styles.actionDockIcon}
              onPress={() => { void save() }}
              disabled={
                saving ||
                uploadingAvatar ||
                phoneAvailabilityChecking ||
                phoneOtpSending ||
                phoneOtpVerifying ||
                customerSetupBlocked
              }
            />
          ) : (
            <DrapeCapsuleButton
              label="Save and continue"
              accessibilityLabel="Save customer setup and continue"
              icon="arrow-right"
              style={styles.actionDockButton}
              onPress={() => { void save() }}
              loading={saving || phoneOtpSending || phoneOtpVerifying}
              disabled={
                saving ||
                uploadingAvatar ||
                phoneAvailabilityChecking ||
                phoneOtpSending ||
                phoneOtpVerifying ||
                customerSetupBlocked
              }
            />
          )}
        </DrapeFloatingActionDock>
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
        <ChoiceSheet
          visible={currencySheetOpen}
          title="Choose currency"
          subtitle="This is the currency you see and pay in for new orders."
          options={SUPPORTED_CURRENCIES.map((option) => ({
            value: option.code,
            title: option.code,
            body: option.name,
            meta: option.symbol,
          }))}
          selectedValue={defaultCurrency}
          onClose={() => setCurrencySheetOpen(false)}
          onSelect={(value) => {
            setDefaultCurrency(value as CurrencyCode)
            setCurrencySource('USER_SELECTED')
            setRegionCode(regionCode || detectedCurrency.regionCode)
            setCurrencySheetOpen(false)
          }}
        />
        <ChoiceSheet
          visible={garmentSheetOpen}
          title="What do you usually order?"
          subtitle="This helps tailors understand the fit context you are likely to need."
          options={GARMENT_OPTIONS.map((option) => ({
            value: option.value,
            title: option.label,
            body: option.hint,
            icon: option.value === 'BOTH' ? 'layers' : 'scissors',
          }))}
          selectedValue={garmentContext}
          onClose={() => setGarmentSheetOpen(false)}
          onSelect={(value) => {
            setGarmentContext(value as GarmentContext)
            setValidationNotice('')
            setGarmentSheetOpen(false)
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
            <TouchableOpacity style={styles.otpClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close phone verification">
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
            accessibilityLabel="Phone verification code"
            editable={!verifying}
            autoFocus
          />
          {!!error && <Text style={styles.otpError} accessibilityRole="alert">{error}</Text>}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  keyboardAvoider: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
  },
  headerLabel: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    fontWeight: FontWeight.semibold,
  },
  headerSpacer: { width: 40 },
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
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  otpClose: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  otpTitle: {
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
  scrollContent: { paddingBottom: 120 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  heroPoints: { gap: Spacing.md },
  heroPoint: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  heroPointTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  heroPointCopy: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  formCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  sectionIntro: { gap: 4 },
  sectionEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 24,
  },
  guideCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
  },
  guideTitle: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  guideText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  photoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  avatarTap: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
  },
  avatarUploading: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(26,26,24,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCopy: { flex: 1, gap: 4 },
  photoTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  photoText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  photoAction: {
    marginTop: 2,
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
  required: { color: Colors.error },
  fieldHint: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  currencyNotice: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
    marginBottom: Spacing.md,
  },
  currencyNoticeTitle: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  currencyNoticeCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  currencyList: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  currencyOptionRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  sheetSelectRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Shadow.sm,
  },
  currencySymbolBadge: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencySymbolText: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  currencyOptionCopy: { flex: 1 },
  currencyOptionTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  currencyOptionHint: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontWeight: FontWeight.medium,
    marginTop: 2,
  },
  currencyRadio: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyRadioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },

  unitRow: { gap: Spacing.sm },
  unitBtn: {
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  unitBtnActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  unitLabel: { fontSize: FontSize.md, color: Colors.inkLight, fontWeight: FontWeight.medium },
  unitLabelActive: { color: Colors.needleGreen },

  optionList: { gap: Spacing.sm },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  optionCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 2,
    borderWidth: 2,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  radioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  optionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  optionLabelActive: { color: Colors.needleGreen },
  optionTextWrap: { flex: 1 },
  optionHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2, lineHeight: 18 },
  actionDock: { justifyContent: 'center' },
  actionDockButton: { flex: 1 },
  actionDockIcon: { alignSelf: 'center' },

  nextCard: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: 4,
    marginBottom: Spacing.md,
  },
  nextEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  nextTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    lineHeight: 21,
  },
  nextCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },
  saveError: {
    fontSize: FontSize.sm,
    color: Colors.error,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  validationNotice: {
    color: Colors.needleGreenDark,
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  actionBlockingNote: {
    color: Colors.inkLight,
    fontSize: FontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  setupExitLinks: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  modeSwitchText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  signOutText: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    fontWeight: FontWeight.medium,
  },
  deleteAccountText: {
    fontSize: FontSize.sm,
    color: Colors.error,
    fontWeight: FontWeight.medium,
  },
})
