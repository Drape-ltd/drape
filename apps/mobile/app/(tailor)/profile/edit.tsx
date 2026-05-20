/**
 * Edit Profile — single source of truth for all tailor profile data.
 * Onboarding writes here; this screen reads and updates the same row.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Modal, Platform,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { useTailorProfile } from '@/lib/tailorProfile'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { goBackOrFallback } from '@/lib/navigation'
import { AddressAutocompleteInput, TagSelector } from '@/components/ui'
import type { TagGroup } from '@/components/ui'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
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

type TailorEditProfileRow = {
  id: string
  display_name: string | null
  location: string | null
  bio: string | null
  specialty_tags: unknown
  availability: Availability | null
  currency: Currency | null
  id_verification_status: VerificationStatus | 'APPROVED' | null
  seller_type: SellerType | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
}

type PickupDetailsRow = {
  pickup_address: string | null
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
  { value: 'OPEN',         label: 'Open',         hint: 'Accepting new order requests' },
  { value: 'LIMITED',      label: 'Limited',       hint: 'Accepting orders; response time may be longer' },
  { value: 'FULLY_BOOKED', label: 'Fully booked',  hint: '"Notify me" shown instead of booking button' },
]

const VERIFY_LABEL: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: 'Setup still needed',
  PENDING:       'Review in progress',
  VERIFIED:      'Identity confirmed',
  REJECTED:      'Needs attention',
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
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { avatarUrl, setAvatarUrl } = useTailorProfile()

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)/profile')
  }

  // ── Form state ──────────────────────────────────────────────────────────────
  const [displayName, setDisplayName]     = useState('')
  const [location, setLocation]           = useState('')
  const [bio, setBio]                     = useState('')
  const [specialties, setSpecialties]     = useState<string[]>([])
  const [availability, setAvailability]   = useState<Availability>('OPEN')
  const [sellerType, setSellerType]       = useState<SellerType>('TAILOR')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupInstructions, setPickupInstructions] = useState('')
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [verifyStatus, setVerifyStatus]   = useState<VerificationStatus>('NOT_SUBMITTED')
  const [portfolioCount, setPortfolioCount] = useState(0)

  // Baseline snapshot to compute dirty state
  const [base, setBase] = useState<{
    displayName: string; location: string; bio: string
    specialties: string[]; availability: Availability; currency: Currency
    sellerType: SellerType
    supportsCustomOrders: boolean
    supportsReadyMade: boolean
    pickupAvailable: boolean
    pickupAddress: string
    pickupInstructions: string
    deliveryAvailable: boolean
    shippingAvailable: boolean
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
    pickupAvailable !== base.pickupAvailable ||
    pickupAddress !== base.pickupAddress ||
    pickupInstructions !== base.pickupInstructions ||
    deliveryAvailable !== base.deliveryAvailable ||
    shippingAvailable !== base.shippingAvailable ||
    JSON.stringify(specialties) !== JSON.stringify(base.specialties)
  )
  const specialtySummary =
    specialties.length > 0
      ? specialties.slice(0, 4).join(' · ') + (specialties.length > 4 ? ` +${specialties.length - 4} more` : '')
      : 'Choose the styles customers can book you for.'
  const currencyLabel = CURRENCY_OPTIONS.find((option) => option.value === currency)?.label ?? currency

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      setFetchError(false)
      return
    }
    setFetchError(false)
    try {
      const [{ data, error }, { data: pickupData }] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('id, display_name, location, bio, specialty_tags, availability, currency, id_verification_status, seller_type, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, delivery_fee, shipping_fee')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('tailor_pickup_details')
          .select('pickup_address, pickup_instructions')
          .eq('user_id', userId)
          .maybeSingle(),
      ])

      if (error) throw error

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
          pickupAvailable: d.pickup_available ?? true,
          pickupAddress: pickup?.pickup_address ?? '',
          pickupInstructions: pickup?.pickup_instructions ?? '',
          deliveryAvailable: d.delivery_available ?? false,
          shippingAvailable: d.shipping_available ?? false,
        }
        setBase(snap)
        setDisplayName(snap.displayName)
        setLocation(snap.location)
        setBio(snap.bio)
        setSpecialties(snap.specialties)
        setAvailability(snap.availability)
        setCurrency(snap.currency)
        setSellerType(snap.sellerType)
        setSupportsCustomOrders(snap.supportsCustomOrders)
        setSupportsReadyMade(snap.supportsReadyMade)
        setPickupAvailable(snap.pickupAvailable)
        setPickupAddress(snap.pickupAddress)
        setPickupInstructions(snap.pickupInstructions)
        setDeliveryAvailable(snap.deliveryAvailable)
        setShippingAvailable(snap.shippingAvailable)
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
          pickupAvailable: true,
          pickupAddress: '',
          pickupInstructions: '',
          deliveryAvailable: false,
          shippingAvailable: false,
        }
        setBase(snap)
        setDisplayName(snap.displayName)
        setLocation(snap.location)
        setBio(snap.bio)
        setSpecialties(snap.specialties)
        setAvailability(snap.availability)
        setCurrency(snap.currency)
        setSellerType(snap.sellerType)
        setSupportsCustomOrders(snap.supportsCustomOrders)
        setSupportsReadyMade(snap.supportsReadyMade)
        setPickupAvailable(snap.pickupAvailable)
        setPickupAddress(snap.pickupAddress)
        setPickupInstructions(snap.pickupInstructions)
        setDeliveryAvailable(snap.deliveryAvailable)
        setShippingAvailable(snap.shippingAvailable)
        setVerifyStatus('NOT_SUBMITTED')
        setPortfolioCount(0)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [userId])

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
      const { error: profileError } = await invokeFunction('tailor-profile-action', {
        body: { action: 'update-avatar', avatarUrl: bustUrl },
      })
      if (profileError) throw profileError
      setAvatarUrl(bustUrl)
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
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drape/1.0' } }
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

    setSaving(true)
    const { error } = await invokeFunction('tailor-profile-action', {
      body: {
        action: 'update-profile',
        profile: {
          displayName: displayName.trim(),
          location: location.trim(),
          bio: bio.trim() || null,
          specialties,
          languages: [],
          availability,
          currency,
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
          priceRangeMin: null,
          priceRangeMax: null,
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
      pickupAvailable,
      pickupAddress: pickupAddress.trim(),
      pickupInstructions: pickupInstructions.trim(),
      deliveryAvailable,
      shippingAvailable,
    })
    goBack()
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Storefront</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your storefront…</Text>
            <Text style={styles.stateHint}>
              We’re pulling in your public profile details so you can update how customers discover and trust your work.
            </Text>
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
            <Text style={styles.stateEyebrow}>Storefront</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile.</Text>
            <Text style={styles.stateHint}>
              This screen should help you refine the storefront customers see before they decide to trust you with an order.
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
              onPress={() => router.replace('/(tailor)/profile')}
            >
              <Text style={styles.errorSecondaryText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
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

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Feather name="edit-3" size={17} color={Colors.needleGreen} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Storefront details</Text>
            <Text style={styles.heroSub}>Keep your profile clear, current, and easy to book.</Text>
          </View>
        </View>

        {/* ── Avatar ───────────────────────────────────────────────────── */}
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

        {/* ── Identity ─────────────────────────────────────────────────── */}
        <Section title="Identity">
          <Field label="Display name" required error={errors.name}>
            <TextInput
              style={[styles.input, errors.name && styles.inputError]}
              value={displayName}
              onChangeText={(v) => { setDisplayName(v); setErrors((e) => ({ ...e, name: undefined })) }}
              placeholder="e.g. John Doe"
              placeholderTextColor={Colors.midGrey}
              autoCapitalize="words"
            />
          </Field>

          <Field label="Location" required error={errors.location}>
            <View>
              <TextInput
                style={[styles.input, errors.location && styles.inputError]}
                value={location}
                onChangeText={onLocationChange}
                onBlur={() => setShowSuggestions(false)}
                placeholder="e.g. Lagos, Nigeria"
                placeholderTextColor={Colors.midGrey}
                autoCorrect={false}
                autoComplete="off"
              />
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
          </Field>
        </Section>

        {/* ── Professional details ──────────────────────────────────────── */}
        <Section title="Professional details">
          <Field label="About you" error={bioError}>
            <TextInput
              style={[styles.input, styles.multiline, bioError ? styles.inputError : undefined]}
              value={bio}
              onChangeText={(v) => { setBio(v); if (bioError) validateBio(v) }}
              onBlur={() => validateBio(bio)}
              placeholder="Tell customers who you are, what you specialise in, and your experience…"
              placeholderTextColor={Colors.midGrey}
              multiline
              numberOfLines={5}
              maxLength={500}
            />
            <Text style={styles.charCount}>{bio.trim().length}/500</Text>
            <Text style={styles.fieldHint}>Try covering:</Text>
            <View style={styles.helperRow}>
              {BIO_PROMPTS.map((prompt) => (
                <View key={prompt} style={styles.helperChip}>
                  <Text style={styles.helperChipText}>{prompt}</Text>
                </View>
              ))}
            </View>
          </Field>

          <Field label="Specialties" required error={errors.specialties}>
            <TouchableOpacity
              style={[styles.selectorSummary, errors.specialties && styles.selectorSummaryError]}
              activeOpacity={0.75}
              onPress={() => setShowSpecialtySheet(true)}
            >
              <View style={styles.selectorSummaryText}>
                <Text style={styles.selectorSummaryTitle}>
                  {specialties.length > 0 ? `${specialties.length} selected` : 'Choose specialties'}
                </Text>
                <Text style={styles.selectorSummaryBody}>{specialtySummary}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={Colors.midGrey} />
            </TouchableOpacity>
            {specialties.length > 0 ? (
              <View style={styles.selectedPreviewRow}>
                {specialties.slice(0, 5).map((specialty) => (
                  <View key={specialty} style={styles.selectedPreviewChip}>
                    <Text style={styles.selectedPreviewText}>{specialty}</Text>
                  </View>
                ))}
                {specialties.length > 5 ? (
                  <View style={styles.selectedPreviewChip}>
                    <Text style={styles.selectedPreviewText}>+{specialties.length - 5}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </Field>

          <Field label="Pricing currency">
            <TouchableOpacity
              style={styles.selectorSummary}
              activeOpacity={0.75}
              onPress={() => setShowCurrencySheet(true)}
            >
              <View style={styles.selectorSummaryText}>
                <Text style={styles.selectorSummaryTitle}>{currencyLabel}</Text>
                <Text style={styles.selectorSummaryBody}>
                  Used for your profile, quotes, and ready-made listings.
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={Colors.midGrey} />
            </TouchableOpacity>
          </Field>
        </Section>

        {/* ── Availability ──────────────────────────────────────────────── */}
        <Section title="Availability">
          {AVAIL_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.availCard, availability === opt.value && styles.availCardActive]}
              onPress={() => setAvailability(opt.value)}
              activeOpacity={0.75}
            >
              <View style={[styles.availRadio, availability === opt.value && styles.availRadioActive]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.availLabel, availability === opt.value && styles.availLabelActive]}>
                  {opt.label}
                </Text>
                <Text style={styles.availHint}>{opt.hint}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </Section>

        <Section title="Selling setup">
          <Field label="Seller type">
            <View style={styles.choiceGroup}>
              {([
                { value: 'TAILOR', label: 'Tailor', hint: 'Custom work first' },
                { value: 'BOUTIQUE', label: 'Boutique', hint: 'Shop with tailors behind it' },
                { value: 'TAILOR_SHOP', label: 'Tailor shop', hint: 'Custom and ready-made together' },
              ] as const).map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.choiceCard, sellerType === opt.value && styles.choiceCardActive]}
                  onPress={() => setSellerType(opt.value)}
                >
                  <Text style={[styles.choiceTitle, sellerType === opt.value && styles.choiceTitleActive]}>{opt.label}</Text>
                  <Text style={styles.choiceHint}>{opt.hint}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          <Field label="What customers can do">
            <View style={styles.choiceGroup}>
              <TouchableOpacity
                style={[styles.choiceCard, supportsCustomOrders && styles.choiceCardActive]}
                onPress={() => setSupportsCustomOrders((value) => !value)}
              >
                <Text style={[styles.choiceTitle, supportsCustomOrders && styles.choiceTitleActive]}>Custom order</Text>
                <Text style={styles.choiceHint}>Customers send details and you quote the work.</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.choiceCard, supportsReadyMade && styles.choiceCardActive]}
                onPress={() => setSupportsReadyMade((value) => !value)}
              >
                <Text style={[styles.choiceTitle, supportsReadyMade && styles.choiceTitleActive]}>Shop now</Text>
                <Text style={styles.choiceHint}>Customers buy ready-made pieces you already have.</Text>
              </TouchableOpacity>
            </View>
          </Field>

          <Field label="Fulfillment">
            <View style={styles.choiceGroup}>
              <TouchableOpacity
                style={[styles.choiceCard, pickupAvailable && styles.choiceCardActive]}
                onPress={() => setPickupAvailable((value) => !value)}
              >
                <Text style={[styles.choiceTitle, pickupAvailable && styles.choiceTitleActive]}>Pickup</Text>
                <Text style={styles.choiceHint}>Customer collects from you or your shop.</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.choiceCard, deliveryAvailable && styles.choiceCardActive]}
                onPress={() => setDeliveryAvailable((value) => !value)}
              >
                <Text style={[styles.choiceTitle, deliveryAvailable && styles.choiceTitleActive]}>Delivery</Text>
                <Text style={styles.choiceHint}>You or your team deliver nearby orders.</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.choiceCard, shippingAvailable && styles.choiceCardActive]}
                onPress={() => setShippingAvailable((value) => !value)}
              >
                <Text style={[styles.choiceTitle, shippingAvailable && styles.choiceTitleActive]}>Shipping</Text>
                <Text style={styles.choiceHint}>Courier or shipping partner handles it.</Text>
              </TouchableOpacity>
            </View>
            {pickupAvailable ? (
              <View style={styles.fulfillmentFeeBlock}>
                <Text style={styles.fieldHint}>
                  Double-check this exact address before you save. Customers only see it after an order is marked ready for collection.
                </Text>
                <AddressAutocompleteInput
                  label="Pickup address"
                  value={pickupAddress}
                  onChangeText={setPickupAddress}
                  placeholder="e.g. 12 Marina Road, Victoria Island"
                  hint="Search and tap a suggestion to autofill, or type the full address manually. Include street or building, district or city, state or region, postal code if used, and country."
                  multiline
                />
                <Field label="Pickup instructions (optional)">
                  <TextInput
                    style={styles.input}
                    value={pickupInstructions}
                    onChangeText={setPickupInstructions}
                    placeholder="e.g. Ask for the front desk and bring your collection code."
                    placeholderTextColor={Colors.midGrey}
                  />
                </Field>
                {pickupAddress.trim().length === 0 ? (
                  <Text style={styles.helperError}>Add your exact pickup address to keep pickup turned on.</Text>
                ) : pickupAddress.trim().length < 8 ? (
                  <Text style={styles.helperError}>Add a fuller pickup address before offering pickup.</Text>
                ) : null}
              </View>
            ) : null}
            {deliveryAvailable || shippingAvailable ? (
              <View style={styles.fulfillmentFeeBlock}>
                <Text style={styles.fieldLabel}>Standard Drape dispatch fees</Text>
                <Text style={styles.fieldHint}>
                  Drape now collects the standard delivery or shipping fee at checkout based on the buyer address and your location. You only need to keep your location and fulfillment options accurate here.
                </Text>
              </View>
            ) : null}
          </Field>
        </Section>

        {/* ── Portfolio ────────────────────────────────────────────────── */}
        <Section title="Portfolio">
          <TouchableOpacity
            style={styles.portfolioLink}
            onPress={() => router.push({
              pathname: '/(tailor)/profile/portfolio',
              params: { returnTo: '/(tailor)/profile/edit' },
            })}
            activeOpacity={0.75}
          >
            <View style={styles.portfolioLinkLeft}>
              <Feather name="image" size={18} color={Colors.needleGreen} />
              <View>
                <Text style={styles.portfolioLinkTitle}>Manage portfolio</Text>
                <Text style={styles.portfolioLinkSub}>
                  {portfolioCount > 0 ? `${portfolioCount} item${portfolioCount !== 1 ? 's' : ''}` : 'No items yet. Add your work'}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.midGrey} />
          </TouchableOpacity>
        </Section>

        {/* ── Trust status (read-only) ──────────────────────────────────── */}
        <Section title="Trust status">
          <TouchableOpacity
            style={styles.trustRow}
            onPress={() => router.push('/(tailor)/profile/trust-access' as never)}
            activeOpacity={0.75}
          >
            <View style={styles.trustIcon}>
              <View style={[styles.verifyDot, { backgroundColor: VERIFY_COLOR[verifyStatus] }]} />
            </View>
            <View style={styles.trustCopy}>
              <Text style={styles.trustTitle}>{VERIFY_LABEL[verifyStatus]}</Text>
              <Text style={styles.trustSub}>
                {verifyStatus === 'VERIFIED'
                  ? 'You can manage profile and payout access from one place.'
                  : verifyStatus === 'PENDING'
                    ? 'We will keep this page updated as review moves.'
                    : 'Open trust & access for the exact next step.'}
              </Text>
            </View>
            <Text style={styles.trustAction}>
              {verifyStatus === 'NOT_SUBMITTED' || verifyStatus === 'REJECTED' ? 'Fix' : 'View'}
            </Text>
            <Feather name="chevron-right" size={16} color={Colors.midGrey} />
          </TouchableOpacity>
        </Section>
      </ScrollView>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.title}>{title}</Text>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  )
}

function Field({
  label, required, error, children,
}: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>
        {label}{required && <Text style={fieldStyles.required}> *</Text>}
      </Text>
      {children}
      {error ? <Text style={fieldStyles.error}>{error}</Text> : null}
    </View>
  )
}

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
    borderBottomWidth: 1, borderBottomColor: Colors.boneDeep,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: { flex: 1, gap: 2 },
  heroTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  heroSub: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    minWidth: 60, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    letterSpacing: 0,
  },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center', fontFamily: Fonts.display },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },

  scroll: { padding: Spacing.xl, gap: Spacing.md, paddingBottom: 48 },

  // Avatar
  avatarSection: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.needleGreen + '40',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: Colors.needleGreen + '40' },
  avatarInitials: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.needleGreen },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.bone,
  },
  avatarHint: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Inputs
  input: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
    borderWidth: 1, borderColor: 'transparent',
  },
  inputError: { borderColor: Colors.error },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  charCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right', marginTop: 4 },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  fieldHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  helperError: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },
  helperRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  helperChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  helperChipText: { fontSize: FontSize.xs, color: Colors.ink, fontWeight: FontWeight.medium },

  selectorSummary: {
    minHeight: 68,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    ...Shadow.sm,
  },
  selectorSummaryError: {
    borderColor: Colors.error,
    backgroundColor: Colors.error + '08',
  },
  selectorSummaryText: { flex: 1, gap: 3 },
  selectorSummaryTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  selectorSummaryBody: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    lineHeight: 18,
  },
  selectedPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  selectedPreviewChip: {
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  selectedPreviewText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },

  // Location suggestions
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

  // Availability
  availCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.lightGrey,
  },
  availCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  availRadio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
  },
  availRadioActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreen },
  availLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  availLabelActive: { color: Colors.needleGreen },
  availHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 1, lineHeight: 18 },
  choiceGroup: { gap: Spacing.sm },
  choiceCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    gap: 2,
  },
  choiceCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  choiceTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  choiceTitleActive: { color: Colors.needleGreen },
  choiceHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  fulfillmentFeeBlock: { gap: Spacing.md, marginTop: Spacing.md },

  // Portfolio link
  portfolioLink: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.md, ...Shadow.sm,
  },
  portfolioLinkLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  portfolioLinkTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  portfolioLinkSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // Trust status
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  trustIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustCopy: { flex: 1, gap: 2 },
  trustTitle: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  trustSub: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  trustAction: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  verifyDot: { width: 8, height: 8, borderRadius: 4 },
  errorRetry: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  errorRetryText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorSecondary: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  errorSecondaryText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  specialtySheet: {
    maxHeight: '86%',
    backgroundColor: Colors.bone,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.lg,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
    alignSelf: 'center',
  },
  specialtySheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  specialtySheetTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  specialtySheetSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.midGrey,
    lineHeight: 20,
  },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specialtySheetScroll: {
    marginHorizontal: -Spacing.xs,
  },
  specialtySheetContent: {
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.md,
  },
  currencySheet: {
    backgroundColor: Colors.bone,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.lg,
  },
  currencyOptionList: {
    gap: Spacing.sm,
  },
  currencyOptionRow: {
    minHeight: 58,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currencyOptionRowActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  currencyOptionText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  currencyOptionTextActive: {
    color: Colors.needleGreen,
  },
})

const sectionStyles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  title: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold,
    color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  body: { gap: Spacing.md },
})

const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  required: { color: Colors.error },
  error: { fontSize: FontSize.xs, color: Colors.error, marginTop: 4 },
})
