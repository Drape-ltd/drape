/**
 * Diary entry — add (id === 'new') or edit an existing offline client record.
 * Covers: customer info, full measurement set, tailor notes, session details.
 * Safety policy: no phone number or email stored.
 * Invite button sends a Client Passport claim link via the system share sheet.
 */
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { sharePassportInvite } from '@/lib/invite'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

// ─── Types ────────────────────────────────────────────────────────────────────

type MeasurementUnit = 'cm' | 'in'
type Gender = 'MALE' | 'FEMALE' | 'PREFER_NOT_TO_SAY' | ''
type EventType = 'WEDDING' | 'CASUAL' | 'ASOEBI' | 'FORMAL' | 'OTHER' | ''
type MeasuredLocation = 'SHOP' | 'CUSTOMER_HOME' | 'EVENT'

interface DiaryForm {
  fullName: string
  gender: Gender
  clientNotes: string
  // Measurements
  unit: MeasurementUnit
  chest: string
  shoulder: string
  sleeve: string
  waist: string
  hip: string
  trouserLength: string
  neck: string
  thigh: string
  inseam: string
  ankle: string
  bicep: string
  wrist: string
  backLength: string
  underBust: string
  // Tailor notes
  fabricPreference: string
  stylePreference: string
  eventType: EventType
  specialFittingNotes: string
  // Session
  measuredAt: Date | null
  measuredLocation: MeasuredLocation
}

const EMPTY_FORM: DiaryForm = {
  fullName: '', gender: '', clientNotes: '',
  unit: 'cm',
  chest: '', shoulder: '', sleeve: '', waist: '',
  hip: '', trouserLength: '', neck: '', thigh: '',
  inseam: '', ankle: '', bicep: '', wrist: '',
  backLength: '', underBust: '',
  fabricPreference: '', stylePreference: '', eventType: '', specialFittingNotes: '',
  measuredAt: new Date(), measuredLocation: 'SHOP',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DiaryEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const isNew = id === 'new'
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  const [form, setForm] = useState<DiaryForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ name?: string; measurements?: string }>({})
  const [showTopError, setShowTopError] = useState(false)
  const [passportId, setPassportId] = useState<string | null>(null)

  const scrollRef = useRef<ScrollView>(null)
  const nameFieldY = useRef(0)
  const measurementsY = useRef(0)
  const [inviteStatus, setInviteStatus] = useState<string>('NOT_INVITED')
  const [tailorDisplayName, setTailorDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  function goBack() {
    if (navigation.canGoBack()) router.back()
    else router.replace('/(tailor)/clients')
  }

  async function loadEntry() {
    if (isNew || !id) return
    setFetchError(false)
    setLoading(true)
    const { data, error } = await supabase
      .from('diary_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      setFetchError(true)
      setLoading(false)
      return
    }

    if (!data) {
      setLoading(false)
      return
    }

    const r = data as any
    setPassportId(r.passport_id)
    setInviteStatus(r.invite_status)
    setForm({
      fullName: r.full_name ?? '',
      gender: r.gender ?? '',
      clientNotes: r.client_notes ?? '',
      unit: r.measurement_unit ?? 'cm',
      chest: r.chest != null ? String(r.chest) : '',
      shoulder: r.shoulder != null ? String(r.shoulder) : '',
      sleeve: r.sleeve != null ? String(r.sleeve) : '',
      waist: r.waist != null ? String(r.waist) : '',
      hip: r.hip != null ? String(r.hip) : '',
      trouserLength: r.trouser_length != null ? String(r.trouser_length) : '',
      neck: r.neck != null ? String(r.neck) : '',
      thigh: r.thigh != null ? String(r.thigh) : '',
      inseam: r.inseam != null ? String(r.inseam) : '',
      ankle: r.ankle != null ? String(r.ankle) : '',
      bicep: r.bicep != null ? String(r.bicep) : '',
      wrist: r.wrist != null ? String(r.wrist) : '',
      backLength: r.back_length != null ? String(r.back_length) : '',
      underBust: r.under_bust != null ? String(r.under_bust) : '',
      fabricPreference: r.fabric_preference ?? '',
      stylePreference: r.style_preference ?? '',
      eventType: r.event_type ?? '',
      specialFittingNotes: r.special_fitting_notes ?? '',
      measuredAt: r.measured_at ? new Date(r.measured_at) : null,
      measuredLocation: r.measured_location ?? 'SHOP',
    })
    setLoading(false)
  }

  // Load existing entry
  useEffect(() => {
    if (!isNew && id) {
      void loadEntry()
    }

    if (user?.id) {
      supabase
        .from('tailor_profiles')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setTailorDisplayName((data as any).display_name ?? '')
        })
    }
  }, [id])

  function set(key: keyof DiaryForm, value: string | Date | null) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'fullName') setErrors((e) => ({ ...e, name: undefined }))
    if (['chest','shoulder','sleeve','waist','hip','trouserLength','neck','thigh','inseam','ankle','bicep','wrist','backLength','underBust'].includes(key as string)) {
      setErrors((e) => ({ ...e, measurements: undefined }))
    }
  }

  function scrollToY(y: number) {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true })
  }

  function validate(): boolean {
    const newErrors: { name?: string; measurements?: string } = {}

    if (!form.fullName.trim()) {
      newErrors.name = 'Customer name is required.'
    }

    const filledCount = [
      form.chest, form.shoulder, form.sleeve, form.waist, form.hip,
      form.trouserLength, form.neck, form.thigh, form.inseam, form.ankle,
      form.bicep, form.wrist, form.backLength, form.underBust,
    ].filter((v) => v.trim() !== '').length

    if (filledCount < 5) {
      newErrors.measurements = `Please add at least 5 measurements (${filledCount} entered).`
    }

    setErrors(newErrors)

    const hasErrors = Object.keys(newErrors).length > 0
    if (hasErrors) {
      setShowTopError(true)
      if (newErrors.name) scrollToY(nameFieldY.current)
      else if (newErrors.measurements) scrollToY(measurementsY.current)
    }
    return !hasErrors
  }

  function parseNum(s: string): number | null {
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  }

  async function handleSave() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    const payload: Record<string, any> = {
      tailor_id: user?.id,
      full_name: form.fullName.trim(),
      gender: form.gender || null,
      client_notes: form.clientNotes.trim() || null,
      measurement_unit: form.unit,
      chest: parseNum(form.chest),
      shoulder: parseNum(form.shoulder),
      sleeve: parseNum(form.sleeve),
      waist: parseNum(form.waist),
      hip: parseNum(form.hip),
      trouser_length: parseNum(form.trouserLength),
      neck: parseNum(form.neck),
      thigh: parseNum(form.thigh),
      inseam: parseNum(form.inseam),
      ankle: parseNum(form.ankle),
      bicep: parseNum(form.bicep),
      wrist: parseNum(form.wrist),
      back_length: parseNum(form.backLength),
      under_bust: parseNum(form.underBust),
      fabric_preference: form.fabricPreference.trim() || null,
      style_preference: form.stylePreference.trim() || null,
      event_type: form.eventType || null,
      special_fitting_notes: form.specialFittingNotes.trim() || null,
      measured_at: form.measuredAt ? form.measuredAt.toISOString().split('T')[0] : null,
      measured_location: form.measuredLocation,
      updated_at: new Date().toISOString(),
    }

    let error: any
    if (isNew) {
      const res = await supabase.from('diary_entries').insert(payload).select('passport_id').single()
      error = res.error
      if (!error && res.data) setPassportId((res.data as any).passport_id)
    } else {
      const res = await supabase.from('diary_entries').update(payload).eq('id', id)
      error = res.error
    }

    setSaving(false)
    if (error) {
      Alert.alert('Save failed', error.message)
    } else {
      if (isNew) goBack()
    }
  }

  async function handleInvite() {
    if (inviting) return
    if (!passportId) {
      Alert.alert('Save first', 'Save the entry before sending an invite.')
      return
    }
    setInviting(true)
    try {
      await sharePassportInvite(passportId, form.fullName.trim() || 'your client', tailorDisplayName)
      const { error } = await supabase
        .from('diary_entries')
        .update({ invite_status: 'INVITE_SENT', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (!error) setInviteStatus('INVITE_SENT')
      else Alert.alert('Invite not marked', error.message)
    } finally {
      setInviting(false)
    }
  }

  async function handleDelete() {
    if (deleting) return
    Alert.alert(
      'Delete entry?',
      `This will permanently remove ${form.fullName || 'this client'} from your diary.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (deleting) return
            setDeleting(true)
            const { error } = await supabase.from('diary_entries').delete().eq('id', id)
            if (error) {
              setDeleting(false)
              Alert.alert('Delete failed', error.message)
              return
            }
            goBack()
          },
        },
      ]
    )
  }

  function onDateChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false)
    if (selected) set('measuredAt', selected)
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Diary entry</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this entry…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together measurements, notes, and invite status so you can continue this client relationship cleanly.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError && !isNew) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Diary entry</Text>
            <Text style={styles.stateTitle}>Couldn't load this diary entry.</Text>
            <Text style={styles.stateHint}>
              This page should help you carry an offline measurement session into Drape without losing fit details or client context.
            </Text>
            <TouchableOpacity style={styles.errorBtn} onPress={() => { void loadEntry() }}>
              <Text style={styles.errorBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tailor)/clients')}>
              <Text style={styles.errorLink}>Open diary</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.errorLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isNew ? 'New client' : form.fullName || 'Edit client'}</Text>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {!isNew && (
              <TouchableOpacity onPress={handleDelete} disabled={saving || deleting} hitSlop={8}>
                {deleting
                  ? <ActivityIndicator size="small" color={Colors.error} />
                  : <Feather name="trash-2" size={20} color={Colors.error} />
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleSave} disabled={saving || deleting} hitSlop={8} style={styles.saveBtn}>
              {saving
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={styles.saveBtnText}>Save</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        {showTopError && (
          <View style={styles.topErrorBanner}>
            <Feather name="alert-circle" size={14} color={Colors.error} />
            <Text style={styles.topErrorText}>Please complete required fields before saving</Text>
            <TouchableOpacity onPress={() => setShowTopError(false)} hitSlop={8}>
              <Feather name="x" size={14} color={Colors.error} />
            </TouchableOpacity>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Offline client diary</Text>
            </View>
            <Text style={styles.heroTitle}>Capture measurements and fitting context even before a client joins the app.</Text>
            <Text style={styles.heroSub}>
              Use this diary to preserve session details, tailoring notes, and a clean path into a
              future passport invite when the client is ready.
            </Text>
          </View>

          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>Best diary habit</Text>
            <Text style={styles.guideText}>
              Record the fit details you would want before the next appointment, then use the passport invite only when the client is ready to continue on Drape.
            </Text>
          </View>

          {/* ── Client info ─────────────────────────────────────────────── */}
          <View onLayout={(e) => { nameFieldY.current = e.nativeEvent.layout.y }}>
          <Section title="Client info">
            <Field label="Full name *">
              <TextInput
                style={[styles.input, errors.name ? styles.inputError : undefined]}
                value={form.fullName}
                onChangeText={(v) => set('fullName', v)}
                placeholder="e.g. Amara Johnson"
                placeholderTextColor={Colors.midGrey}
                autoCapitalize="words"
              />
              {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
            </Field>
            <Field label="Gender (optional)">
              <SegmentPicker
                options={[
                  { label: 'Male', value: 'MALE' },
                  { label: 'Female', value: 'FEMALE' },
                  { label: 'Prefer not to say', value: 'PREFER_NOT_TO_SAY' },
                ]}
                value={form.gender}
                onChange={(v) => set('gender', v as Gender)}
                nullable
                wrap
              />
            </Field>
            <Field label="Client notes">
              <TextInput
                style={[styles.input, styles.multiline]}
                value={form.clientNotes}
                onChangeText={(v) => set('clientNotes', v)}
                placeholder="Any additional info about this client…"
                placeholderTextColor={Colors.midGrey}
                multiline
                numberOfLines={3}
              />
            </Field>
          </Section>
          </View>

          {/* ── Measurements ────────────────────────────────────────────── */}
          <View onLayout={(e) => { measurementsY.current = e.nativeEvent.layout.y }}>
          <Section title="Measurements">
            <Field label="Unit">
              <SegmentPicker
                options={[{ label: 'cm', value: 'cm' }, { label: 'inches', value: 'in' }]}
                value={form.unit}
                onChange={(v) => set('unit', v as MeasurementUnit)}
              />
            </Field>
            <View style={styles.measureGrid}>
              <MeasureField label="Chest" value={form.chest} unit={form.unit} onChange={(v) => set('chest', v)} />
              <MeasureField label="Shoulder" value={form.shoulder} unit={form.unit} onChange={(v) => set('shoulder', v)} />
              <MeasureField label="Sleeve" value={form.sleeve} unit={form.unit} onChange={(v) => set('sleeve', v)} />
              <MeasureField label="Waist" value={form.waist} unit={form.unit} onChange={(v) => set('waist', v)} />
              <MeasureField label="Hip" value={form.hip} unit={form.unit} onChange={(v) => set('hip', v)} />
              <MeasureField label="Trouser length" value={form.trouserLength} unit={form.unit} onChange={(v) => set('trouserLength', v)} />
              <MeasureField label="Neck" value={form.neck} unit={form.unit} onChange={(v) => set('neck', v)} />
              <MeasureField label="Thigh" value={form.thigh} unit={form.unit} onChange={(v) => set('thigh', v)} />
              <MeasureField label="Inseam" value={form.inseam} unit={form.unit} onChange={(v) => set('inseam', v)} />
              <MeasureField label="Ankle / cuff" value={form.ankle} unit={form.unit} onChange={(v) => set('ankle', v)} />
              <MeasureField label="Bicep" value={form.bicep} unit={form.unit} onChange={(v) => set('bicep', v)} />
              <MeasureField label="Wrist" value={form.wrist} unit={form.unit} onChange={(v) => set('wrist', v)} />
              <MeasureField label="Back length" value={form.backLength} unit={form.unit} onChange={(v) => set('backLength', v)} />
              <MeasureField label="Under bust" value={form.underBust} unit={form.unit} onChange={(v) => set('underBust', v)} />
            </View>
            {errors.measurements && <Text style={styles.errorText}>{errors.measurements}</Text>}
          </Section>
          </View>

          {/* ── Tailor notes ─────────────────────────────────────────────── */}
          <Section title="Tailor notes">
            <Field label="Event type">
              <SegmentPicker
                options={[
                  { label: 'Wedding', value: 'WEDDING' },
                  { label: 'Casual', value: 'CASUAL' },
                  { label: 'Asoebi', value: 'ASOEBI' },
                  { label: 'Formal', value: 'FORMAL' },
                  { label: 'Other', value: 'OTHER' },
                ]}
                value={form.eventType}
                onChange={(v) => set('eventType', v as EventType)}
                nullable
                wrap
              />
            </Field>
            <Field label="Fabric preference">
              <TextInput
                style={styles.input}
                value={form.fabricPreference}
                onChangeText={(v) => set('fabricPreference', v)}
                placeholder="e.g. Ankara, linen, cotton…"
                placeholderTextColor={Colors.midGrey}
              />
            </Field>
            <Field label="Style preference">
              <TextInput
                style={styles.input}
                value={form.stylePreference}
                onChangeText={(v) => set('stylePreference', v)}
                placeholder="e.g. Slim fit, agbada, kaftan…"
                placeholderTextColor={Colors.midGrey}
              />
            </Field>
            <Field label="Fitting notes">
              <TextInput
                style={[styles.input, styles.multiline]}
                value={form.specialFittingNotes}
                onChangeText={(v) => set('specialFittingNotes', v)}
                placeholder="Posture, alterations, special instructions…"
                placeholderTextColor={Colors.midGrey}
                multiline
                numberOfLines={3}
              />
            </Field>
          </Section>

          {/* ── Session ───────────────────────────────────────────────────── */}
          <Section title="Session">
            <Field label="Date measured">
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <Feather name="calendar" size={16} color={Colors.midGrey} />
                <Text style={[styles.dateBtnText, !form.measuredAt && styles.datePlaceholder]}>
                  {form.measuredAt
                    ? form.measuredAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                    : 'Select date'}
                </Text>
                {form.measuredAt && (
                  <TouchableOpacity onPress={() => set('measuredAt', null)} hitSlop={8} style={{ marginLeft: 'auto' }}>
                    <Feather name="x" size={14} color={Colors.midGrey} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </Field>

            <Field label="Location">
              <SegmentPicker
                options={[
                  { label: 'Shop', value: 'SHOP' },
                  { label: 'Home visit', value: 'CUSTOMER_HOME' },
                  { label: 'Event', value: 'EVENT' },
                ]}
                value={form.measuredLocation}
                onChange={(v) => set('measuredLocation', v as MeasuredLocation)}
              />
            </Field>
          </Section>

          {/* ── Client Passport ──────────────────────────────────────────── */}
          {!isNew && (
            <Section title="Client Passport">
              <View style={styles.passportCard}>
                <View style={styles.passportInfo}>
                  <Feather name="credit-card" size={20} color={Colors.needleGreen} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.passportTitle}>
                      {inviteStatus === 'CLAIMED' ? 'Passport claimed' : 'Share passport'}
                    </Text>
                    <Text style={styles.passportSub}>
                      {inviteStatus === 'CLAIMED'
                        ? 'This client has claimed their measurement passport on Drape.'
                        : inviteStatus === 'INVITE_SENT'
                          ? 'Invite sent — waiting for the client to claim their passport.'
                          : 'Send this client a link to claim their measurements on Drape.'}
                    </Text>
                  </View>
                </View>
                {inviteStatus !== 'CLAIMED' && (
                  <TouchableOpacity
                    style={[styles.inviteBtn, inviting && styles.inviteBtnDisabled]}
                    onPress={() => { void handleInvite() }}
                    disabled={inviting}
                  >
                    {inviting ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Feather name="send" size={15} color={Colors.white} />
                    )}
                    <Text style={styles.inviteBtnText}>
                      {inviting ? 'Sending…' : inviteStatus === 'INVITE_SENT' ? 'Resend invite' : 'Send invite'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </Section>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Date Picker ─── */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={form.measuredAt ?? new Date()}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={onDateChange}
        />
      )}
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="slide" visible={showDatePicker}>
          <View style={styles.dateModalOverlay}>
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>Select date</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={form.measuredAt ?? new Date()}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={onDateChange}
                style={{ height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
    </View>
  )
}

function MeasureField({
  label, value, unit, onChange,
}: {
  label: string; value: string; unit: string; onChange: (v: string) => void
}) {
  return (
    <View style={measureStyles.cell}>
      <Text style={measureStyles.label}>{label}</Text>
      <View style={measureStyles.inputRow}>
        <TextInput
          style={measureStyles.input}
          value={value}
          onChangeText={onChange}
          placeholder="—"
          placeholderTextColor={Colors.midGrey}
          keyboardType="decimal-pad"
        />
        <Text style={measureStyles.unit}>{unit}</Text>
      </View>
    </View>
  )
}

function SegmentPicker({
  options, value, onChange, nullable = false, wrap = false,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
  nullable?: boolean
  wrap?: boolean
}) {
  return (
    <View style={[segStyles.row, wrap && segStyles.rowWrap]}>
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <TouchableOpacity
            key={opt.value}
            style={[segStyles.btn, active && segStyles.btnActive]}
            onPress={() => onChange(nullable && active ? '' : opt.value)}
          >
            <Text style={[segStyles.label, active && segStyles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
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
  errorBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
  },
  errorBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
  errorLink: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.boneDeep,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    minWidth: 60, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },

  scroll: { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
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
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  guideText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  input: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  topErrorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.errorLight, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.error + '30',
  },
  topErrorText: { flex: 1, fontSize: FontSize.sm, color: Colors.error },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  errorText: { fontSize: FontSize.xs, color: Colors.error, marginTop: 4 },
  inputError: { borderWidth: 1.5, borderColor: Colors.error },

  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  dateBtnText: { flex: 1, fontSize: FontSize.md, color: Colors.ink },
  datePlaceholder: { color: Colors.midGrey },

  dateModalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  dateModalCard: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingBottom: Spacing.xxxl,
  },
  dateModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  dateModalTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  dateModalDone: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.needleGreen },

  passportCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
  },
  passportInfo: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  passportTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  passportSub: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 19, marginTop: 2 },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    alignSelf: 'flex-start',
  },
  inviteBtnDisabled: { opacity: 0.7 },
  inviteBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.white },
})

const sectionStyles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  title: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.midGrey,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  body: { gap: Spacing.sm },
})

const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
})

const measureStyles = StyleSheet.create({
  cell: { width: '48%', gap: 6 },
  label: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.midGrey },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    gap: 4, ...Shadow.sm,
  },
  input: { flex: 1, fontSize: FontSize.md, color: Colors.ink },
  unit: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.medium },
})

const segStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowWrap: { flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
  },
  btnActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  label: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },
  labelActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
})
