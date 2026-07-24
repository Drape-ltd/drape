import {
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { requiresOpsPayoutDestinationReview } from './verification-review.ts'

Deno.test('first payout setup does not require ops review', () => {
  assertEquals(
    requiresOpsPayoutDestinationReview(
      {
        payout_account_verified: false,
        payout_reverification_required: false,
      },
      null,
      'PAYSTACK:NGN:001:******0000:ANNA',
    ),
    false,
  )
})

Deno.test('replacement of a verified payout destination requires ops review', () => {
  assertEquals(
    requiresOpsPayoutDestinationReview(
      {
        payout_account_verified: true,
        payout_reverification_required: false,
      },
      'STRIPE_CONNECT:USD:acct_current',
      'PAYSTACK:NGN:001:******0000:ANNA',
    ),
    true,
  )
})

Deno.test('refreshing the same verified payout destination does not require ops review', () => {
  assertEquals(
    requiresOpsPayoutDestinationReview(
      {
        payout_account_verified: true,
        payout_reverification_required: false,
      },
      'STRIPE_CONNECT:USD:acct_current',
      'STRIPE_CONNECT:USD:acct_current',
    ),
    false,
  )
})
