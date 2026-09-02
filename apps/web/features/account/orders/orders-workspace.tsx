'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'
import { OrdersContent, type AccountMessage, type AccountOrder, type AccountPayment, type OrdersData, type OrderParty } from './orders-content'

const orderSelect = 'id, order_kind, garment_type, item_title, stage, delivery_method, quoted_amount, total_amount, currency, quoted_currency, created_at, updated_at, customer_id, tailor_id, tailor_profile_id, seller_item_id, tailor_profiles!tailor_profile_id(display_name, business_name)'
type LoadState = { status: 'loading' } | { status: 'ready'; data: OrdersData } | { status: 'error'; message: string }
function unique(values: Array<string | null>) { return [...new Set(values.filter((value): value is string => Boolean(value)))] }

async function loadOrders(userId: string): Promise<OrdersData> {
  const supabase = createClient()
  const tailorResult = await supabase.from('tailor_profiles').select('id').eq('user_id', userId).maybeSingle()
  if (tailorResult.error) throw new Error('Your order role could not be confirmed.')
  const tailorProfileId = (tailorResult.data as { id?: string } | null)?.id ?? null
  const filter = tailorProfileId ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}` : `customer_id.eq.${userId},tailor_id.eq.${userId}`
  const ordersResult = await supabase.from('orders').select(orderSelect).or(filter).order('created_at', { ascending: false }).limit(40)
  if (ordersResult.error) throw new Error('Order history could not load. Refresh to retry.')
  let orders = (ordersResult.data ?? []) as unknown as AccountOrder[]
  const customerIds = unique(orders.map((order) => order.customer_id))
  if (customerIds.length) {
    const customersResult = await supabase.from('customer_profiles').select('user_id, display_name').in('user_id', customerIds)
    if (!customersResult.error) {
      const customers = new Map(((customersResult.data ?? []) as Array<{ user_id: string; display_name: string | null }>).map((profile) => [profile.user_id, { display_name: profile.display_name } satisfies OrderParty]))
      orders = orders.map((order) => ({ ...order, customer_profiles: order.customer_id ? customers.get(order.customer_id) ?? null : null }))
    }
  }
  const ids = orders.map((order) => order.id)
  if (!ids.length) return { userId, tailorProfileId, orders, payments: [], messages: [], consultationAttendanceReviews: [] }
  const [paymentsResult, messagesResult, reviewsResult] = await Promise.all([
    supabase.from('order_payments').select('order_id, status, created_at').in('order_id', ids).order('created_at', { ascending: false }).limit(80),
    supabase.from('messages').select('order_id, body, photo_url, voice_url, created_at').in('order_id', ids).order('created_at', { ascending: false }).limit(100),
    supabase.from('consultation_attendance_reviews').select('order_id, status, reported_by_role, resolution_code, created_at').in('order_id', ids).order('created_at', { ascending: false }),
  ])
  if (paymentsResult.error || messagesResult.error || reviewsResult.error) throw new Error('Latest order updates could not load. Refresh to retry.')
  return {
    userId, tailorProfileId, orders,
    payments: (paymentsResult.data ?? []) as AccountPayment[],
    messages: (messagesResult.data ?? []) as AccountMessage[],
    consultationAttendanceReviews: ((reviewsResult.data ?? []) as Array<{ order_id: string; status: string | null; reported_by_role: 'CUSTOMER' | 'TAILOR' | null; resolution_code: string | null; created_at: string }>).map((review) => ({ orderId: review.order_id, status: review.status, reportedByRole: review.reported_by_role, resolutionCode: review.resolution_code, createdAt: review.created_at })),
  }
}

function OrdersRoute({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => { let active = true; void loadOrders(userId).then((data) => { if (active) setState({ status: 'ready', data }) }).catch((error) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Orders could not load.' }) }); return () => { active = false } }, [revision, userId])
  useEffect(() => {
    if (state.status !== 'ready') return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 180) }
    const channel = supabase.channel(`web-orders:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${userId}` }, queue)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tailor_id=eq.${userId}` }, queue)
    if (state.data.tailorProfileId) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tailor_profile_id=eq.${state.data.tailorProfileId}` }, queue)
    const orderIds = state.data.orders.map((order) => order.id).slice(0, 40)
    if (orderIds.length) {
      const filter = `order_id=in.(${orderIds.join(',')})`
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_payments', filter }, queue)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter }, queue)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'consultation_attendance_reviews', filter }, queue)
    }
    channel.subscribe()
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel) }
  }, [refresh, state, userId])
  if (state.status === 'loading') return <section className="app-surface p-7" aria-busy="true"><p className="text-sm font-semibold text-ink/60">Loading orders…</p></section>
  if (state.status === 'error') return <section className="app-surface p-7" role="alert"><h2 className="text-2xl font-semibold text-ink">Orders unavailable</h2><p className="mt-2 text-sm leading-6 text-ink/62">{state.message} Your records have not been changed.</p><button type="button" onClick={refresh} className="mt-5 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white">Try again</button></section>
  return <OrdersContent data={state.data} />
}

export function OrdersWorkspace() { return <AccountRouteRuntime surface="orders">{({ session }) => <OrdersRoute userId={session.user.id} />}</AccountRouteRuntime> }
