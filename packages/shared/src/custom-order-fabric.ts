const SUPPORTED_FABRIC_BUDGET_CURRENCIES = new Set(['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'])

function isSupportedFabricBudgetCurrency(value: string | null | undefined) {
  return typeof value === 'string' && SUPPORTED_FABRIC_BUDGET_CURRENCIES.has(value.trim().toUpperCase())
}

export type CustomOrderFabricSource = 'CUSTOMER_SUPPLIES' | 'TAILOR_SOURCES'
export type FabricSubstitutionPreference =
  | 'ASK_BEFORE_SUBSTITUTING'
  | 'SIMILAR_OK'
  | 'EXACT_MATCH_ONLY'
export type BulkFabricMode =
  | 'SAME_FABRIC'
  | 'COORDINATED_VARIATIONS'
  | 'DIFFERENT_FABRIC_PER_PERSON'

export type CustomOrderFabricIssueCode =
  | 'FABRIC_SOURCE_REQUIRED'
  | 'FABRIC_DESCRIPTION_REQUIRED'
  | 'FABRIC_BUDGET_REQUIRED'
  | 'FABRIC_BUDGET_CURRENCY_REQUIRED'
  | 'FABRIC_REFERENCE_REQUIRED'
  | 'FABRIC_SUBSTITUTION_REQUIRED'
  | 'CUSTOMER_FABRIC_MEDIA_REQUIRED'
  | 'FABRIC_HANDOFF_REQUIRED'
  | 'BULK_FABRIC_MODE_REQUIRED'

export type CustomOrderFabricIssue = {
  code: CustomOrderFabricIssueCode
  message: string
}

export type CustomOrderFabricInput = {
  fabricSource?: CustomOrderFabricSource | string | null
  fabricDescription?: string | null
  fabricBudgetAmount?: number | null
  fabricBudgetCurrency?: string | null
  fabricReferenceMediaCount?: number | null
  fabricReferenceLinkCount?: number | null
  fabricSubstitutionPreference?: FabricSubstitutionPreference | string | null
  fabricHandoffMode?: string | null
  isBulkOrder?: boolean | null
  bulkRecipientCount?: number | null
  bulkFabricMode?: BulkFabricMode | string | null
  suggestedVendorName?: string | null
  suggestedVendorLocation?: string | null
  suggestedVendorLink?: string | null
  suggestedVendorNotes?: string | null
}

export const FABRIC_SUBSTITUTION_OPTIONS: Array<{
  value: FabricSubstitutionPreference
  label: string
  hint: string
}> = [
  {
    value: 'ASK_BEFORE_SUBSTITUTING',
    label: 'Ask before substituting',
    hint: 'The tailor should confirm with you before choosing a close alternative.',
  },
  {
    value: 'SIMILAR_OK',
    label: 'Similar is okay',
    hint: 'The tailor can choose a close match if the exact fabric is unavailable.',
  },
  {
    value: 'EXACT_MATCH_ONLY',
    label: 'Exact match only',
    hint: 'Do not source or cut unless the fabric closely matches your reference.',
  },
]

export const BULK_FABRIC_MODE_OPTIONS: Array<{
  value: BulkFabricMode
  label: string
  hint: string
}> = [
  {
    value: 'SAME_FABRIC',
    label: 'Same fabric for everyone',
    hint: 'One fabric direction and dye lot should cover the group.',
  },
  {
    value: 'COORDINATED_VARIATIONS',
    label: 'Coordinated variations',
    hint: 'The group can use related colors, trims, or patterns.',
  },
  {
    value: 'DIFFERENT_FABRIC_PER_PERSON',
    label: 'Different per person',
    hint: 'Each recipient may need separate sourcing notes before quote acceptance.',
  },
]

function pushIssue(issues: CustomOrderFabricIssue[], code: CustomOrderFabricIssueCode, message: string) {
  issues.push({ code, message })
}

function count(value: number | null | undefined) {
  return Number.isFinite(value) && typeof value === 'number' && value > 0 ? value : 0
}

function cleanText(value: string | null | undefined) {
  return value?.trim() ?? ''
}

export function getCustomOrderFabricIssues(input: CustomOrderFabricInput): CustomOrderFabricIssue[] {
  const issues: CustomOrderFabricIssue[] = []
  const source = input.fabricSource
  const mediaCount = count(input.fabricReferenceMediaCount)
  const linkCount = count(input.fabricReferenceLinkCount)
  const isBulkOrder = input.isBulkOrder === true || count(input.bulkRecipientCount) >= 2

  if (source !== 'CUSTOMER_SUPPLIES' && source !== 'TAILOR_SOURCES') {
    pushIssue(issues, 'FABRIC_SOURCE_REQUIRED', 'Choose who provides fabric before submitting.')
    return issues
  }

  if (source === 'TAILOR_SOURCES') {
    if (cleanText(input.fabricDescription).length < 8) {
      pushIssue(issues, 'FABRIC_DESCRIPTION_REQUIRED', 'Describe the fabric the tailor should source.')
    }
    if (!Number.isFinite(input.fabricBudgetAmount) || (input.fabricBudgetAmount ?? 0) <= 0) {
      pushIssue(issues, 'FABRIC_BUDGET_REQUIRED', 'Set a fabric budget before asking the tailor to source.')
    }
    if (!isSupportedFabricBudgetCurrency(input.fabricBudgetCurrency)) {
      pushIssue(issues, 'FABRIC_BUDGET_CURRENCY_REQUIRED', 'Choose the budget currency for fabric sourcing.')
    }
    if (mediaCount + linkCount < 1) {
      pushIssue(issues, 'FABRIC_REFERENCE_REQUIRED', 'Add a fabric photo, video, or supported reference link.')
    }
    if (!FABRIC_SUBSTITUTION_OPTIONS.some((option) => option.value === input.fabricSubstitutionPreference)) {
      pushIssue(issues, 'FABRIC_SUBSTITUTION_REQUIRED', 'Choose what the tailor should do if the exact fabric is unavailable.')
    }
  }

  if (source === 'CUSTOMER_SUPPLIES') {
    if (mediaCount < 1) {
      pushIssue(issues, 'CUSTOMER_FABRIC_MEDIA_REQUIRED', 'Add at least one photo or video of the fabric you will provide.')
    }
    if (!cleanText(input.fabricHandoffMode)) {
      pushIssue(issues, 'FABRIC_HANDOFF_REQUIRED', 'Choose how your fabric will reach the tailor.')
    }
  }

  if (isBulkOrder && !BULK_FABRIC_MODE_OPTIONS.some((option) => option.value === input.bulkFabricMode)) {
    pushIssue(issues, 'BULK_FABRIC_MODE_REQUIRED', 'Choose how fabric should work across this group order.')
  }

  return issues
}

export function isCustomOrderFabricBriefComplete(input: CustomOrderFabricInput) {
  return getCustomOrderFabricIssues(input).length === 0
}
