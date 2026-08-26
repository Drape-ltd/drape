export const CUSTOM_ORDER_MIN_DELIVERY_DAYS = 14
export const CUSTOM_ORDER_DEFAULT_DEADLINE_DAYS = 28
export const CUSTOM_ORDER_MAX_REFERENCE_PHOTOS = 6
export const CUSTOM_ORDER_MAX_STYLE_LINKS = 3
export const CUSTOM_ORDER_MIN_BRIEF_LINES = 3
export const CUSTOM_ORDER_MIN_BRIEF_PARAGRAPH_CHARS = 80
export const CUSTOM_ORDER_MIN_BRIEF_PARAGRAPH_WORDS = 12
export const CUSTOM_ORDER_FABRIC_SOURCING_DEFAULT_BUSINESS_DAYS = 5

export const CUSTOM_ORDER_STYLE_LINK_HOSTS = [
  'instagram.com',
  'www.instagram.com',
  'pinterest.com',
  'www.pinterest.com',
  'pin.it',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
] as const

export const CUSTOM_ORDER_OCCASIONS = [
  'Wedding',
  'Birthday',
  'Event',
  'Everyday',
  'Business',
  'Religious ceremony',
  'Graduation',
  'Travel',
  'Funeral',
  'Other',
] as const

export const CUSTOM_ORDER_GENDER_PRESENTATIONS = [
  'Menswear',
  'Womenswear',
  'Unisex',
] as const

export const CUSTOM_ORDER_SHIPPING_PREFERENCES = [
  'STANDARD',
  'EXPRESS',
] as const

export const CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS = [3, 5, 7, 10] as const

export const CUSTOM_ORDER_GARMENT_TAXONOMY = [
  {
    category: 'West African and diaspora',
    items: [
      'Agbada',
      'Boubou',
      'Babban Riga / Riga',
      'Kaftan',
      'Senator / Native set',
      'Dashiki / Danshiki',
      'Iro and Buba',
      'Buba dress',
      'Wrapper skirt',
      'Kaba and slit',
      'Kente outfit / wrapper',
      'Aso-oke outfit',
      'Asoebi / group outfit',
      'Ankara dress',
      'Ankara co-ord',
      'Ankara jumpsuit',
      'Gele / headwrap',
      'Fila / cap',
    ],
  },
  {
    category: 'South Asian',
    items: [
      'Saree blouse',
      'Lehenga / choli / dupatta',
      'Sherwani',
      'Kurta',
      'Kurti',
      'Salwar kameez',
      'Anarkali',
      'Churidar',
      'Nehru jacket',
      'Jodhpuri / Bandhgala',
      'Dhoti kurta',
      'Petticoat',
    ],
  },
  {
    category: 'Western and formal',
    items: [
      'Suit',
      'Tuxedo',
      'Blazer',
      'Waistcoat',
      'Dress shirt',
      'Trousers',
      'Skirt',
      'Wedding gown',
      'Evening gown',
      'Cocktail dress',
      'Bridesmaid dress',
      'Jumpsuit',
      'Coat / jacket',
    ],
  },
  {
    category: 'Modest and MENA',
    items: [
      'Abaya',
      'Jilbab',
      'Jalabiya / Galabeya',
      'Thobe / Jubba',
      'Modest dress',
    ],
  },
  {
    category: 'Work, groups, and family',
    items: [
      'Uniform',
      'Choir / church outfit',
      'School outfit',
      "Children's outfit",
      'Matching family set',
      'Group ceremonial order',
    ],
  },
  {
    category: 'Other',
    items: ['Other'],
  },
] as const

export const CUSTOM_ORDER_GARMENT_TYPES = CUSTOM_ORDER_GARMENT_TAXONOMY.flatMap((group) => group.items)

export const CUSTOM_ORDER_STYLE_ATTRIBUTES = [
  'Colour',
  'Silhouette',
  'Length',
  'Sleeve',
  'Neckline',
  'Closure',
  'Lining',
  'Embellishment',
  'Modesty / coverage',
  'Pockets',
  'Fit',
  'Fabric behaviour',
] as const

export const CUSTOM_PRODUCTION_STAGE_KEYS = [
  'ORDER_ACCEPTED',
  'FABRIC',
  'PRE_CUTTING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'QUALITY_CHECK',
  'DISPATCHED',
  'DELIVERED',
] as const

export type CustomProductionStageKey = (typeof CUSTOM_PRODUCTION_STAGE_KEYS)[number]

export const CUSTOM_PRODUCTION_EVIDENCE_PURPOSES = {
  SOURCING_PROGRESS: 'SOURCING_PROGRESS',
  FABRIC_APPROVAL: 'FABRIC_APPROVAL',
  PRODUCTION_STAGE: 'PRODUCTION_STAGE',
} as const

export type CustomProductionEvidencePurpose =
  (typeof CUSTOM_PRODUCTION_EVIDENCE_PURPOSES)[keyof typeof CUSTOM_PRODUCTION_EVIDENCE_PURPOSES]

export const SOURCED_FABRIC_CHANGE_NOTE_PREFIX = 'Customer requested sourced fabric changes:'
export const SOURCED_FABRIC_APPROVED_NOTE = 'Customer approved the tailor-sourced fabric.'
export const STYLE_ALIGNMENT_APPROVED_NOTE = 'Customer approved the tailor style interpretation before cutting.'
export const STYLE_ALIGNMENT_CHANGE_NOTE_PREFIX = 'Customer requested style clarification before cutting:'
export const STYLE_ALIGNMENT_REQUEST_NOTE_PREFIX = 'Tailor requested style approval before cutting:'

export type SourcedFabricDecision = 'APPROVED' | 'CHANGES_REQUESTED'

export function sourcedFabricDecisionFromNote(note: unknown): SourcedFabricDecision | null {
  if (typeof note !== 'string') return null
  const normalized = note.trim()
  if (normalized === SOURCED_FABRIC_APPROVED_NOTE) return 'APPROVED'
  if (normalized.startsWith(SOURCED_FABRIC_CHANGE_NOTE_PREFIX)) return 'CHANGES_REQUESTED'
  return null
}

export type StyleAlignmentDecision = 'APPROVED' | 'CHANGES_REQUESTED'
export type StyleAlignmentEvent = 'REQUESTED' | StyleAlignmentDecision

export function styleAlignmentEventFromNote(note: unknown): StyleAlignmentEvent | null {
  if (typeof note !== 'string') return null
  const normalized = note.trim()
  if (normalized.startsWith(STYLE_ALIGNMENT_REQUEST_NOTE_PREFIX)) return 'REQUESTED'
  if (normalized === STYLE_ALIGNMENT_APPROVED_NOTE) return 'APPROVED'
  if (normalized.startsWith(STYLE_ALIGNMENT_CHANGE_NOTE_PREFIX)) return 'CHANGES_REQUESTED'
  return null
}

export function styleAlignmentDecisionFromNote(note: unknown): StyleAlignmentDecision | null {
  const event = styleAlignmentEventFromNote(note)
  return event === 'APPROVED' || event === 'CHANGES_REQUESTED' ? event : null
}

export function styleAlignmentChangeFeedbackFromUpdates(
  updates: ReadonlyArray<{
    note?: unknown
    createdAt?: unknown
    created_at?: unknown
  }>,
): SourcedFabricChangeFeedback | null {
  return updates.reduce<SourcedFabricChangeFeedback | null>((latest, update) => {
    if (typeof update.note !== 'string') return latest
    const note = update.note.trim()
    if (!note.startsWith(STYLE_ALIGNMENT_CHANGE_NOTE_PREFIX)) return latest
    const feedback = note.slice(STYLE_ALIGNMENT_CHANGE_NOTE_PREFIX.length).trim()
    if (!feedback) return latest

    const rawCreatedAt = update.createdAt ?? update.created_at
    const createdAt = typeof rawCreatedAt === 'string' && rawCreatedAt.trim() ? rawCreatedAt : null
    if (!latest) return { feedback, createdAt }

    const latestTime = latest.createdAt ? Date.parse(latest.createdAt) : Number.NEGATIVE_INFINITY
    const candidateTime = createdAt ? Date.parse(createdAt) : Number.NEGATIVE_INFINITY
    return Number.isFinite(candidateTime) && candidateTime >= latestTime
      ? { feedback, createdAt }
      : latest
  }, null)
}

export type SourcedFabricChangeFeedback = {
  feedback: string
  createdAt: string | null
}

export function sourcedFabricChangeFeedbackFromUpdates(
  updates: ReadonlyArray<{
    note?: unknown
    createdAt?: unknown
    created_at?: unknown
  }>,
): SourcedFabricChangeFeedback | null {
  return updates.reduce<SourcedFabricChangeFeedback | null>((latest, update) => {
    if (typeof update.note !== 'string') return latest
    const note = update.note.trim()
    if (!note.startsWith(SOURCED_FABRIC_CHANGE_NOTE_PREFIX)) return latest

    const feedback = note.slice(SOURCED_FABRIC_CHANGE_NOTE_PREFIX.length).trim()
    if (!feedback) return latest

    const rawCreatedAt = update.createdAt ?? update.created_at
    const createdAt = typeof rawCreatedAt === 'string' && rawCreatedAt.trim()
      ? rawCreatedAt
      : null
    if (!latest) return { feedback, createdAt }

    const latestTime = latest.createdAt ? Date.parse(latest.createdAt) : Number.NEGATIVE_INFINITY
    const candidateTime = createdAt ? Date.parse(createdAt) : Number.NEGATIVE_INFINITY
    return Number.isFinite(candidateTime) && candidateTime >= latestTime
      ? { feedback, createdAt }
      : latest
  }, null)
}

export function isFabricApprovalEvidence(input: { stageKey?: unknown; metadata?: unknown }) {
  const metadata = input.metadata
  return input.stageKey === 'FABRIC'
    && !!metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>).evidence_purpose === CUSTOM_PRODUCTION_EVIDENCE_PURPOSES.FABRIC_APPROVAL
}

export function latestFabricApprovalEvidence<
  T extends {
    stageKey?: unknown
    stage_key?: unknown
    metadata?: unknown
    createdAt?: unknown
    created_at?: unknown
  },
>(evidence: ReadonlyArray<T>): T | null {
  return evidence.reduce<T | null>((latest, candidate) => {
    if (!isFabricApprovalEvidence({
      stageKey: candidate.stageKey ?? candidate.stage_key,
      metadata: candidate.metadata,
    })) return latest
    if (!latest) return candidate

    const candidateCreatedAt = candidate.createdAt ?? candidate.created_at
    const latestCreatedAt = latest.createdAt ?? latest.created_at
    const candidateTime = typeof candidateCreatedAt === 'string' ? Date.parse(candidateCreatedAt) : Number.NaN
    const latestTime = typeof latestCreatedAt === 'string' ? Date.parse(latestCreatedAt) : Number.NaN

    if (!Number.isFinite(candidateTime)) return latest
    if (!Number.isFinite(latestTime) || candidateTime >= latestTime) return candidate
    return latest
  }, null)
}

export const CUSTOM_PRODUCTION_STAGE_LABELS: Record<CustomProductionStageKey, string> = {
  ORDER_ACCEPTED: 'Order accepted',
  FABRIC: 'Fabric',
  PRE_CUTTING: 'Pre-cutting checks',
  CUTTING: 'Cutting',
  SEWING: 'Sewing',
  FINISHING: 'Finishing',
  QUALITY_CHECK: 'Quality check',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
}

export const CUSTOM_PRODUCTION_STAGE_ORDER_STAGE: Record<CustomProductionStageKey, string> = {
  ORDER_ACCEPTED: 'CONFIRMED',
  FABRIC: 'SOURCING',
  PRE_CUTTING: 'DESIGNING',
  CUTTING: 'CUTTING',
  SEWING: 'SEWING',
  FINISHING: 'FINISHING',
  QUALITY_CHECK: 'FINISHING',
  DISPATCHED: 'READY_FOR_DRAPE_DISPATCH',
  DELIVERED: 'DELIVERED',
}

export const CUSTOM_PRODUCTION_STAGE_REQUIREMENTS: Record<
  CustomProductionStageKey,
  { noteRequired: boolean; photoRequired: boolean; minPhotoCount: number }
> = {
  ORDER_ACCEPTED: { noteRequired: true, photoRequired: false, minPhotoCount: 0 },
  FABRIC: { noteRequired: true, photoRequired: true, minPhotoCount: 1 },
  PRE_CUTTING: { noteRequired: true, photoRequired: true, minPhotoCount: 1 },
  CUTTING: { noteRequired: true, photoRequired: true, minPhotoCount: 1 },
  SEWING: { noteRequired: true, photoRequired: true, minPhotoCount: 1 },
  FINISHING: { noteRequired: true, photoRequired: true, minPhotoCount: 2 },
  QUALITY_CHECK: { noteRequired: true, photoRequired: true, minPhotoCount: 1 },
  DISPATCHED: { noteRequired: true, photoRequired: false, minPhotoCount: 0 },
  DELIVERED: { noteRequired: false, photoRequired: false, minPhotoCount: 0 },
}

export const CUSTOM_FABRIC_APPROVAL_STATUSES = [
  'NOT_REQUIRED',
  'PENDING_TAILOR_UPLOAD',
  'PENDING_CUSTOMER_APPROVAL',
  'APPROVED',
  'CHANGES_REQUESTED',
  'UNSUITABLE',
  'OPS_REVIEW',
] as const

export type CustomFabricApprovalStatus = (typeof CUSTOM_FABRIC_APPROVAL_STATUSES)[number]

export const CUSTOM_ORDER_RESUMABLE_STAGES = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
] as const

export function isResumableCustomOrderStage(stage: string | null | undefined) {
  return typeof stage === 'string' && CUSTOM_ORDER_RESUMABLE_STAGES.includes(stage as (typeof CUSTOM_ORDER_RESUMABLE_STAGES)[number])
}

export function customOrderMinimumDeliveryDate(now = new Date()) {
  const minimum = new Date(now)
  minimum.setHours(0, 0, 0, 0)
  minimum.setDate(minimum.getDate() + CUSTOM_ORDER_MIN_DELIVERY_DAYS)
  return minimum
}

export function customOrderDefaultDeadline(now = new Date()) {
  const deadline = new Date(now)
  deadline.setHours(0, 0, 0, 0)
  deadline.setDate(deadline.getDate() + CUSTOM_ORDER_DEFAULT_DEADLINE_DAYS)
  return deadline
}

export function customOrderBriefLineCount(value: string | null | undefined) {
  if (!value) return 0
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .length
}

export function customOrderBriefWordCount(value: string | null | undefined) {
  if (!value) return 0
  return value.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)?.length ?? 0
}

export function isCustomOrderBriefLongEnough(value: string | null | undefined) {
  if (!value) return false
  const trimmed = value.trim()
  return customOrderBriefLineCount(trimmed) >= CUSTOM_ORDER_MIN_BRIEF_LINES
    || (trimmed.length >= CUSTOM_ORDER_MIN_BRIEF_PARAGRAPH_CHARS
      && customOrderBriefWordCount(trimmed) >= CUSTOM_ORDER_MIN_BRIEF_PARAGRAPH_WORDS)
}

export function isAllowedCustomStyleReference(value: string | null | undefined) {
  if (!value) return false
  try {
    const parsed = new URL(value.trim())
    const host = parsed.hostname.toLowerCase()
    return CUSTOM_ORDER_STYLE_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

export function isKnownCustomGarmentType(value: string | null | undefined) {
  if (!value) return false
  return CUSTOM_ORDER_GARMENT_TYPES.some((item) => item.toLowerCase() === value.trim().toLowerCase())
}

export function isCustomFabricSourcingDeadline(value: number | null | undefined) {
  return typeof value === 'number'
    && CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS.includes(value as (typeof CUSTOM_ORDER_FABRIC_SOURCING_DEADLINE_DAYS)[number])
}

export function isCustomProductionStageKey(value: string | null | undefined): value is CustomProductionStageKey {
  return typeof value === 'string' && CUSTOM_PRODUCTION_STAGE_KEYS.includes(value as CustomProductionStageKey)
}
