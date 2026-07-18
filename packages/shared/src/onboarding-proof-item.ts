export type OnboardingProofItemIssueCode =
  | 'TITLE_REQUIRED'
  | 'CATEGORY_REQUIRED'
  | 'DESCRIPTION_REQUIRED'
  | 'MEDIA_REQUIRED'
  | 'SIZE_REQUIRED'
  | 'STOCK_REQUIRED'

export type OnboardingProofItemIssue = {
  code: OnboardingProofItemIssueCode
  message: string
}

export type OnboardingProofItemInput = {
  title?: string | null
  category?: string | null
  description?: string | null
  mediaCount?: number | null
  priceAmount?: number | null
  sizes?: string[] | null
  inventoryQuantity?: number | null
  fitGuideReady?: boolean | null
  fulfillmentSelected?: boolean | null
  pickupAddressReady?: boolean | null
  canPublishLive?: boolean | null
}

export const ONBOARDING_PROOF_ITEM_MESSAGES: Record<OnboardingProofItemIssueCode, string> = {
  TITLE_REQUIRED: 'Add a title for this ready-made item.',
  CATEGORY_REQUIRED: 'Choose a category so reviewers understand the piece.',
  DESCRIPTION_REQUIRED: 'Add a short description for review.',
  MEDIA_REQUIRED: 'Add at least one clear photo or video of the item.',
  SIZE_REQUIRED: 'Add at least one size option.',
  STOCK_REQUIRED: 'Add at least 1 unit across your selected sizes.',
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasPositiveInteger(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) >= 1
}

function issue(code: OnboardingProofItemIssueCode): OnboardingProofItemIssue {
  return { code, message: ONBOARDING_PROOF_ITEM_MESSAGES[code] }
}

export function getOnboardingProofItemIssues(input: OnboardingProofItemInput): OnboardingProofItemIssue[] {
  const issues: OnboardingProofItemIssue[] = []

  if (!hasText(input.title)) issues.push(issue('TITLE_REQUIRED'))
  if (!hasText(input.category)) issues.push(issue('CATEGORY_REQUIRED'))
  if (!hasText(input.description)) issues.push(issue('DESCRIPTION_REQUIRED'))
  if (!hasPositiveInteger(input.mediaCount)) issues.push(issue('MEDIA_REQUIRED'))
  if (!Array.isArray(input.sizes) || input.sizes.filter(hasText).length === 0) issues.push(issue('SIZE_REQUIRED'))
  if (!hasPositiveInteger(input.inventoryQuantity)) issues.push(issue('STOCK_REQUIRED'))

  return issues
}

export function isOnboardingProofItemComplete(input: OnboardingProofItemInput) {
  return getOnboardingProofItemIssues(input).length === 0
}
