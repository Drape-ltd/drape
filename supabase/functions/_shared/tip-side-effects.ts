import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueOrderEventEmailJob, enqueuePushJob, enqueueTipPayoutJob } from './side-effect-jobs.ts'

type ConfirmedTip = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  amount: number
  currency: string
}

function currencySymbol(currency: string) {
  switch (currency.trim().toUpperCase()) {
    case 'NGN': return '₦'
    case 'GHS': return '₵'
    case 'GBP': return '£'
    case 'EUR': return '€'
    case 'USD': return '$'
    case 'CAD': return 'CA$'
    case 'KES': return 'KSh '
    default: return `${currency.trim().toUpperCase()} `
  }
}

export function formatTipAmount(amount: number, currency: string) {
  const majorAmount = Number.isFinite(amount) ? amount / 100 : 0
  return `${currencySymbol(currency)}${majorAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export async function enqueueTipConfirmedSideEffects(supabase: SupabaseClient, tip: ConfirmedTip) {
  const { data: order, error } = await supabase.from('orders').select('id, reference, customer_id, tailor_id').eq('id', tip.order_id).single()
  if (error) throw error
  const amount = formatTipAmount(tip.amount, tip.currency)
  await Promise.all([
    enqueueTipPayoutJob(supabase, { tipId: tip.id, orderId: tip.order_id, idempotencyKey: tip.id, priority: 5 }),
    enqueuePushJob(supabase, { userId: tip.tailor_id, orderId: tip.order_id, source: 'tip-confirmation', idempotencyKey: `tip:${tip.id}:tailor:push`, priority: 20, notification: { title: `You received a ${amount} tip`, body: 'A customer thanked you. The full amount is yours and is queued for payout.', preferenceKey: 'paymentReleased', data: { orderId: tip.order_id, tipId: tip.id, amount: String(tip.amount), currency: tip.currency } } }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: tip.tailor_id, audience: 'TAILOR', subject: `You received a ${amount} tip`, headline: `You received a ${amount} tip`, body: `A customer thanked you with ${amount}. The full amount is yours, separate from the order price, and is now queued for payout.`, ctaLabel: 'View earnings', source: 'tip-confirmation', idempotencyKey: `tip:${tip.id}:tailor:email`, priority: 20 }),
    enqueuePushJob(supabase, { userId: tip.customer_id, orderId: tip.order_id, source: 'tip-confirmation', idempotencyKey: `tip:${tip.id}:customer:push`, priority: 20, notification: { title: `${amount} tip confirmed`, body: 'Your thank-you tip was confirmed and will go to the tailor in full.', preferenceKey: 'paymentConfirmations', data: { orderId: tip.order_id, tipId: tip.id, amount: String(tip.amount), currency: tip.currency } } }),
    enqueueOrderEventEmailJob(supabase, { order, recipientUserId: tip.customer_id, audience: 'CUSTOMER', subject: `${amount} Drapeon tip confirmed`, headline: `Your ${amount} tip is confirmed`, body: `Thank you for supporting your tailor. The ${amount} tip is recorded separately from the order and is owed to the tailor in full.`, ctaLabel: 'View order', source: 'tip-confirmation', idempotencyKey: `tip:${tip.id}:customer:email`, priority: 20 }),
  ])
}
