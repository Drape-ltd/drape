import { formatDatabaseEnumLabel } from './display-text'

export type BriefDossierRowPresentation = 'inline' | 'stacked' | 'chips' | 'links' | 'media'

export type BriefDossierRow = {
  id: string
  label: string
  value?: string | null
  values?: string[]
  hrefs?: string[]
  mediaUrls?: string[]
  presentation: BriefDossierRowPresentation
  tone?: 'default' | 'warning' | 'success'
}

export type BriefDossierSectionId =
  | 'summary'
  | 'style_refs'
  | 'fabric_plan'
  | 'measurements'
  | 'fulfillment'
  | 'bulk_recipients'
  | 'messages_proof'

export type BriefDossierSection = {
  id: BriefDossierSectionId
  title: string
  summary?: string
  rows: BriefDossierRow[]
}

export type BriefDossier = {
  title: string
  sections: BriefDossierSection[]
}

export type BriefDossierCustomDetail = {
  garmentTypeOther?: string | null
  genderPresentation?: string | null
  socialReferenceLinks?: string[] | null
  styleNotes?: string | null
  bodyNote?: string | null
  fabricDescription?: string | null
  fabricBudgetAmount?: number | null
  fabricBudgetCurrency?: string | null
  fabricSourcingDeadlineDays?: number | null
  fabricSourcingDeadlineAt?: string | null
  fabricApprovalStatus?: string | null
  shippingPreference?: string | null
  deliveryInstructions?: string | null
  targetDeliveryDate?: string | null
}

export type BriefDossierInput = {
  orderKind?: string | null
  garmentType?: string | null
  garmentDescription?: string | null
  itemTitle?: string | null
  itemSize?: string | null
  itemQuantity?: number | null
  occasion?: string | null
  stage?: string | null
  quotedAmount?: number | null
  quotedCurrency?: string | null
  quotedCompletionDate?: string | null
  deadline?: string | null
  fabricSource?: string | null
  deliveryMethod?: string | null
  deliveryAddress?: string | null
  recipientName?: string | null
  recipientPhone?: string | null
  fabricTracking?: string | null
  trackingNumber?: string | null
  carrier?: string | null
  fulfillmentProvider?: string | null
  fulfillmentReference?: string | null
  fulfillmentContactName?: string | null
  fulfillmentContactPhone?: string | null
  collectionCode?: string | null
  referencePhotos?: string[] | null
  proofMediaUrls?: string[] | null
  messageCount?: number | null
  supportMeta?: Record<string, unknown> | null
  customDetail?: BriefDossierCustomDetail | null
  measurementSnapshot?: Record<string, unknown> | null
  measurementSourceLabel?: string | null
  measurementAgeLabel?: string | null
  fitConfidenceLabel?: string | null
  wearerLabel?: string | null
  bulkMemberCount?: number | null
}

export type BriefDossierFormatters = {
  label?: (value: string | null | undefined, fallback?: string) => string
  date?: (value: string | null | undefined) => string | null
  money?: (amount: number | null | undefined, currency: string | null | undefined) => string
}

const LONG_LABEL_HINTS = [
  'address',
  'note',
  'instructions',
  'description',
  'vendor',
  'members',
  'body',
  'brief',
  'tracking',
]

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function defaultDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function defaultMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount / 100)
}

function shouldStack(label: string, value: string) {
  const normalized = label.toLowerCase()
  return (
    value.length > 44 ||
    value.includes('\n') ||
    LONG_LABEL_HINTS.some((hint) => normalized.includes(hint))
  )
}

function row(
  id: string,
  label: string,
  value: string | null | undefined,
  presentation?: BriefDossierRowPresentation,
): BriefDossierRow | null {
  const cleaned = value?.trim()
  if (!cleaned) return null
  return {
    id,
    label,
    value: cleaned,
    presentation: presentation ?? (shouldStack(label, cleaned) ? 'stacked' : 'inline'),
  }
}

function chipRow(id: string, label: string, values: string[] | null | undefined): BriefDossierRow | null {
  const cleaned = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
  if (cleaned.length === 0) return null
  return { id, label, values: cleaned, presentation: 'chips' }
}

function linkRow(id: string, label: string, hrefs: string[] | null | undefined): BriefDossierRow | null {
  const cleaned = [...new Set((hrefs ?? []).map((value) => value.trim()).filter(Boolean))]
  if (cleaned.length === 0) return null
  return { id, label, hrefs: cleaned, presentation: 'links' }
}

function mediaRow(id: string, label: string, urls: string[] | null | undefined, fallbackCount?: number | null): BriefDossierRow | null {
  const cleaned = [...new Set((urls ?? []).map((value) => value.trim()).filter(Boolean))]
  const count = cleaned.length || fallbackCount || 0
  if (count <= 0) return null
  return {
    id,
    label,
    value: `${count} media item${count === 1 ? '' : 's'}`,
    mediaUrls: cleaned,
    presentation: cleaned.length > 0 ? 'media' : 'inline',
  }
}

function addSection(sections: BriefDossierSection[], section: BriefDossierSection) {
  if (section.rows.length > 0) sections.push(section)
}

function countLabel(count: number | null | undefined, noun: string) {
  if (!count || count <= 0) return null
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function buildBriefDossier(
  input: BriefDossierInput,
  formatters: BriefDossierFormatters = {},
): BriefDossier {
  const label = formatters.label ?? formatDatabaseEnumLabel
  const labelList = (values: string[]) => values.map((value) => label(value))
  const date = formatters.date ?? defaultDate
  const money = formatters.money ?? defaultMoney
  const meta = objectRecord(input.supportMeta) ?? {}
  const customOrder = objectRecord(meta.customOrder)
  const fabricReference = objectRecord(meta.fabricReference)
  const fabricSourcing = objectRecord(meta.fabricSourcing)
  const customerFabricProof = objectRecord(meta.customerFabricProof)
  const suggestedVendor = objectRecord(fabricSourcing?.suggestedVendor)
  const bulkOrder = objectRecord(meta.bulkOrder)
  const fitProfile = objectRecord(meta.fitProfile)
  const styleAlignment = objectRecord(meta.styleAlignment)
  const measurementFallback = objectRecord(meta.measurementFallback)
  const snapshot = objectRecord(input.measurementSnapshot)

  const custom = input.customDetail ?? null
  const title = input.orderKind === 'READY_MADE' ? 'Purchase dossier' : 'Brief dossier'
  const targetDate =
    date(custom?.targetDeliveryDate) ??
    date(stringValue(customOrder?.targetDeliveryDate)) ??
    date(input.quotedCompletionDate) ??
    date(input.deadline)

  const summaryRows = [
    row('garment', input.orderKind === 'READY_MADE' ? 'Item' : 'Garment', custom?.garmentTypeOther ?? input.itemTitle ?? input.garmentType),
    row('selected_type', 'Selected type', custom?.garmentTypeOther ? input.garmentType : null),
    row('fit_category', 'Fit category', custom?.genderPresentation ?? stringValue(customOrder?.genderPresentation)),
    row('size', 'Size', input.itemSize),
    row('quantity', 'Quantity', typeof input.itemQuantity === 'number' ? String(input.itemQuantity) : null),
    row('stage', 'Status', label(input.stage, 'In progress')),
    row('amount', input.orderKind === 'READY_MADE' ? 'Item price' : 'Quote', money(input.quotedAmount, input.quotedCurrency)),
    row('occasion', 'Occasion', input.occasion),
    row('target_date', 'Target delivery', targetDate),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const styleLinks = [
    ...stringList(meta.styleReferenceLinks),
    ...stringList(meta.styleInspirationLinks),
    ...(custom?.socialReferenceLinks ?? []),
  ]
  const styleRows = [
    row('brief', 'Brief', input.garmentDescription, 'stacked'),
    row('style_notes', 'Style notes', custom?.styleNotes ?? stringValue(meta.styleNotes), 'stacked'),
    chipRow('style_attributes', 'Style attributes', stringList(meta.styleAttributes)),
    mediaRow('reference_photos', 'Style reference media', input.referencePhotos, numberValue(styleAlignment?.referencePhotoCount)),
    linkRow('style_links', 'Style reference links', styleLinks),
    row('alignment_instruction', 'Tailor review', stringValue(styleAlignment?.instruction), 'stacked'),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const fabricMedia = [
    ...stringList(fabricReference?.mediaUrls),
    ...stringList(customerFabricProof?.mediaUrls),
    ...stringList(fabricSourcing?.referenceMediaUrls),
  ]
  const fabricLinks = [
    ...stringList(fabricReference?.links),
    ...stringList(fabricReference?.referenceLinks),
    ...stringList(customerFabricProof?.referenceLinks),
    ...stringList(fabricSourcing?.referenceLinks),
  ]
  const fabricBudgetAmount = numberValue(fabricSourcing?.budgetAmount) ?? custom?.fabricBudgetAmount ?? null
  const fabricBudgetCurrency = stringValue(fabricSourcing?.budgetCurrency) ?? custom?.fabricBudgetCurrency ?? input.quotedCurrency ?? null
  const fabricRows = [
    row('source', 'Fabric source', input.fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer supplies fabric' : input.fabricSource === 'TAILOR_SOURCES' ? 'Tailor sources fabric' : label(input.fabricSource, 'Fabric source')),
    row('description', 'Fabric description', custom?.fabricDescription ?? stringValue(fabricSourcing?.description), 'stacked'),
    row('budget', 'Fabric budget', fabricBudgetAmount ? money(fabricBudgetAmount, fabricBudgetCurrency) : null),
    row('deadline', 'Sourcing deadline', date(custom?.fabricSourcingDeadlineAt) ?? countLabel(custom?.fabricSourcingDeadlineDays ?? numberValue(fabricSourcing?.deadlineBusinessDays), 'business day')),
    row(
      'substitution',
      'Substitution rule',
      fabricSourcing
        ? stringValue(fabricSourcing.substitutionLabel) ?? label(stringValue(fabricSourcing.substitutionPreference), 'Ask before substituting')
        : null,
    ),
    mediaRow('fabric_media', 'Fabric reference media', fabricMedia, numberValue(fabricReference?.mediaCount) ?? numberValue(customerFabricProof?.mediaCount) ?? numberValue(fabricSourcing?.referenceMediaCount)),
    linkRow('fabric_links', 'Fabric reference links', fabricLinks),
    row('handoff', 'Fabric handoff', stringValue(meta.fabricHandoffLabel) ?? label(stringValue(meta.fabricHandoffMode), 'Not set'), 'stacked'),
    row('vendor_name', 'Suggested vendor', stringValue(suggestedVendor?.name), 'stacked'),
    row('vendor_location', 'Vendor location', stringValue(suggestedVendor?.location), 'stacked'),
    row('vendor_link', 'Vendor link', stringValue(suggestedVendor?.link), 'stacked'),
    row('vendor_notes', 'Vendor notes', stringValue(suggestedVendor?.notes), 'stacked'),
    row('approval', 'Fabric approval', label(custom?.fabricApprovalStatus ?? stringValue(fabricSourcing?.status), 'Not required')),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const bodyFlags = labelList([
    ...stringList(snapshot?.fitFlags),
    ...stringList(snapshot?.bodyFlags),
    ...stringList(snapshot?.symmetryFlags),
    ...stringList(fitProfile?.bodyFlags),
    ...stringList(fitProfile?.symmetryFlags),
  ])
  const bodyShapes = labelList(
    Array.isArray(snapshot?.bodyShape)
      ? stringList(snapshot?.bodyShape)
      : stringList([snapshot?.bodyShape]),
  )
  const measurementsRows = [
    row('wearer', 'Wearer', input.wearerLabel ?? stringValue(objectRecord(meta.wearerContext)?.label)),
    row('source', 'Measurement source', input.measurementSourceLabel ?? stringValue(snapshot?.measurementSourceLabel)),
    row('confidence', 'Fit confidence', input.fitConfidenceLabel ?? stringValue(snapshot?.confidenceOverall)),
    row('age', 'Last updated', input.measurementAgeLabel),
    row('cut_context', 'Cut context', label(stringValue(snapshot?.garmentContext)), 'stacked'),
    row('body_shape', 'Body shape', bodyShapes.join(', ')),
    chipRow('body_flags', 'Body context', bodyFlags),
    row('body_note', 'Body note', custom?.bodyNote ?? stringValue(meta.bodyNote) ?? stringValue(snapshot?.bodyNote) ?? stringValue(measurementFallback?.note), 'stacked'),
    row('fit_notes', 'Fit notes', stringValue(fitProfile?.styleEaseNotes) ?? stringValue(fitProfile?.tailorMeasurementOverrideReason), 'stacked'),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const fulfillmentRows = [
    row('method', 'Fulfillment', input.deliveryMethod === 'LOCAL_COLLECTION' ? 'Local collection' : input.deliveryMethod === 'LOCAL_DELIVERY' ? 'Local delivery' : input.deliveryMethod === 'SHIPPING' ? 'Shipping' : label(input.deliveryMethod, 'Fulfillment')),
    row('recipient', 'Recipient', input.recipientName),
    row('phone', 'Recipient phone', input.recipientPhone),
    row('address', input.deliveryMethod === 'LOCAL_DELIVERY' ? 'Deliver to' : 'Ship to', input.deliveryAddress, 'stacked'),
    row('preference', 'Shipping preference', label(custom?.shippingPreference)),
    row('instructions', 'Delivery instructions', custom?.deliveryInstructions ?? stringValue(meta.deliveryInstructions), 'stacked'),
    row('provider', 'Provider', input.fulfillmentProvider ?? input.carrier),
    row('reference', 'Fulfillment reference', input.fulfillmentReference),
    row('tracking', 'Tracking', input.trackingNumber ? [input.trackingNumber, input.fulfillmentProvider ?? input.carrier].filter(Boolean).join(' · ') : null, 'stacked'),
    row('contact', 'Fulfillment contact', input.fulfillmentContactName),
    row('contact_phone', 'Fulfillment phone', input.fulfillmentContactPhone),
    row('collection_code', 'Collection code', input.collectionCode),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const memberNames = stringList(bulkOrder?.memberNames)
  const bulkRows = [
    row('status', 'Group order', bulkOrder?.enabled === true ? 'Bulk or group brief' : null),
    row('label', 'Group label', stringValue(bulkOrder?.label)),
    row('recipient_count', 'Recipients', countLabel(numberValue(bulkOrder?.recipientCount) ?? input.bulkMemberCount, 'recipient')),
    row('fabric_mode', 'Fabric mode', stringValue(bulkOrder?.fabricModeLabel) ?? label(stringValue(bulkOrder?.fabricMode), 'Not set')),
    row('measurement_policy', 'Measurement policy', stringValue(bulkOrder?.memberMeasurementPolicy), 'stacked'),
    row('members', 'Members', memberNames.length > 0 ? memberNames.join('\n') : null, 'stacked'),
    row('notes', 'Bulk notes', stringValue(bulkOrder?.notes), 'stacked'),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const messagesProofRows = [
    mediaRow('proof_media', 'Production proof', input.proofMediaUrls),
    row('message_count', 'Messages', countLabel(input.messageCount, 'message')),
    row('fabric_tracking', 'Fabric tracking', input.fabricTracking, 'stacked'),
    row('customer_expectation', 'Reference expectation', stringValue(styleAlignment?.customerExpectation), 'stacked'),
  ].filter((item): item is BriefDossierRow => Boolean(item))

  const sections: BriefDossierSection[] = []
  addSection(sections, { id: 'summary', title: 'Summary', rows: summaryRows })
  addSection(sections, { id: 'style_refs', title: 'Style refs', summary: 'Reference media, links, and notes the tailor should match or interpret.', rows: styleRows })
  addSection(sections, { id: 'fabric_plan', title: 'Fabric plan', summary: 'Who provides fabric, budget, references, vendor hints, and handoff expectations.', rows: fabricRows })
  addSection(sections, { id: 'measurements', title: 'Measurements/body profile', summary: 'Fit context that should influence quote, pattern, and cutting decisions.', rows: measurementsRows })
  addSection(sections, { id: 'fulfillment', title: 'Fulfillment', summary: 'Delivery, pickup, recipient, and tracking details.', rows: fulfillmentRows })
  addSection(sections, { id: 'bulk_recipients', title: 'Bulk recipients', summary: 'Group-order details that should stay out of cramped fact rows.', rows: bulkRows })
  addSection(sections, { id: 'messages_proof', title: 'Messages/proof', summary: 'Proof, references, and conversation context tied to the order record.', rows: messagesProofRows })

  return { title, sections }
}
