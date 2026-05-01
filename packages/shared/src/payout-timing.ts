export const PAYOUT_DISPUTE_WINDOW_HOURS = 72

export function payoutWindowClosesAt(confirmedAt: string) {
  return new Date(Date.parse(confirmedAt) + PAYOUT_DISPUTE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
}

export function hasPayoutWindowClosed(confirmedAt: string, now = Date.now()) {
  return Date.parse(payoutWindowClosesAt(confirmedAt)) <= now
}
