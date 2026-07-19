export const IDENTITY_CONSENT_POLICY_VERSION = 'identity-verification-v1' as const

export const IDENTITY_CONSENT_COPY =
  'I consent to Drapeon processing my legal name and live identity selfie for account verification, marketplace safety, and fraud prevention. Identity media stays private, is limited to authorized trust review, and is retained or erased under Drapeon\'s published privacy and legal obligations.'

export type IdentityRetentionState =
  | 'ACTIVE'
  | 'RESTRICTED_PROCESSING'
  | 'LEGAL_HOLD'
  | 'ERASURE_DUE'
  | 'ERASED'

export type PayoutNameMatchStatus =
  | 'NOT_CHECKED'
  | 'MATCH'
  | 'REVIEW_REQUIRED'
  | 'MISMATCH'

function normalizedNameTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^\p{L}\s'-]+/gu, ' ')
    .split(/\s+/u)
    .map((token) => token.replace(/^[-']+|[-']+$/gu, ''))
    .filter((token) => token.length > 0)
    .sort()
}

export function classifyPayoutNameMatch(
  legalName: string | null | undefined,
  resolvedAccountName: string | null | undefined,
): Exclude<PayoutNameMatchStatus, 'NOT_CHECKED'> {
  const legalTokens = normalizedNameTokens(legalName)
  const payoutTokens = normalizedNameTokens(resolvedAccountName)
  if (legalTokens.length === 0 || payoutTokens.length === 0) return 'REVIEW_REQUIRED'
  if (legalTokens.join(' ') === payoutTokens.join(' ')) return 'MATCH'

  const payoutSet = new Set(payoutTokens)
  const overlap = legalTokens.filter((token) => payoutSet.has(token)).length
  return overlap === 0 ? 'MISMATCH' : 'REVIEW_REQUIRED'
}

export function isValidLegalName(value: string): boolean {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  return (
    normalized.length >= 2 &&
    normalized.length <= 120 &&
    /^[\p{L}\p{M}](?:[\p{L}\p{M}' -]*[\p{L}\p{M}])?$/u.test(normalized)
  )
}

export function normalizeLegalName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}
