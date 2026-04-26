export type ReadyMadePolicyRow = {
  title: string
  body: string
}

export const READY_MADE_POLICY_ROWS: ReadyMadePolicyRow[] = [
  {
    title: 'Cancellation before handoff',
    body: 'If you need to cancel after paying, request cancellation review before the order moves to Drape dispatch, collection, or live delivery.',
  },
  {
    title: 'Refunds or exchanges',
    body: 'If the wrong item arrives, the item is damaged, or Drape dispatch fails, raise it in Drape before finishing the order so support can review the next step.',
  },
  {
    title: 'Final-sale posture',
    body: 'Change-of-mind return is not automatic once preparation, pickup, or dispatch has started.',
  },
]

export const READY_MADE_CHECKOUT_REMINDER =
  'Standard delivery and shipping are Drape-managed. The flat fulfillment fee is included in this checkout.'
