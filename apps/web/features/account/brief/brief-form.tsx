'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BULK_FABRIC_MODE_OPTIONS,
  CUSTOM_ORDER_DRAFT_VERSION,
  CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS,
  CUSTOM_ORDER_GARMENT_TAXONOMY,
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_MAX_STYLE_LINKS,
  FABRIC_SUBSTITUTION_OPTIONS,
  SUPPORTED_ACCOUNT_CURRENCIES,
  customOrderMinimumDeliveryDate,
  customOrderDefaultDeadline,
  fulfillmentEligibilityCopy,
  getCustomOrderFabricIssues,
  isAllowedCustomStyleReference,
  isCustomOrderBriefLongEnough,
  isMeaningfulCustomOrderDraft,
  normalizeAccountCurrency,
  normalizePhoneForStorage,
  parseMoneyInputToMinorUnits,
  validatePhoneForProfile,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
  type FulfillmentEligibilityResult,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { safeEntityName, safeUserText } from '../../../lib/safe-display'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { MoneyInput } from '../../../components/money-input'
import { StructuredAddressSearch } from '../../../components/structured-address-search'
import { Button } from '../../../components/ui/button'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'

export type BriefCustomerProfile = {
  user_id: string
  display_name: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  updated_at: string | null
}

export type BriefMeasurementProfile = {
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

export type BriefTailorProfile = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
  location: string | null
  specialty_tags: string[] | null
  currency: string | null
  availability: string | null
  accepts_custom_orders_now?: boolean | null
  shop_paused?: boolean | null
  is_live: boolean | null
  supports_custom_orders: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  portfolio_photo_urls: string[] | null
  avatar_url: string | null
}

type TailorProfile = BriefTailorProfile

const GROUP_ORDERS_ENABLED = process.env.NEXT_PUBLIC_GROUP_ORDERS_V1 === 'true'
const MAX_WEB_FABRIC_REFERENCE_MEDIA = 4
const WEB_OCCASION_OPTIONS = ['Wedding', 'Birthday', 'Event', 'Everyday', 'Business', 'Religious ceremony', 'Graduation', 'Travel', 'Funeral', 'Other']
const MESSAGE_PHOTO_MAX_BYTES = 10 * 1024 * 1024
const MESSAGE_PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ORDER_EVIDENCE_CONTENT_TYPES = new Set<string>(ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES)

function accountRoute(path: string): Route { return path as Route }
function cleanLabel(value: string | null | undefined, fallback = 'Not set') { return value?.trim() || fallback }
function safeList(value: string[] | null | undefined, fallback = 'Not listed') { return value?.filter(Boolean).join(' · ') || fallback }
function tailorPhoto(tailor: BriefTailorProfile) { return tailor.portfolio_photo_urls?.find(Boolean) ?? tailor.avatar_url ?? null }
function canStartCustomBriefOnWeb(tailor: BriefTailorProfile, userId: string | null) {
  return tailor.is_live === true && tailor.supports_custom_orders === true && tailor.accepts_custom_orders_now !== false && tailor.availability !== 'FULLY_BOOKED' && tailor.user_id !== userId
}
function customBriefUnavailableLabel(tailor: BriefTailorProfile, userId: string | null) {
  if (tailor.user_id === userId) return 'Your tailor profile'
  if (tailor.accepts_custom_orders_now === false) return 'Custom orders paused'
  if (tailor.availability === 'FULLY_BOOKED') return 'Fully booked'
  return 'Custom orders unavailable'
}
function defaultDeadlineInput() { return customOrderDefaultDeadline().toISOString().slice(0, 10) }
function minimumDeadlineInput() { return customOrderMinimumDeliveryDate().toISOString().slice(0, 10) }
function dateInputToIso(value: string) { if (!value) return null; const date = new Date(`${value}T12:00:00.000Z`); return Number.isNaN(date.getTime()) ? null : date.toISOString() }
function linesToUrls(value: string) { return value.split(/\s+/u).map((entry) => entry.trim()).filter(Boolean) }
function parseMinorUnits(value: string) { return parseMoneyInputToMinorUnits(value) }
function assertNoContactLeak(value: string, fallback?: string) { const filtered = filterContactInfo(value); return filtered.blocked ? fallback ?? filtered.userMessage : null }
function rawErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (!error || typeof error !== 'object') return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}
function isDisplayableFunctionError(value: string) {
  const trimmed = value.trim()
  if (/^[A-Z0-9_:-]+$/u.test(trimmed) && !trimmed.includes(' ')) return false
  if (['database error', 'internal error', 'internal server error', 'unauthorized', 'forbidden', 'not found'].includes(trimmed.toLowerCase())) return false
  const normalized = trimmed.toLowerCase()
  return !normalized.startsWith('validation error') && !normalized.includes('invalid discriminator') && !normalized.includes('expected ') && !normalized.includes('received ')
}
function friendlyActionError(error: unknown, fallback = 'That action could not finish right now. Please try again.') {
  const raw = rawErrorMessage(error)
  const normalized = raw?.toLowerCase() ?? ''
  if (['network request failed', 'failed to fetch', 'fetch failed', 'networkerror', 'timed out', 'connection lost', 'offline'].some((pattern) => normalized.includes(pattern))) {
    return 'Connection looks weak. Your details are still here, so retry when the signal improves.'
  }
  const message = raw?.replace(/^FunctionsHttpError:\s*/iu, '').trim()
  return message && isDisplayableFunctionError(message) ? message : fallback
}
async function functionHttpErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || typeof (context as { clone?: unknown }).clone !== 'function') return null
  try {
    const text = await (context as Response).clone().text()
    if (!text.trim()) return null
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown }
      const candidate = typeof parsed.message === 'string' ? parsed.message : typeof parsed.error === 'string' ? parsed.error : null
      return candidate?.trim() && isDisplayableFunctionError(candidate) ? candidate.trim() : null
    } catch { return isDisplayableFunctionError(text.trim()) ? text.trim() : null }
  } catch { return null }
}
async function invokeAccountFunction<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = createClient()
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw new Error((await functionHttpErrorMessage(error)) ?? friendlyActionError(error))
  const payload = (data ?? {}) as Record<string, unknown>
  if (payload.error) throw new Error(typeof payload.message === 'string' ? payload.message : typeof payload.error === 'string' ? payload.error : 'That action could not finish right now.')
  return payload as T
}
function validateMessagePhoto(file: File) {
  if (!MESSAGE_PHOTO_CONTENT_TYPES.has(file.type)) return 'Choose a JPEG, PNG, or WebP image.'
  if (file.size > MESSAGE_PHOTO_MAX_BYTES) return 'Choose a photo under 10 MB.'
  return null
}
async function mediaDuration(file: File) {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<number>((resolve, reject) => {
      const media = document.createElement('video')
      media.preload = 'metadata'
      media.onloadedmetadata = () => resolve(media.duration)
      media.onerror = () => reject(new Error('Video metadata could not be read.'))
      media.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}
async function reencodeImageFile(file: File) {
  if (!file.type.startsWith('image/')) return file
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new window.Image()
      candidate.onload = () => resolve(candidate)
      candidate.onerror = () => reject(new Error('The image could not be prepared.'))
      candidate.src = url
    })
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob) throw new Error('The image could not be prepared.')
    return new File([blob], `${file.name.replace(/\.[^.]+$/u, '') || 'brief-photo'}.jpg`, { type: 'image/jpeg' })
  } finally { URL.revokeObjectURL(url) }
}
async function prepareOrderEvidenceFile(file: File) {
  const contentType = file.type.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ORDER_EVIDENCE_CONTENT_TYPES.has(contentType)) throw new Error('That file type is not supported here. Please choose a photo or video from your device.')
  if (contentType.startsWith('video/')) {
    if (!ALLOWED_VIDEO_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number])) throw new Error('Choose an MP4 or MOV video.')
    if (file.size > MEDIA_LIMITS_BYTES.orderUpdateVideo) throw new Error(`Choose videos under ${Math.round(MEDIA_LIMITS_BYTES.orderUpdateVideo / (1024 * 1024))} MB.`)
    if ((await mediaDuration(file)) > MEDIA_LIMITS_SECONDS.orderUpdateVideo) throw new Error(OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE)
    return file
  }
  if (file.size > MEDIA_LIMITS_BYTES.image) throw new Error('Choose a photo under 10 MB.')
  return reencodeImageFile(file)
}
async function uploadPublicFile(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/gu, '') || 'jpg'
  const path = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream', cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable, upsert: false })
  if (error) throw new Error('The media could not upload. Try a smaller file.')
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <section className="app-surface p-7"><h2 className="text-2xl font-semibold text-ink">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-ink/62">{body}</p>{action ? <div className="mt-5">{action}</div> : null}</section>
}
function ActionNotice({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) return null
  return <p role="status" className={`rounded-[8px] border px-4 py-3 text-sm ${error ? 'border-rust/20 bg-rust/6 text-rust' : 'border-needle/20 bg-needle/8 text-ink'}`}>{error ?? success}</p>
}
function PhotoTile({ src, label }: { src: string | null; label: string }) {
  return src ? <Image src={src} alt={label} width={720} height={540} unoptimized className="aspect-[4/3] w-full rounded-[8px] object-cover" /> : <div className="grid aspect-[4/3] place-items-center rounded-[8px] bg-needle/8 text-sm text-ink/48">No image</div>
}

export type BriefRenderData = {
  tailor: BriefTailorProfile | null
  measurementProfiles: BriefMeasurementProfile[]
  userId: string | null
  accountCurrency: string | null
  customerProfile: BriefCustomerProfile | null
  warning: string | null
}

function measurementSnapshotForChoice(data: Pick<BriefRenderData, 'customerProfile' | 'measurementProfiles'>, choice: string) {
  if (choice === 'legacy' && data.customerProfile?.measurements) {
    return {
      ...data.customerProfile.measurements,
      measurementSource: 'web_legacy_customer_profile',
      unit: data.customerProfile.unit_preference ?? (data.customerProfile.measurements.unit as string | undefined) ?? 'in',
      measurementProfileLabel: 'Customer profile',
      measurementProfileUpdatedAt: data.customerProfile.updated_at,
    }
  }
  const profile = data.measurementProfiles.find((entry) => entry.id === choice)
  if (!profile?.measurements) return null
  return {
    ...profile.measurements,
    measurementSource: `web_${profile.source ?? 'measurement_profile'}`,
    unit: profile.unit_preference ?? (profile.measurements.unit as string | undefined) ?? 'in',
    measurementProfileId: profile.id,
    measurementProfileLabel: profile.label ?? 'Saved measurement profile',
    measurementProfileUpdatedAt: profile.updated_at ?? profile.last_measured_at,
  }
}

function measurementTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  for (const field of ['measurementProfileUpdatedAt', 'capturedAt', 'confirmedAt']) {
    const raw = snapshot[field]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const date = new Date(raw)
    if (Number.isFinite(date.getTime())) return date
  }
  return null
}

function measurementAgeFromSnapshot(value: unknown, now = new Date()) {
  const lastUpdated = measurementTimestamp(value)
  if (!lastUpdated) return null
  const ageMonths = Math.max(0, Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
  return {
    lastUpdatedAt: lastUpdated.toISOString(),
    ageMonths,
    stale: ageMonths >= 6,
    warningShown: ageMonths >= 6,
  }
}

function defaultDeliveryMethodForTailor(tailor: TailorProfile | null | undefined) {
  if (tailor?.pickup_available) return 'LOCAL_COLLECTION'
  if (tailor?.delivery_available) return 'LOCAL_DELIVERY'
  return 'SHIPPING'
}

export function BriefForm({ data, tailorId, onRefresh }: { data: BriefRenderData; tailorId?: string; onRefresh: () => void }) {
  const router = useRouter()
  const tailor = data.tailor
  const firstMeasurementId = data.measurementProfiles[0]?.id ?? (data.customerProfile?.measurements ? 'legacy' : 'fallback')
  const [garmentType, setGarmentType] = useState('')
  const [garmentTypeOther, setGarmentTypeOther] = useState('')
  const [genderPresentation, setGenderPresentation] = useState<'Menswear' | 'Womenswear' | 'Unisex'>('Unisex')
  const [description, setDescription] = useState('')
  const [occasion, setOccasion] = useState('Event')
  const [occasionOther, setOccasionOther] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadlineInput)
  const [wearerMode, setWearerMode] = useState<'SELF' | 'OTHER' | 'GROUP'>('SELF')
  const [wearerName, setWearerName] = useState('')
  const [bulkRecipientCount, setBulkRecipientCount] = useState('')
  const [bulkLabel, setBulkLabel] = useState('')
  const [bulkMemberNames, setBulkMemberNames] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [styleLinks, setStyleLinks] = useState('')
  const [styleNotes, setStyleNotes] = useState('')
  const [fitNote, setFitNote] = useState('')
  const [measurementChoice, setMeasurementChoice] = useState(firstMeasurementId)
  const [referencePhotos, setReferencePhotos] = useState<File[]>([])
  const [fabricSource, setFabricSource] = useState<'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'>('TAILOR_SOURCES')
  const [fabricDescription, setFabricDescription] = useState('')
  const [fabricBudget, setFabricBudget] = useState('')
  const [fabricBudgetCurrency, setFabricBudgetCurrency] = useState(normalizeAccountCurrency(data.accountCurrency ?? tailor?.currency ?? 'USD') ?? 'USD')
  const [fabricReferenceFiles, setFabricReferenceFiles] = useState<File[]>([])
  const [fabricReferenceLinksInput, setFabricReferenceLinksInput] = useState('')
  const [fabricSubstitutionPreference, setFabricSubstitutionPreference] = useState('')
  const [bulkFabricMode, setBulkFabricMode] = useState('')
  const [fabricVendorName, setFabricVendorName] = useState('')
  const [fabricVendorLocation, setFabricVendorLocation] = useState('')
  const [fabricVendorLink, setFabricVendorLink] = useState('')
  const [fabricVendorNotes, setFabricVendorNotes] = useState('')
  const [fabricSourcingDeadlineDays, setFabricSourcingDeadlineDays] = useState(CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS)
  const [deliveryMethod, setDeliveryMethod] = useState<'LOCAL_COLLECTION' | 'LOCAL_DELIVERY' | 'SHIPPING'>(defaultDeliveryMethodForTailor(tailor))
  const [shippingPreference, setShippingPreference] = useState<'STANDARD' | 'EXPRESS'>('STANDARD')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [recipientName, setRecipientName] = useState(data.customerProfile?.display_name ?? '')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryRegion, setDeliveryRegion] = useState('')
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('')
  const [deliveryCountryCode, setDeliveryCountryCode] = useState('US')
  const [deliveryVerificationSource, setDeliveryVerificationSource] = useState('')
  const [deliveryVerificationReference, setDeliveryVerificationReference] = useState('')
  const [deliveryVerifiedAt, setDeliveryVerifiedAt] = useState('')
  const [fulfillmentEligibility, setFulfillmentEligibility] = useState<FulfillmentEligibilityResult | null>(null)
  const [checkingFulfillment, setCheckingFulfillment] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<'loading' | 'restored' | 'saving' | 'saved' | 'error' | null>(null)
  const [draftAttachmentWarning, setDraftAttachmentWarning] = useState(false)
  const draftLoadStartedRef = useRef(false)
  const draftHydratedRef = useRef(false)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const fabricMediaInputRef = useRef<HTMLInputElement | null>(null)

  const draftFields = useMemo(() => ({
    garmentType, garmentTypeOther, genderPresentation, description, occasion, occasionOther,
    deadline, wearerMode, wearerName, bulkRecipientCount, bulkLabel, bulkMemberNames,
    bulkNotes, styleLinks, styleNotes, fitNote, measurementChoice, fabricSource,
    fabricDescription, fabricBudget, fabricBudgetCurrency, fabricReferenceLinksInput,
    fabricSubstitutionPreference, bulkFabricMode, fabricVendorName, fabricVendorLocation,
    fabricVendorLink, fabricVendorNotes, fabricSourcingDeadlineDays, deliveryMethod,
    shippingPreference, deliveryInstructions, recipientName, recipientPhone, deliveryAddress,
    deliveryCity, deliveryRegion, deliveryPostalCode, deliveryCountryCode,
    deliveryVerificationSource, deliveryVerifiedAt, acknowledged,
  }), [
    garmentType, garmentTypeOther, genderPresentation, description, occasion, occasionOther,
    deadline, wearerMode, wearerName, bulkRecipientCount, bulkLabel, bulkMemberNames,
    bulkNotes, styleLinks, styleNotes, fitNote, measurementChoice, fabricSource,
    fabricDescription, fabricBudget, fabricBudgetCurrency, fabricReferenceLinksInput,
    fabricSubstitutionPreference, bulkFabricMode, fabricVendorName, fabricVendorLocation,
    fabricVendorLink, fabricVendorNotes, fabricSourcingDeadlineDays, deliveryMethod,
    shippingPreference, deliveryInstructions, recipientName, recipientPhone, deliveryAddress,
    deliveryCity, deliveryRegion, deliveryPostalCode, deliveryCountryCode,
    deliveryVerificationSource, deliveryVerifiedAt, acknowledged,
  ])

  useEffect(() => {
    if (!tailorId || draftLoadStartedRef.current) return
    draftLoadStartedRef.current = true
    setDraftStatus('loading')
    void invokeAccountFunction<{ draft?: { version: string; fields: Record<string, unknown>; has_device_only_attachments: boolean } | null }>('custom-order-draft-action', {
      action: 'load', tailorProfileId: tailorId,
    }).then((result) => {
      const draft = result.draft
      if (!draft || draft.version !== CUSTOM_ORDER_DRAFT_VERSION) { draftHydratedRef.current = true; setDraftStatus(null); return }
      const f = draft.fields ?? {}
      const text = (key: string) => typeof f[key] === 'string' ? f[key] as string : ''
      setGarmentType(text('garmentType')); setGarmentTypeOther(text('garmentTypeOther'))
      if (f.genderPresentation === 'Menswear' || f.genderPresentation === 'Womenswear' || f.genderPresentation === 'Unisex') setGenderPresentation(f.genderPresentation)
      setDescription(text('description')); setOccasion(text('occasion') || 'Event'); setOccasionOther(text('occasionOther'))
      setDeadline(text('deadline') || defaultDeadlineInput());
      if (f.wearerMode === 'SELF' || f.wearerMode === 'OTHER' || (GROUP_ORDERS_ENABLED && f.wearerMode === 'GROUP')) setWearerMode(f.wearerMode)
      setWearerName(text('wearerName')); setBulkRecipientCount(text('bulkRecipientCount')); setBulkLabel(text('bulkLabel'))
      setBulkMemberNames(text('bulkMemberNames')); setBulkNotes(text('bulkNotes')); setStyleLinks(text('styleLinks'))
      setStyleNotes(text('styleNotes')); setFitNote(text('fitNote')); setMeasurementChoice(text('measurementChoice') || firstMeasurementId)
      if (f.fabricSource === 'TAILOR_SOURCES' || f.fabricSource === 'CUSTOMER_SUPPLIES') setFabricSource(f.fabricSource)
      setFabricDescription(text('fabricDescription')); setFabricBudget(text('fabricBudget'))
      if (typeof f.fabricBudgetCurrency === 'string') setFabricBudgetCurrency(normalizeAccountCurrency(f.fabricBudgetCurrency) ?? fabricBudgetCurrency)
      setFabricReferenceLinksInput(text('fabricReferenceLinksInput')); setFabricSubstitutionPreference(text('fabricSubstitutionPreference'))
      setBulkFabricMode(text('bulkFabricMode')); setFabricVendorName(text('fabricVendorName')); setFabricVendorLocation(text('fabricVendorLocation'))
      setFabricVendorLink(text('fabricVendorLink')); setFabricVendorNotes(text('fabricVendorNotes'))
      if (typeof f.fabricSourcingDeadlineDays === 'number') setFabricSourcingDeadlineDays(f.fabricSourcingDeadlineDays)
      if (f.deliveryMethod === 'LOCAL_COLLECTION' || f.deliveryMethod === 'LOCAL_DELIVERY' || f.deliveryMethod === 'SHIPPING') setDeliveryMethod(f.deliveryMethod)
      if (f.shippingPreference === 'STANDARD' || f.shippingPreference === 'EXPRESS') setShippingPreference(f.shippingPreference)
      setDeliveryInstructions(text('deliveryInstructions')); setRecipientName(text('recipientName')); setRecipientPhone(text('recipientPhone'))
      setDeliveryAddress(text('deliveryAddress')); setDeliveryCity(text('deliveryCity')); setDeliveryRegion(text('deliveryRegion'))
      setDeliveryPostalCode(text('deliveryPostalCode')); setDeliveryCountryCode(text('deliveryCountryCode') || 'US')
      setDeliveryVerificationSource(text('deliveryVerificationSource'))
      setDeliveryVerifiedAt(text('deliveryVerifiedAt'))
      setAcknowledged(f.acknowledged === true); setDraftAttachmentWarning(draft.has_device_only_attachments); draftHydratedRef.current = true; setDraftStatus('restored')
    }).catch(() => { draftHydratedRef.current = true; setDraftStatus('error') })
  }, [fabricBudgetCurrency, firstMeasurementId, tailorId])

  useEffect(() => {
    if (!tailorId || !draftHydratedRef.current || busy || !isMeaningfulCustomOrderDraft(draftFields)) return
    setDraftStatus((current) => current === 'restored' ? current : 'saving')
    const timer = window.setTimeout(() => {
      void invokeAccountFunction('custom-order-draft-action', {
        action: 'save', tailorProfileId: tailorId, version: CUSTOM_ORDER_DRAFT_VERSION,
        currentStep: 0, fields: draftFields,
        hasDeviceOnlyAttachments: referencePhotos.length > 0 || fabricReferenceFiles.length > 0,
      }).then(() => setDraftStatus('saved')).catch(() => setDraftStatus('error'))
    }, 650)
    return () => window.clearTimeout(timer)
  }, [busy, draftFields, fabricReferenceFiles.length, referencePhotos.length, tailorId])

  if (!tailor || !tailorId) {
    return (
      <EmptyState
        title="Tailor not found."
        body="Choose a tailor before starting a custom brief."
        action={<Link href="/account/explore" className="font-semibold text-needle">Back to Explore</Link>}
      />
    )
  }

  if (tailor.supports_custom_orders !== true) {
    return (
      <EmptyState
        title="Custom orders are not listed for this tailor."
        body="Browse ready-made pieces or open the app if you already have an active order with this tailor."
        action={<Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="font-semibold text-needle">Back to profile</Link>}
      />
    )
  }

  if (!canStartCustomBriefOnWeb(tailor, data.userId)) {
    return (
      <EmptyState
        title={customBriefUnavailableLabel(tailor, data.userId)}
        body="This tailor is not accepting new custom briefs from this account right now. You can review the profile, save the tailor, or browse other available tailors."
        action={<Link href={accountRoute(`/account/tailors/${tailor.id}`)} className="font-semibold text-needle">Back to profile</Link>}
      />
    )
  }

  const selectedTailor = tailor
  const baseMeasurementSnapshot = measurementChoice === 'fallback' ? null : measurementSnapshotForChoice(data, measurementChoice)
  const styleReferenceLinks = linesToUrls(styleLinks)
  const fabricReferenceLinks = linesToUrls(fabricReferenceLinksInput)
  const needsDeliveryDetails = deliveryMethod !== 'LOCAL_COLLECTION'
  const fabricBudgetAmount = parseMinorUnits(fabricBudget)
  const selectedFabricSubstitution = FABRIC_SUBSTITUTION_OPTIONS.find((option) => option.value === fabricSubstitutionPreference)
  const selectedBulkFabricMode = BULK_FABRIC_MODE_OPTIONS.find((option) => option.value === bulkFabricMode)

  function clearWebDeliveryVerification() {
    setDeliveryVerificationSource('')
    setDeliveryVerificationReference('')
    setDeliveryVerifiedAt('')
    setFulfillmentEligibility(null)
  }

  async function resolveWebFulfillment(
    method: typeof deliveryMethod,
    verifiedAt = deliveryVerifiedAt,
    verificationSource = deliveryVerificationSource,
  ) {
    if (checkingFulfillment) return null
    setCheckingFulfillment(true)
    try {
      const result = await invokeAccountFunction<{ fulfillment?: FulfillmentEligibilityResult }>('custom-order-draft-action', {
        action: 'resolve-fulfillment',
        tailorProfileId: selectedTailor.id,
        method,
        destination: method === 'LOCAL_COLLECTION' ? null : {
          addressLine1: deliveryAddress.trim(),
          city: deliveryCity.trim(),
          regionCode: deliveryRegion.trim(),
          postalCode: deliveryPostalCode.trim(),
          countryCode: deliveryCountryCode.trim().toUpperCase(),
          verificationSource,
          verificationReference: deliveryVerificationReference || null,
          verifiedAt,
        },
      })
      const fulfillment = result.fulfillment ?? null
      setFulfillmentEligibility(fulfillment)
      if (fulfillment?.status === 'BLOCKED' && fulfillment.reason === 'LOCAL_DELIVERY_COUNTRY_MISMATCH') {
        const switchToShipping = window.confirm(
          `This address is outside ${fulfillment.originCountryCode ?? 'the tailor’s country'}. Switch to international shipping?`,
        )
        if (switchToShipping) {
          setDeliveryMethod('SHIPPING')
          setCheckingFulfillment(false)
          return await resolveWebFulfillment('SHIPPING', verifiedAt, verificationSource)
        }
      }
      return fulfillment
    } catch {
      setError('Could not check this fulfillment option right now.')
      return null
    } finally {
      setCheckingFulfillment(false)
    }
  }

  async function confirmWebDeliveryAddress() {
    if (!deliveryAddress.trim() || !deliveryCity.trim() || !deliveryRegion.trim() || !/^[A-Za-z]{2}$/u.test(deliveryCountryCode.trim())) {
      setError('Add the full delivery address and 2-letter country code first.')
      return
    }
    setError(null)
    const verifiedAt = new Date().toISOString()
    setDeliveryVerificationSource('CUSTOMER_CONFIRMED_STRUCTURED')
    setDeliveryVerifiedAt(verifiedAt)
    await resolveWebFulfillment(deliveryMethod, verifiedAt, 'CUSTOMER_CONFIRMED_STRUCTURED')
  }

  async function submitBrief() {
    setError(null)
    setSuccess(null)
    setCreatedOrderId(null)
    if (wearerMode === 'GROUP' && !GROUP_ORDERS_ENABLED) {
      setError('Group orders are not available yet. Send one custom request for one wearer, or contact Drapeon Support for a coordinated order.')
      setWearerMode('SELF')
      return
    }
    const deadlineIso = dateInputToIso(deadline)
    const deadlineDate = deadlineIso ? new Date(deadlineIso) : null
    const normalizedRecipientPhone = needsDeliveryDetails ? normalizePhoneForStorage(recipientPhone) : ''

    const textToCheck = [
      description,
      styleNotes,
      fitNote,
      fabricDescription,
      fabricVendorName,
      fabricVendorLocation,
      fabricVendorNotes,
      wearerName,
      bulkLabel,
      bulkMemberNames,
      bulkNotes,
      deliveryInstructions,
      deliveryAddress,
      deliveryCity,
      deliveryRegion,
      recipientName,
    ].join('\n')
    const leak = assertNoContactLeak(textToCheck, "Briefs can't include phone numbers, emails, links, social handles, or off-platform contact instructions.")
    if (leak) {
      setError(leak)
      return
    }
    if (!isCustomOrderBriefLongEnough(description)) {
      setError('Write one clear paragraph, or at least 3 short lines, describing the garment.')
      return
    }
    if (!garmentType) {
      setError('Choose the type of garment you want made.')
      return
    }
    if (!deadlineDate || Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() < customOrderMinimumDeliveryDate().getTime()) {
      setError('Target delivery date must be at least 2 weeks from today.')
      return
    }
    if (garmentType === 'Other' && !garmentTypeOther.trim()) {
      setError('Describe the garment type when choosing Other.')
      return
    }
    if (styleReferenceLinks.length > CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setError(`Add no more than ${CUSTOM_ORDER_MAX_STYLE_LINKS} style links. Remove extra links before submitting.`)
      return
    }
    if (styleReferenceLinks.length === 0 && referencePhotos.length === 0) {
      setError('Add at least one Instagram, Pinterest, or TikTok reference link, or attach a reference photo.')
      return
    }
    const unsupportedStyleLink = styleReferenceLinks.find((link) => !isAllowedCustomStyleReference(link))
    if (unsupportedStyleLink) {
      setError('Style links must be from Instagram, Pinterest, or TikTok.')
      return
    }
    if (fabricReferenceLinks.length > CUSTOM_ORDER_MAX_STYLE_LINKS) {
      setError('Add no more than ' + CUSTOM_ORDER_MAX_STYLE_LINKS + ' fabric links. Remove extra links before submitting.')
      return
    }
    const unsupportedFabricLink = fabricReferenceLinks.find((link) => !isAllowedCustomStyleReference(link))
    if (unsupportedFabricLink) {
      setError('Fabric links must be from Instagram, Pinterest, or TikTok.')
      return
    }
    if (fabricReferenceFiles.length > MAX_WEB_FABRIC_REFERENCE_MEDIA) {
      setError('Add no more than ' + MAX_WEB_FABRIC_REFERENCE_MEDIA + ' fabric media files.')
      return
    }
    let normalizedFabricVendorLink: string | null = null
    if (fabricVendorLink.trim()) {
      try {
        const trimmedVendorLink = fabricVendorLink.trim()
        const url = new URL(trimmedVendorLink.startsWith('http://') || trimmedVendorLink.startsWith('https://') ? trimmedVendorLink : 'https://' + trimmedVendorLink)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported vendor link')
        normalizedFabricVendorLink = url.toString()
      } catch {
        setError('Enter a valid vendor website or social link.')
        return
      }
    }
    if (wearerMode === 'OTHER' && wearerName.trim().length < 2) {
      setError('Add the wearer name for this brief.')
      return
    }
    const bulkCount = Number.parseInt(bulkRecipientCount, 10)
    if (wearerMode === 'GROUP' && (!Number.isFinite(bulkCount) || bulkCount < 2)) {
      setError('Add at least 2 wearers for a group order.')
      return
    }
    if (!baseMeasurementSnapshot) {
      setError('Add saved measurements before submitting. This gives your tailor the fit context they need for an accurate quote.')
      return
    }
    if (fitNote.trim().length < 20) {
      setError('Add a fit note with at least 20 characters before submitting.')
      return
    }
    const fabricIssues = getCustomOrderFabricIssues({
      fabricSource,
      fabricDescription,
      fabricBudgetAmount,
      fabricBudgetCurrency,
      fabricReferenceMediaCount: fabricReferenceFiles.length,
      fabricReferenceLinkCount: fabricReferenceLinks.length,
      fabricSubstitutionPreference,
      fabricHandoffMode: fabricSource === 'CUSTOMER_SUPPLIES' ? 'CUSTOMER_TO_TAILOR' : null,
      isBulkOrder: wearerMode === 'GROUP',
      bulkRecipientCount: Number.isFinite(bulkCount) ? bulkCount : null,
      bulkFabricMode,
      suggestedVendorName: fabricVendorName,
      suggestedVendorLocation: fabricVendorLocation,
      suggestedVendorLink: normalizedFabricVendorLink,
      suggestedVendorNotes: fabricVendorNotes,
    })
    const firstFabricIssue = fabricIssues[0]
    if (firstFabricIssue) {
      setError(firstFabricIssue.message)
      return
    }
    for (const photo of referencePhotos) {
      const photoError = validateMessagePhoto(photo)
      if (photoError) {
        setError(photoError)
        return
      }
    }
    if (needsDeliveryDetails && (!recipientName.trim() || !deliveryAddress.trim() || !deliveryCity.trim() || !deliveryRegion.trim() || !deliveryCountryCode.trim())) {
      setError('Add the full delivery address before submitting. Street, city, region, and country are required.')
      return
    }
    const recipientPhoneError = needsDeliveryDetails ? validatePhoneForProfile(normalizedRecipientPhone) : null
    if (recipientPhoneError) {
      setError(recipientPhoneError)
      return
    }
    if (!acknowledged) {
      setError('Review and acknowledge the cancellation and handoff policy before submitting.')
      return
    }
    const eligibility = await resolveWebFulfillment(deliveryMethod)
    if (!eligibility || eligibility.status !== 'ELIGIBLE') {
      if (eligibility) setError(fulfillmentEligibilityCopy(eligibility))
      return
    }

    const wearerLabel = wearerMode === 'GROUP'
      ? bulkLabel.trim() || 'Group order'
      : wearerMode === 'SELF'
        ? data.customerProfile?.display_name ?? 'Me'
        : wearerName.trim()
    const wearerContext = {
      mode: wearerMode,
      label: wearerLabel,
      measurementProfileLabel: wearerMode === 'GROUP'
        ? wearerLabel
        : measurementChoice === 'fallback'
          ? 'Tailor follow-up needed'
          : wearerLabel,
      relationship: wearerMode === 'GROUP' ? 'GROUP' : wearerMode === 'SELF' ? 'BUYER' : 'NAMED_OTHER',
      selectedAt: new Date().toISOString(),
      note: wearerMode === 'GROUP'
        ? 'Group order measurements are handled per wearer before quote acceptance.'
        : wearerMode === 'OTHER'
          ? 'Customer confirmed the attached measurements are for this named wearer.'
          : null,
    }
    const measurementSnapshot = baseMeasurementSnapshot
      ? {
          ...baseMeasurementSnapshot,
          wearerContext,
          measurementProfileLabel: wearerContext.measurementProfileLabel,
        }
      : null
    const measurementAge = measurementAgeFromSnapshot(measurementSnapshot)
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
          disagreementRule: 'If fabric suitability is disputed, Drapeon reviews the timeline before work continues.',
          prepRequirements: [
            'Share the handoff plan before the order is submitted',
            'Keep any shipping reference inside the order thread',
            'Keep receipt or dropoff proof in Drapeon if fabric value is material',
            'Do not expect cutting to start before receipt is confirmed',
          ],
        }
      : {
          approvalRequiredForTailorSourcing: true,
          replacementRule: 'Tailor-sourced fabric should only be replaced after customer approval inside Drapeon.',
          disagreementRule: 'If sourcing changes the agreed design or budget, Drapeon should review before work continues.',
          prepRequirements: [
            'Fabric sourcing is covered by the accepted quote',
            'Tailor should not buy replacement fabric without approval',
            'Fabric proof should be photographed in natural light when color matters',
          ],
        }
    const bulkMembers = bulkMemberNames
      .split(/\n|,/u)
      .map((name) => name.trim())
      .filter(Boolean)
    const bulkOrder = wearerMode === 'GROUP'
      ? {
          enabled: true,
          mode: 'OPS_MANAGED_SPECIAL_CASE',
          label: bulkLabel.trim() || null,
          recipientCount: bulkCount,
          memberNames: bulkMembers.length > 0 ? bulkMembers : null,
          memberMeasurementPolicy: 'Each wearer needs their own measurement profile before quote acceptance. Do not reuse the buyer profile unless the buyer is also that wearer.',
          payerModel: 'SINGLE_PAYER',
          measurementPrivacy: 'TAILOR_ONLY',
          statusPolicy: 'OPS_MANAGED_LINKED_CHILDREN',
          dyeLotConsistencyRequired: true,
          fabricMode: bulkFabricMode || null,
          fabricModeLabel: selectedBulkFabricMode?.label ?? null,
          notes: bulkNotes.trim() || null,
        }
      : null
    const styleAlignment = {
      requiredBeforeCutting: true,
      referencePhotoCount: referencePhotos.length,
      styleReferenceLinkCount: styleReferenceLinks.length,
      instruction: 'Before cutting, confirm what can and cannot be matched from the customer references inside Drapeon.',
      customerExpectation: 'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.',
    }
    const supportMeta = {
      source: 'web',
      wearerContext,
      bulkOrder,
      fabricPolicy,
      fabricReference: {
        sourceMode: fabricSource,
        mediaCount: fabricReferenceFiles.length,
        linkCount: fabricReferenceLinks.length,
        links: fabricReferenceLinks,
      },
      customerFabricProof: fabricSource === 'CUSTOMER_SUPPLIES'
        ? {
            requiredBeforeQuote: true,
            mediaCount: fabricReferenceFiles.length,
            referenceLinks: fabricReferenceLinks,
          }
        : null,
      measurementAge,
      styleAlignment,
      measurementFallback: !measurementSnapshot
        ? { requiredBeforeQuote: true, note: fitNote.trim() }
        : null,
      fabricHandoffMode: fabricSource === 'CUSTOMER_SUPPLIES' ? 'CUSTOMER_TO_TAILOR' : 'NO_CUSTOMER_HANDOFF_REQUIRED',
      fabricHandoffLabel: fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer will coordinate fabric handoff in Drapeon' : 'No customer fabric handoff required',
      fabricSourcing: fabricSource === 'TAILOR_SOURCES'
        ? {
            description: fabricDescription.trim() || null,
            budgetAmount: fabricBudgetAmount,
            budgetCurrency: fabricBudgetAmount ? fabricBudgetCurrency : null,
            deadlineBusinessDays: fabricSourcingDeadlineDays,
            referenceLinks: fabricReferenceLinks,
            referenceMediaCount: fabricReferenceFiles.length,
            substitutionPreference: fabricSubstitutionPreference || null,
            substitutionLabel: selectedFabricSubstitution?.label ?? null,
            suggestedVendor: fabricVendorName.trim() || fabricVendorLocation.trim() || normalizedFabricVendorLink || fabricVendorNotes.trim()
              ? {
                  name: fabricVendorName.trim() || null,
                  location: fabricVendorLocation.trim() || null,
                  link: normalizedFabricVendorLink,
                  notes: fabricVendorNotes.trim() || null,
                }
              : null,
            bulkFabricMode: bulkFabricMode || null,
            bulkFabricModeLabel: selectedBulkFabricMode?.label ?? null,
          }
        : null,
      webBrief: {
        createdAt: new Date().toISOString(),
        styleReferenceLinkCount: styleReferenceLinks.length,
        referencePhotoCount: referencePhotos.length,
        hasReferencePhoto: referencePhotos.length > 0,
      },
    }

    const buildPayload = (
      action: 'preflight-create-order' | 'create-order',
      uploadedReferencePhotoUrls: string[],
      uploadedFabricReferenceUrls: string[] = [],
    ) => {
      const supportMetaRecord = supportMeta as Record<string, unknown>
      const payloadSupportMeta = {
        ...supportMetaRecord,
        fabricReference: {
          ...(supportMetaRecord.fabricReference as Record<string, unknown>),
          mediaUrls: uploadedFabricReferenceUrls,
        },
        ...(fabricSource === 'TAILOR_SOURCES'
          ? {
              fabricSourcing: {
                ...(supportMetaRecord.fabricSourcing as Record<string, unknown>),
                referenceMediaUrls: uploadedFabricReferenceUrls,
              },
            }
          : {
              customerFabricProof: {
                ...(supportMetaRecord.customerFabricProof as Record<string, unknown>),
                mediaUrls: uploadedFabricReferenceUrls,
              },
            }),
      }

      return {
        action,
        tailorProfileId: selectedTailor.id,
        garmentType,
        garmentTypeOther: garmentType === 'Other' ? garmentTypeOther.trim() : null,
        genderPresentation,
        description: description.trim(),
        occasion: occasion === 'Other' ? occasionOther.trim() || 'Other' : occasion || null,
        deadline: deadlineIso,
        referencePhotos: uploadedReferencePhotoUrls,
        referencePhotoCount: action === 'preflight-create-order' ? referencePhotos.length : uploadedReferencePhotoUrls.length,
        styleReferenceLinks,
        styleNotes: styleNotes.trim() || null,
        customerMeasurementsSnapshot: measurementSnapshot,
        fitNote: fitNote.trim() || null,
        bodyNote: fitNote.trim() || null,
        fabricSource,
        fabricDescription: fabricSource === 'TAILOR_SOURCES' ? fabricDescription.trim() : null,
        fabricBudgetAmount: fabricSource === 'TAILOR_SOURCES' ? fabricBudgetAmount : null,
        fabricBudgetCurrency: fabricSource === 'TAILOR_SOURCES' ? fabricBudgetCurrency : null,
        fabricSourcingDeadlineDays: fabricSource === 'TAILOR_SOURCES' ? fabricSourcingDeadlineDays : null,
        fabricReferenceMedia: uploadedFabricReferenceUrls,
        fabricReferenceMediaCount: fabricReferenceFiles.length,
        fabricReferenceLinks,
        fabricSubstitutionPreference: fabricSource === 'TAILOR_SOURCES' ? fabricSubstitutionPreference || null : null,
        bulkFabricMode: wearerMode === 'GROUP' ? bulkFabricMode || null : null,
        fabricVendorName: fabricSource === 'TAILOR_SOURCES' ? fabricVendorName.trim() || null : null,
        fabricVendorLocation: fabricSource === 'TAILOR_SOURCES' ? fabricVendorLocation.trim() || null : null,
        fabricVendorLink: fabricSource === 'TAILOR_SOURCES' ? normalizedFabricVendorLink : null,
        fabricVendorNotes: fabricSource === 'TAILOR_SOURCES' ? fabricVendorNotes.trim() || null : null,
        supportMeta: payloadSupportMeta,
        deliveryMethod,
        shippingPreference: deliveryMethod === 'SHIPPING' ? shippingPreference : null,
        deliveryInstructions: deliveryInstructions.trim() || null,
        deliveryAddress: needsDeliveryDetails ? deliveryAddress.trim() : null,
        deliveryCity: needsDeliveryDetails ? deliveryCity.trim() : null,
        deliveryRegion: needsDeliveryDetails ? deliveryRegion.trim() : null,
        deliveryPostalCode: needsDeliveryDetails ? deliveryPostalCode.trim() : null,
        deliveryCountryCode: needsDeliveryDetails ? deliveryCountryCode.trim().toUpperCase() : null,
        deliveryVerificationSource: needsDeliveryDetails ? deliveryVerificationSource : null,
        deliveryVerificationReference: needsDeliveryDetails ? deliveryVerificationReference || null : null,
        deliveryVerifiedAt: needsDeliveryDetails ? deliveryVerifiedAt : null,
        recipientName: needsDeliveryDetails ? recipientName.trim() : null,
        recipientPhone: needsDeliveryDetails ? normalizedRecipientPhone : null,
        cancellationPolicyAcknowledged: acknowledged,
      }
    }

    setBusy(true)
    try {
      await invokeAccountFunction('custom-order-action', buildPayload('preflight-create-order', []))
      const uploadedReferencePhotos: string[] = []
      for (const photo of referencePhotos) {
        const preparedPhoto = await reencodeImageFile(photo)
        uploadedReferencePhotos.push(await uploadPublicFile('order-photos', `brief/${data.userId}`, preparedPhoto))
      }
      const uploadedFabricReferenceUrls: string[] = []
      for (const file of fabricReferenceFiles) {
        const preparedFabricMedia = await prepareOrderEvidenceFile(file)
        uploadedFabricReferenceUrls.push(await uploadPublicFile('order-photos', 'brief/' + data.userId + '/fabric', preparedFabricMedia))
      }
      const result = await invokeAccountFunction<{ orderId?: string }>('custom-order-action', buildPayload('create-order', uploadedReferencePhotos, uploadedFabricReferenceUrls))
      await invokeAccountFunction('custom-order-draft-action', { action: 'delete', tailorProfileId: selectedTailor.id })
      setCreatedOrderId(result.orderId ?? null)
      setSuccess('Custom brief sent. Opening the new order so you can track the quote.')
      setDescription('')
      setStyleLinks('')
      setStyleNotes('')
      setFitNote('')
      setOccasionOther('')
      setWearerName('')
      setBulkRecipientCount('')
      setBulkLabel('')
      setBulkMemberNames('')
      setBulkNotes('')
      setDeliveryInstructions('')
      setReferencePhotos([])
      setFabricReferenceFiles([])
      setFabricReferenceLinksInput('')
      setFabricSubstitutionPreference('')
      setBulkFabricMode('')
      setFabricVendorName('')
      setFabricVendorLocation('')
      setFabricVendorLink('')
      setFabricVendorNotes('')
      if (photoInputRef.current) photoInputRef.current.value = ''
      if (fabricMediaInputRef.current) fabricMediaInputRef.current.value = ''
      onRefresh()
      if (result.orderId) {
        router.push(accountRoute(`/account/orders/${result.orderId}`))
      }
    } catch (briefError) {
      setError(friendlyActionError(briefError, 'Custom brief could not be submitted. Check required fields and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const deliveryOptions = [
    selectedTailor.pickup_available ? ['LOCAL_COLLECTION', 'Local collection'] : null,
    selectedTailor.delivery_available ? ['LOCAL_DELIVERY', 'Local delivery'] : null,
    selectedTailor.shipping_available ? ['SHIPPING', 'Shipping'] : null,
  ].filter((entry): entry is [string, string] => !!entry)
  if (deliveryOptions.length === 0) deliveryOptions.push(['LOCAL_COLLECTION', 'Local collection'])

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1fr)] lg:items-start">
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start lg:block">
            <PhotoTile src={tailorPhoto(selectedTailor)} label="Tailor profile" />
            <div>
              <h2 className="mt-3 text-2xl font-semibold text-ink sm:mt-0 lg:mt-4">{safeEntityName(selectedTailor.business_name || selectedTailor.display_name, 'Tailor')}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink/62">
                {safeUserText(selectedTailor.location, 'Location pending')} · {safeList(selectedTailor.specialty_tags, 'Custom clothing')}
              </p>
              <p className="mt-3 w-fit rounded-full bg-bone/70 px-3 py-1.5 text-xs font-semibold text-needle">
                Availability: {cleanLabel(selectedTailor.availability, 'Ask before booking')}
              </p>
            </div>
          </div>
        </div>
        <div className="self-start rounded-[8px] border border-needle/12 bg-needle/8 p-4 shadow-sm sm:p-5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-needle/80">Before quote</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-ink sm:text-2xl">The tailor reviews this before pricing.</h2>
          <p className="mt-2 text-sm leading-6 text-ink/66">
            This sends a pending-quote order. Add saved measurements first so the tailor can price with fit context.
          </p>
        </div>
      </section>

      <section className="rounded-[8px] border border-ink/8 bg-white/84 p-4 shadow-sm sm:p-5">
        <div className="grid gap-5">
          <ActionNotice error={error} success={success} />
          {draftStatus ? (
            <div className={`rounded-[8px] border px-4 py-3 text-sm ${draftStatus === 'error' ? 'border-rust/20 bg-rust/6 text-rust' : 'border-needle/16 bg-needle/6 text-ink/68'}`} role="status">
              <strong className="text-ink">{draftStatus === 'loading' ? 'Checking for a saved request…' : draftStatus === 'restored' ? 'Request restored' : draftStatus === 'saving' ? 'Saving request…' : draftStatus === 'saved' ? 'Request saved' : 'Draft could not save'}</strong>
              {(draftStatus === 'restored' || draftAttachmentWarning) ? <p className="mt-1 leading-5">{draftAttachmentWarning ? 'Your written details were restored. Reattach local photo or video files before submitting.' : 'Continue from where you stopped on any signed-in Drapeon device.'}</p> : null}
            </div>
          ) : null}
          {createdOrderId ? (
            <Link href={accountRoute(`/account/orders/${createdOrderId}`)} className="inline-flex w-fit rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white">
              Open submitted order
            </Link>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Garment</span>
              <select value={garmentType} onChange={(event) => setGarmentType(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="" disabled>Select a garment</option>
                {CUSTOM_ORDER_GARMENT_TAXONOMY.map((group) => (
                  <optgroup key={group.category} label={group.category}>
                    {group.items.map((type) => <option key={type} value={type}>{type}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fit category</span>
              <select value={genderPresentation} onChange={(event) => setGenderPresentation(event.target.value as typeof genderPresentation)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="Unisex">Unisex</option>
                <option value="Menswear">Menswear</option>
                <option value="Womenswear">Womenswear</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Target date</span>
              <input type="date" value={deadline} min={minimumDeadlineInput()} onChange={(event) => setDeadline(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          </div>
          {garmentType === 'Other' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Garment type details</span>
              <input value={garmentTypeOther} onChange={(event) => setGarmentTypeOther(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          ) : null}
          <div className="grid gap-4 rounded-[8px] border border-ink/6 bg-bone/35 p-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Wearer</span>
              <select value={wearerMode} onChange={(event) => setWearerMode(event.target.value as typeof wearerMode)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                <option value="SELF">Me</option>
                <option value="OTHER">Someone else</option>
                {GROUP_ORDERS_ENABLED ? <option value="GROUP">Group order</option> : null}
              </select>
            </label>
            {wearerMode === 'OTHER' ? (
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Wearer name</span>
                <input value={wearerName} onChange={(event) => setWearerName(event.target.value)} placeholder="Name used for this measurement profile" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            ) : null}
            {wearerMode === 'GROUP' ? (
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Group name</span>
                  <input value={bulkLabel} onChange={(event) => setBulkLabel(event.target.value)} placeholder="Wedding party, choir..." className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Wearers</span>
                  <input value={bulkRecipientCount} onChange={(event) => setBulkRecipientCount(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="2+" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
                <label className="grid gap-2 md:col-span-3">
                  <span className="text-sm font-semibold text-ink">Members and notes</span>
                  <textarea value={`${bulkMemberNames}${bulkNotes ? `\n\n${bulkNotes}` : ''}`} onChange={(event) => {
                    const [members = '', ...notes] = event.target.value.split(/\n\n/u)
                    setBulkMemberNames(members)
                    setBulkNotes(notes.join('\n\n'))
                  }} rows={3} placeholder="Names separated by commas or lines, then optional notes." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                </label>
              </>
            ) : null}
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Brief</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={1200} placeholder="Describe the outfit, silhouette, occasion, fabric expectations, and anything the tailor must know." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Occasion</span>
              <select value={occasion} onChange={(event) => setOccasion(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {WEB_OCCASION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Reference photos</span>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  if (files.length > CUSTOM_ORDER_MAX_REFERENCE_PHOTOS) {
                    setReferencePhotos(files.slice(0, CUSTOM_ORDER_MAX_REFERENCE_PHOTOS))
                    setError(`Only the first ${CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} reference photos were selected.`)
                    return
                  }
                  setReferencePhotos(files)
                  setError(null)
                }}
                className="rounded-full border border-ink/10 bg-bone/45 px-4 py-3 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
              />
              <span className="text-xs leading-5 text-ink/52">{referencePhotos.length}/{CUSTOM_ORDER_MAX_REFERENCE_PHOTOS} photos selected.</span>
            </label>
          </div>
          {occasion === 'Other' ? (
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Occasion details</span>
              <input value={occasionOther} onChange={(event) => setOccasionOther(event.target.value)} placeholder="Naming ceremony, corporate gala, festival..." className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          ) : null}
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Style links</span>
            <input value={styleLinks} onChange={(event) => setStyleLinks(event.target.value)} placeholder="Instagram, Pinterest, or TikTok links" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            <span className="text-xs leading-5 text-ink/52">
              Add up to {CUSTOM_ORDER_MAX_STYLE_LINKS} supported links. Extra links must be removed before submitting.
            </span>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Style notes</span>
            <textarea value={styleNotes} onChange={(event) => setStyleNotes(event.target.value)} rows={3} maxLength={1200} className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Measurements</span>
              <select value={measurementChoice} onChange={(event) => setMeasurementChoice(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {data.measurementProfiles.map((profile) => <option key={profile.id} value={profile.id}>{safeUserText(profile.label, 'Saved profile')}</option>)}
                {data.customerProfile?.measurements ? <option value="legacy">Customer profile</option> : null}
                <option value="fallback" disabled>No measurements yet</option>
              </select>
              {(() => {
                const profile = data.measurementProfiles.find((p) => p.id === measurementChoice)
                const age = profile ? measurementAgeFromSnapshot({ measurementProfileUpdatedAt: profile.last_measured_at ?? profile.updated_at }) : null
                if (!age?.stale) return null
                return (
                  <span className="text-xs leading-5 text-amber-700">
                    These measurements are {age.ageMonths} months old. Update them in Profile if your fit or body shape changed before submitting this brief.
                  </span>
                )
              })()}
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fit note <span className="font-normal text-ink/52">(min 20 chars)</span></span>
              <textarea value={fitNote} onChange={(event) => setFitNote(event.target.value)} rows={3} maxLength={500} placeholder="e.g. I prefer extra room in the shoulders, shorter torso, or trousers sitting high on the waist." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
              <span className="text-xs leading-5 text-ink/52">
                No contact details. Describe fit, coverage, posture, or comfort preferences.
              </span>
            </label>
          </div>

          <section className="grid gap-4 rounded-[8px] border border-ink/6 bg-bone/35 p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric</span>
                <select value={fabricSource} onChange={(event) => setFabricSource(event.target.value as typeof fabricSource)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="TAILOR_SOURCES">Tailor sources fabric</option>
                  <option value="CUSTOMER_SUPPLIES">Customer supplies fabric</option>
                </select>
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-semibold text-ink">Fabric details</span>
                <input value={fabricDescription} onChange={(event) => setFabricDescription(event.target.value)} placeholder={fabricSource === 'TAILOR_SOURCES' ? 'Fabric type, color, weight, and what the tailor should source' : 'Fabric type, color, yardage, and how it will be handed off'} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric photos or videos</span>
                <input
                  ref={fabricMediaInputRef}
                  type="file"
                  accept="image/*,video/mp4,video/quicktime"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    if (files.length > MAX_WEB_FABRIC_REFERENCE_MEDIA) {
                      setFabricReferenceFiles(files.slice(0, MAX_WEB_FABRIC_REFERENCE_MEDIA))
                      setError('Only the first ' + MAX_WEB_FABRIC_REFERENCE_MEDIA + ' fabric media files were selected.')
                      return
                    }
                    setFabricReferenceFiles(files)
                    setError(null)
                  }}
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
                />
                <span className="text-xs leading-5 text-ink/52">
                  {fabricReferenceFiles.length}/{MAX_WEB_FABRIC_REFERENCE_MEDIA} media files selected. Use photos or short MP4/MOV clips.
                </span>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Fabric reference links</span>
                <textarea value={fabricReferenceLinksInput} onChange={(event) => setFabricReferenceLinksInput(event.target.value)} rows={3} placeholder="Instagram, Pinterest, or TikTok links for fabric references" className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                <span className="text-xs leading-5 text-ink/52">
                  Add links only for fabric references. Keep vendor contact details out of the brief.
                </span>
              </label>
            </div>

            {wearerMode === 'GROUP' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Group fabric plan</span>
                <select value={bulkFabricMode} onChange={(event) => setBulkFabricMode(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="">Choose fabric plan</option>
                  {BULK_FABRIC_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="text-xs leading-5 text-ink/52">
                  Bulk orders need a clear sourcing plan so the tailor can protect dye lot, matching, and recipient differences.
                </span>
              </label>
            ) : null}

            {fabricSource === 'TAILOR_SOURCES' ? (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <MoneyInput id="custom-brief-fabric-budget" label="Fabric budget" value={fabricBudget} onValueChange={setFabricBudget} currency={fabricBudgetCurrency} required hint="Set the maximum fabric sourcing budget before the tailor quotes." />
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Budget currency</span>
                    <select value={fabricBudgetCurrency} onChange={(event) => setFabricBudgetCurrency(normalizeAccountCurrency(event.target.value) ?? fabricBudgetCurrency)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                      {SUPPORTED_ACCOUNT_CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Sourcing update</span>
                    <select value={fabricSourcingDeadlineDays} onChange={(event) => setFabricSourcingDeadlineDays(Number.parseInt(event.target.value, 10))} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                      {[3, CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS, 7, 10].map((days) => (
                        <option key={days} value={days}>{days} business days</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">If the exact fabric is unavailable</span>
                  <select value={fabricSubstitutionPreference} onChange={(event) => setFabricSubstitutionPreference(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                    <option value="">Choose substitution rule</option>
                    {FABRIC_SUBSTITUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="text-xs leading-5 text-ink/52">
                    {selectedFabricSubstitution?.hint ?? 'This tells the tailor whether to ask before using a close alternative.'}
                  </span>
                </label>
                <div className="grid gap-4 rounded-[8px] border border-ink/6 bg-white/70 p-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Suggested vendor</span>
                    <input value={fabricVendorName} onChange={(event) => setFabricVendorName(event.target.value)} placeholder="Optional vendor or shop name" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-ink">Vendor location</span>
                    <input value={fabricVendorLocation} onChange={(event) => setFabricVendorLocation(event.target.value)} placeholder="Market, city, or area" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2 md:col-span-2">
                    <span className="text-sm font-semibold text-ink">Vendor website or social link</span>
                    <input value={fabricVendorLink} onChange={(event) => setFabricVendorLink(event.target.value)} placeholder="Optional link only, no phone or direct payment details" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                  <label className="grid gap-2 md:col-span-2">
                    <span className="text-sm font-semibold text-ink">Vendor notes</span>
                    <textarea value={fabricVendorNotes} onChange={(event) => setFabricVendorNotes(event.target.value)} rows={3} maxLength={500} placeholder="Optional sourcing context, no contact details." className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50" />
                  </label>
                </div>
              </>
            ) : (
              <p className="rounded-[8px] border border-needle/10 bg-white/70 px-4 py-3 text-sm leading-6 text-ink/66">
                Add at least one clear fabric photo or video. The tailor will confirm fabric suitability and handoff inside the order before quoting or cutting.
              </p>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fulfillment</span>
              <select value={deliveryMethod} onChange={(event) => {
                const method = event.target.value as typeof deliveryMethod
                setDeliveryMethod(method)
                setFulfillmentEligibility(null)
                if (method === 'LOCAL_COLLECTION') void resolveWebFulfillment(method)
              }} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                {deliveryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {deliveryMethod === 'SHIPPING' ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Shipping speed</span>
                <select value={shippingPreference} onChange={(event) => setShippingPreference(event.target.value as typeof shippingPreference)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50">
                  <option value="STANDARD">Standard</option>
                  <option value="EXPRESS">Express</option>
                </select>
              </label>
            ) : null}
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-semibold text-ink">Instructions</span>
              <input value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} placeholder="Gate, handoff, or shipping notes without contact details" className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
            </label>
          </div>

          {needsDeliveryDetails ? (
            <div className="grid gap-4 rounded-[8px] border border-ink/6 bg-bone/45 p-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Recipient name</span>
                <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <PhoneNumberField
                label="Recipient phone"
                value={recipientPhone}
                onValueChange={setRecipientPhone}
                placeholder="Phone number"
              />
              <StructuredAddressSearch onSelect={(address) => {
                setDeliveryAddress(address.line1 || address.displayValue)
                setDeliveryCity(address.city)
                setDeliveryRegion(address.stateRegion)
                setDeliveryPostalCode(address.postcode)
                setDeliveryCountryCode(address.countryCode ?? '')
                setDeliveryVerificationSource('ADDRESS_SEARCH')
                setDeliveryVerificationReference(address.reference)
                setDeliveryVerifiedAt(new Date().toISOString())
                setFulfillmentEligibility(null)
              }} />
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-semibold text-ink">Street address</span>
                <input value={deliveryAddress} onChange={(event) => { setDeliveryAddress(event.target.value); clearWebDeliveryVerification() }} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">City</span>
                <input value={deliveryCity} onChange={(event) => { setDeliveryCity(event.target.value); clearWebDeliveryVerification() }} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">State / region</span>
                <input value={deliveryRegion} onChange={(event) => { setDeliveryRegion(event.target.value); clearWebDeliveryVerification() }} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Postal code</span>
                <input value={deliveryPostalCode} onChange={(event) => { setDeliveryPostalCode(event.target.value); clearWebDeliveryVerification() }} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Country code <span className="font-normal text-ink/52">(2 letters, e.g. US, GB, NG)</span></span>
                <input value={deliveryCountryCode} onChange={(event) => { setDeliveryCountryCode(event.target.value.toUpperCase().slice(0, 2)); clearWebDeliveryVerification() }} maxLength={2} className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50" />
              </label>
              <div className="grid gap-2 md:col-span-2">
                <Button type="button" variant="secondary" onClick={() => void confirmWebDeliveryAddress()} disabled={checkingFulfillment}>
                  {checkingFulfillment ? 'Checking…' : 'Confirm delivery address'}
                </Button>
                {fulfillmentEligibility ? (
                  <p role="status" className={fulfillmentEligibility.status === 'ELIGIBLE' ? 'text-xs text-needle' : 'text-xs text-kante'}>
                    {fulfillmentEligibilityCopy(fulfillmentEligibility)}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {!needsDeliveryDetails && fulfillmentEligibility ? (
            <p role="status" className={fulfillmentEligibility.status === 'ELIGIBLE' ? 'text-sm text-needle' : 'text-sm text-kante'}>
              {fulfillmentEligibilityCopy(fulfillmentEligibility)}
            </p>
          ) : null}

          <label className="flex items-start gap-3 rounded-[8px] border border-ink/8 bg-bone/55 p-4 text-sm leading-6 text-ink/66">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
            <span>
              This sends a brief for quote review, not an automatic charge. Pricing, payment, cancellation, and handoff terms stay inside Drapeon once the tailor responds.
            </span>
          </label>
          <button type="button" onClick={submitBrief} disabled={busy} className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20">
            {busy ? 'Submitting brief...' : 'Submit custom brief'}
          </button>
        </div>
      </section>
    </div>
  )
}
