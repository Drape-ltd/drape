/**
 * Canonical stage colour map shared across all tailor screens.
 * Each stage has a background + text pair so pills look identical
 * whether they appear on the dashboard, orders list, order detail,
 * or client history.
 */
import { colors } from '@drape/shared/design-system'

export const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  PENDING_QUOTE:        { bg: colors.statusPendingBg, text: colors.statusPending },
  CONSULTATION:         { bg: colors.statusPendingBg, text: colors.statusPending },
  QUOTE_SENT:           { bg: colors.primaryLight, text: colors.primaryDark },
  PAYMENT_PENDING:      { bg: colors.primaryLight, text: colors.primaryDark },
  PAYMENT_FAILED:       { bg: colors.statusErrorBg, text: colors.statusError },
  CONFIRMED:            { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  DESIGNING:            { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  SOURCING:             { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  CUTTING:              { bg: colors.accentLight, text: colors.accent },
  SEWING:               { bg: colors.accentLight, text: colors.accent },
  FINISHING:            { bg: colors.accentLight, text: colors.accent },
  OUT_FOR_DELIVERY:     { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  SHIPPED:              { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  READY_FOR_COLLECTION: { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  DELIVERED:            { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  COLLECTED:            { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  COMPLETE:             { bg: colors.statusSuccessBg, text: colors.statusSuccess },
  PARTIALLY_REFUNDED:   { bg: colors.accentLight, text: colors.accent },
  IN_DISPUTE:           { bg: colors.statusErrorBg, text: colors.statusError },
  DECLINED:             { bg: colors.statusMutedBg, text: colors.textSecondary },
  EXPIRED:              { bg: colors.statusMutedBg, text: colors.textSecondary },
  CANCELLED:            { bg: colors.statusMutedBg, text: colors.textSecondary },
  REFUNDED:             { bg: colors.statusMutedBg, text: colors.textSecondary },
}

const FALLBACK = { bg: colors.statusMutedBg, text: colors.textSecondary }

export function stageColor(stage: string) {
  return STAGE_COLORS[stage] ?? FALLBACK
}
