export type OpsVerificationEvidenceChecklistKey =
  | 'public_avatar'
  | 'portfolio_media'
  | 'proof_item'
  | 'live_id'

export type OpsVerificationEvidenceChecklistItem = {
  key: OpsVerificationEvidenceChecklistKey
  label: string
  detail: string
  ready: boolean
}

export type OpsVerificationProofItemEvidence = {
  id: string
  title: string
  category: string | null
  description: string | null
  mediaUrls: string[]
  isLive: boolean
  stockStatus: string | null
  inventoryQuantity: number
  sizes: string[]
  createdAt: string
  updatedAt: string
}

export type OpsVerificationEvidenceInput = {
  avatarUrl?: string | null
  idDocumentUrl?: string | null
  portfolioPhotoUrls?: string[] | null
  portfolioVideoUrls?: string[] | null
  proofItems?: OpsVerificationProofItemEvidence[] | null
}

export type OpsVerificationEvidenceSummary = {
  portfolioPhotoCount: number
  portfolioVideoCount: number
  portfolioMediaCount: number
  proofItemCount: number
  proofItemMediaCount: number
  totalEvidenceMediaCount: number
  readyCount: number
  missingLabels: string[]
  checklist: OpsVerificationEvidenceChecklistItem[]
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function cleanStringList(values: string[] | null | undefined) {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
}

function cleanProofItems(values: OpsVerificationProofItemEvidence[] | null | undefined) {
  if (!Array.isArray(values)) return []
  return values.filter((item) => hasText(item.id) && hasText(item.title))
}

export function buildOpsVerificationEvidenceSummary(
  input: OpsVerificationEvidenceInput,
): OpsVerificationEvidenceSummary {
  const portfolioPhotoCount = cleanStringList(input.portfolioPhotoUrls).length
  const portfolioVideoCount = cleanStringList(input.portfolioVideoUrls).length
  const portfolioMediaCount = portfolioPhotoCount + portfolioVideoCount
  const proofItems = cleanProofItems(input.proofItems)
  const proofItemMediaCount = proofItems.reduce(
    (sum, item) => sum + cleanStringList(item.mediaUrls).length,
    0,
  )

  const checklist: OpsVerificationEvidenceChecklistItem[] = [
    {
      key: 'public_avatar',
      label: 'Public avatar',
      detail: 'Profile has a public face/image reviewers can compare against the setup context.',
      ready: hasText(input.avatarUrl),
    },
    {
      key: 'portfolio_media',
      label: 'Portfolio media',
      detail: `${portfolioMediaCount} public portfolio media item${portfolioMediaCount === 1 ? '' : 's'} available.`,
      ready: portfolioMediaCount > 0,
    },
    {
      key: 'proof_item',
      label: 'Onboarding proof item',
      detail: `${proofItems.length} hidden proof item${proofItems.length === 1 ? '' : 's'} with ${proofItemMediaCount} media item${proofItemMediaCount === 1 ? '' : 's'}.`,
      ready: proofItems.length > 0 && proofItemMediaCount > 0,
    },
    {
      key: 'live_id',
      label: 'Live selfie + ID',
      detail: 'Private identity evidence has a signed review link.',
      ready: hasText(input.idDocumentUrl),
    },
  ]

  return {
    portfolioPhotoCount,
    portfolioVideoCount,
    portfolioMediaCount,
    proofItemCount: proofItems.length,
    proofItemMediaCount,
    totalEvidenceMediaCount: portfolioMediaCount + proofItemMediaCount,
    readyCount: checklist.filter((item) => item.ready).length,
    missingLabels: checklist.filter((item) => !item.ready).map((item) => item.label),
    checklist,
  }
}
