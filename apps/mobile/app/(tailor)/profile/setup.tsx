/**
 * Tailor profile setup wizard — 4 steps
 * Step 0: Identity (display name, location, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (min 4 photos)
 * Step 3: Availability + ID verification upload
 */
import { useState, useRef } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Alert, KeyboardAvoidingView, Platform, FlatList,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { stripExif } from '@/lib/stripExif'
import { Button, Input, TagSelector, ProgressStepper } from '@/components/ui'
import type { TagGroup } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const STEP_TITLES = ['Your identity', 'Specialties & pricing', 'Portfolio', 'Availability & verification']
const STEP_SUBS = [
  'This is your public profile. No contact details — customers find you through Drape.',
  'Tell customers what you make and what to expect on price.',
  'Upload at least 4 photos of your work. This is what customers see first.',
  'Set your availability and verify your identity to go live.',
]
const STEP_LABELS = ['Identity', 'Specialties', 'Portfolio', 'Availability']

// ─── Language options (grouped by region) ────────────────────────────────────

const LANGUAGE_GROUPS: TagGroup[] = [
  {
    label: 'West African',
    items: ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'Twi', 'Akan', 'Fante', 'Ga', 'Ewe', 'Wolof', 'Fulani', 'Dagbani'],
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
    items: ['Agbada', 'Iro & Buba', 'Ankara', 'Kaftans', 'Dashiki', 'Boubou', 'Native Wear', 'Asoebi', 'Kente'],
  },
  {
    label: 'Formal & Western',
    items: ['Suits', 'Wool Suits', 'Tuxedo', 'Shirts', 'Trousers', 'Blazers'],
  },
  {
    label: 'Womenswear',
    items: ['Bespoke Dress', 'Wedding Gown', 'Prom Dress', 'Bridal', 'Jumpsuit', 'Skirts', 'Blouses'],
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
    items: ['Embroidery', 'Adire', 'Batik'],
  },
]

type Availability = 'OPEN' | 'LIMITED' | 'FULLY_BOOKED'

export default function TailorSetupScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ])
  }

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 0
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name ?? '')
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
  const [currency, setCurrency] = useState<'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES'>('GBP')

  // Step 2
  const [portfolioItems, setPortfolioItems] = useState<Array<{ type: 'photo' | 'video'; url: string }>>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const pickedUris = useRef<Set<string>>(new Set())

  // Step 3
  const [availability, setAvailability] = useState<Availability>('OPEN')
  const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState(false)

  // ── Location autocomplete via Nominatim (OSM, no API key) ───────────────────

  function onLocationChange(text: string) {
    setLocation(text)
    setShowSuggestions(false)
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
      } catch {
        // Nominatim unavailable — just let the user type freely
      }
    }, 400)
  }

  function selectLocation(suggestion: string) {
    setLocation(suggestion)
    setLocationSuggestions([])
    setShowSuggestions(false)
  }

  // ── Bio gibberish detection ──────────────────────────────────────────────────

  function isBioGibberish(text: string): boolean {
    const t = text.trim()
    // Excessive repeated characters: "hhhhhh", "aaaaaaa"
    if (/(.)\1{4,}/i.test(t)) return true
    // Actual keyboard-smash sequences (chars that run in order along a row)
    if (/qwert|werty|ertyu|rtyui|tyuio|yuiop|asdfg|sdfgh|dfghj|fghjk|ghjkl|zxcvb|xcvbn|cvbnm/i.test(t)) return true
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

  function validateBio(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) { setBioError("Contact details aren't allowed in your bio."); return false }
    if (text.trim().length < 80) { setBioError(`About you needs at least 80 characters (${text.trim().length}/80).`); return false }
    if (isBioGibberish(text)) { setBioError('Please enter a meaningful description of your tailoring experience.'); return false }
    setBioError(''); return true
  }

  async function pickPortfolioMedia() {
    if (portfolioItems.length >= 12) { Alert.alert('Maximum reached', 'You can add up to 12 photos or videos.'); return }
    const videoCount = portfolioItems.filter((i) => i.type === 'video').length
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
      videoMaxDuration: 30,
    })
    if (res.canceled || !res.assets[0]) return

    const asset = res.assets[0]
    const isVideo = asset.type === 'video'

    if (isVideo && videoCount >= 2) {
      Alert.alert('Video limit', 'You can include up to 2 videos in your portfolio.')
      return
    }
    if (pickedUris.current.has(asset.uri)) {
      Alert.alert('Duplicate', 'That file is already in your portfolio.')
      return
    }

    setUploadingMedia(true)
    pickedUris.current.add(asset.uri)

    try {
      if (isVideo) {
        const filename = `portfolio/${user?.id}/${Date.now()}.mp4`
        const blob = await (await fetch(asset.uri)).blob()
        if (blob.size > 50 * 1024 * 1024) {
          pickedUris.current.delete(asset.uri)
          Alert.alert('File too large', 'Videos must be under 50 MB.')
          setUploadingMedia(false)
          return
        }
        const { error: videoError } = await supabase.storage.from('portfolio-photos').upload(filename, blob, { contentType: 'video/mp4' })
        if (videoError) throw videoError
        const { data } = supabase.storage.from('portfolio-photos').getPublicUrl(filename)
        setPortfolioItems((prev) => [...prev, { type: 'video', url: data.publicUrl }])
      } else {
        const uri = await stripExif(asset.uri)
        const filename = `portfolio/${user?.id}/${Date.now()}.jpg`
        const blob = await (await fetch(uri)).blob()
        if (blob.size > 10 * 1024 * 1024) {
          pickedUris.current.delete(asset.uri)
          Alert.alert('File too large', 'Photos must be under 10 MB.')
          setUploadingMedia(false)
          return
        }
        const { error: photoError } = await supabase.storage.from('portfolio-photos').upload(filename, blob, { contentType: 'image/jpeg' })
        if (photoError) throw photoError
        const { data } = supabase.storage.from('portfolio-photos').getPublicUrl(filename)
        setPortfolioItems((prev) => [...prev, { type: 'photo', url: data.publicUrl }])
      }
    } catch {
      pickedUris.current.delete(asset.uri)
      Alert.alert('Error', 'Could not upload media. Please try again.')
    }
    setUploadingMedia(false)
  }

  async function pickIdPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 })
    if (res.canceled || !res.assets[0]) return
    setIdPhotoUri(res.assets[0].uri)
  }

  async function uploadIdAndSave(): Promise<string | null> {
    if (!idPhotoUri) return null
    setUploadingId(true)
    const ext = idPhotoUri.split('.').pop() ?? 'jpg'
    const filename = `id-verification/${user?.id}/${Date.now()}.${ext}`
    try {
      const blob = await (await fetch(idPhotoUri)).blob()
      if (blob.size > 20 * 1024 * 1024) throw new Error('ID photo exceeds 20 MB limit.')
      await supabase.storage.from('id-documents').upload(filename, blob, { contentType: `image/${ext}` })
      const { data } = supabase.storage.from('id-documents').getPublicUrl(filename)
      setUploadingId(false)
      return data.publicUrl
    } catch {
      setUploadingId(false)
      return null
    }
  }

  async function finish() {
    setSaving(true)

    const idUrl = await uploadIdAndSave()

    const now = new Date().toISOString()
    const { error } = await supabase.from('tailor_profiles').upsert({
      user_id: user?.id,
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      location: location.trim(),
      languages,
      specialty_tags: specialties,
      price_range_min: priceMin ? Math.round(parseFloat(priceMin) * 100) : null,
      price_range_max: priceMax ? Math.round(parseFloat(priceMax) * 100) : null,
      currency,
      portfolio_photo_urls: portfolioItems.filter((i) => i.type === 'photo').map((i) => i.url),
      portfolio_video_urls: portfolioItems.filter((i) => i.type === 'video').map((i) => i.url),
      availability,
      id_document_url: idUrl,
      id_verification_status: idUrl ? 'PENDING' : 'NOT_SUBMITTED',
      updated_at: now,
    }, { onConflict: 'user_id' })

    setSaving(false)

    if (error) {
      Alert.alert('Error', 'Could not save your profile. Please try again.')
      return
    }

    if (idUrl) {
      supabase.functions.invoke('notify-ops-verification', {
        body: { tailorId: user?.id },
      }).catch(() => {})
    }

    Alert.alert(
      'Profile submitted',
      idUrl
        ? 'We\'ll review your ID within 24 hours. You\'ll be notified when your profile goes live.'
        : 'Your profile is saved. Submit a government ID to go live.',
      [{ text: 'OK', onPress: () => router.replace('/(tailor)/profile') }]
    )
  }

  function canProceed(): boolean {
    if (step === 0) return (
      !!displayName.trim() &&
      !!location.trim() &&
      bio.trim().length >= 80 &&
      !bioError &&
      !isBioGibberish(bio) &&
      languages.length >= 1
    )
    if (step === 1) {
      const min = parseFloat(priceMin)
      const max = parseFloat(priceMax)
      return (
        specialties.length >= 1 &&
        !!priceMin && !!priceMax &&
        !isNaN(min) && !isNaN(max) &&
        min > 0 && max >= min && max <= 100_000
      )
    }
    if (step === 2) return portfolioItems.length >= 4
    if (step === 3) return true
    return false
  }

  function next() {
    if (!canProceed()) return
    if (step < 3) setStep(step + 1)
    else finish()
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => step > 0 ? setStep(step - 1) : router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.stepCount}>{step + 1} / 4</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Progress stepper with step labels */}
        <ProgressStepper steps={STEP_LABELS} current={step} />

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.content}>
            <View>
              <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
              <Text style={styles.stepSub}>{STEP_SUBS[step]}</Text>
            </View>

            {/* ── Step 0: Identity ── */}
            {step === 0 && (
              <View style={styles.fields}>
                <Input
                  label="Display name"
                  placeholder="e.g. Emeka Obi"
                  value={displayName}
                  onChangeText={setDisplayName}
                  required
                  autoCapitalize="words"
                  hint="No @, URLs, or phone numbers. This is your public name."
                  testID="display-name-input"
                />
                <View>
                  <Input
                    label="Location"
                    placeholder="e.g. Lagos, Nigeria"
                    value={location}
                    onChangeText={onLocationChange}
                    onBlur={() => setShowSuggestions(false)}
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
                          style={[styles.suggestionRow, i === locationSuggestions.length - 1 && styles.suggestionRowLast]}
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
                  placeholder="Tell customers who you are, what you specialise in, and your experience. Min 80 characters."
                  value={bio}
                  onChangeText={(v) => { setBio(v); validateBio(v) }}
                  onBlur={() => validateBio(bio)}
                  error={bioError}
                  required
                  multiline
                  numberOfLines={5}
                  maxLength={500}
                  filterContact
                  hint={`Min 80 characters · ${bio.trim().length}/500. No social handles, phone numbers, or URLs.`}
                  testID="bio-input"
                />

                <TagSelector
                  label="Languages you speak"
                  options={LANGUAGE_GROUPS}
                  selected={languages}
                  onChange={setLanguages}
                  searchable
                />
              </View>
            )}

            {/* ── Step 1: Specialties + pricing ── */}
            {step === 1 && (
              <View style={styles.fields}>
                <TagSelector
                  label="What do you make?"
                  required
                  hint="Select all that apply — these appear as tags on your profile."
                  options={SPECIALTY_GROUPS}
                  selected={specialties}
                  onChange={setSpecialties}
                  searchable
                />

                <View>
                  <Text style={styles.fieldLabel}>Typical price range <Text style={styles.required}>*</Text></Text>
                  <Text style={styles.fieldHint}>This shows as an indicator on your profile — not a fixed price. Customers use it to gauge fit before reaching out.</Text>
                  <View style={styles.currencyRow}>
                    {(['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES'] as const).map((c) => (
                      <TouchableOpacity
                        key={c}
                        style={[styles.currencyChip, currency === c && styles.currencyChipActive]}
                        onPress={() => setCurrency(c)}
                      >
                        <Text style={[styles.currencyChipText, currency === c && styles.currencyChipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.priceRow}>
                    <Input
                      label="From"
                      placeholder="50"
                      value={priceMin}
                      onChangeText={setPriceMin}
                      keyboardType="decimal-pad"
                      required
                      containerStyle={styles.priceInput}
                    />
                    <Input
                      label="To"
                      placeholder="500"
                      value={priceMax}
                      onChangeText={setPriceMax}
                      keyboardType="decimal-pad"
                      required
                      containerStyle={styles.priceInput}
                    />
                  </View>
                  {!!priceMin && !!priceMax && parseFloat(priceMax) < parseFloat(priceMin) && (
                    <Text style={styles.priceError}>"To" must be greater than "From"</Text>
                  )}
                </View>
              </View>
            )}

            {/* ── Step 2: Portfolio ── */}
            {step === 2 && (
              <View style={styles.fields}>
                <View style={styles.portfolioStatus}>
                  <View style={styles.portfolioBar}>
                    <View style={[styles.portfolioBarFill, { width: `${Math.min(100, (portfolioItems.length / 4) * 100)}%` }]} />
                  </View>
                  <Text style={styles.portfolioCount}>
                    {portfolioItems.length}/4 minimum {portfolioItems.length >= 4 ? '✓' : ''} · {portfolioItems.filter((i) => i.type === 'video').length}/2 videos
                  </Text>
                </View>

                <View style={styles.portfolioGrid}>
                  {portfolioItems.map((item, i) => (
                    <View key={i} style={styles.portfolioThumb}>
                      {item.type === 'photo' ? (
                        <Image source={{ uri: item.url }} style={styles.portfolioImg} resizeMode="cover" />
                      ) : (
                        <View style={[styles.portfolioImg, styles.videoThumb]}>
                          <Text style={styles.videoIcon}>▶</Text>
                          <Text style={styles.videoLabel}>Video</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.portfolioRemove}
                        onPress={() => setPortfolioItems((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Text style={styles.portfolioRemoveText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {portfolioItems.length < 12 && (
                    <TouchableOpacity style={styles.portfolioAdd} onPress={pickPortfolioMedia} disabled={uploadingMedia}>
                      <Text style={styles.portfolioAddIcon}>{uploadingMedia ? '…' : '+'}</Text>
                      <Text style={styles.portfolioAddLabel}>Photo or video</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    Photos and videos (max 30s, up to 2) are scanned before going live. EXIF location data is stripped automatically.
                  </Text>
                </View>
              </View>
            )}

            {/* ── Step 3: Availability + ID verification ── */}
            {step === 3 && (
              <View style={styles.fields}>
                <View>
                  <Text style={styles.fieldLabel}>Availability</Text>
                  {([
                    { value: 'OPEN', label: 'Open', hint: 'Accepting new order requests' },
                    { value: 'LIMITED', label: 'Limited', hint: 'Accepting orders; response time may be longer' },
                    { value: 'FULLY_BOOKED', label: 'Fully booked', hint: '"Notify me" shown instead of booking button' },
                  ] as const).map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.availCard, availability === opt.value && styles.availCardActive]}
                      onPress={() => setAvailability(opt.value)}
                    >
                      <View style={[styles.availRadio, availability === opt.value && styles.availRadioActive]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.availLabel, availability === opt.value && styles.availLabelActive]}>{opt.label}</Text>
                        <Text style={styles.availHint}>{opt.hint}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Identity verification</Text>
                  <Text style={styles.fieldHint}>
                    Upload a government-issued photo ID (passport, national ID, or driver's licence). You can submit your profile now — your profile goes live once we've reviewed your ID within 24 hours. You can also add this later from your profile.
                  </Text>
                  {idPhotoUri ? (
                    <View style={styles.idPreviewWrap}>
                      <Image source={{ uri: idPhotoUri }} style={styles.idPreview} resizeMode="cover" />
                      <TouchableOpacity onPress={() => setIdPhotoUri(null)}>
                        <Text style={styles.idRemove}>Remove and re-upload</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.idPickBtn} onPress={pickIdPhoto}>
                      <Text style={styles.idPickIcon}>🪪</Text>
                      <Text style={styles.idPickLabel}>Upload ID document</Text>
                      <Text style={styles.idPickHint}>Passport · National ID · Driver's licence</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    Your ID is stored securely and only accessed by the Drape verification team. It is never shared with customers or other tailors.
                  </Text>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* CTA */}
        <View style={styles.cta}>
          <Button
            label={step < 3 ? 'Continue' : (saving || uploadingId ? 'Submitting…' : 'Submit profile')}
            onPress={next}
            loading={saving || uploadingId}
            disabled={!canProceed()}
          />
          {step === 0 && (
            <TouchableOpacity onPress={handleSignOut} style={styles.signOutLink}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          )}
          {step === 1 && (!priceMin || !priceMax) && (
            <Text style={styles.minNote}>Set a price range to continue</Text>
          )}
          {step === 2 && portfolioItems.length < 4 && (
            <Text style={styles.minNote}>Upload at least 4 photos or videos to continue</Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  stepCount: { fontSize: FontSize.sm, color: Colors.midGrey },

  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  stepTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  stepSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20, marginTop: 4 },

  fields: { gap: Spacing.xl },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  fieldHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginBottom: Spacing.md },
  required: { color: Colors.error },

  // Currency selector
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  currencyChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  currencyChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  currencyChipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  currencyChipTextActive: { color: Colors.needleGreen },

  // Pricing
  priceRow: { flexDirection: 'row', gap: Spacing.md },
  priceInput: { flex: 1, marginBottom: 0 },
  priceError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs },

  // Portfolio
  portfolioStatus: { gap: Spacing.xs },
  portfolioBar: { height: 4, backgroundColor: Colors.lightGrey, borderRadius: 2 },
  portfolioBarFill: { height: '100%', backgroundColor: Colors.needleGreen, borderRadius: 2 },
  portfolioCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioThumb: { width: 100, height: 100, borderRadius: Radius.md, position: 'relative', overflow: 'hidden' },
  portfolioImg: { width: '100%', height: '100%' },
  videoThumb: { backgroundColor: Colors.ink, alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoIcon: { fontSize: 24, color: Colors.white },
  videoLabel: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)' },
  portfolioRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  portfolioRemoveText: { color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold },
  portfolioAdd: {
    width: 100, height: 100, borderRadius: Radius.md,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.lightGrey,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  portfolioAddIcon: { fontSize: 24, color: Colors.midGrey },
  portfolioAddLabel: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Availability
  availCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.lightGrey, marginBottom: Spacing.md,
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

  // ID verification
  idPickBtn: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl,
    alignItems: 'center', gap: Spacing.sm, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.lightGrey,
  },
  idPickIcon: { fontSize: 40 },
  idPickLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  idPickHint: { fontSize: FontSize.xs, color: Colors.midGrey },
  idPreviewWrap: { gap: Spacing.md },
  idPreview: { width: '100%', height: 200, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },
  idRemove: { fontSize: FontSize.sm, color: Colors.error },

  infoBox: {
    backgroundColor: Colors.boneDeep, borderRadius: Radius.md, padding: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: Colors.needleGreen,
  },
  infoText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  cta: {
    padding: Spacing.xl, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey, gap: Spacing.sm,
  },
  signOutLink: { alignSelf: 'center' },
  signOutText: { fontSize: FontSize.sm, color: Colors.error },
  minNote: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center' },

  suggestionsBox: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.lightGrey,
    marginTop: 2, overflow: 'hidden', ...Shadow.sm,
  },
  suggestionRow: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionText: { fontSize: FontSize.sm, color: Colors.ink },
})
