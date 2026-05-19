export const ORDER_CANCELLATION_POLICY_VERSION = '2026-05-09-v1'

export const ORDER_CANCELLATION_POLICY_ROWS = [
  {
    title: 'Before the tailor accepts',
    body: 'You can cancel for a full refund before the tailor accepts the order.',
  },
  {
    title: 'After acceptance, before cutting',
    body: 'A full refund can still be reviewed before irreversible work starts.',
  },
  {
    title: 'After cutting begins',
    body: 'Cancellation is reviewed case by case and may be limited to a partial refund.',
  },
  {
    title: 'After completion or handoff',
    body: 'Standard cancellation closes. Use delivery review or aftercare if something is wrong.',
  },
] as const

export const ORDER_CANCELLATION_ACK_COPY =
  'I understand Drape holds payment securely and that cancellation/refund outcomes depend on order progress.'
