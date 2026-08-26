import { FABRIC_FUNDING_POLICY_V2_VERSION, type FabricAllowanceCoverageCode } from './fabric-funding'

export type FabricFundingPolicyV2Version = typeof FABRIC_FUNDING_POLICY_V2_VERSION

export const FABRIC_CANDIDATE_STATUSES = [
  'DRAFT',
  'AWAITING_CUSTOMER_DECISION',
  'CHANGES_REQUESTED',
  'DECLINED',
  'AWAITING_SHORTFALL_PAYMENT',
  'RELEASE_QUEUED',
  'RELEASE_PROCESSING',
  'RELEASE_SUCCEEDED',
  'RELEASE_BLOCKED',
  'AWAITING_RECEIPT',
  'RECONCILED',
  'EXCEPTION',
  'SUPERSEDED',
] as const

export type FabricCandidateStatus = typeof FABRIC_CANDIDATE_STATUSES[number]

export const FABRIC_CUSTOMER_DECISIONS = ['APPROVE', 'REQUEST_CHANGES', 'DECLINE'] as const
export type FabricCustomerDecision = typeof FABRIC_CUSTOMER_DECISIONS[number]

export const FABRIC_DECLINE_REASON_CODES = [
  'TOO_EXPENSIVE',
  'WRONG_COLOR',
  'WRONG_TEXTURE_OR_WEIGHT',
  'WRONG_QUALITY',
  'INSUFFICIENT_QUANTITY',
  'DEADLINE_IMPACT',
  'NO_LONGER_NEEDED',
  'OTHER',
] as const
export type FabricDeclineReasonCode = typeof FABRIC_DECLINE_REASON_CODES[number]

export const FABRIC_HANDOFF_MODES = [
  'CUSTOMER_SHIPS_TO_TAILOR',
  'CUSTOMER_DROPS_OFF_LOCALLY',
  'TAILOR_PICKS_UP_LOCALLY',
  'BRINGS_TO_CONSULTATION',
] as const
export type FabricHandoffMode = typeof FABRIC_HANDOFF_MODES[number]

export const FABRIC_HANDOFF_STATUSES = [
  'AWAITING_HANDOFF',
  'SCHEDULED',
  'IN_TRANSIT',
  'RECEIVED_SUITABLE',
  'RECEIVED_WITH_ISSUE',
  'REPLACEMENT_REQUIRED',
  'TAILOR_REPLACEMENT_PROPOSED',
  'CONTINUE_AUTHORIZED',
] as const
export type FabricHandoffStatus = typeof FABRIC_HANDOFF_STATUSES[number]

export const FABRIC_MATERIAL_ISSUE_OUTCOMES = [
  'CUSTOMER_PROVIDES_REPLACEMENT',
  'TAILOR_SOURCES_REPLACEMENT',
  'CONTINUE_WITH_CURRENT_FABRIC',
] as const
export type FabricMaterialIssueOutcome = typeof FABRIC_MATERIAL_ISSUE_OUTCOMES[number]

export type FabricMediaArtifact = {
  originalStoragePath: string
  displayStoragePath: string
  mediaType: 'IMAGE' | 'VIDEO'
  posterStoragePath?: string | null
  crop?: {
    x: number
    y: number
    width: number
    height: number
    sourceWidth: number
    sourceHeight: number
    aspectRatio: '4:3'
  } | null
}

export type FabricCandidateInput = {
  orderId: string
  componentCode: FabricAllowanceCoverageCode
  supplierCostAmount: number
  currency: string
  privateSupplierEstimateStoragePath: string
  customerMedia: FabricMediaArtifact[]
  availabilityNote: string
  quantitySpecification: string
  deadlineImpact: 'NONE' | 'MAY_DELAY' | 'DELAYS_ORDER'
  deadlineImpactNote?: string | null
  policyVersion: string
  correlationId: string
  idempotencyKey: string
}

export type ValidFabricCandidate = Omit<FabricCandidateInput, 'policyVersion'> & {
  policyVersion: FabricFundingPolicyV2Version
  currency: string
  availabilityNote: string
  quantitySpecification: string
  deadlineImpactNote: string | null
}

export type FabricCandidateFundingBreakdown = {
  supplierCostAmount: number
  protectedAllowanceAmount: number
  shortfallSubtotalAmount: number
  shortfallTaxAmount: number
  shortfallFeeAmount: number
  shortfallChargeAmount: number
  authorizedFabricAllocationAfterPayment: number
}

export type FabricUserFacingState =
  | 'FINDING_MATERIALS'
  | 'AWAITING_FABRIC_APPROVAL'
  | 'AWAITING_FABRIC_PAYMENT'
  | 'SECURING_MATERIALS'
  | 'AWAITING_RECEIPT'
  | 'MATERIALS_READY'
  | 'AWAITING_HANDOFF'
  | 'HANDOFF_SCHEDULED'
  | 'FABRIC_IN_TRANSIT'
  | 'FABRIC_ISSUE'
  | 'FABRIC_EXCEPTION'

export type FabricCuttingBlockerCode =
  | 'MEASUREMENTS_NOT_READY'
  | 'STYLE_NOT_APPROVED'
  | 'FABRIC_CANDIDATE_REQUIRED'
  | 'FABRIC_CUSTOMER_APPROVAL_REQUIRED'
  | 'FABRIC_SHORTFALL_PAYMENT_REQUIRED'
  | 'FABRIC_RELEASE_NOT_SUCCESSFUL'
  | 'FABRIC_RECEIPT_REQUIRED'
  | 'ACQUIRED_FABRIC_PROOF_REQUIRED'
  | 'FABRIC_RECONCILIATION_REQUIRED'
  | 'CUSTOMER_FABRIC_HANDOFF_REQUIRED'
  | 'CUSTOMER_FABRIC_RECEIPT_REQUIRED'
  | 'CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED'
  | 'CUSTOMER_FABRIC_ISSUE_UNRESOLVED'

export type FabricCuttingBlocker = {
  code: FabricCuttingBlockerCode
  message: string
  recoveryAction:
    | 'REVIEW_MEASUREMENTS'
    | 'REVIEW_STYLE'
    | 'SUBMIT_FABRIC_CANDIDATE'
    | 'OPEN_FABRIC_DECISION'
    | 'PAY_FABRIC_SHORTFALL'
    | 'RETRY_OR_REVIEW_RELEASE'
    | 'UPLOAD_RECEIPT'
    | 'UPLOAD_ACQUIRED_FABRIC_PROOF'
    | 'RESOLVE_RECONCILIATION'
    | 'ARRANGE_FABRIC_HANDOFF'
    | 'CONFIRM_FABRIC_RECEIPT'
    | 'RESOLVE_FABRIC_ISSUE'
}

const CUSTOMER_FABRIC_BLOCKER_COPY: Partial<Record<FabricCuttingBlockerCode, string>> = {
  MEASUREMENTS_NOT_READY: 'Measurements still need confirmation before the tailor can start cutting.',
  STYLE_NOT_APPROVED: 'The style plan still needs confirmation before the tailor can start cutting.',
  FABRIC_CANDIDATE_REQUIRED: 'The tailor is preparing the exact fabric and supplier cost for your review.',
  FABRIC_CUSTOMER_APPROVAL_REQUIRED: 'Review the exact fabric and authorize its cost.',
  FABRIC_SHORTFALL_PAYMENT_REQUIRED: 'Pay the disclosed fabric difference so the approved funds can be released.',
  FABRIC_RELEASE_NOT_SUCCESSFUL: 'The approved fabric funds are still being processed.',
  FABRIC_RECEIPT_REQUIRED: 'The tailor is adding the final supplier receipt.',
  ACQUIRED_FABRIC_PROOF_REQUIRED: 'The tailor is adding fresh proof of the acquired fabric.',
  FABRIC_RECONCILIATION_REQUIRED: 'The fabric purchase is being reconciled before cutting can start.',
  CUSTOMER_FABRIC_HANDOFF_REQUIRED: 'Choose how your fabric will reach the tailor.',
  CUSTOMER_FABRIC_RECEIPT_REQUIRED: 'The tailor is confirming that your fabric arrived and is suitable.',
  CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED: 'The tailor is adding fresh proof that your fabric was received.',
  CUSTOMER_FABRIC_ISSUE_UNRESOLVED: 'Choose how to resolve the reported fabric issue before cutting starts.',
}

export function formatFabricCuttingBlockerForRole(
  blocker: { code: string; message: string; componentCode?: string | null },
  role: 'CUSTOMER' | 'TAILOR'
) {
  if (blocker.code === 'FABRIC_CANDIDATE_REQUIRED' && blocker.componentCode) {
    const component = blocker.componentCode.replace(/_/g, ' ').toLowerCase()
    return role === 'CUSTOMER'
      ? `The tailor is preparing the exact ${component} and supplier cost for your review.`
      : `Submit the exact ${component} and supplier cost for customer review.`
  }
  if (role === 'CUSTOMER') return CUSTOMER_FABRIC_BLOCKER_COPY[blocker.code as FabricCuttingBlockerCode] ?? blocker.message
  return blocker.message
}

function requireMinorUnits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer in minor units.`)
  }
  return value
}

function requireText(value: string, field: string, minimum = 3) {
  const clean = value.trim()
  if (clean.length < minimum) throw new Error(`${field} is required.`)
  return clean
}

function requireStoragePath(value: string, field: string) {
  const clean = requireText(value, field)
  if (/^https?:\/\//iu.test(clean) || clean.includes('..')) {
    throw new Error(`${field} must be a private storage path, not a public URL.`)
  }
  return clean
}

export function isFabricFundingPolicyV2(value: string | null | undefined): value is FabricFundingPolicyV2Version {
  return value === FABRIC_FUNDING_POLICY_V2_VERSION
}

export function validateFabricCandidate(input: FabricCandidateInput): ValidFabricCandidate {
  if (!isFabricFundingPolicyV2(input.policyVersion)) {
    throw new Error(`policyVersion must be ${FABRIC_FUNDING_POLICY_V2_VERSION}.`)
  }
  const currency = input.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('currency must be an ISO-style three-letter code.')
  if (input.customerMedia.length < 1 || input.customerMedia.length > 6) {
    throw new Error('customerMedia must contain between one and six artifacts.')
  }
  const customerMedia = input.customerMedia.map((artifact) => ({
    ...artifact,
    originalStoragePath: requireStoragePath(artifact.originalStoragePath, 'originalStoragePath'),
    displayStoragePath: requireStoragePath(artifact.displayStoragePath, 'displayStoragePath'),
    posterStoragePath: artifact.posterStoragePath
      ? requireStoragePath(artifact.posterStoragePath, 'posterStoragePath')
      : null,
    crop: artifact.mediaType === 'VIDEO' ? null : artifact.crop ?? null,
  }))
  const deadlineImpactNote = input.deadlineImpact === 'NONE'
    ? null
    : requireText(input.deadlineImpactNote ?? '', 'deadlineImpactNote', 8)

  return {
    ...input,
    policyVersion: FABRIC_FUNDING_POLICY_V2_VERSION,
    supplierCostAmount: requireMinorUnits(input.supplierCostAmount, 'supplierCostAmount'),
    currency,
    privateSupplierEstimateStoragePath: requireStoragePath(
      input.privateSupplierEstimateStoragePath,
      'privateSupplierEstimateStoragePath',
    ),
    customerMedia,
    availabilityNote: requireText(input.availabilityNote, 'availabilityNote', 5),
    quantitySpecification: requireText(input.quantitySpecification, 'quantitySpecification', 5),
    deadlineImpactNote,
    correlationId: requireText(input.correlationId, 'correlationId'),
    idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey'),
  }
}

export function deriveFabricCandidateFundingBreakdown(input: {
  supplierCostAmount: number
  remainingProtectedAllowanceAmount: number
  shortfallTaxAmount?: number
  shortfallFeeAmount?: number
}): FabricCandidateFundingBreakdown {
  const supplierCostAmount = requireMinorUnits(input.supplierCostAmount, 'supplierCostAmount')
  const protectedAllowanceAmount = Math.max(
    0,
    Math.min(supplierCostAmount, Math.trunc(input.remainingProtectedAllowanceAmount)),
  )
  const shortfallSubtotalAmount = supplierCostAmount - protectedAllowanceAmount
  const shortfallTaxAmount = Math.max(0, Math.trunc(input.shortfallTaxAmount ?? 0))
  const shortfallFeeAmount = Math.max(0, Math.trunc(input.shortfallFeeAmount ?? 0))
  if (shortfallSubtotalAmount === 0 && (shortfallTaxAmount > 0 || shortfallFeeAmount > 0)) {
    throw new Error('Tax and fees cannot be charged when there is no material shortfall.')
  }
  return {
    supplierCostAmount,
    protectedAllowanceAmount,
    shortfallSubtotalAmount,
    shortfallTaxAmount,
    shortfallFeeAmount,
    shortfallChargeAmount: shortfallSubtotalAmount + shortfallTaxAmount + shortfallFeeAmount,
    authorizedFabricAllocationAfterPayment: protectedAllowanceAmount + shortfallSubtotalAmount,
  }
}

export function deriveFabricUserFacingState(input: {
  fabricSource: 'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'
  candidateStatus?: FabricCandidateStatus | null
  handoffStatus?: FabricHandoffStatus | null
}): FabricUserFacingState {
  if (input.fabricSource === 'CUSTOMER_SUPPLIES') {
    if (input.handoffStatus === 'SCHEDULED') return 'HANDOFF_SCHEDULED'
    if (input.handoffStatus === 'IN_TRANSIT') return 'FABRIC_IN_TRANSIT'
    if (input.handoffStatus === 'RECEIVED_WITH_ISSUE' || input.handoffStatus === 'REPLACEMENT_REQUIRED' || input.handoffStatus === 'TAILOR_REPLACEMENT_PROPOSED') return 'FABRIC_ISSUE'
    if (input.handoffStatus === 'RECEIVED_SUITABLE' || input.handoffStatus === 'CONTINUE_AUTHORIZED') return 'MATERIALS_READY'
    return 'AWAITING_HANDOFF'
  }
  switch (input.candidateStatus) {
    case 'AWAITING_CUSTOMER_DECISION': return 'AWAITING_FABRIC_APPROVAL'
    case 'AWAITING_SHORTFALL_PAYMENT': return 'AWAITING_FABRIC_PAYMENT'
    case 'RELEASE_QUEUED':
    case 'RELEASE_PROCESSING':
    case 'RELEASE_SUCCEEDED': return 'SECURING_MATERIALS'
    case 'AWAITING_RECEIPT': return 'AWAITING_RECEIPT'
    case 'RECONCILED': return 'MATERIALS_READY'
    case 'RELEASE_BLOCKED':
    case 'EXCEPTION': return 'FABRIC_EXCEPTION'
    default: return 'FINDING_MATERIALS'
  }
}

export function deriveFabricCuttingBlockers(input: {
  fabricSource: 'TAILOR_SOURCES' | 'CUSTOMER_SUPPLIES'
  measurementsReady: boolean
  styleReady: boolean
  candidateStatus?: FabricCandidateStatus | null
  shortfallPaid?: boolean
  providerReleaseSucceeded?: boolean
  receiptPresent?: boolean
  acquiredProofPresent?: boolean
  reconciliationStatus?: 'EXACT' | 'RESOLVED' | 'PENDING' | 'EXCEPTION' | null
  handoffStatus?: FabricHandoffStatus | null
  handoffReceiptProofPresent?: boolean
}): FabricCuttingBlocker[] {
  const blockers: FabricCuttingBlocker[] = []
  if (!input.measurementsReady) blockers.push({ code: 'MEASUREMENTS_NOT_READY', message: 'Confirm the measurements before cutting.', recoveryAction: 'REVIEW_MEASUREMENTS' })
  if (!input.styleReady) blockers.push({ code: 'STYLE_NOT_APPROVED', message: 'Confirm the style plan before cutting.', recoveryAction: 'REVIEW_STYLE' })
  if (input.fabricSource === 'CUSTOMER_SUPPLIES') {
    if (!input.handoffStatus) blockers.push({ code: 'CUSTOMER_FABRIC_HANDOFF_REQUIRED', message: 'Arrange how the customer fabric will reach the tailor.', recoveryAction: 'ARRANGE_FABRIC_HANDOFF' })
    else if (['RECEIVED_WITH_ISSUE', 'REPLACEMENT_REQUIRED', 'TAILOR_REPLACEMENT_PROPOSED'].includes(input.handoffStatus)) blockers.push({ code: 'CUSTOMER_FABRIC_ISSUE_UNRESOLVED', message: 'Resolve the reported fabric issue before cutting.', recoveryAction: 'RESOLVE_FABRIC_ISSUE' })
    else if (!['RECEIVED_SUITABLE', 'CONTINUE_AUTHORIZED'].includes(input.handoffStatus)) blockers.push({ code: 'CUSTOMER_FABRIC_RECEIPT_REQUIRED', message: 'The tailor must confirm the customer fabric was received and suitable.', recoveryAction: 'CONFIRM_FABRIC_RECEIPT' })
    else if (!input.handoffReceiptProofPresent) blockers.push({ code: 'CUSTOMER_FABRIC_RECEIPT_PROOF_REQUIRED', message: 'Upload fresh proof that the customer fabric was received.', recoveryAction: 'CONFIRM_FABRIC_RECEIPT' })
    return blockers
  }
  if (!input.candidateStatus || input.candidateStatus === 'DRAFT' || input.candidateStatus === 'CHANGES_REQUESTED' || input.candidateStatus === 'DECLINED' || input.candidateStatus === 'SUPERSEDED') {
    blockers.push({ code: 'FABRIC_CANDIDATE_REQUIRED', message: 'Submit the exact fabric and supplier cost for customer review.', recoveryAction: 'SUBMIT_FABRIC_CANDIDATE' })
    return blockers
  }
  if (input.candidateStatus === 'AWAITING_CUSTOMER_DECISION') blockers.push({ code: 'FABRIC_CUSTOMER_APPROVAL_REQUIRED', message: 'The customer must approve the exact fabric and authorize its cost.', recoveryAction: 'OPEN_FABRIC_DECISION' })
  if (input.candidateStatus === 'AWAITING_SHORTFALL_PAYMENT' || input.shortfallPaid === false) blockers.push({ code: 'FABRIC_SHORTFALL_PAYMENT_REQUIRED', message: 'Pay the disclosed fabric shortfall before funds can be released.', recoveryAction: 'PAY_FABRIC_SHORTFALL' })
  if (!input.providerReleaseSucceeded) blockers.push({ code: 'FABRIC_RELEASE_NOT_SUCCESSFUL', message: 'Wait for a terminal successful fabric-fund release before purchasing or cutting.', recoveryAction: 'RETRY_OR_REVIEW_RELEASE' })
  if (!input.receiptPresent) blockers.push({ code: 'FABRIC_RECEIPT_REQUIRED', message: 'Upload the final supplier receipt.', recoveryAction: 'UPLOAD_RECEIPT' })
  if (!input.acquiredProofPresent) blockers.push({ code: 'ACQUIRED_FABRIC_PROOF_REQUIRED', message: 'Upload fresh proof of the acquired fabric.', recoveryAction: 'UPLOAD_ACQUIRED_FABRIC_PROOF' })
  if (!['EXACT', 'RESOLVED'].includes(input.reconciliationStatus ?? '')) blockers.push({ code: 'FABRIC_RECONCILIATION_REQUIRED', message: 'Finish fabric reconciliation before cutting.', recoveryAction: 'RESOLVE_RECONCILIATION' })
  return blockers
}
