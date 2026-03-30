/**
 * Edit Profile — single source of truth for all tailor profile data.
 * Onboarding writes here; this screen reads and updates the same row.
 */
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Image,
} from 'react-native'
import { useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useTailorProfile } from '@/lib/tailorProfile'
import { TagSelector } from '@/components/ui'
import type { TagGroup } from '@/components/ui'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
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
const BIO_TEMPLATES = [
  'I make custom native wear and occasion outfits with clean finishing and reliable delivery.',
  'I run a boutique and tailor studio, offering custom work and ready-made pieces.',
  'I focus on crochet and handmade pieces made to order with careful finishing and fit.',
] as const

type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
type Currency = 'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES'
type SellerType = 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: 'GBP', label: '£ GBP' },
  { value: 'USD', label: '$ USD' },
  { value: 'EUR', label: '€ EUR' },
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
  NOT_SUBMITTED: 'Verification not submitted',
  PENDING:       'ID under review — verified within 24 hours',
  VERIFIED:      'Identity verified',
  REJECTED:      'Verification failed — please re-submit',
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
  const { avatarUrl, setAvatarUrl } = useTailorProfile()

  function goBack() {
    router.replace('/(tailor)/profile')
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
    deliveryAvailable !== base.deliveryAvailable ||
    shippingAvailable !== base.shippingAvailable ||
    JSON.stringify(specialties) !== JSON.stringify(base.specialties)
  )

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => { load() }, [])

  async function load() {
    if (!user?.id) return
    setFetchError(false)
    try {
      const { data, error } = await supabase
        .from('tailor_profiles')
        .select('id, display_name, location, bio, specialty_tags, availability, currency, id_verification_status, seller_type, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) throw error

      if (data) {
        const d = data as any
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
        setDeliveryAvailable(snap.deliveryAvailable)
        setShippingAvailable(snap.shippingAvailable)
        setVerifyStatus((d.id_verification_status ?? 'NOT_SUBMITTED') as VerificationStatus)

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
  }

  // ── Avatar ───────────────────────────────────────────────────────────────────

  async function handleAvatarPress() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to update your profile picture.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.9,
    })
    if (result.canceled || !result.assets[0]) return

    setUploadingAvatar(true)
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )
      const fileName = `${user!.id}/avatar.jpg`
      const blob = await (await fetch(compressed.uri)).blob()
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName)
      const bustUrl = `${publicUrl}?t=${Date.now()}`
      const { error: profileError } = await invokeFunction('tailor-profile-action', {
        body: { action: 'update-avatar', avatarUrl: bustUrl },
      })
      if (profileError) throw profileError
      setAvatarUrl(bustUrl)
    } catch {
      Alert.alert('Upload failed', 'Could not update your photo. Please try again.')
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
        const data: any[] = await res.json()
        const labels = data.map((item) => {
          const a = item.address ?? {}
          const city = a.city ?? a.town ?? a.village ?? a.county ?? item.display_name.split(',')[0]
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
          deliveryAvailable,
          shippingAvailable,
          priceRangeMin: null,
          priceRangeMax: null,
        },
      },
    })
    setSaving(false)
    if (error) {
      Alert.alert('Save failed', error.message)
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
            <Text style={styles.stateEyebrow}>Profile edit</Text>
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
            <Text style={styles.stateEyebrow}>Profile edit</Text>
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
            ? <ActivityIndicator size="small" color={Colors.white} />
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
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Public tailor profile</Text>
          </View>
          <Text style={styles.heroTitle}>Shape the first impression customers book from.</Text>
          <Text style={styles.heroSub}>
            Your name, location, specialties, and availability all help customers decide whether
            they trust you with their next custom order.
          </Text>
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
                <ActivityIndicator color={Colors.white} />
              </View>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.cameraBadge}>
              <Feather name="camera" size={12} color={Colors.white} />
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
              placeholder="e.g. Emeka Obi"
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
            <View style={styles.helperRow}>
              {BIO_TEMPLATES.map((template) => (
                <TouchableOpacity
                  key={template}
                  style={styles.helperChip}
                  onPress={() => {
                    setBio(template)
                    validateBio(template)
                  }}
                >
                  <Text style={styles.helperChipText}>Use template</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          <Field label="Specialties" required error={errors.specialties}>
            <TagSelector
              label=""
              options={SPECIALTY_GROUPS}
              selected={specialties}
              onChange={(v) => { setSpecialties(v); setErrors((e) => ({ ...e, specialties: undefined })) }}
              searchable
            />
          </Field>

          <Field label="Pricing currency">
            <View style={styles.currencyRow}>
              {CURRENCY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.currencyChip, currency === opt.value && styles.currencyChipActive]}
                  onPress={() => setCurrency(opt.value)}
                >
                  <Text style={[styles.currencyChipText, currency === opt.value && styles.currencyChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
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
          </Field>
        </Section>

        {/* ── Portfolio ────────────────────────────────────────────────── */}
        <Section title="Portfolio">
          <TouchableOpacity
            style={styles.portfolioLink}
            onPress={() => router.push('/(tailor)/profile/portfolio')}
            activeOpacity={0.75}
          >
            <View style={styles.portfolioLinkLeft}>
              <Feather name="image" size={18} color={Colors.needleGreen} />
              <View>
                <Text style={styles.portfolioLinkTitle}>Manage portfolio</Text>
                <Text style={styles.portfolioLinkSub}>
                  {portfolioCount > 0 ? `${portfolioCount} item${portfolioCount !== 1 ? 's' : ''}` : 'No items yet — add your work'}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={Colors.midGrey} />
          </TouchableOpacity>
        </Section>

        {/* ── Verification (read-only) ──────────────────────────────────── */}
        <Section title="Verification">
          <View style={[styles.verifyCard, { borderLeftColor: VERIFY_COLOR[verifyStatus] }]}>
            <View style={[styles.verifyDot, { backgroundColor: VERIFY_COLOR[verifyStatus] }]} />
            <Text style={[styles.verifyText, { color: VERIFY_COLOR[verifyStatus] }]}>
              {VERIFY_LABEL[verifyStatus]}
            </Text>
          </View>
          {(verifyStatus === 'NOT_SUBMITTED' || verifyStatus === 'REJECTED') && (
            <TouchableOpacity
              style={styles.verifyLink}
              onPress={() => router.push('/(tailor)/profile/setup')}
              activeOpacity={0.75}
            >
              <Text style={styles.verifyLinkText}>
                {verifyStatus === 'REJECTED' ? 'Re-submit verification →' : 'Submit ID verification →'}
              </Text>
            </TouchableOpacity>
          )}
        </Section>
      </ScrollView>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.boneDeep,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 38,
  },
  heroSub: {
    fontSize: FontSize.md,
    color: Colors.inkLight,
    lineHeight: 24,
  },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    minWidth: 60, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },

  scroll: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: 60 },

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
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  inputError: { borderColor: Colors.error },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  charCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right', marginTop: 4 },
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

  // Currency
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  currencyChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  currencyChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  currencyChipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  currencyChipTextActive: { color: Colors.needleGreen },

  // Availability
  availCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1.5, borderColor: Colors.lightGrey,
  },
  availCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  availRadio: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    borderWidth: 2, borderColor: Colors.lightGrey, backgroundColor: Colors.white,
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
  choiceTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  choiceTitleActive: { color: Colors.needleGreen },
  choiceHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },

  // Portfolio link
  portfolioLink: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.sm,
  },
  portfolioLinkLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  portfolioLinkTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  portfolioLinkSub: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 2 },

  // Verification
  verifyCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderLeftWidth: 4, ...Shadow.sm,
  },
  verifyDot: { width: 8, height: 8, borderRadius: 4 },
  verifyText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  verifyLink: { alignSelf: 'flex-start', paddingTop: Spacing.sm },
  verifyLinkText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.medium },
  errorRetry: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  errorRetryText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorSecondary: {
    backgroundColor: Colors.white,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxxl,
  },
  errorSecondaryText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
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
