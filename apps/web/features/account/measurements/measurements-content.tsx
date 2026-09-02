'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Ruler, ScanLine, Users } from 'lucide-react'
import {
  CORE_MEASUREMENT_FIELDS,
  MEASUREMENT_FIELD_KEYS,
  buildMeasurementProfileStoragePayload,
  isMeasurementFieldKey,
  isTransientMeasurementMetadataKey,
  measurementCoreCompleteness,
  promoteSpecialistMeasurementsToProfileValues,
  readMeasurementValue,
  mergeMeasurementRecords,
  specialistMeasurementProfileValueKeys,
  stripDrapeVisionFit360DraftFields,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { safeUserText } from '../../../lib/safe-display'
import { OpenAppButton } from '../../../components/open-app-button'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { MetricCard } from '../../../components/ui/metric-card'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { formatDate, formatDatabaseEnumLabel } from '@drape/shared'

export type CustomerProfile = {
  user_id: string
  display_name: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  updated_at: string | null
}
export type MeasurementProfile = {
  id: string
  label: string | null
  relationship: string | null
  source: string | null
  unit_preference: string | null
  measurements?: Record<string, unknown> | null
  is_default: boolean | null
  last_measured_at: string | null
  updated_at: string | null
}
export type MeasurementScan = { id: string; capture_method: string | null; status: string | null; confidence_overall: string | null; created_at: string | null }
export type MeasurementsRenderData = { userId: string; customerProfile: CustomerProfile | null; measurementProfiles: MeasurementProfile[]; measurementScans: MeasurementScan[]; warning: string | null }

function cleanLabel(value: string | null | undefined, fallback = 'Not set') { return value?.trim() ? formatDatabaseEnumLabel(value, fallback) : fallback }
function assertNoContactLeak(value: string, fallback?: string) { const filtered = filterContactInfo(value); return filtered.blocked ? fallback ?? filtered.userMessage : null }
function ActionNotice({ error, success }: { error: string | null; success: string | null }) { if (!error && !success) return null; return <p role="status" className={`rounded-[8px] border px-4 py-3 text-sm leading-6 ${error ? 'border-rust/20 bg-rust/8 text-ink' : 'border-needle/14 bg-needle/8 text-needle'}`}>{error || success}</p> }
function DisclosurePanel({ title, summary, children, defaultOpen = false }: { title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean }) { return <details open={defaultOpen} className="group rounded-[8px] border border-ink/8 bg-white/84 shadow-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:hidden"><span><span className="block text-sm font-semibold text-ink">{title}</span>{summary ? <span className="mt-1 block text-xs leading-5 text-ink/56">{summary}</span> : null}</span><span className="shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-needle group-open:hidden">Show</span><span className="hidden shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-ink/52 group-open:inline-flex">Hide</span></summary><div className="border-t border-ink/6 px-4 py-4">{children}</div></details> }
function SummaryLine({ label, value }: { label: string; value: ReactNode }) { return <div className="rounded-[8px] border border-ui-border bg-white p-4"><p className="text-xs font-semibold uppercase text-needle/72">{label}</p><div className="mt-2 text-sm font-semibold text-ink">{value ?? 'Not set'}</div></div> }

function hasMeasurements(profile: CustomerProfile | null) {
  return !!profile?.measurements && Object.keys(profile.measurements).length > 0
}
function measurementCompleteness(measurements: Record<string, unknown> | null | undefined) {
  return measurementCoreCompleteness(measurements)
}

function measurementProfileStatusCopy(completeness: ReturnType<typeof measurementCoreCompleteness>) {
  if (completeness.missing.length === 0) {
    return {
      lead: 'Measurements saved.',
      detail: 'Tailors can use this profile in briefs.',
    }
  }

  return {
    lead: `${completeness.present.length}/${CORE_MEASUREMENT_FIELDS.length} key measurements saved.`,
    detail: `Add: ${completeness.missing.map((field) => field.label).join(', ')}.`,
  }
}

const DRAPE_VISION_FIT_360_CAPTURE_METHOD = 'DRAPE_VISION_ROTATION'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFit360VisionProfile(measurements: Record<string, unknown>) {
  const latestFitProfile = isRecord(measurements.latestFitProfile) ? measurements.latestFitProfile : null
  return measurements.captureMethod === DRAPE_VISION_FIT_360_CAPTURE_METHOD ||
    latestFitProfile?.captureMethod === DRAPE_VISION_FIT_360_CAPTURE_METHOD ||
    measurements.scanFlow === 'FIT_TURN_360_V1' ||
    latestFitProfile?.scanFlow === 'FIT_TURN_360_V1'
}

function normalizeMeasurementRecord(measurements: Record<string, unknown> | null | undefined) {
  if (!measurements) return measurements
  const promoted = promoteSpecialistMeasurementsToProfileValues(measurements).measurements
  if (!isFit360VisionProfile(promoted)) return promoted
  return stripDrapeVisionFit360DraftFields(promoted)
}

function measurementsForProfile(profile: MeasurementProfile, customerProfile: CustomerProfile | null) {
  const shouldMergeLegacy =
    profile.is_default === true &&
    (!profile.relationship || profile.relationship === 'SELF')
  const measurements = shouldMergeLegacy
    ? mergeMeasurementRecords(customerProfile?.measurements, profile.measurements)
    : profile.measurements ?? {}
  return normalizeMeasurementRecord(measurements) ?? {}
}

const MEASUREMENT_FIELD_LABELS: Record<(typeof MEASUREMENT_FIELD_KEYS)[number], string> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulderWidth: 'Shoulder width',
  inseam: 'Inseam',
  sleeveLength: 'Sleeve length',
  neckCircumference: 'Neck circumference',
  underBust: 'Under bust',
  height: 'Height',
  backLength: 'Back length',
  outseam: 'Outseam',
  thighCircumference: 'Thigh circumference',
  kneeCircumference: 'Knee circumference',
  bicepCircumference: 'Bicep circumference',
  wristCircumference: 'Wrist circumference',
  palmWidth: 'Palm width',
  palmLength: 'Palm length',
  sleeveOpening: 'Sleeve opening',
  banglePassOver: 'Bangle pass-over',
  headCircumference: 'Head circumference',
  hatBandLine: 'Hat band line',
  headLength: 'Head length',
  headWidth: 'Head width',
  earToEarOverCrown: 'Ear to ear over crown',
  frontToBackOverCrown: 'Front to back over crown',
  filaHeight: 'Fila height',
  torsoLength: 'Torso length',
  ankleHemOpening: 'Ankle / hem opening',
}

const MEASUREMENT_PROFILE_METADATA_KEYS = new Set([
  'unit',
  'measurementProfileLabel',
  'measurementProfileUpdatedAt',
  'wearerContext',
  'fitStyle',
  'fitPassportVersion',
  'measurementSource',
  'measurementSourceLabel',
  'fitConfidence',
  'needsConfirmation',
  'confirmationReason',
  'confirmationFields',
  'confirmationRequestedAt',
  'confirmedAt',
  'confirmedBy',
  'confirmedFields',
  'garmentContext',
  'bodyShape',
  'fitFlags',
  'bodyNote',
  'bodyFlags',
  'symmetryFlags',
  'requiresTailorReview',
  'latestFitProfile',
  'specialistMeasurements',
  'visionSpecialistProfile',
  'latestSpecialistMeasurementScanId',
  'latestSpecialistScanMode',
  'latestSpecialistScanFlow',
  'latestSpecialistScanStatus',
  'latestSpecialistScanAt',
])

function hasEditableMeasurementValue(value: unknown) {
  if (value == null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim().length > 0
  return false
}

function measurementEditorValue(
  measurements: Record<string, unknown> | null | undefined,
  field: { key: string; aliases?: readonly string[] },
) {
  if (!measurements) return undefined
  const candidates = [field.key, ...(field.aliases ?? [])]
  return candidates.map((key) => measurements[key]).find(hasEditableMeasurementValue)
}

function isEditableCustomMeasurementKey(key: string, value: unknown): boolean {
  const isTransientMetadata = isTransientMeasurementMetadataKey(String(key))
  return !isMeasurementFieldKey(key) &&
    !MEASUREMENT_PROFILE_METADATA_KEYS.has(key) &&
    !isTransientMetadata &&
    hasEditableMeasurementValue(value)
}

function coreMeasurementSummary(measurements: Record<string, unknown> | null | undefined) {
  const normalizedMeasurements = normalizeMeasurementRecord(measurements)
  return CORE_MEASUREMENT_FIELDS.map((field) => {
    const value = readMeasurementValue(normalizedMeasurements, field)
    if (value == null) return null
    return `${field.label}: ${safeUserText(String(value), 'Saved')}`
  }).filter((value): value is string => Boolean(value))
}

const SPECIALIST_MEASUREMENT_META_KEYS = new Set([
  'unit',
  'cm',
  'title',
  'measurementScanId',
  'captureMethod',
  'captureMethodLabel',
  'captureVersion',
  'visionPipelineVersion',
  'outputKind',
  'scanFlow',
  'scanFlowLabel',
  'capturedAt',
  'confidenceOverall',
  'confidenceByField',
  'requiresTailorReview',
  'tapeInputsIn',
  'tapeSummary',
])

const SPECIALIST_SECTION_COPY: Record<string, { title: string; subtitle: string }> = {
  hand_wrist: {
    title: 'Hand & wrist scan',
    subtitle: 'Palm, cuff, bangle, and wrist values saved from Vision.',
  },
  headwear: {
    title: 'Headwear scan',
    subtitle: 'Head, crown, fila, and hat-band values saved from Vision.',
  },
  bodice_corset: {
    title: 'Bodice & corset scan',
    subtitle: 'Bodice, under-bust, torso, and ribcage values saved from Vision.',
  },
  lower_body_detail: {
    title: 'Hem & ankle openings',
    subtitle: 'Extra hem/opening values saved from the lower-body scan.',
  },
  fit_360: {
    title: 'Fit 360 scan',
    subtitle: 'Core body measurements saved from Vision.',
  },
}

const SPECIALIST_PROFILE_FIELD_ALIASES: Record<string, string> = {
  'Palm width': 'palmWidth',
  'Palm length': 'palmLength',
  'Sleeve opening': 'sleeveOpening',
  'Bangle pass-over': 'banglePassOver',
  'Bangle pass over': 'banglePassOver',
  ankleHem: 'ankleHemOpening',
  'Ankle / hem opening': 'ankleHemOpening',
}

function titleizeMeasurementKey(key: string) {
  if (isMeasurementFieldKey(key)) return MEASUREMENT_FIELD_LABELS[key]
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase())
}

function formatSpecialistMeasurementValue(value: unknown, unit: string) {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : null
  if (numericValue == null || !Number.isFinite(numericValue)) return null
  return `${numericValue.toFixed(2).replace(/\.?0+$/, '')} ${unit}`
}

function specialistMeasurementSections(measurements: Record<string, unknown> | null | undefined) {
  const normalizedMeasurements = normalizeMeasurementRecord(measurements)
  if (!normalizedMeasurements || !isRecord(normalizedMeasurements.specialistMeasurements)) return []
  return Object.entries(normalizedMeasurements.specialistMeasurements)
    .map(([mode, rawValue]) => {
      if (!isRecord(rawValue)) return null
      const unit = rawValue.unit === 'cm' ? 'cm' : 'in'
      const copy = SPECIALIST_SECTION_COPY[mode] ?? {
        title: typeof rawValue.title === 'string' && rawValue.title.trim()
          ? rawValue.title.trim()
          : titleizeMeasurementKey(mode),
        subtitle: 'Saved scan values for this profile.',
      }
      const values = Object.entries(rawValue)
        .filter(([key]) => {
          if (SPECIALIST_MEASUREMENT_META_KEYS.has(key)) return false
          return !isMeasurementFieldKey(SPECIALIST_PROFILE_FIELD_ALIASES[key] ?? key)
        })
        .map(([key, value]) => {
          const formattedValue = formatSpecialistMeasurementValue(value, unit)
          if (!formattedValue) return null
          return { key, label: titleizeMeasurementKey(key), value: formattedValue }
        })
        .filter((value): value is { key: string; label: string; value: string } => !!value)
      if (!values.length) return null
      return { id: mode, ...copy, values }
    })
    .filter((section): section is { id: string; title: string; subtitle: string; values: Array<{ key: string; label: string; value: string }> } => !!section)
}

function SpecialistMeasurementSections({ measurements }: { measurements: Record<string, unknown> | null | undefined }) {
  const sections = specialistMeasurementSections(measurements)
  if (sections.length === 0) return null

  return (
    <div className="mt-3 grid gap-2">
      {sections.map((section) => (
        <div key={section.id} className="rounded-lg border border-needle/12 bg-needle/8 p-3">
          <p className="text-sm font-semibold text-ink">{safeUserText(section.title, 'Vision scan')}</p>
          <p className="mt-1 text-xs leading-5 text-ink/54">{safeUserText(section.subtitle, 'Saved scan values for this profile.')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {section.values.map((value) => (
              <span key={`${section.id}:${value.key}`} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                {safeUserText(value.label, 'Measurement')}: {safeUserText(value.value, 'Saved')}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function preservedMeasurementMeta(measurements: Record<string, unknown> | null | undefined) {
  const normalizedMeasurements = normalizeMeasurementRecord(measurements)
  const meta: Record<string, unknown> = {}
  if (!normalizedMeasurements) return meta
  for (const key of [
    'latestFitProfile',
    'specialistMeasurements',
    'visionSpecialistProfile',
    'latestSpecialistMeasurementScanId',
    'latestSpecialistScanMode',
    'latestSpecialistScanFlow',
    'latestSpecialistScanStatus',
    'latestSpecialistScanAt',
    'bodyFlags',
    'symmetryFlags',
    'requiresTailorReview',
  ]) {
    if (normalizedMeasurements[key] != null) meta[key] = normalizedMeasurements[key]
  }
  return meta
}

function scanConfidenceLabel(value: string | null | undefined) {
  if (!value) return 'Confidence pending'
  const numeric = Number.parseFloat(value)
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return 'Good confidence'
    if (numeric >= 0.6) return 'Review recommended'
    return 'Needs review'
  }
  return cleanLabel(value, 'Confidence pending')
}

function fitPreferenceFromProfile(profile: CustomerProfile | null) {
  const measurements = profile?.measurements
  if (!measurements || typeof measurements !== 'object') return 'Fit preference not set'
  const candidate =
    measurements.fitPreference ??
    measurements.fit_style ??
    measurements.fitStyle ??
    measurements.fit
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? safeUserText(candidate, 'Fit preference saved')
    : 'Fit preference not set'
}


function ManualMeasurementEditor({ data, onRefresh }: { data: MeasurementsRenderData; onRefresh: () => void }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('Me')
  const [relationship, setRelationship] = useState('SELF')
  const [unit, setUnit] = useState('in')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [customMeasurements, setCustomMeasurements] = useState<Array<{ id: string; name: string; value: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const customMeasurementCounterRef = useRef(0)
  const coreFieldNames = CORE_MEASUREMENT_FIELDS
  const coreFieldKeys = new Set<string>(coreFieldNames.map((field) => field.key))
  const additionalFieldNames = MEASUREMENT_FIELD_KEYS
    .filter((key) => !coreFieldKeys.has(key))
    .map((key) => ({ key, label: MEASUREMENT_FIELD_LABELS[key] }))
  const allFieldNames = [...coreFieldNames, ...additionalFieldNames]

  function customMeasurementId() {
    customMeasurementCounterRef.current += 1
    return `custom_${customMeasurementCounterRef.current}`
  }

  function addCustomMeasurement(name = '', value = '') {
    setCustomMeasurements((current) => [...current, { id: customMeasurementId(), name, value }])
  }

  function updateCustomMeasurement(id: string, field: 'name' | 'value', value: string) {
    setCustomMeasurements((current) => current.map((measurement) => (
      measurement.id === id ? { ...measurement, [field]: value } : measurement
    )))
  }

  function removeCustomMeasurement(id: string) {
    setCustomMeasurements((current) => current.filter((measurement) => measurement.id !== id))
  }

  function startEdit(profile: MeasurementProfile) {
    const nextMeasurements = measurementsForProfile(profile, data.customerProfile)
    const specialistBackedKeys = specialistMeasurementProfileValueKeys(nextMeasurements)
    setEditingId(profile.id)
    setLabel(profile.label ?? 'Me')
    setRelationship(profile.relationship ?? 'SELF')
    setUnit(profile.unit_preference ?? data.customerProfile?.unit_preference ?? 'in')
    setFields(Object.fromEntries(allFieldNames.map((field) => {
      const value = measurementEditorValue(nextMeasurements, field)
      return [field.key, typeof value === 'number' || typeof value === 'string' ? String(value) : '']
    })))
    setCustomMeasurements(Object.entries(nextMeasurements)
      .filter(([key, value]) => !specialistBackedKeys.has(key) && isEditableCustomMeasurementKey(key, value))
      .map(([name, value]) => ({
        id: customMeasurementId(),
        name,
        value: String(value),
      })))
    setError(null)
    setSuccess(null)
    setEditorOpen(true)
  }

  function requestEdit(profile: MeasurementProfile) {
    startEdit(profile)
  }

  function startNewProfile() {
    resetForm()
    setError(null)
    setSuccess(null)
    setEditorOpen(true)
  }

  function closeEditor() {
    resetForm()
    setError(null)
    setEditorOpen(false)
  }

  function resetForm() {
    setEditingId(null)
    setLabel('Me')
    setRelationship('SELF')
    setUnit('in')
    setFields({})
    setCustomMeasurements([])
  }

  async function saveProfile() {
    setError(null)
    setSuccess(null)
    if (!data.userId) return
    const labelLeak = assertNoContactLeak(label, "Measurement profile names can't include contact details.")
    if (labelLeak) {
      setError(labelLeak)
      return
    }
    const numericMeasurements = Object.fromEntries(
      allFieldNames
        .map((field) => [field.key, Number.parseFloat(fields[field.key] ?? '')] as const)
        .filter(([, value]) => Number.isFinite(value) && value > 0),
    ) as Record<string, number>
    const coreMeasurementCount = coreFieldNames.filter((field) => {
      const value = numericMeasurements[field.key]
      return typeof value === 'number' && Number.isFinite(value) && value > 0
    }).length
    if (coreMeasurementCount < 4) {
      setError('Add at least height, chest, waist, and hips before saving a profile.')
      return
    }
    const customMeasurementPayload: Record<string, number> = {}
    const seenCustomNames = new Set<string>()
    for (const customMeasurement of customMeasurements) {
      const name = customMeasurement.name.trim()
      const rawValue = customMeasurement.value.trim()
      if (!name && !rawValue) continue
      if (!name || !rawValue) {
        setError('Each custom measurement needs both a name and a value.')
        return
      }
      const nameLeak = assertNoContactLeak(name, "Custom measurement names can't include contact details.")
      if (nameLeak) {
        setError(nameLeak)
        return
      }
      if (!isEditableCustomMeasurementKey(name, rawValue)) {
        setError('Use a normal measurement name for custom tape points.')
        return
      }
      const duplicateKey = name.toLowerCase()
      if (seenCustomNames.has(duplicateKey)) {
        setError('Custom measurement names must be unique.')
        return
      }
      const value = Number.parseFloat(rawValue)
      if (!Number.isFinite(value) || value <= 0) {
        setError('Custom measurement values must be positive numbers.')
        return
      }
      seenCustomNames.add(duplicateKey)
      customMeasurementPayload[name] = value
    }
    setBusy(true)
    const supabase = createClient()
    const now = new Date().toISOString()
    const trimmedLabel = label.trim() || 'Me'
    const editingProfile = data.measurementProfiles.find((profile) => profile.id === editingId)
    const existingMeasurements = editingProfile ? measurementsForProfile(editingProfile, data.customerProfile) : null
    const measurements = buildMeasurementProfileStoragePayload({
      ...preservedMeasurementMeta(existingMeasurements),
      ...numericMeasurements,
      ...customMeasurementPayload,
      unit,
      measurementSource: 'MANUAL',
      measurementProfileLabel: trimmedLabel,
      measurementProfileUpdatedAt: now,
    })
    const payload = {
      label: trimmedLabel,
      relationship,
      unit_preference: unit,
      source: 'MANUAL',
      measurements,
      last_measured_at: now,
      updated_at: now,
    }
    const shouldMirrorToCustomerProfile = editingId ? editingProfile?.is_default === true : data.measurementProfiles.length === 0
    const result = editingId
      ? await supabase.from('customer_measurement_profiles').update(payload).eq('id', editingId)
      : await supabase.from('customer_measurement_profiles').insert({
          ...payload,
          customer_id: data.userId,
          is_default: data.measurementProfiles.length === 0,
        })
    if (result.error) {
      setBusy(false)
      setError('Measurements could not save. Please refresh and try again.')
      return
    }
    if (shouldMirrorToCustomerProfile) {
      const mirrorResult = await supabase.from('customer_profiles').upsert(
        {
          user_id: data.userId,
          measurements,
          unit_preference: unit,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      )
      if (mirrorResult.error) {
        setBusy(false)
        setError('Measurements saved, but app profile sync could not finish. Refresh and try again.')
        onRefresh()
        return
      }
    }
    setBusy(false)
    setSuccess(editingId ? 'Measurement profile updated.' : 'Measurement profile saved.')
    resetForm()
    setEditorOpen(false)
    onRefresh()
  }

  if (!editorOpen) {
    return (
      <Surface className="grid gap-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Measurements</p>
          <h3 className="mt-1 text-xl font-semibold text-ink">Review saved profiles</h3>
          <p className="mt-2 text-sm leading-6 text-ink/62">
            Values stay read-only here until you choose to add or edit a profile.
          </p>
        </div>
        <ActionNotice error={error} success={success} />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button onClick={startNewProfile}>
            Add measurements
          </Button>
          {data.measurementProfiles.map((profile) => (
            <Button key={profile.id} variant="secondary" onClick={() => requestEdit(profile)}>
              Edit {safeUserText(profile.label, 'profile')}
            </Button>
          ))}
        </div>
      </Surface>
    )
  }

  return (
    <Surface className="grid gap-4 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Manual profile</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">{editingId ? 'Update wearer measurements' : 'Add wearer measurements'}</h3>
      </div>
      <ActionNotice error={error} success={success} />
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Profile name">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label="Wearer">
          <NativeSelect value={relationship} onChange={(event) => setRelationship(event.target.value)}>
            <option value="SELF">Me</option>
            <option value="SPOUSE">Spouse</option>
            <option value="PARENT">Parent</option>
            <option value="CHILD">Child</option>
            <option value="FRIEND">Friend</option>
            <option value="GROUP_MEMBER">Group member</option>
            <option value="OTHER">Someone else</option>
          </NativeSelect>
        </Field>
        <Field label="Unit">
          <NativeSelect value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="in">Inches</option>
            <option value="cm">Centimetres</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {coreFieldNames.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              inputMode="decimal"
              value={fields[field.key] ?? ''}
              onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </Field>
        ))}
      </div>
      <DisclosurePanel
        title="Additional measurements"
        summary="Add optional body areas or custom tape points a tailor asked for. Blank optional fields stay out of the saved profile."
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {additionalFieldNames.map((field) => (
              <Field key={field.key} label={field.label}>
                <Input
                  inputMode="decimal"
                  value={fields[field.key] ?? ''}
                  onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 rounded-[8px] border border-ink/6 bg-bone/35 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Custom tape points</p>
                <p className="mt-1 text-xs leading-5 text-ink/56">Use these for garment-specific points that are not listed above.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => addCustomMeasurement()} className="w-fit">
                Add custom point
              </Button>
            </div>
            {customMeasurements.length > 0 ? (
              <div className="grid gap-2">
                {customMeasurements.map((measurement) => (
                  <div key={measurement.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
                    <Input
                      value={measurement.name}
                      onChange={(event) => updateCustomMeasurement(measurement.id, 'name', event.target.value)}
                      placeholder="e.g. Ankle"
                    />
                    <Input
                      inputMode="decimal"
                      value={measurement.value}
                      onChange={(event) => updateCustomMeasurement(measurement.id, 'value', event.target.value)}
                      placeholder={`0 ${unit}`}
                    />
                    <Button variant="secondary" onClick={() => removeCustomMeasurement(measurement.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </DisclosurePanel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={saveProfile} disabled={busy}>
          {busy ? 'Saving...' : editingId ? 'Update profile' : 'Save profile'}
        </Button>
        <Button variant="secondary" onClick={closeEditor}>
          Cancel edit
        </Button>
      </div>
    </Surface>
  )
}


export function MeasurementsContent({ data, onRefresh }: { data: MeasurementsRenderData; onRefresh: () => void }) {
  const legacyMeasurementCount = hasMeasurements(data.customerProfile) ? 1 : 0
  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Named profiles" value={data.measurementProfiles.length} hint="Reusable wearer profiles" icon={<Users />} />
        <MetricCard label="Drapeon Vision scans" value={data.measurementScans.length} hint="Saved guided captures" icon={<ScanLine />} />
        <MetricCard label="Profile units" value={data.customerProfile?.unit_preference || data.measurementProfiles[0]?.unit_preference || 'Not set'} hint="Applied across measurements" icon={<Ruler />} />
      </section>
      <ManualMeasurementEditor data={data} onRefresh={onRefresh} />
      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Surface>
          <SurfaceHeader title="Wearer profiles" description="Review saved measurements before starting a custom brief." />
          <div className="grid gap-3 p-5">
            {data.measurementProfiles.length === 0 && legacyMeasurementCount === 0 ? (
              <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No measurement profiles yet. Add manual measurements or use Drapeon Vision in the app before starting a custom order.
              </p>
            ) : (
              <>
                {data.measurementProfiles.map((profile) => (
                  <div key={profile.id} className="rounded-[8px] border border-ui-border bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-ink">{safeUserText(profile.label, 'Measurement profile')}</h3>
                        <p className="mt-1 text-sm text-ink/60">
                          {cleanLabel(profile.relationship, 'Wearer')} · {cleanLabel(profile.source, 'Manual')}
                        </p>
                      </div>
                      <p className="text-xs font-semibold text-needle">{profile.is_default ? 'Default' : profile.unit_preference}</p>
                    </div>
                    {(() => {
                      const profileMeasurements = measurementsForProfile(profile, data.customerProfile)
                      const completeness = measurementCompleteness(profileMeasurements)
                      const statusCopy = measurementProfileStatusCopy(completeness)
                      const values = coreMeasurementSummary(profileMeasurements)
                      return (
                        <>
                          <div className="mt-3 rounded-[8px] bg-ui-muted px-3 py-2 text-xs leading-5 text-ink/58">
                            <span className="font-semibold text-ink">{statusCopy.lead}</span>
                            {` ${statusCopy.detail}`}
                          </div>
                          {values.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {values.slice(0, 7).map((value) => (
                                <span key={value} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <SpecialistMeasurementSections measurements={profileMeasurements} />
                        </>
                      )
                    })()}
                    <p className="mt-3 text-xs text-ink/46">
                      Last measured {formatDate(profile.last_measured_at ?? profile.updated_at) ?? 'recently'}
                    </p>
                  </div>
                ))}
                {legacyMeasurementCount > 0 ? (
                  <div className="rounded-[8px] border border-ui-border bg-white p-4">
                    <h3 className="font-semibold text-ink">Main customer measurements</h3>
                    <p className="mt-1 text-sm text-ink/60">Legacy profile · {fitPreferenceFromProfile(data.customerProfile)}</p>
                    {(() => {
                      const completeness = measurementCompleteness(data.customerProfile?.measurements)
                      const statusCopy = measurementProfileStatusCopy(completeness)
                      const values = coreMeasurementSummary(data.customerProfile?.measurements)
                      return (
                        <>
                          <div className="mt-3 rounded-[8px] bg-ui-muted px-3 py-2 text-xs leading-5 text-ink/58">
                            <span className="font-semibold text-ink">{statusCopy.lead}</span>
                            {` ${statusCopy.detail}`}
                          </div>
                          {values.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {values.slice(0, 7).map((value) => (
                                <span key={value} className="rounded-full border border-ink/8 bg-white px-3 py-1 text-xs text-ink/62">
                                  {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <SpecialistMeasurementSections measurements={data.customerProfile?.measurements} />
                        </>
                      )
                    })()}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Surface>
        <Surface>
          <SurfaceHeader
            title="Drapeon Vision"
            description="Guided scans stay linked to the wearer profile and can be reviewed before an order is placed."
            action={<OpenAppButton label="Open Drapeon Vision" />}
          />
          <div className="grid gap-3 p-5">
            {data.measurementScans.length === 0 ? (
              <p className="rounded-[8px] bg-white/70 p-4 text-sm leading-6 text-ink/62">No scan records yet.</p>
            ) : (
              data.measurementScans.map((scan) => (
                <SummaryLine
                  key={scan.id}
                  label={cleanLabel(scan.capture_method, 'Scan')}
                  value={<span className="flex flex-wrap items-center gap-2"><StatusChip status={scan.status} fallback="Captured" /><span>{scanConfidenceLabel(scan.confidence_overall)}</span></span>}
                />
              ))
            )}
          </div>
        </Surface>
      </section>
    </div>
  )
}
