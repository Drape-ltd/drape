const DAY_MS = 24 * 60 * 60 * 1_000

export type TailorActivityNudgeKind =
  | 'availability-check'
  | 'unfinished-shop'
  | 'share-profile'
  | 'monthly-recap'

export type TailorActivityNudge = {
  kind: TailorActivityNudgeKind
  stage: string
  title: string
  body: string
  emailSubject: string
  eyebrow: string
  ctaLabel: string
  webPath: string
  appUrl: string
  destinationKey: 'TAILOR_PROFILE' | 'TAILOR_SHOP'
  emailOptional: boolean
  details: Array<{ label: string; value: string }>
}

export type TailorActivityCandidate = {
  profileId: string
  displayName: string
  isLive: boolean
  availability: string | null
  supportsReadyMade: boolean
  lastSignInAt: string | null
  verifiedAt: string | null
  createdAt: string
  oldestDraftCreatedAt: string | null
  draftItemCount: number
  liveItemCount: number
  savesCount: number
  ordersLast30Days: number
  totalOrders: number
  totalReviews: number
  avgRating: number
  lastActivityNudgeAt: string | null
}

function ageInDays(value: string | null | undefined, nowMs: number) {
  const timestamp = value ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(timestamp) || nowMs < timestamp) return null
  return Math.floor((nowMs - timestamp) / DAY_MS)
}

function milestoneStage(anchor: string | null | undefined, milestones: number[], nowMs: number) {
  const age = ageInDays(anchor, nowMs)
  if (age === null || age < milestones[0]) return null
  const reached = milestones.filter((milestone) => age >= milestone).at(-1)
  return reached ? `day-${reached}` : null
}

function number(value: number) {
  return new Intl.NumberFormat('en').format(Math.max(0, value))
}

function performanceSummary(candidate: TailorActivityCandidate) {
  const rating =
    candidate.totalReviews > 0
      ? `${candidate.avgRating.toFixed(1)} from ${number(
          candidate.totalReviews
        )} review${candidate.totalReviews === 1 ? '' : 's'}`
      : 'No reviews yet'
  return [
    { label: 'Saved by customers', value: number(candidate.savesCount) },
    {
      label: 'Orders in the last 30 days',
      value: number(candidate.ordersLast30Days),
    },
    { label: 'Live shop pieces', value: number(candidate.liveItemCount) },
    { label: 'Customer rating', value: rating },
  ]
}

/**
 * Selects at most one useful, evidence-based nudge for a tailor per run.
 * A six-day cross-campaign cooldown prevents several lifecycle messages from
 * landing back-to-back. Durable job keys provide the longer-term dedupe.
 */
export function chooseTailorActivityNudge(
  candidate: TailorActivityCandidate,
  nowMs = Date.now()
): TailorActivityNudge | null {
  const sinceLastNudge = ageInDays(candidate.lastActivityNudgeAt, nowMs)
  if (sinceLastNudge !== null && sinceLastNudge < 6) return null

  const publicProfilePath = `/tailors/${encodeURIComponent(candidate.profileId)}`

  if (candidate.isLive && ['OPEN', 'LIMITED'].includes(candidate.availability ?? '')) {
    const stage = milestoneStage(candidate.lastSignInAt, [30, 60, 90], nowMs)
    if (stage) {
      return {
        kind: 'availability-check',
        stage,
        title: 'Still taking orders?',
        body: 'Your Drapeon profile is live. Confirm your availability so customers know whether you can take on new work.',
        emailSubject: 'Are you still taking orders on Drapeon?',
        eyebrow: 'Keep your availability accurate',
        ctaLabel: 'Review availability',
        webPath: '/account/profile',
        appUrl: 'drape://profile',
        destinationKey: 'TAILOR_PROFILE',
        emailOptional: false,
        details: [
          { label: 'Current status', value: candidate.availability ?? 'Open' },
          {
            label: 'Why it matters',
            value: 'Customers can see when you are ready for new work',
          },
        ],
      }
    }
  }

  if (candidate.supportsReadyMade && candidate.draftItemCount > 0) {
    const stage = milestoneStage(candidate.oldestDraftCreatedAt, [3, 7, 14, 30], nowMs)
    if (stage) {
      const count = number(candidate.draftItemCount)
      return {
        kind: 'unfinished-shop',
        stage,
        title: 'Your next shop piece is almost ready',
        body: `You have ${count} draft listing${
          candidate.draftItemCount === 1 ? '' : 's'
        }. Finish one and give customers another way to shop your work.`,
        emailSubject: 'Finish your Drapeon shop listing',
        eyebrow: 'A quick storefront win',
        ctaLabel: 'Finish your listing',
        webPath: '/account/shop',
        appUrl: 'drape://shop',
        destinationKey: 'TAILOR_SHOP',
        emailOptional: false,
        details: [
          { label: 'Draft listings', value: count },
          { label: 'Live shop pieces', value: number(candidate.liveItemCount) },
        ],
      }
    }
  }

  if (candidate.isLive) {
    const stage = milestoneStage(candidate.verifiedAt ?? candidate.createdAt, [1, 7, 30], nowMs)
    if (stage && candidate.totalOrders === 0) {
      return {
        kind: 'share-profile',
        stage,
        title: 'Your work deserves an audience ✨',
        body: `Share ${
          candidate.displayName || 'your Drapeon profile'
        } with past clients and your network so they can explore your work and request an order.`,
        emailSubject: 'Share your live Drapeon profile',
        eyebrow: 'Your storefront is live',
        ctaLabel: 'Open and share profile',
        webPath: publicProfilePath,
        appUrl: 'drape://profile',
        destinationKey: 'TAILOR_PROFILE',
        emailOptional: true,
        details: [
          {
            label: 'Your public profile',
            value: `https://drapeon.co${publicProfilePath}`,
          },
          {
            label: 'Easy first audience',
            value: 'Past clients, friends, and your social followers',
          },
        ],
      }
    }
  }

  if (candidate.isLive) {
    const month = new Date(nowMs).toISOString().slice(0, 7)
    return {
      kind: 'monthly-recap',
      stage: month,
      title: 'Your Drapeon month at a glance',
      body: `${number(candidate.savesCount)} customer saves, ${number(
        candidate.ordersLast30Days
      )} orders this month, and ${number(
        candidate.liveItemCount
      )} live shop pieces. Keep your storefront fresh and share it with your audience.`,
      emailSubject: 'Your monthly Drapeon storefront recap',
      eyebrow: 'Your monthly storefront pulse',
      ctaLabel: 'View and share profile',
      webPath: publicProfilePath,
      appUrl: 'drape://profile',
      destinationKey: 'TAILOR_PROFILE',
      emailOptional: true,
      details: performanceSummary(candidate),
    }
  }

  return null
}
