import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  chooseTailorActivityNudge,
  type TailorActivityCandidate,
} from './tailor-activity-nudges.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const now = Date.parse('2026-09-13T12:00:00.000Z')
const daysAgo = (days: number) => new Date(now - days * DAY_MS).toISOString()

function candidate(patch: Partial<TailorActivityCandidate> = {}): TailorActivityCandidate {
  return {
    profileId: 'f91f5c6a-64ca-45ae-b71d-2bd02cb0c677',
    displayName: 'Needle House',
    isLive: true,
    availability: 'OPEN',
    supportsReadyMade: false,
    lastSignInAt: daysAgo(1),
    verifiedAt: daysAgo(1),
    createdAt: daysAgo(10),
    oldestDraftCreatedAt: null,
    draftItemCount: 0,
    liveItemCount: 2,
    savesCount: 4,
    ordersLast30Days: 1,
    totalOrders: 1,
    totalReviews: 2,
    avgRating: 4.5,
    lastActivityNudgeAt: null,
    ...patch,
  }
}

Deno.test('activity nudges prioritize an inactive live profile', () => {
  const result = chooseTailorActivityNudge(
    candidate({
      lastSignInAt: daysAgo(61),
      supportsReadyMade: true,
      oldestDraftCreatedAt: daysAgo(20),
      draftItemCount: 2,
    }),
    now
  )
  assertEquals(result?.kind, 'availability-check')
  assertEquals(result?.stage, 'day-60')
})

Deno.test('unfinished listings are nudged before profile sharing', () => {
  const result = chooseTailorActivityNudge(
    candidate({
      supportsReadyMade: true,
      oldestDraftCreatedAt: daysAgo(8),
      draftItemCount: 1,
      totalOrders: 0,
      verifiedAt: daysAgo(8),
    }),
    now
  )
  assertEquals(result?.kind, 'unfinished-shop')
  assertEquals(result?.stage, 'day-7')
})

Deno.test('new live tailors without orders get a public-profile share prompt', () => {
  const result = chooseTailorActivityNudge(candidate({ totalOrders: 0 }), now)
  assertEquals(result?.kind, 'share-profile')
  assertEquals(result?.webPath, '/tailors/f91f5c6a-64ca-45ae-b71d-2bd02cb0c677')
  assertEquals(result?.emailOptional, true)
})

Deno.test('active established tailors receive a real-data monthly recap', () => {
  const result = chooseTailorActivityNudge(candidate(), now)
  assertEquals(result?.kind, 'monthly-recap')
  assertEquals(result?.stage, '2026-09')
  assertEquals(result?.details[0], { label: 'Saved by customers', value: '4' })
})

Deno.test('cross-campaign cooldown prevents stacked lifecycle messages', () => {
  const result = chooseTailorActivityNudge(
    candidate({
      lastSignInAt: daysAgo(60),
      lastActivityNudgeAt: daysAgo(2),
    }),
    now
  )
  assertEquals(result, null)
})

Deno.test('non-live profiles are not sent storefront activity nudges', () => {
  const result = chooseTailorActivityNudge(candidate({ isLive: false }), now)
  assertEquals(result, null)
})
