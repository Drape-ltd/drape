import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  TAX_FULFILLMENT_POLICY_VERSION,
  TAX_FULFILLMENT_CLASSIFICATIONS,
  isTaxDecisionBlockedReason,
  isTaxTransactionType,
  resolveRegistrationDecision,
  validateTaxLineClassifications,
  validateReviewedTaxResponsibilityControl,
  type ActivatedTaxDecision,
  type ReviewedTaxControlResolution,
  type ReviewedTaxResponsibilityControl,
  type TaxActivationEnvironment,
  type TaxDecisionBlockedReason,
  type TaxDecisionLineKey,
  type TaxFulfillmentClassification,
  type TaxLineClassification,
  type TaxPolicyActivation,
  type TaxRegistrationFact,
  type TaxTransactionType,
} from '../../../packages/shared/src/tax-decision.ts'

type ResolverRow = Record<string, unknown>

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function mapActivation(row: ResolverRow): TaxPolicyActivation {
  return {
    activationId: requiredString(row.activationId),
    environment: requiredString(row.environment) as TaxActivationEnvironment,
    policyVersion: requiredString(row.policyVersion),
    status: 'ACTIVE',
    jurisdictionCountryCode: requiredString(row.jurisdictionCountryCode),
    jurisdictionRegionCode: optionalString(row.jurisdictionRegionCode),
    originCountryCode: optionalString(row.originCountryCode),
    destinationCountryCode: optionalString(row.destinationCountryCode),
    transactionType: requiredString(row.transactionType) as TaxTransactionType,
    fulfillmentClassification: requiredString(row.fulfillmentClassification) as TaxFulfillmentClassification,
    effectiveFrom: requiredString(row.effectiveFrom),
    effectiveTo: optionalString(row.effectiveTo),
    reviewedAt: requiredString(row.reviewedAt),
    reviewDueAt: requiredString(row.reviewDueAt),
    legalReviewer: requiredString(row.legalReviewer),
    financeApprover: requiredString(row.financeApprover),
    engineeringApprover: requiredString(row.engineeringApprover),
    sourceUrls: Array.isArray(row.sourceUrls) ? row.sourceUrls.filter((value): value is string => typeof value === 'string') : [],
  }
}

function blocked(reason: unknown): { status: 'BLOCKED'; reason: TaxDecisionBlockedReason } {
  return { status: 'BLOCKED', reason: isTaxDecisionBlockedReason(reason) ? reason : 'CONTROL_RESOLUTION_FAILED' }
}

function requiredString(value: unknown): string {
  return optionalString(value) ?? ''
}

function mapResolverRow(row: ResolverRow): ReviewedTaxResponsibilityControl {
  return {
    controlId: requiredString(row.controlId),
    controlKey: requiredString(row.controlKey),
    policyVersion: requiredString(row.policyVersion),
    status: 'ACTIVE',
    jurisdictionCountryCode: requiredString(row.jurisdictionCountryCode),
    jurisdictionRegionCode: optionalString(row.jurisdictionRegionCode),
    transactionType: requiredString(row.transactionType) as TaxTransactionType,
    fulfillmentClassification: requiredString(row.fulfillmentClassification) as TaxFulfillmentClassification,
    supplyCharacterization: requiredString(row.supplyCharacterization) as ReviewedTaxResponsibilityControl['supplyCharacterization'],
    liabilityGranularity: requiredString(row.liabilityGranularity) as ReviewedTaxResponsibilityControl['liabilityGranularity'],
    responsibleParty: requiredString(row.responsibleParty) as ReviewedTaxResponsibilityControl['responsibleParty'],
    statutoryRole: requiredString(row.statutoryRole),
    registrationSubject: requiredString(row.registrationSubject) as ReviewedTaxResponsibilityControl['registrationSubject'],
    registrationRuleId: requiredString(row.registrationRuleId),
    marketplaceFacilitatorApplies: row.marketplaceFacilitatorApplies === true,
    collectionMode: requiredString(row.collectionMode) as ReviewedTaxResponsibilityControl['collectionMode'],
    calculationStrategy: requiredString(row.calculationStrategy),
    providerReference: optionalString(row.providerReference),
    invoiceTreatment: requiredString(row.invoiceTreatment),
    filingLiabilityAccount: requiredString(row.filingLiabilityAccount),
    amendmentMayInherit: row.amendmentMayInherit === true,
    sourceUrls: Array.isArray(row.sourceUrls) ? row.sourceUrls.filter((value): value is string => typeof value === 'string') : [],
    legalReviewer: requiredString(row.legalReviewer),
    financeApprover: requiredString(row.financeApprover),
    engineeringApprover: requiredString(row.engineeringApprover),
    reviewedAt: requiredString(row.reviewedAt),
    reviewDueAt: requiredString(row.reviewDueAt),
    effectiveFrom: requiredString(row.effectiveFrom),
    effectiveTo: optionalString(row.effectiveTo),
    supersedesControlId: optionalString(row.supersedesControlId),
    changeReason: requiredString(row.changeReason),
  }
}

/**
 * Service-only 11A resolver. This is intentionally not called by live pricing
 * yet; later activation must opt an exact policy, corridor, and transaction
 * type into the decision chain.
 */
export async function resolveReviewedTaxDecision(input: {
  supabase: SupabaseClient
  policyVersion: string
  originCountryCode?: string | null
  jurisdictionCountryCode: string
  jurisdictionRegionCode?: string | null
  transactionType: unknown
  fulfillmentClassification: unknown
  at?: string
}): Promise<ReviewedTaxControlResolution> {
  if (!isTaxTransactionType(input.transactionType)) {
    return { status: 'BLOCKED', reason: 'UNSUPPORTED_TRANSACTION_TYPE' }
  }
  if (
    typeof input.fulfillmentClassification !== 'string'
    || !(TAX_FULFILLMENT_CLASSIFICATIONS as readonly string[]).includes(input.fulfillmentClassification)
  ) return { status: 'BLOCKED', reason: 'MISSING_CORRIDOR_CONTROL' }

  const { data, error } = await input.supabase.rpc('resolve_reviewed_tax_responsibility_control', {
    p_policy_version: input.policyVersion,
    p_origin_country_code: input.originCountryCode ?? null,
    p_jurisdiction_country_code: input.jurisdictionCountryCode,
    p_jurisdiction_region_code: input.jurisdictionRegionCode ?? null,
    p_tax_transaction_type: input.transactionType,
    p_fulfillment_classification: input.fulfillmentClassification,
    p_at: input.at ?? new Date().toISOString(),
  })
  if (error || !data || typeof data !== 'object') {
    return { status: 'BLOCKED', reason: 'CONTROL_RESOLUTION_FAILED' }
  }

  const result = data as ResolverRow
  if (result.status !== 'RESOLVED') {
    const reason = result.reason
    return {
      status: 'BLOCKED',
      reason: isTaxDecisionBlockedReason(reason) ? reason : 'CONTROL_RESOLUTION_FAILED',
    }
  }

  const control = mapResolverRow(result)
  const invalid = validateReviewedTaxResponsibilityControl(control, {
    launchPolicyVersion: input.policyVersion,
  })
  return invalid ? { status: 'BLOCKED', reason: invalid } : { status: 'RESOLVED', control }
}

/**
 * Authoritative 11C-11E activation boundary. An absent exact activation keeps
 * legacy pricing in place. An activated scope must fully resolve or block
 * before a payment provider is initialized.
 */
export async function resolveActivatedTaxDecision(input: {
  supabase: SupabaseClient
  environment: TaxActivationEnvironment
  policyVersion?: string
  jurisdictionCountryCode: string
  jurisdictionRegionCode?: string | null
  originCountryCode?: string | null
  destinationCountryCode?: string | null
  transactionType: unknown
  fulfillmentClassification: unknown
  tailorId: string
  customerId: string
  requiredLineKeys: readonly TaxDecisionLineKey[]
  at?: string
}): Promise<
  | { status: 'NOT_ACTIVATED' }
  | { status: 'BLOCKED'; reason: TaxDecisionBlockedReason }
  | { status: 'RESOLVED'; decision: ActivatedTaxDecision; corridor: Record<string, unknown> | null }
> {
  if (!isTaxTransactionType(input.transactionType)) return blocked('UNSUPPORTED_TRANSACTION_TYPE')
  if (
    typeof input.fulfillmentClassification !== 'string'
    || !(TAX_FULFILLMENT_CLASSIFICATIONS as readonly string[]).includes(input.fulfillmentClassification)
  ) return blocked('MISSING_CORRIDOR_CONTROL')
  const policyVersion = input.policyVersion ?? TAX_FULFILLMENT_POLICY_VERSION
  const at = input.at ?? new Date().toISOString()
  const { data: activationData, error: activationError } = await input.supabase.rpc('resolve_tax_policy_activation', {
    p_environment: input.environment,
    p_policy_version: policyVersion,
    p_jurisdiction_country_code: input.jurisdictionCountryCode,
    p_jurisdiction_region_code: input.jurisdictionRegionCode ?? null,
    p_origin_country_code: input.originCountryCode ?? null,
    p_destination_country_code: input.destinationCountryCode ?? null,
    p_tax_transaction_type: input.transactionType,
    p_fulfillment_classification: input.fulfillmentClassification,
    p_at: at,
  })
  if (activationError || !activationData || typeof activationData !== 'object') return blocked('CONTROL_RESOLUTION_FAILED')
  const activationResult = activationData as ResolverRow
  if (activationResult.status === 'NOT_ACTIVATED') return { status: 'NOT_ACTIVATED' }
  if (activationResult.status !== 'RESOLVED') return blocked(activationResult.reason)
  const activation = mapActivation(activationResult)

  const reviewed = await resolveReviewedTaxDecision({
    supabase: input.supabase,
    policyVersion,
    originCountryCode: input.originCountryCode,
    jurisdictionCountryCode: input.jurisdictionCountryCode,
    jurisdictionRegionCode: input.jurisdictionRegionCode,
    transactionType: input.transactionType,
    fulfillmentClassification: input.fulfillmentClassification,
    at,
  })
  if (reviewed.status !== 'RESOLVED') return reviewed
  const registrationSubjectId = reviewed.control.registrationSubject === 'DRAPEON'
    ? 'DRAPEON'
    : reviewed.control.registrationSubject === 'TAILOR'
      ? input.tailorId
      : input.customerId

  const [{ data: registrationControl, error: registrationControlError }, { data: lineRows, error: lineError }] = await Promise.all([
    input.supabase
      .from('tax_registration_controls')
      .select('id, rule_type, threshold_amount_minor, threshold_currency')
      .eq('id', reviewed.control.registrationRuleId)
      .single(),
    input.supabase
      .from('tax_line_classification_controls')
      .select('line_key, line_class, taxable, calculation_strategy, review_due_at')
      .eq('responsibility_control_id', reviewed.control.controlId),
  ])
  if (registrationControlError || !registrationControl || lineError || !lineRows) return blocked('CONTROL_RESOLUTION_FAILED')

  const { data: factRow, error: factError } = await input.supabase
    .from('tax_registration_facts')
    .select('id, registration_subject, subject_id, jurisdiction_country_code, jurisdiction_region_code, tax_transaction_type, decision, taxable_turnover_minor, turnover_currency, measurement_period, evidence_references, effective_from, effective_to, reviewed_at, review_due_at')
    .eq('registration_subject', reviewed.control.registrationSubject)
    .eq('subject_id', registrationSubjectId)
    .eq('jurisdiction_country_code', reviewed.control.jurisdictionCountryCode)
    .eq('tax_transaction_type', reviewed.control.transactionType)
    .lte('effective_from', at)
    .or(`effective_to.is.null,effective_to.gt.${at}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (factError) return blocked('CONTROL_RESOLUTION_FAILED')
  const fact: TaxRegistrationFact | null = factRow ? {
    factId: factRow.id,
    registrationSubject: factRow.registration_subject,
    subjectId: factRow.subject_id,
    jurisdictionCountryCode: factRow.jurisdiction_country_code,
    jurisdictionRegionCode: factRow.jurisdiction_region_code,
    transactionType: factRow.tax_transaction_type,
    decision: factRow.decision,
    taxableTurnoverMinor: factRow.taxable_turnover_minor,
    turnoverCurrency: factRow.turnover_currency,
    measurementPeriod: factRow.measurement_period,
    evidenceReferences: factRow.evidence_references ?? [],
    effectiveFrom: factRow.effective_from,
    effectiveTo: factRow.effective_to,
    reviewedAt: factRow.reviewed_at,
    reviewDueAt: factRow.review_due_at,
  } as TaxRegistrationFact : null
  const registration = resolveRegistrationDecision({
    control: reviewed.control,
    registrationRuleType: registrationControl.rule_type,
    thresholdAmountMinor: registrationControl.threshold_amount_minor,
    thresholdCurrency: registrationControl.threshold_currency,
    fact,
    at,
  })
  if (registration.status !== 'RESOLVED') return registration

  const lines = validateTaxLineClassifications({
    requiredLineKeys: input.requiredLineKeys,
    lines: lineRows.map((row): TaxLineClassification => ({
      lineKey: row.line_key,
      lineClass: row.line_class,
      taxable: row.taxable,
      calculationStrategy: row.calculation_strategy,
    })),
  })
  if (!lines || lineRows.some((row) => Date.parse(row.review_due_at) <= Date.parse(at))) {
    return blocked('MISSING_JURISDICTION_CONTROL')
  }

  let corridor: Record<string, unknown> | null = null
  let collectionMode = reviewed.control.collectionMode
  if (input.fulfillmentClassification === 'INTERNATIONAL_SHIPPING') {
    const { data, error } = await input.supabase
      .from('tax_corridor_controls')
      .select('id, control_key, collection_mode, responsible_importer, export_treatment, import_treatment, shipping_taxability, carrier_constraints, required_export_evidence, required_customs_fields, calculation_strategy, calculation_provider, import_tax_rate_bps, duty_rate_bps, import_tax_base, duty_base, import_tax_liability_account, duty_liability_account, source_urls, reviewed_at, review_due_at')
      .eq('policy_version', policyVersion)
      .eq('origin_country_code', input.originCountryCode)
      .eq('destination_country_code', input.destinationCountryCode)
      .eq('tax_transaction_type', input.transactionType)
      .eq('status', 'ACTIVE')
      .lte('effective_from', at)
      .or(`effective_to.is.null,effective_to.gt.${at}`)
      .maybeSingle()
    if (error || !data || Date.parse(data.review_due_at) <= Date.parse(at)) return blocked('MISSING_CORRIDOR_CONTROL')
    corridor = data
    if (data.collection_mode !== 'COLLECTED_AT_CHECKOUT' && data.collection_mode !== 'PAYABLE_ON_IMPORT') {
      return blocked('MISSING_CORRIDOR_CONTROL')
    }
    collectionMode = data.collection_mode
    if (collectionMode === 'COLLECTED_AT_CHECKOUT' && (
      data.calculation_strategy !== 'REVIEWED_STATIC'
      || !Number.isInteger(data.import_tax_rate_bps)
      || !Number.isInteger(data.duty_rate_bps)
      || !data.import_tax_base
      || !data.duty_base
      || !data.import_tax_liability_account
      || !data.duty_liability_account
    )) return blocked('MISSING_CORRIDOR_CONTROL')
  }
  if (collectionMode === 'BLOCKED') return blocked('CONTROL_NOT_ACTIVE')

  return {
    status: 'RESOLVED',
    decision: {
      activation,
      control: reviewed.control,
      registrationDecision: registration.decision,
      registrationFactId: registration.factId,
      lines,
      collectionMode,
      shippingTaxable: lines.find((line) => line.lineKey === 'FULFILLMENT')?.taxable ?? false,
    },
    corridor,
  }
}
