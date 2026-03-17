import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform, Image, Modal, TextInput,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import DateTimePicker from '@react-native-community/datetimepicker'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { stripExif } from '@/lib/stripExif'
import { Button, Input } from '@/components/ui'
import { filterContactInfo, rejectPlaceholder, filterStyleReference } from '@drape/shared/contact-filter'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const MEAS_PROMPT_KEY = 'drape_meas_prompt_shown'

// ─── Types ────────────────────────────────────────────────────────────────────

type FabricSource = 'CUSTOMER_SUPPLIES' | 'TAILOR_SOURCES'
type DeliveryMethod = 'SHIPPING' | 'LOCAL_COLLECTION'

const GARMENT_TYPES = [
  'Agbada', 'Suit', 'Kaftan', 'Ankara Dress', 'Lehenga', 'Saree Blouse',
  'Trousers', 'Shirt', 'Bespoke Dress', 'Wedding Gown', 'Blazer', 'Skirt', 'Other',
]

const STEP_TITLES = ['Garment details', 'Style references', 'Your measurements', 'Fabric & delivery']

const CURATED_STYLE_HANDLES = [
  '@thesartorialist',
  '@drapeofficial',
  '@agbada_styles',
  '@bespoketailoring',
  '@africanbespoke',
  '@mens_fashion',
  '@couturefashion',
  '@weddingdressstyle',
  '@ankara_fashion',
  '@nigerian_fashion',
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderBriefScreen() {
  const { tailorId } = useLocalSearchParams<{ tailorId: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [showMeasPrompt, setShowMeasPrompt] = useState(false)

  // Step 1
  const [garmentType, setGarmentType] = useState('')
  const [description, setDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [occasion, setOccasion] = useState('')
  const [deadline, setDeadline] = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)

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
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryAddressError, setDeliveryAddressError] = useState('')

  // Resolved tailor user_id (tailorId param is tailor_profiles.id)
  const [tailorUserId, setTailorUserId] = useState<string | null>(null)

  // Load tailor user_id + customer measurements; show one-time completeness prompt
  useEffect(() => {
    async function load() {
      const [tailorRes, measRes] = await Promise.all([
        supabase
          .from('tailor_profiles')
          .select('user_id')
          .eq('id', tailorId)
          .single(),
        supabase
          .from('customer_profiles')
          .select('measurements')
          .eq('user_id', user?.id)
          .single(),
      ])

      if (tailorRes.data) setTailorUserId(tailorRes.data.user_id)

      const hasMeasurements = !!(measRes.data?.measurements && Object.keys(measRes.data.measurements).length > 0)
      if (hasMeasurements) {
        setMeasurements(measRes.data.measurements)
      } else {
        const alreadyShown = await AsyncStorage.getItem(MEAS_PROMPT_KEY)
        if (!alreadyShown) setShowMeasPrompt(true)
      }
    }
    load()
  }, [])

  function validateDescription(text: string) {
    const placeholder = rejectPlaceholder(text, 'Description')
    if (placeholder) { setDescriptionError(placeholder); return false }
    const res = filterContactInfo(text)
    if (res.blocked) { setDescriptionError("Contact details can't be included here."); return false }
    setDescriptionError('')
    return true
  }

  function validateDeliveryAddress(text: string) {
    const placeholder = rejectPlaceholder(text, 'Delivery address')
    if (placeholder) { setDeliveryAddressError(placeholder); return false }
    if (text.trim().length < 10) { setDeliveryAddressError('Please enter your full delivery address.'); return false }
    setDeliveryAddressError('')
    return true
  }

  function validateFitNote(text: string) {
    if (text.trim().length < 20) {
      setFitNoteError('Tell your tailor about your deadline and any key fit details — at least 20 characters.')
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
    if (step === 0) return !!garmentType && description.trim().length >= 1 && !descriptionError && !!deadline
    if (step === 1) return true // photos optional
    if (step === 2) return !!measurements && fitNote.trim().length >= 20 && !fitNoteError
    if (step === 3) {
      if (!fabricSource || !deliveryMethod) return false
      if (deliveryMethod === 'SHIPPING' && (deliveryAddress.trim().length < 10 || !!deliveryAddressError)) return false
      return true
    }
    return false
  }

  function addInspirationHandle(handle: string) {
    if (!inspirationLinks.includes(handle)) {
      setInspirationLinks((prev) => [...prev, handle])
    }
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
    if (!tailorUserId) {
      Alert.alert('Error', 'Could not load tailor details. Please go back and try again.')
      return
    }
    // Final guard — catches any placeholder values that bypassed per-field validation
    if (!validateDescription(description)) return
    if (!validateFitNote(fitNote)) return
    if (deliveryMethod === 'SHIPPING' && !validateDeliveryAddress(deliveryAddress)) return
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
      } catch {
        // Skip failed uploads — don't block submission
      }
    }

    // Generate reference number
    const reference = `DRP${Date.now().toString(36).toUpperCase().slice(-6)}`

    const { data, error } = await supabase.from('orders').insert({
      customer_id: user?.id,
      tailor_id: tailorUserId,       // auth UUID — for tailor's own queries
      tailor_profile_id: tailorId,   // tailor_profiles.id — for joins
      reference,
      garment_type: garmentType,
      garment_description: description.trim(),
      occasion: occasion.trim() || null,
      deadline: deadline?.toISOString() ?? null,
      reference_photos: uploadedUrls,
      customer_measurements_snapshot: measurements,
      fit_note: fitNote.trim() ? (inspirationLinks.length > 0 ? `${fitNote.trim()}\n\nStyle inspiration: ${inspirationLinks.join(', ')}` : fitNote.trim()) : (inspirationLinks.length > 0 ? `Style inspiration: ${inspirationLinks.join(', ')}` : null),
      fabric_source: fabricSource,
      delivery_method: deliveryMethod,
      delivery_address: deliveryMethod === 'SHIPPING' ? deliveryAddress.trim() : null,
      stage: 'PENDING_QUOTE',
      stage_updated_at: new Date().toISOString(),
    }).select('id').single()

    setSubmitting(false)

    if (error || !data) {
      console.error('Order insert error:', JSON.stringify(error))
      Alert.alert('Error', 'Could not submit your order. Please try again.')
      return
    }

    capture('order_placed', {
      garment_type: garmentType,
      has_photos: uploadedUrls.length > 0,
      has_measurements: !!measurements,
      fabric_source: fabricSource,
      delivery_method: deliveryMethod,
      has_deadline: !!deadline,
    })

    router.replace(`/(customer)/orders/${data.id}`)
  }

  function next() {
    if (step === 2 && !measurements) {
      Alert.alert(
        'Measurements required',
        'Please set up your measurement profile before placing an order. This helps your tailor give an accurate quote.',
        [
          { text: 'Set up now', onPress: () => router.navigate('/(customer)/profile/measurements') },
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
    else router.back()
  }

  async function dismissMeasPrompt(goToMeasurements: boolean) {
    await AsyncStorage.setItem(MEAS_PROMPT_KEY, '1')
    setShowMeasPrompt(false)
    if (goToMeasurements) router.navigate('/(customer)/profile/measurements')
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
                  placeholder="Describe your garment — style, details, fabric preferences..."
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
                        <Image source={{ uri }} style={styles.photoImage} resizeMode="cover" />
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
                    Add Instagram, Pinterest, or TikTok links to styles you like — up to 5. We've suggested some accounts below.
                  </Text>

                  {/* Curated handles */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.handlesScroll}>
                    <View style={styles.handlesRow}>
                      {CURATED_STYLE_HANDLES.map((handle) => {
                        const selected = inspirationLinks.includes(handle)
                        return (
                          <TouchableOpacity
                            key={handle}
                            style={[styles.handleChip, selected && styles.handleChipActive]}
                            onPress={() => selected ? removeInspirationLink(handle) : addInspirationHandle(handle)}
                          >
                            <Text style={[styles.handleChipText, selected && styles.handleChipTextActive]}>{handle}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </ScrollView>

                  {/* Custom link input */}
                  <View style={styles.inspirationInputRow}>
                    <View style={{ flex: 1 }}>
                      <Input
                        label=""
                        placeholder="Paste an Instagram / Pinterest link or @handle"
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
                      <Text style={styles.measureEditHint}>Tap any field to edit</Text>
                    </View>
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
                            {value ? `${value} ${measurements.unit}` : '—'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {measurements.fitFlags?.length > 0 && (
                      <View style={styles.flagsRow}>
                        {measurements.fitFlags.map((f: string) => (
                          <View key={f} style={styles.flagBadge}>
                            <Text style={styles.flagBadgeText}>{f.replace(/_/g, ' ').toLowerCase()}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.noMeasureCard}>
                    <Text style={styles.noMeasureTitle}>Measurements required</Text>
                    <Text style={styles.noMeasureHint}>
                      Your tailor needs your measurements to give an accurate quote. Set up your profile once — it applies to all future orders.
                    </Text>
                    <TouchableOpacity
                      style={styles.noMeasureBtn}
                      onPress={() => router.navigate('/(customer)/profile/measurements')}
                    >
                      <Text style={styles.noMeasureBtnText}>Set up measurements</Text>
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
                      hint="You'll ship fabric to the tailor. They'll ask for their address."
                      active={fabricSource === 'CUSTOMER_SUPPLIES'}
                      onPress={() => setFabricSource('CUSTOMER_SUPPLIES')}
                    />
                    <OptionCard
                      title="Tailor to source"
                      hint="Tailor buys the fabric — cost included in their quote."
                      active={fabricSource === 'TAILOR_SOURCES'}
                      onPress={() => setFabricSource('TAILOR_SOURCES')}
                    />
                  </View>
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Delivery <Text style={styles.required}>*</Text></Text>
                  <View style={styles.optionCards}>
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

                {deliveryMethod === 'SHIPPING' && (
                  <Input
                    label="Delivery address"
                    placeholder="Full address including postcode / ZIP / state"
                    value={deliveryAddress}
                    onChangeText={(v) => { setDeliveryAddress(v); if (deliveryAddressError) validateDeliveryAddress(v) }}
                    onBlur={() => validateDeliveryAddress(deliveryAddress)}
                    multiline
                    numberOfLines={3}
                    required
                    hint="Your tailor ships the finished garment here."
                    error={deliveryAddressError}
                  />
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
                    {deliveryMethod && (
                      <SummaryRow label="Delivery" value={deliveryMethod === 'SHIPPING' ? 'Shipping' : 'Local collection'} />
                    )}
                    {deliveryMethod === 'SHIPPING' && deliveryAddress.trim() && (
                      <SummaryRow label="Ship to" value={deliveryAddress.trim()} />
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.cta}>
          <Button
            label={step < 3 ? 'Continue' : 'Send order'}
            onPress={next}
            loading={submitting}
            disabled={!canProceed() && step !== 1}
            testID={step < 3 ? 'brief-continue-btn' : 'brief-send-btn'}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Inline measurement edit modal */}
      <Modal visible={!!editingField} transparent animationType="slide">
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
                        const { data } = await supabase.from('customer_profiles').select('measurements').eq('user_id', user?.id).single()
                        if (data) {
                          await supabase.from('customer_profiles').update({
                            measurements: { ...data.measurements, [editingField.key]: parsed },
                          }).eq('user_id', user?.id)
                        }
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
      <Modal visible={showMeasPrompt} transparent animationType="fade">
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
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  backText: { color: Colors.needleGreen, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  stepLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.xl, marginBottom: Spacing.sm },
  progressSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.lightGrey },
  progressSegDone: { backgroundColor: Colors.needleGreen },

  scroll: { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  stepTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink },

  fields: { gap: Spacing.xl },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink, marginBottom: Spacing.sm },
  required: { color: Colors.error },
  fieldHint: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  // Garment type chips
  garmentRow: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.xs },
  garmentChip: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  garmentChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  garmentChipText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.medium },
  garmentChipTextActive: { color: Colors.needleGreen },

  // Date picker
  dateButton: {
    backgroundColor: Colors.white, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.lightGrey, padding: Spacing.lg, marginTop: Spacing.sm,
  },
  dateButtonRequired: { borderColor: Colors.error + '60' },
  dateText: { fontSize: FontSize.md, color: Colors.ink },
  datePlaceholder: { color: Colors.midGrey },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  photoThumb: { width: 100, height: 100, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  photoRemoveText: { color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold },
  photoAdd: {
    width: 100, height: 100, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.lightGrey, borderStyle: 'dashed',
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  photoAddIcon: { fontSize: 24, color: Colors.midGrey },
  photoAddLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  photoCount: { fontSize: FontSize.xs, color: Colors.midGrey },

  // Measurements summary
  measureSummaryCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  measureSummaryTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  measureSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  measureSummaryItem: { width: '47%', gap: 2 },
  measureSummaryLabel: { fontSize: FontSize.xs, color: Colors.midGrey },
  measureSummaryValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  flagBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, backgroundColor: Colors.kanteRustLight, borderRadius: Radius.full },
  flagBadgeText: { fontSize: FontSize.xs, color: Colors.kanteRust, fontWeight: FontWeight.medium },
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
    backgroundColor: Colors.boneDeep, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center',
  },
  noMeasureTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  noMeasureHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', lineHeight: 20 },
  noMeasureBtn: {
    marginTop: Spacing.sm, backgroundColor: Colors.needleGreen,
    borderRadius: Radius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl,
  },
  noMeasureBtnText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },

  // Style inspiration
  inspirationSection: { gap: Spacing.md },
  handlesScroll: { marginTop: Spacing.sm },
  handlesRow: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.xs },
  handleChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  handleChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  handleChipText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.medium },
  handleChipTextActive: { color: Colors.needleGreen },
  inspirationInputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inspirationAddBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    paddingVertical: 12, paddingHorizontal: Spacing.lg,
  },
  inspirationAddText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  selectedLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  selectedLinkBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.needleGreenLight, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderWidth: 1, borderColor: Colors.needleGreen, maxWidth: 200,
  },
  selectedLinkText: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.medium, flexShrink: 1 },
  selectedLinkRemove: { fontSize: 10, color: Colors.needleGreen },
  linkError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs, lineHeight: 18 },

  // Fabric & delivery options
  optionCards: { gap: Spacing.md },
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
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
  summaryCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm },
  summaryTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: FontSize.sm, color: Colors.inkLight },
  summaryValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  // CTA
  cta: {
    padding: Spacing.xl, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.lightGrey,
  },

  // Profile completeness prompt modal
  promptOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  promptCard: {
    backgroundColor: Colors.white, borderRadius: Radius.xl,
    padding: Spacing.xl, gap: Spacing.lg, alignItems: 'center', ...Shadow.lg,
  },
  promptEmoji: { fontSize: 40 },
  promptTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  promptBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 22, textAlign: 'center' },
  promptPrimary: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxl, alignSelf: 'stretch', alignItems: 'center',
  },
  promptPrimaryText: { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
  promptSecondary: { fontSize: FontSize.sm, color: Colors.midGrey, textDecorationLine: 'underline' },
})
