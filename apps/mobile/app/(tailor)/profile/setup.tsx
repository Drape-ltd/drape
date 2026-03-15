/**
 * Tailor profile setup wizard — 4 steps
 * Step 0: Identity (display name, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (min 4 photos)
 * Step 3: Availability + ID verification upload
 */
import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { stripExif } from '@/lib/stripExif'
import { Button, Input } from '@/components/ui'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const STEP_TITLES = ['Your identity', 'Specialties & pricing', 'Portfolio', 'Availability & verification']
const STEP_SUBS = [
  'This is your public profile. No contact details — customers find you through Drape.',
  'Tell customers what you make and what to expect on price.',
  'Upload at least 4 photos of your work. This is what customers see first.',
  'Set your availability and verify your identity to go live.',
]

const SPECIALTY_OPTIONS = [
  'Agbada', 'Suits', 'Kaftans', 'Ankara', 'Bespoke Dress', 'Lehenga',
  'Saree Blouse', 'Bridal', 'Trousers', 'Shirts', 'Native Wear', 'Wedding Gown',
  'Asobi', 'Kente', 'Wool Suits', 'Embroidery',
]

const LANGUAGE_OPTIONS = ['English', 'Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic', 'Hindi', 'Twi', 'Pidgin']

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
  const [languages, setLanguages] = useState<string[]>(['English'])

  // Step 1
  const [specialties, setSpecialties] = useState<string[]>([])
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')

  // Step 2
  const [portfolioPhotos, setPortfolioPhotos] = useState<string[]>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  // Step 3
  const [availability, setAvailability] = useState<Availability>('OPEN')
  const [idPhotoUri, setIdPhotoUri] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState(false)

  function validateBio(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) { setBioError("Contact details aren't allowed in your bio."); return false }
    setBioError(''); return true
  }

  function toggleLanguage(lang: string) {
    setLanguages((prev) => prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang])
  }

  function toggleSpecialty(s: string) {
    setSpecialties((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  async function pickPortfolioPhoto() {
    if (portfolioPhotos.length >= 12) { Alert.alert('Maximum 12 portfolio photos'); return }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })
    if (res.canceled || !res.assets[0]) return

    setUploadingPhoto(true)
    const rawUri = res.assets[0].uri
    const uri = await stripExif(rawUri)
    const ext = 'jpg' // stripExif always outputs JPEG
    const filename = `portfolio/${user?.id}/${Date.now()}.${ext}`
    try {
      const blob = await (await fetch(uri)).blob()
      await supabase.storage.from('portfolio-photos').upload(filename, blob, { contentType: `image/${ext}` })
      const { data } = supabase.storage.from('portfolio-photos').getPublicUrl(filename)
      setPortfolioPhotos((prev) => [...prev, data.publicUrl])
    } catch {
      Alert.alert('Error', 'Could not upload photo. Please try again.')
    }
    setUploadingPhoto(false)
  }

  async function pickIdPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 })
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
      portfolio_photo_urls: portfolioPhotos,
      availability,
      id_document_url: idUrl,
      id_verification_status: idUrl ? 'PENDING' : 'NOT_SUBMITTED',
      is_live: false,
      tier: 'VERIFIED',
      avg_rating: 0,
      total_reviews: 0,
      total_orders: 0,
      updated_at: now,
    }, { onConflict: 'user_id' })

    setSaving(false)

    if (error) {
      Alert.alert('Error', 'Could not save your profile. Please try again.')
      return
    }

    Alert.alert(
      'Profile submitted',
      idUrl
        ? 'We\'ll review your ID within 24 hours. You\'ll be notified when your profile goes live.'
        : 'Your profile is saved. Submit a government ID to go live.',
      [{ text: 'OK', onPress: () => router.replace('/(tailor)') }]
    )
  }

  function canProceed(): boolean {
    if (step === 0) return !!displayName.trim() && !!location.trim() && !bioError
    if (step === 1) return specialties.length >= 1
    if (step === 2) return portfolioPhotos.length >= 4
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
          <Text style={styles.stepIndicator}>{step + 1} / 4</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.progressRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.progressSeg, i <= step && styles.progressSegDone]} />
          ))}
        </View>

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
                <Input
                  label="Location"
                  placeholder="e.g. Lagos, Nigeria"
                  value={location}
                  onChangeText={setLocation}
                  required
                  testID="location-input"
                />
                <Input
                  label="About you"
                  placeholder="14 years tailoring Agbada, suits, and bespoke pieces..."
                  value={bio}
                  onChangeText={(v) => { setBio(v); if (bioError) validateBio(v) }}
                  onBlur={() => validateBio(bio)}
                  error={bioError}
                  multiline
                  numberOfLines={5}
                  maxLength={500}
                  filterContact
                  hint="Max 500 characters. No social handles, phone numbers, or URLs."
                  testID="bio-input"
                />
                <View>
                  <Text style={styles.fieldLabel}>Languages you speak</Text>
                  <View style={styles.chipWrap}>
                    {LANGUAGE_OPTIONS.map((lang) => (
                      <TouchableOpacity
                        key={lang}
                        style={[styles.chip, languages.includes(lang) && styles.chipActive]}
                        onPress={() => toggleLanguage(lang)}
                      >
                        <Text style={[styles.chipText, languages.includes(lang) && styles.chipTextActive]}>{lang}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 1: Specialties + pricing ── */}
            {step === 1 && (
              <View style={styles.fields}>
                <View>
                  <Text style={styles.fieldLabel}>What do you make? <Text style={styles.required}>*</Text></Text>
                  <Text style={styles.fieldHint}>Select all that apply — these appear as tags on your profile.</Text>
                  <View style={styles.chipWrap}>
                    {SPECIALTY_OPTIONS.map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, specialties.includes(s) && styles.chipActive]}
                        onPress={() => toggleSpecialty(s)}
                      >
                        <Text style={[styles.chipText, specialties.includes(s) && styles.chipTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Typical price range (£)</Text>
                  <Text style={styles.fieldHint}>This shows as an indicator on your profile — not a fixed price.</Text>
                  <View style={styles.priceRow}>
                    <Input
                      label="From"
                      placeholder="50"
                      value={priceMin}
                      onChangeText={setPriceMin}
                      keyboardType="decimal-pad"
                      containerStyle={styles.priceInput}
                    />
                    <Input
                      label="To"
                      placeholder="500"
                      value={priceMax}
                      onChangeText={setPriceMax}
                      keyboardType="decimal-pad"
                      containerStyle={styles.priceInput}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 2: Portfolio ── */}
            {step === 2 && (
              <View style={styles.fields}>
                <View style={styles.portfolioStatus}>
                  <View style={[styles.portfolioBar]}>
                    <View style={[styles.portfolioBarFill, { width: `${Math.min(100, (portfolioPhotos.length / 4) * 100)}%` }]} />
                  </View>
                  <Text style={styles.portfolioCount}>
                    {portfolioPhotos.length}/4 minimum {portfolioPhotos.length >= 4 ? '✓' : ''}
                  </Text>
                </View>

                <View style={styles.portfolioGrid}>
                  {portfolioPhotos.map((url, i) => (
                    <View key={i} style={styles.portfolioThumb}>
                      <Image source={{ uri: url }} style={styles.portfolioImg} resizeMode="cover" />
                      <TouchableOpacity
                        style={styles.portfolioRemove}
                        onPress={() => setPortfolioPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Text style={styles.portfolioRemoveText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {portfolioPhotos.length < 12 && (
                    <TouchableOpacity style={styles.portfolioAdd} onPress={pickPortfolioPhoto} disabled={uploadingPhoto}>
                      <Text style={styles.portfolioAddIcon}>{uploadingPhoto ? '…' : '+'}</Text>
                      <Text style={styles.portfolioAddLabel}>Add photo</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    Photos are scanned for embedded contact details before going live. EXIF location data is removed automatically.
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
                  <Text style={styles.fieldLabel}>Identity verification <Text style={styles.required}>*</Text></Text>
                  <Text style={styles.fieldHint}>
                    Upload a government-issued photo ID (passport, national ID, or driver's licence). Reviewed within 24 hours. Your profile goes live on approval.
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
          {step === 2 && portfolioPhotos.length < 4 && (
            <Text style={styles.minNote}>Upload at least 4 photos to continue</Text>
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
  stepIndicator: { fontSize: FontSize.sm, color: Colors.midGrey },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.xl, marginBottom: Spacing.sm },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.lightGrey },
  progressSegDone: { backgroundColor: Colors.needleGreen },

  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  stepTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },
  stepSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20, marginTop: 4 },

  fields: { gap: Spacing.xl },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  fieldHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginBottom: Spacing.md },
  required: { color: Colors.error },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  chipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  chipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.needleGreen },

  priceRow: { flexDirection: 'row', gap: Spacing.md },
  priceInput: { flex: 1, marginBottom: 0 },

  // Portfolio
  portfolioStatus: { gap: Spacing.xs },
  portfolioBar: { height: 4, backgroundColor: Colors.lightGrey, borderRadius: 2 },
  portfolioBarFill: { height: '100%', backgroundColor: Colors.needleGreen, borderRadius: 2 },
  portfolioCount: { fontSize: FontSize.xs, color: Colors.midGrey },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  portfolioThumb: { width: 100, height: 100, borderRadius: Radius.md, position: 'relative', overflow: 'hidden' },
  portfolioImg: { width: '100%', height: '100%' },
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

  // ID
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
})
