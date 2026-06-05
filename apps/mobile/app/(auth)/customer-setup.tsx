import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImageManipulator from 'expo-image-manipulator'
import { Feather } from '@expo/vector-icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { syncUserRow } from '@/lib/syncUserRow'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { Sentry } from '@/lib/sentry'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import {
  SUPPORTED_CURRENCIES,
  detectDeviceCurrencyPreference,
  fetchCurrencyPreferenceContext,
  type CurrencyCode,
} from '@/lib/currency'
import { Button, Input } from '@/components/ui'
import { AvatarImage } from '@/components/ui/AvatarImage'
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
  return isLikelyConnectivityIssue(error)
    ? 'Connection looks weak. We could not save your setup yet. Retry when the signal improves.'
    : 'We could not save your setup right now. Please try again in a moment.'
}

export default function CustomerSetupScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const detectedCurrency = useMemo(() => detectDeviceCurrencyPreference(), [])

  // Pre-fill display name from OAuth metadata if available
  const oauthName = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? ''
  const oauthPhone = typeof user?.user_metadata?.phone === 'string' ? user.user_metadata.phone : ''

  const [displayName, setDisplayName] = useState(oauthName)
  const [nameError, setNameError] = useState('')
  const [phone, setPhone] = useState(oauthPhone)
  const [phoneError, setPhoneError] = useState('')
  const [unit, setUnit] = useState<Unit>('in')
  const [garmentContext, setGarmentContext] = useState<GarmentContext | null>(null)
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>(detectedCurrency.currency)
  const [currencySource, setCurrencySource] = useState(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    void fetchCurrencyPreferenceContext().then((resolved) => {
      if (cancelled) return
      setDefaultCurrency(resolved.currency)
      setCurrencySource(resolved.source)
      setRegionCode(resolved.regionCode)
    })

    supabase
      .from('customer_profiles')
      .select('display_name, phone, unit_preference, garment_context, measurements, avatar_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return

        const row = data as CustomerSetupProfileRow
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
      })

    supabase
      .from('users')
      .select('default_currency, currency_source, region_code')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return

        const row = data as UserCurrencyRow
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
      })

    return () => {
      cancelled = true
    }
  }, [user?.id, oauthName, oauthPhone])

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

  function validatePhone(value: string) {
    if (!value.trim()) {
      setPhoneError('Enter a valid phone number for order updates and account recovery.')
      return false
    }

    const error = validatePhoneForProfile(value)
    if (error) {
      setPhoneError('Enter a valid phone number for order updates and account recovery.')
      return false
    }
    setPhoneError('')
    return true
  }

  async function save() {
    if (saving) return
    if (!validateName(displayName)) return
    if (!validatePhone(phone)) return
    if (!garmentContext) {
      Alert.alert('Almost there', 'Please select what you typically order.')
      return
    }

    setSaveError('')
    setSaving(true)
    const now = new Date().toISOString()

    const normalizedPhone = normalizePhoneForStorage(phone)

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
        const message = isLikelyConnectivityIssue(syncError)
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
    // RouteGuard will now detect the profile is complete and navigate to (customer)
    router.replace('/(customer)')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <AuthEntryHeader
              eyebrow="Finish customer setup"
              title="Set up your side of Drapeon."
              body="These basics shape your fit profile, order updates, account currency, and first booking."
              showWordmark={false}
            />

            <View style={styles.formCard}>
              <View style={styles.sectionIntro}>
                <Text style={styles.sectionEyebrow}>Your profile</Text>
                <Text style={styles.sectionTitle}>Basics that shape every order.</Text>
              </View>

              <View style={styles.guideCard}>
                <Text style={styles.guideTitle}>Best use</Text>
                <Text style={styles.guideText}>
                  Keep this simple and accurate. You can refine the rest later.
                </Text>
              </View>

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

              <Input
                label="Your name"
                placeholder="John Doe"
                value={displayName}
                onChangeText={(v) => {
                  setDisplayName(v)
                  if (nameError) validateName(v)
                }}
                onBlur={() => validateName(displayName)}
                error={nameError}
                required
                autoCapitalize="words"
                hint="This is shown to tailors on your orders."
              />

              <Input
                label="Phone number"
                placeholder="For order updates and account recovery"
                value={phone}
                onChangeText={(v) => {
                  setPhone(v)
                  if (phoneError) validatePhone(v)
                }}
                onBlur={() => validatePhone(phone)}
                error={phoneError}
                required
                keyboardType="phone-pad"
                autoCapitalize="none"
                hint={PHONE_STORAGE_HINT}
              />

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
                <View style={styles.currencyList}>
                  {SUPPORTED_CURRENCIES.map((option) => (
                    <TouchableOpacity
                      key={option.code}
                      style={styles.currencyOptionRow}
                      onPress={() => {
                        setDefaultCurrency(option.code)
                        setCurrencySource('USER_SELECTED')
                        setRegionCode(regionCode || detectedCurrency.regionCode)
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: defaultCurrency === option.code }}
                    >
                      <View style={styles.currencySymbolBadge}>
                        <Text style={styles.currencySymbolText}>{option.symbol}</Text>
                      </View>
                      <View style={styles.currencyOptionCopy}>
                        <Text style={styles.currencyOptionTitle}>{option.code}</Text>
                        <Text style={styles.currencyOptionHint}>{option.name}</Text>
                      </View>
                      <View style={[styles.currencyRadio, defaultCurrency === option.code && styles.currencyRadioActive]}>
                        {defaultCurrency === option.code ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
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

            <View style={styles.formCard}>
              <View style={styles.sectionIntro}>
                <Text style={styles.sectionEyebrow}>Fit context</Text>
                <Text style={styles.sectionTitle}>
                  Help tailors understand what you usually order.
                </Text>
              </View>

              <Text style={styles.fieldLabel}>
                What do you typically order? <Text style={styles.required}>*</Text>
              </Text>
              <Text style={styles.fieldHint}>Helps tailors understand your fitting needs.</Text>
              <View style={styles.optionList}>
                {GARMENT_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optionCard,
                      garmentContext === opt.value && styles.optionCardActive,
                    ]}
                    onPress={() => setGarmentContext(opt.value)}
                  >
                    <View
                      style={[styles.radio, garmentContext === opt.value && styles.radioActive]}
                    />
                    <View style={styles.optionTextWrap}>
                      <Text
                        style={[
                          styles.optionLabel,
                          garmentContext === opt.value && styles.optionLabelActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text style={styles.optionHint}>{opt.hint}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom + Spacing.sm, Spacing.xl) }]}>
          <View style={styles.nextCard}>
            <Text style={styles.nextEyebrow}>What happens next</Text>
            <Text style={styles.nextTitle}>You’ll land in customer home ready to start.</Text>
          </View>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <Button
            label="Continue to Drapeon"
            onPress={save}
            loading={saving}
            disabled={
              saving ||
              uploadingAvatar ||
              !displayName.trim() ||
              !phone.trim() ||
              !!nameError ||
              !!phoneError ||
              !garmentContext
            }
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  keyboardAvoider: { flex: 1 },
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

  cta: {
    padding: Spacing.xl,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
  },
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
})
