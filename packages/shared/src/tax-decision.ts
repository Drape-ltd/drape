import type { CommercialTransactionPurpose, OrderPaymentPhase } from './commercial-contracts'

/**
 * Dormant Implementation 11A contracts.
 *
 * These values describe the reviewed decision graph. They do not activate the
 * graph for checkout; existing tax pricing remains authoritative until an
 * exact corridor and transaction type are allowlisted by a later policy.
 */
export const TAX_FULFILLMENT_POLICY_VERSION = 'tax-fulfillment-2026-08-15-v1' as const

export const TAX_TRANSACTION_TYPES = [
  'CUSTOM_ORDER',
  'READY_MADE_ORDER',
  'CONSULTATION',
  'MATERIAL_ADVANCE',
  'ORDER_AMENDMENT',
  'FULFILLMENT_CHARGE',
  'TIP_OR_GRATUITY',
] as const
export type TaxTransactionType = (typeof TAX_TRANSACTION_TYPES)[number]

export const TAX_FULFILLMENT_CLASSIFICATIONS = [
  'LOCAL_COLLECTION',
  'LOCAL_DELIVERY',
  'INTERNATIONAL_SHIPPING',
] as const
export type TaxFulfillmentClassification = (typeof TAX_FULFILLMENT_CLASSIFICATIONS)[number]

export const TAX_SUPPLY_CHARACTERIZATIONS = [
  'GOODS',
  'SERVICES',
  'COMPOSITE',
  'ANCILLARY',
  'GRATUITY',
  'OUT_OF_SCOPE',
  'JURISDICTION_SPECIFIC',
] as const
export type TaxSupplyCharacterization = (typeof TAX_SUPPLY_CHARACTERIZATIONS)[number]

export const TAX_LIABILITY_GRANULARITIES = ['ORDER', 'LINE_GROUP'] as const
export type TaxLiabilityGranularity = (typeof TAX_LIABILITY_GRANULARITIES)[number]

export const TAX_RESPONSIBLE_PARTIES = [
  'TAILOR',
  'DRAPEON_MARKETPLACE_FACILITATOR',
  'CUSTOMER_IMPORTER',
] as const
export type TaxResponsibleParty = (typeof TAX_RESPONSIBLE_PARTIES)[number]

export const TAX_REGISTRATION_SUBJECTS = ['TAILOR', 'DRAPEON', 'CUSTOMER_IMPORTER'] as const
export type TaxRegistrationSubject = (typeof TAX_REGISTRATION_SUBJECTS)[number]

export const TAX_REGISTRATION_RULE_TYPES = [
  'MANDATORY',
  'THRESHOLD',
  'NOT_REQUIRED',
  'BLOCKED',
] as const
export type TaxRegistrationRuleType = (typeof TAX_REGISTRATION_RULE_TYPES)[number]

export const TAX_REGISTRATION_DECISIONS = [
  'REGISTERED',
  'NOT_REGISTERED',
  'NOT_REQUIRED',
  'CUSTOMER_IMPORTER',
  'BLOCKED',
] as const
export type TaxRegistrationDecision = (typeof TAX_REGISTRATION_DECISIONS)[number]

export const TAX_LINE_CLASSES = [
  'STANDARD',
  'ZERO_RATED',
  'EXEMPT',
  'JURISDICTION_SPECIFIC',
] as const
export type TaxLineClass = (typeof TAX_LINE_CLASSES)[number]

export const TAX_COLLECTION_MODES = [
  'COLLECTED_AT_CHECKOUT',
  'PAYABLE_ON_IMPORT',
  'BLOCKED',
] as const
export type TaxCollectionMode = (typeof TAX_COLLECTION_MODES)[number]

export const TAX_ACTIVATION_ENVIRONMENTS = ['DEVELOPMENT', 'PRODUCTION'] as const
export type TaxActivationEnvironment = (typeof TAX_ACTIVATION_ENVIRONMENTS)[number]

export const TAX_ACTIVATION_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED', 'EXPIRED'] as const
export type TaxActivationStatus = (typeof TAX_ACTIVATION_STATUSES)[number]

export const TAX_REGISTRATION_FACT_STATUSES = [
  'REGISTERED',
  'NOT_REGISTERED',
  'NOT_REQUIRED',
  'CUSTOMER_IMPORTER',
  'BLOCKED',
] as const

export const TAX_DECISION_LINE_KEYS = [
  'TAILORING',
  'FABRIC_ALLOWANCE',
  'READY_MADE_ITEM',
  'CONSULTATION',
  'MATERIAL_ADVANCE',
  'ORDER_AMENDMENT',
  'FULFILLMENT',
  'TIP',
] as const
export type TaxDecisionLineKey = (typeof TAX_DECISION_LINE_KEYS)[number]

export const TAX_CONTROL_STATUSES = [
  'DRAFT',
  'REVIEW_PENDING',
  'APPROVED',
  'ACTIVE',
  'SUPERSEDED',
  'EXPIRED',
  'BLOCKED',
] as const
export type TaxControlStatus = (typeof TAX_CONTROL_STATUSES)[number]

export const TAX_DECISION_BLOCKED_REASONS = [
  'UNSUPPORTED_TRANSACTION_TYPE',
  'UNDERLYING_TRANSACTION_TYPE_REQUIRED',
  'ORDER_KIND_REQUIRED',
  'MISSING_JURISDICTION_CONTROL',
  'CONTROL_NOT_ACTIVE',
  'CONTROL_NOT_EFFECTIVE',
  'CONTROL_REVIEW_EXPIRED',
  'CONTROL_CONFLICT',
  'CONTROL_RESOLUTION_FAILED',
  'CONTROL_POLICY_MISMATCH',
  'UNSUPPORTED_LIABILITY_GRANULARITY',
  'MISSING_SOURCE_REVIEW',
  'MISSING_REGISTRATION_RULE',
  'MISSING_CORRIDOR_CONTROL',
  'OTHER_REVIEWED_REQUIRES_TAX_MAPPING',
] as const
export type TaxDecisionBlockedReason = (typeof TAX_DECISION_BLOCKED_REASONS)[number]

export type VerifiedTaxLocation = {
  countryCode: string
  regionCode: string | null
  postalCode: string | null
  city: string | null
  addressLine1: string
  verificationSource: string
  verifiedAt: string
}

export type ReviewedTaxResponsibilityControl = {
  controlId: string
  controlKey: string
  policyVersion: string
  status: TaxControlStatus
  jurisdictionCountryCode: string
  jurisdictionRegionCode: string | null
  transactionType: TaxTransactionType
  fulfillmentClassification: TaxFulfillmentClassification
  supplyCharacterization: TaxSupplyCharacterization
  liabilityGranularity: TaxLiabilityGranularity
  responsibleParty: TaxResponsibleParty
  statutoryRole: string
  registrationSubject: TaxRegistrationSubject
  registrationRuleId: string
  marketplaceFacilitatorApplies: boolean
  collectionMode: TaxCollectionMode
  calculationStrategy: string
  providerReference: string | null
  invoiceTreatment: string
  filingLiabilityAccount: string
  amendmentMayInherit: boolean
  sourceUrls: readonly string[]
  legalReviewer: string
  financeApprover: string
  engineeringApprover: string
  reviewedAt: string
  reviewDueAt: string
  effectiveFrom: string
  effectiveTo: string | null
  supersedesControlId: string | null
  changeReason: string
}

export type TaxDecisionReceiptSnapshot = {
  policyVersion: string
  controlId: string
  transactionType: TaxTransactionType
  fulfillmentClassification: TaxFulfillmentClassification
  origin: VerifiedTaxLocation | null
  destination: VerifiedTaxLocation | null
  corridorKey: string | null
  jurisdictionCountryCode: string
  jurisdictionRegionCode: string | null
  supplyCharacterization: TaxSupplyCharacterization
  liabilityGranularity: TaxLiabilityGranularity
  responsibleParty: TaxResponsibleParty
  registrationSubject: TaxRegistrationSubject
  registrationDecision: TaxRegistrationDecision
  lineClasses: readonly TaxLineClass[]
  collectionMode: TaxCollectionMode
  sourceUrls: readonly string[]
  reviewedAt: string
  reviewDueAt: string
  correlationId: string
}

export type TaxPolicyActivation = {
  activationId: string
  environment: TaxActivationEnvironment
  policyVersion: string
  status: TaxActivationStatus
  jurisdictionCountryCode: string
  jurisdictionRegionCode: string | null
  originCountryCode: string | null
  destinationCountryCode: string | null
  transactionType: TaxTransactionType
  fulfillmentClassification: TaxFulfillmentClassification
  effectiveFrom: string
  effectiveTo: string | null
  reviewedAt: string
  reviewDueAt: string
  legalReviewer: string
  financeApprover: string
  engineeringApprover: string
  sourceUrls: readonly string[]
}

export type TaxRegistrationFact = {
  factId: string
  registrationSubject: TaxRegistrationSubject
  subjectId: string
  jurisdictionCountryCode: string
  jurisdictionRegionCode: string | null
  transactionType: TaxTransactionType
  decision: TaxRegistrationDecision
  taxableTurnoverMinor: number | null
  turnoverCurrency: string | null
  measurementPeriod: string | null
  evidenceReferences: readonly string[]
  effectiveFrom: string
  effectiveTo: string | null
  reviewedAt: string
  reviewDueAt: string
}

export type TaxLineClassification = {
  lineKey: TaxDecisionLineKey
  lineClass: TaxLineClass
  taxable: boolean
  calculationStrategy: string
}

export type ActivatedTaxDecision = {
  activation: TaxPolicyActivation
  control: ReviewedTaxResponsibilityControl
  registrationDecision: TaxRegistrationDecision
  registrationFactId: string | null
  lines: readonly TaxLineClassification[]
  collectionMode: TaxCollectionMode
  shippingTaxable: boolean
}

export const INTERNATIONAL_TAX_BASES = [
  'SUBTOTAL',
  'SUBTOTAL_AND_SHIPPING',
  'SUBTOTAL_SHIPPING_AND_DUTY',
] as const
export type InternationalTaxBase = (typeof INTERNATIONAL_TAX_BASES)[number]

export type ReviewedInternationalChargeRule = {
  collectionMode: TaxCollectionMode
  importTaxRateBps: number | null
  dutyRateBps: number | null
  importTaxBase: InternationalTaxBase | null
  dutyBase: Exclude<InternationalTaxBase, 'SUBTOTAL_SHIPPING_AND_DUTY'> | null
}

function requireMinorUnit(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer in minor units.`)
  return value
}

function requireRate(value: number | null, field: string) {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0 || (value ?? 10_001) > 10_000) {
    throw new Error(`${field} must be a reviewed basis-point rate.`)
  }
  return value as number
}

function calculateRate(base: number, rateBps: number) {
  return Number((BigInt(base) * BigInt(rateBps) + BigInt(5_000)) / BigInt(10_000))
}

/**
 * Calculates only charges Drapeon is explicitly configured to collect.
 * PAYABLE_ON_IMPORT deliberately returns zero; BLOCKED never produces prices.
 */
export function calculateReviewedInternationalCharges(input: {
  subtotalAmount: number
  shippingAmount: number
  rule: ReviewedInternationalChargeRule
}): { importTaxAmount: number; dutyAmount: number } {
  const subtotal = requireMinorUnit(input.subtotalAmount, 'subtotalAmount')
  const shipping = requireMinorUnit(input.shippingAmount, 'shippingAmount')
  if (input.rule.collectionMode === 'BLOCKED') throw new Error('This international corridor is blocked.')
  if (input.rule.collectionMode === 'PAYABLE_ON_IMPORT') return { importTaxAmount: 0, dutyAmount: 0 }

  const dutyRate = requireRate(input.rule.dutyRateBps, 'dutyRateBps')
  const importRate = requireRate(input.rule.importTaxRateBps, 'importTaxRateBps')
  if (!input.rule.dutyBase || !input.rule.importTaxBase) throw new Error('Reviewed international charge bases are required.')
  const dutyBase = input.rule.dutyBase === 'SUBTOTAL_AND_SHIPPING' ? subtotal + shipping : subtotal
  const dutyAmount = calculateRate(dutyBase, dutyRate)
  const importBase = input.rule.importTaxBase === 'SUBTOTAL'
    ? subtotal
    : input.rule.importTaxBase === 'SUBTOTAL_AND_SHIPPING'
      ? subtotal + shipping
      : subtotal + shipping + dutyAmount
  return { dutyAmount, importTaxAmount: calculateRate(importBase, importRate) }
}

export type TaxActivationResolution =
  | { status: 'NOT_ACTIVATED' }
  | { status: 'RESOLVED'; activation: TaxPolicyActivation }
  | { status: 'BLOCKED'; reason: TaxDecisionBlockedReason }

export type TaxTransactionTypeResolution =
  | { status: 'RESOLVED'; transactionType: TaxTransactionType }
  | { status: 'BLOCKED'; reason: TaxDecisionBlockedReason }

export type ReviewedTaxControlResolution =
  | { status: 'RESOLVED'; control: ReviewedTaxResponsibilityControl }
  | { status: 'BLOCKED'; reason: TaxDecisionBlockedReason }

const TAX_TRANSACTION_TYPE_SET = new Set<string>(TAX_TRANSACTION_TYPES)
const TAX_DECISION_BLOCKED_REASON_SET = new Set<string>(TAX_DECISION_BLOCKED_REASONS)
const TAX_FULFILLMENT_SET = new Set<string>(TAX_FULFILLMENT_CLASSIFICATIONS)
const TAX_SUPPLY_SET = new Set<string>(TAX_SUPPLY_CHARACTERIZATIONS)
const TAX_RESPONSIBLE_PARTY_SET = new Set<string>(TAX_RESPONSIBLE_PARTIES)
const TAX_REGISTRATION_SUBJECT_SET = new Set<string>(TAX_REGISTRATION_SUBJECTS)
const TAX_COLLECTION_MODE_SET = new Set<string>(TAX_COLLECTION_MODES)
const TAX_CONTROL_STATUS_SET = new Set<string>(TAX_CONTROL_STATUSES)
const TAX_ACTIVATION_STATUS_SET = new Set<string>(TAX_ACTIVATION_STATUSES)
const TAX_ACTIVATION_ENVIRONMENT_SET = new Set<string>(TAX_ACTIVATION_ENVIRONMENTS)
const TAX_LINE_KEY_SET = new Set<string>(TAX_DECISION_LINE_KEYS)

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDate(value: unknown): value is string {
  return isNonEmpty(value) && Number.isFinite(Date.parse(value))
}

function normalizeCountryCode(value: unknown): string | null {
  if (!isNonEmpty(value)) return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : null
}

function normalizeRegionCode(value: unknown): string | null {
  if (!isNonEmpty(value)) return null
  return value.trim().toUpperCase()
}

export function isTaxTransactionType(value: unknown): value is TaxTransactionType {
  return typeof value === 'string' && TAX_TRANSACTION_TYPE_SET.has(value)
}

export function isTaxDecisionBlockedReason(value: unknown): value is TaxDecisionBlockedReason {
  return typeof value === 'string' && TAX_DECISION_BLOCKED_REASON_SET.has(value)
}

export function isVerifiedTaxLocation(value: unknown): value is VerifiedTaxLocation {
  if (!value || typeof value !== 'object') return false
  const location = value as Partial<VerifiedTaxLocation>
  return normalizeCountryCode(location.countryCode) !== null
    && isNonEmpty(location.addressLine1)
    && isNonEmpty(location.verificationSource)
    && isIsoDate(location.verifiedAt)
    && (location.regionCode === null || typeof location.regionCode === 'string')
    && (location.postalCode === null || typeof location.postalCode === 'string')
    && (location.city === null || typeof location.city === 'string')
}

export function deriveTaxTransactionType(input: {
  orderKind?: unknown
  paymentPhase?: OrderPaymentPhase | unknown
  purpose?: CommercialTransactionPurpose | unknown
  underlyingTransactionType?: unknown
}): TaxTransactionTypeResolution {
  const phase = typeof input.paymentPhase === 'string' ? input.paymentPhase : null
  const purpose = typeof input.purpose === 'string' ? input.purpose : null
  const commercialEvent = purpose ?? phase

  if (commercialEvent === 'PROMOTIONAL_COVERAGE') {
    return isTaxTransactionType(input.underlyingTransactionType)
      ? { status: 'RESOLVED', transactionType: input.underlyingTransactionType }
      : { status: 'BLOCKED', reason: 'UNDERLYING_TRANSACTION_TYPE_REQUIRED' }
  }
  if (commercialEvent === 'OTHER_REVIEWED') {
    return { status: 'BLOCKED', reason: 'OTHER_REVIEWED_REQUIRES_TAX_MAPPING' }
  }
  if (commercialEvent === 'CONSULTATION') return { status: 'RESOLVED', transactionType: 'CONSULTATION' }
  if (commercialEvent === 'MATERIAL_ADVANCE') return { status: 'RESOLVED', transactionType: 'MATERIAL_ADVANCE' }
  if (commercialEvent === 'ADJUSTMENT' || commercialEvent === 'ORDER_ADJUSTMENT') {
    return { status: 'RESOLVED', transactionType: 'ORDER_AMENDMENT' }
  }
  if (commercialEvent === 'FULFILLMENT') return { status: 'RESOLVED', transactionType: 'FULFILLMENT_CHARGE' }
  if (commercialEvent === 'TIP') return { status: 'RESOLVED', transactionType: 'TIP_OR_GRATUITY' }
  if (commercialEvent === 'INITIAL_ORDER') {
    if (input.orderKind === 'CUSTOM') return { status: 'RESOLVED', transactionType: 'CUSTOM_ORDER' }
    if (input.orderKind === 'READY_MADE') return { status: 'RESOLVED', transactionType: 'READY_MADE_ORDER' }
    return { status: 'BLOCKED', reason: 'ORDER_KIND_REQUIRED' }
  }

  return { status: 'BLOCKED', reason: 'UNSUPPORTED_TRANSACTION_TYPE' }
}

export function validateReviewedTaxResponsibilityControl(
  value: ReviewedTaxResponsibilityControl,
  options: { launchPolicyVersion?: string } = {},
): TaxDecisionBlockedReason | null {
  if (!isNonEmpty(value.policyVersion) || (options.launchPolicyVersion && value.policyVersion !== options.launchPolicyVersion)) {
    return 'CONTROL_POLICY_MISMATCH'
  }
  if (!isNonEmpty(value.controlId) || !isNonEmpty(value.controlKey)) return 'MISSING_JURISDICTION_CONTROL'
  if (!TAX_CONTROL_STATUS_SET.has(value.status)) return 'CONTROL_NOT_ACTIVE'
  if (!normalizeCountryCode(value.jurisdictionCountryCode)) return 'MISSING_JURISDICTION_CONTROL'
  if (!TAX_TRANSACTION_TYPE_SET.has(value.transactionType)) return 'UNSUPPORTED_TRANSACTION_TYPE'
  if (!TAX_FULFILLMENT_SET.has(value.fulfillmentClassification)) return 'MISSING_CORRIDOR_CONTROL'
  if (!TAX_SUPPLY_SET.has(value.supplyCharacterization)) return 'MISSING_JURISDICTION_CONTROL'
  if (value.liabilityGranularity !== 'ORDER') return 'UNSUPPORTED_LIABILITY_GRANULARITY'
  if (!TAX_RESPONSIBLE_PARTY_SET.has(value.responsibleParty)) return 'MISSING_JURISDICTION_CONTROL'
  if (!TAX_REGISTRATION_SUBJECT_SET.has(value.registrationSubject) || !isNonEmpty(value.registrationRuleId)) {
    return 'MISSING_REGISTRATION_RULE'
  }
  if (!TAX_COLLECTION_MODE_SET.has(value.collectionMode)) return 'MISSING_CORRIDOR_CONTROL'
  if (
    value.sourceUrls.length === 0
    || value.sourceUrls.some((source) => !/^https:\/\//u.test(source))
    || !isNonEmpty(value.legalReviewer)
    || !isNonEmpty(value.financeApprover)
    || !isNonEmpty(value.engineeringApprover)
    || !isIsoDate(value.reviewedAt)
    || !isIsoDate(value.reviewDueAt)
  ) return 'MISSING_SOURCE_REVIEW'
  if (!isIsoDate(value.effectiveFrom) || (value.effectiveTo !== null && !isIsoDate(value.effectiveTo))) {
    return 'CONTROL_NOT_EFFECTIVE'
  }
  if (Date.parse(value.reviewDueAt) <= Date.parse(value.reviewedAt)) return 'MISSING_SOURCE_REVIEW'
  if (value.effectiveTo !== null && Date.parse(value.effectiveTo) <= Date.parse(value.effectiveFrom)) {
    return 'CONTROL_NOT_EFFECTIVE'
  }
  return null
}

export function resolveReviewedTaxResponsibilityControl(input: {
  controls: readonly ReviewedTaxResponsibilityControl[]
  policyVersion: string
  jurisdictionCountryCode: unknown
  jurisdictionRegionCode?: unknown
  transactionType: unknown
  fulfillmentClassification: unknown
  at?: Date | string
}): ReviewedTaxControlResolution {
  if (!isTaxTransactionType(input.transactionType)) {
    return { status: 'BLOCKED', reason: 'UNSUPPORTED_TRANSACTION_TYPE' }
  }
  if (typeof input.fulfillmentClassification !== 'string' || !TAX_FULFILLMENT_SET.has(input.fulfillmentClassification)) {
    return { status: 'BLOCKED', reason: 'MISSING_CORRIDOR_CONTROL' }
  }

  const countryCode = normalizeCountryCode(input.jurisdictionCountryCode)
  if (!countryCode) return { status: 'BLOCKED', reason: 'MISSING_JURISDICTION_CONTROL' }
  const regionCode = normalizeRegionCode(input.jurisdictionRegionCode)
  const at = input.at instanceof Date ? input.at : new Date(input.at ?? Date.now())
  if (!Number.isFinite(at.getTime())) return { status: 'BLOCKED', reason: 'CONTROL_NOT_EFFECTIVE' }

  const scoped = input.controls.filter((control) => (
    control.policyVersion === input.policyVersion
    && normalizeCountryCode(control.jurisdictionCountryCode) === countryCode
    && control.transactionType === input.transactionType
    && control.fulfillmentClassification === input.fulfillmentClassification
    && (normalizeRegionCode(control.jurisdictionRegionCode) === regionCode || control.jurisdictionRegionCode === null)
  ))
  if (scoped.length === 0) return { status: 'BLOCKED', reason: 'MISSING_JURISDICTION_CONTROL' }

  const active = scoped.filter((control) => control.status === 'ACTIVE')
  if (active.length === 0) return { status: 'BLOCKED', reason: 'CONTROL_NOT_ACTIVE' }

  const effective = active.filter((control) => {
    const from = Date.parse(control.effectiveFrom)
    const to = control.effectiveTo ? Date.parse(control.effectiveTo) : Number.POSITIVE_INFINITY
    return Number.isFinite(from) && from <= at.getTime() && at.getTime() < to
  })
  if (effective.length === 0) return { status: 'BLOCKED', reason: 'CONTROL_NOT_EFFECTIVE' }

  const exactRegion = regionCode
    ? effective.filter((control) => normalizeRegionCode(control.jurisdictionRegionCode) === regionCode)
    : []
  const selectedPool = exactRegion.length > 0 ? exactRegion : effective.filter((control) => control.jurisdictionRegionCode === null)
  if (selectedPool.length === 0) return { status: 'BLOCKED', reason: 'MISSING_JURISDICTION_CONTROL' }
  if (selectedPool.length > 1) return { status: 'BLOCKED', reason: 'CONTROL_CONFLICT' }

  const control = selectedPool[0]
  if (!control) return { status: 'BLOCKED', reason: 'MISSING_JURISDICTION_CONTROL' }
  const validationFailure = validateReviewedTaxResponsibilityControl(control, {
    launchPolicyVersion: input.policyVersion,
  })
  if (validationFailure) return { status: 'BLOCKED', reason: validationFailure }
  if (Date.parse(control.reviewDueAt) <= at.getTime()) {
    return { status: 'BLOCKED', reason: 'CONTROL_REVIEW_EXPIRED' }
  }

  return { status: 'RESOLVED', control }
}

export function resolveTaxPolicyActivation(input: {
  activations: readonly TaxPolicyActivation[]
  environment: unknown
  policyVersion: string
  jurisdictionCountryCode: unknown
  jurisdictionRegionCode?: unknown
  originCountryCode?: unknown
  destinationCountryCode?: unknown
  transactionType: unknown
  fulfillmentClassification: unknown
  at?: Date | string
}): TaxActivationResolution {
  if (typeof input.environment !== 'string' || !TAX_ACTIVATION_ENVIRONMENT_SET.has(input.environment)) {
    return { status: 'BLOCKED', reason: 'CONTROL_POLICY_MISMATCH' }
  }
  if (!isTaxTransactionType(input.transactionType)) {
    return { status: 'BLOCKED', reason: 'UNSUPPORTED_TRANSACTION_TYPE' }
  }
  if (typeof input.fulfillmentClassification !== 'string' || !TAX_FULFILLMENT_SET.has(input.fulfillmentClassification)) {
    return { status: 'BLOCKED', reason: 'MISSING_CORRIDOR_CONTROL' }
  }
  const country = normalizeCountryCode(input.jurisdictionCountryCode)
  if (!country) return { status: 'BLOCKED', reason: 'MISSING_JURISDICTION_CONTROL' }
  const region = normalizeRegionCode(input.jurisdictionRegionCode)
  const origin = normalizeCountryCode(input.originCountryCode)
  const destination = normalizeCountryCode(input.destinationCountryCode)
  const at = input.at instanceof Date ? input.at : new Date(input.at ?? Date.now())
  if (!Number.isFinite(at.getTime())) return { status: 'BLOCKED', reason: 'CONTROL_NOT_EFFECTIVE' }

  const scoped = input.activations.filter((activation) => (
    activation.environment === input.environment
    && activation.policyVersion === input.policyVersion
    && normalizeCountryCode(activation.jurisdictionCountryCode) === country
    && activation.transactionType === input.transactionType
    && activation.fulfillmentClassification === input.fulfillmentClassification
    && (normalizeRegionCode(activation.jurisdictionRegionCode) === region || activation.jurisdictionRegionCode === null)
    && (activation.originCountryCode === null || normalizeCountryCode(activation.originCountryCode) === origin)
    && (activation.destinationCountryCode === null || normalizeCountryCode(activation.destinationCountryCode) === destination)
  ))
  if (scoped.length === 0) return { status: 'NOT_ACTIVATED' }

  const active = scoped.filter((activation) => activation.status === 'ACTIVE')
  if (active.length === 0) return { status: 'BLOCKED', reason: 'CONTROL_NOT_ACTIVE' }
  const effective = active.filter((activation) => (
    Date.parse(activation.effectiveFrom) <= at.getTime()
    && (activation.effectiveTo === null || at.getTime() < Date.parse(activation.effectiveTo))
  ))
  if (effective.length === 0) return { status: 'BLOCKED', reason: 'CONTROL_NOT_EFFECTIVE' }
  const exactRegion = region
    ? effective.filter((activation) => normalizeRegionCode(activation.jurisdictionRegionCode) === region)
    : []
  const pool = exactRegion.length > 0 ? exactRegion : effective.filter((activation) => activation.jurisdictionRegionCode === null)
  if (pool.length !== 1) return { status: 'BLOCKED', reason: 'CONTROL_CONFLICT' }
  const activation = pool[0]!
  if (Date.parse(activation.reviewDueAt) <= at.getTime()) {
    return { status: 'BLOCKED', reason: 'CONTROL_REVIEW_EXPIRED' }
  }
  if (
    !TAX_ACTIVATION_STATUS_SET.has(activation.status)
    || !isIsoDate(activation.reviewedAt)
    || !isIsoDate(activation.reviewDueAt)
    || activation.sourceUrls.length === 0
    || activation.sourceUrls.some((source) => !/^https:\/\//u.test(source))
    || !isNonEmpty(activation.legalReviewer)
    || !isNonEmpty(activation.financeApprover)
    || !isNonEmpty(activation.engineeringApprover)
  ) return { status: 'BLOCKED', reason: 'MISSING_SOURCE_REVIEW' }
  return { status: 'RESOLVED', activation }
}

export function resolveRegistrationDecision(input: {
  control: ReviewedTaxResponsibilityControl
  registrationRuleType: TaxRegistrationRuleType
  thresholdAmountMinor?: number | null
  thresholdCurrency?: string | null
  fact?: TaxRegistrationFact | null
  at?: Date | string
}): { status: 'RESOLVED'; decision: TaxRegistrationDecision; factId: string | null } | { status: 'BLOCKED'; reason: TaxDecisionBlockedReason } {
  const at = input.at instanceof Date ? input.at : new Date(input.at ?? Date.now())
  if (input.registrationRuleType === 'BLOCKED') return { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  if (input.registrationRuleType === 'NOT_REQUIRED') {
    return { status: 'RESOLVED', decision: 'NOT_REQUIRED', factId: null }
  }
  const fact = input.fact
  if (!fact || !Number.isFinite(at.getTime())) return { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  if (
    fact.registrationSubject !== input.control.registrationSubject
    || fact.jurisdictionCountryCode !== input.control.jurisdictionCountryCode
    || fact.transactionType !== input.control.transactionType
    || Date.parse(fact.effectiveFrom) > at.getTime()
    || (fact.effectiveTo !== null && at.getTime() >= Date.parse(fact.effectiveTo))
    || Date.parse(fact.reviewDueAt) <= at.getTime()
  ) return { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  if (input.registrationRuleType === 'MANDATORY') {
    return fact.decision === 'REGISTERED' || fact.decision === 'CUSTOMER_IMPORTER'
      ? { status: 'RESOLVED', decision: fact.decision, factId: fact.factId }
      : { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  }
  const threshold = input.thresholdAmountMinor
  const currency = input.thresholdCurrency?.trim().toUpperCase() ?? null
  if (!Number.isSafeInteger(threshold) || (threshold ?? -1) < 0 || !currency) {
    return { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  }
  if (!Number.isSafeInteger(fact.taxableTurnoverMinor) || fact.turnoverCurrency?.trim().toUpperCase() !== currency) {
    return { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  }
  if ((fact.taxableTurnoverMinor ?? 0) >= (threshold ?? 0)) {
    return fact.decision === 'REGISTERED'
      ? { status: 'RESOLVED', decision: 'REGISTERED', factId: fact.factId }
      : { status: 'BLOCKED', reason: 'MISSING_REGISTRATION_RULE' }
  }
  return { status: 'RESOLVED', decision: 'NOT_REGISTERED', factId: fact.factId }
}

export function validateTaxLineClassifications(input: {
  requiredLineKeys: readonly TaxDecisionLineKey[]
  lines: readonly TaxLineClassification[]
}): TaxLineClassification[] | null {
  const unique = new Map<TaxDecisionLineKey, TaxLineClassification>()
  for (const line of input.lines) {
    if (!TAX_LINE_KEY_SET.has(line.lineKey) || unique.has(line.lineKey) || !TAX_LINE_CLASSES.includes(line.lineClass)) return null
    unique.set(line.lineKey, line)
  }
  const required = [...new Set(input.requiredLineKeys)]
  if (required.some((key) => !unique.has(key))) return null
  return required.map((key) => unique.get(key)!)
}

export const TAX_DECISION_BLOCKED_COPY: Readonly<Record<TaxDecisionBlockedReason, string>> = {
  UNSUPPORTED_TRANSACTION_TYPE: 'This payment type is not available for tax calculation yet.',
  UNDERLYING_TRANSACTION_TYPE_REQUIRED: 'The underlying purchase must be identified before pricing can continue.',
  ORDER_KIND_REQUIRED: 'The order type must be confirmed before pricing can continue.',
  MISSING_JURISDICTION_CONTROL: 'Tax rules for this location have not been activated yet.',
  CONTROL_NOT_ACTIVE: 'Tax rules for this location are still under review.',
  CONTROL_NOT_EFFECTIVE: 'Tax rules for this date could not be confirmed.',
  CONTROL_REVIEW_EXPIRED: 'Tax rules for this location require review before checkout can continue.',
  CONTROL_CONFLICT: 'Conflicting tax rules were found. Drapeon must review this checkout.',
  CONTROL_RESOLUTION_FAILED: 'Tax rules could not be verified right now. No payment has been started.',
  CONTROL_POLICY_MISMATCH: 'This checkout uses a different tax policy version.',
  UNSUPPORTED_LIABILITY_GRANULARITY: 'This tax rule requires line-level responsibility that is not supported yet.',
  MISSING_SOURCE_REVIEW: 'Tax sources or review evidence are incomplete.',
  MISSING_REGISTRATION_RULE: 'Tax registration responsibility could not be confirmed.',
  MISSING_CORRIDOR_CONTROL: 'This fulfillment route has not been activated yet.',
  OTHER_REVIEWED_REQUIRES_TAX_MAPPING: 'This reviewed payment needs an approved tax classification before pricing.',
}

export function formatTaxDecisionBlockedReason(reason: TaxDecisionBlockedReason): string {
  return TAX_DECISION_BLOCKED_COPY[reason]
}

export function taxCollectionPromise(input: {
  collectionMode: TaxCollectionMode
  responsibleParty: TaxResponsibleParty
  destinationCountryCode?: string | null
}): { title: string; body: string } {
  if (input.collectionMode === 'COLLECTED_AT_CHECKOUT') {
    return { title: 'Tax included at checkout', body: 'Drapeon collects the displayed tax with this payment. No hidden tax is added by Drapeon afterward.' }
  }
  if (input.collectionMode === 'PAYABLE_ON_IMPORT') {
    const destination = input.destinationCountryCode?.trim().toUpperCase()
    return {
      title: 'Import charges are not included',
      body: `${input.responsibleParty === 'CUSTOMER_IMPORTER' ? 'The customer/importer' : 'The responsible importer'} may need to pay customs, import tax, duty, or carrier charges${destination ? ` in ${destination}` : ''}.`,
    }
  }
  return { title: 'Checkout unavailable for this route', body: 'Drapeon has not activated a reviewed tax and import treatment for this route.' }
}
