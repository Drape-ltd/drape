export type ReviewerAccessConfig = {
  emails: string
  until: string
}

export type ReviewerAccessDecision = {
  expiresAt: string
} | null

export function reviewerAccessDecision(
  email: string | null | undefined,
  config: ReviewerAccessConfig,
  nowMs = Date.now()
): ReviewerAccessDecision {
  const normalizedEmail = email?.trim().toLowerCase() ?? ''
  if (!normalizedEmail) return null

  const expiresAtMs = Date.parse(config.until.trim())
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return null

  const allowedEmails = config.emails
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (!allowedEmails.includes(normalizedEmail)) return null

  return { expiresAt: new Date(expiresAtMs).toISOString() }
}

export function reviewerAccessFromEnv(
  email: string | null | undefined,
  nowMs = Date.now()
): ReviewerAccessDecision {
  return reviewerAccessDecision(
    email,
    {
      emails: Deno.env.get('REVIEWER_AUTH_BYPASS_EMAILS') ?? '',
      until: Deno.env.get('REVIEWER_AUTH_BYPASS_UNTIL') ?? '',
    },
    nowMs
  )
}
