export type ProviderDisputeStatus =
  | 'NEEDS_RESPONSE'
  | 'UNDER_REVIEW'
  | 'WON'
  | 'LOST'
  | 'WARNING_CLOSED'
  | 'UNKNOWN'

export type ProviderDisputeSnapshot = {
  status: ProviderDisputeStatus
  amount: number
  currency: string
  evidenceDueAt?: string | null
  moneyMovementBlocked: boolean
}

export type ProviderDisputePresentation = {
  tone: 'warning' | 'neutral' | 'success'
  label: string
  title: string
  body: string
  blocksRelease: boolean
  deadline: string | null
}

export function presentProviderDispute(input: ProviderDisputeSnapshot): ProviderDisputePresentation {
  const deadline = input.evidenceDueAt ?? null
  switch (input.status) {
    case 'NEEDS_RESPONSE':
      return {
        tone: 'warning',
        label: 'Payment review needs evidence',
        title: 'Earnings release is paused',
        body: 'The payment provider opened a review. Drapeon Ops is collecting the required evidence; unreleased money stays protected meanwhile.',
        blocksRelease: input.moneyMovementBlocked,
        deadline,
      }
    case 'UNDER_REVIEW':
      return {
        tone: 'warning',
        label: 'Payment review in progress',
        title: 'Earnings release is paused',
        body: 'The payment provider is reviewing the transaction. Drapeon will update both parties when it reaches a decision.',
        blocksRelease: input.moneyMovementBlocked,
        deadline,
      }
    case 'WON':
      return {
        tone: 'success',
        label: 'Payment review resolved',
        title: 'Protection review cleared',
        body: 'The provider resolved the review in Drapeon’s favor. Any eligible release can continue after settlement refreshes.',
        blocksRelease: input.moneyMovementBlocked,
        deadline: null,
      }
    case 'LOST':
      return {
        tone: 'warning',
        label: 'Payment reversed by provider',
        title: 'Order funds need reconciliation',
        body: 'The provider returned the disputed payment. Drapeon Ops is reconciling the order before any further money movement.',
        blocksRelease: input.moneyMovementBlocked,
        deadline: null,
      }
    case 'WARNING_CLOSED':
      return {
        tone: 'success',
        label: 'Payment warning closed',
        title: 'Provider review closed',
        body: 'The provider closed the warning. Drapeon is refreshing the order’s protected-payment state.',
        blocksRelease: input.moneyMovementBlocked,
        deadline: null,
      }
    default:
      return {
        tone: 'neutral',
        label: 'Payment review updating',
        title: 'Earnings release is paused',
        body: 'Drapeon is confirming the provider’s latest decision. Unreleased money stays protected until that state is verified.',
        blocksRelease: input.moneyMovementBlocked,
        deadline,
      }
  }
}
