import {
  PAYOUT_BLOCKED_REASONS,
  payoutBlockReasonMessage,
  resolvePayoutMoney,
} from '../../../packages/shared/src/payout-gating.ts'
import {
  hasPayoutWindowClosed,
  PAYOUT_DISPUTE_WINDOW_HOURS,
  payoutWindowClosesAt,
} from '../../../packages/shared/src/payout-timing.ts'

export type PayoutBlockedReason = typeof PAYOUT_BLOCKED_REASONS[keyof typeof PAYOUT_BLOCKED_REASONS]

export type PayoutCandidateOrder = {
  id: string
  reference?: string | null
  stage: string
  order_kind?: string | null
  tailor_id?: string | null
  customer_id?: string | null
  currency?: string | null
  source_currency?: string | null
  source_amount?: number | null
  subtotal_amount?: number | null
  tailor_payout_currency_locked?: string | null
  tailor_payout_provider_locked?: 'STRIPE' | 'PAYSTACK' | null
  tailor_paystack_recipient_code_locked?: string | null
  tailor_stripe_connect_account_id_locked?: string | null
  ops_payout_resolution_mode?: 'ORIGINAL_CURRENCY' | 'CONVERT_TO_CURRENT' | 'REFUND_CUSTOMER' | null
  ops_payout_override_currency?: string | null
  ops_payout_override_provider?: 'STRIPE' | 'PAYSTACK' | null
  ops_payout_override_amount?: number | null
  ops_payout_override_fx_rate?: number | null
  ops_payout_override_fx_rate_timestamp?: string | null
  ops_payout_override_note?: string | null
  platform_fee_amount?: number | null
  tax_amount?: number | null
  shipping_amount?: number | null
  total_amount?: number | null
  escrow_released?: boolean | null
  handoff_completed_at?: string | null
  customer_handoff_confirmed_at?: string | null
  handoff_confirmation_source?: string | null
}

export type TailorPayoutProfile = {
  id: string
  user_id: string
  display_name?: string | null
  payout_currency?: string | null
  payout_provider?: 'STRIPE' | 'PAYSTACK' | null
  payout_reverification_required?: boolean | null
  payout_account_verified?: boolean | null
  payout_account_type?: 'STRIPE_CONNECT' | 'PAYSTACK' | null
  payout_destination_hold_until?: string | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
}

export type SuccessfulOrderPayment = {
  id: string
  order_id: string
  phase: 'INITIAL_ORDER' | 'CONSULTATION' | 'FULFILLMENT'
  provider: 'STRIPE' | 'PAYSTACK'
  currency: string
  amount: number
  status: 'SUCCEEDED' | 'PARTIAL_REFUND' | 'REFUNDED'
  provider_payment_id?: string | null
  refunded_amount?: number | null
}

export { hasPayoutWindowClosed }
