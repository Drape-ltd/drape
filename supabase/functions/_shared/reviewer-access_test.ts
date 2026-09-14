import { reviewerAccessDecision } from './reviewer-access.ts'

const NOW = Date.parse('2026-09-14T12:00:00.000Z')

Deno.test('allows an exact reviewer email during the configured window', () => {
  const decision = reviewerAccessDecision(
    ' Review.Apple@Drapeon.co ',
    {
      emails: 'review.apple@drapeon.co,showcase.alder-rue@drapeon.co',
      until: '2026-09-28T12:00:00.000Z',
    },
    NOW
  )

  if (decision?.expiresAt !== '2026-09-28T12:00:00.000Z') {
    throw new Error('expected reviewer access to be active')
  }
})

Deno.test('denies an unlisted email', () => {
  const decision = reviewerAccessDecision(
    'someone@example.com',
    { emails: 'review.apple@drapeon.co', until: '2026-09-28T12:00:00.000Z' },
    NOW
  )

  if (decision !== null) throw new Error('expected an unlisted email to be denied')
})

Deno.test('denies reviewer access after the expiry', () => {
  const decision = reviewerAccessDecision(
    'review.apple@drapeon.co',
    { emails: 'review.apple@drapeon.co', until: '2026-09-14T11:59:59.000Z' },
    NOW
  )

  if (decision !== null) throw new Error('expected expired reviewer access to be denied')
})
