'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'
import { WorkContent, type WorkData, type WorkOrder, type WorkTailor } from './work-content'

const profileSelect = 'id, user_id, display_name, business_name, availability, is_live, is_verified, total_orders, profile_completed, id_verification_status, payout_provider, payout_reverification_required, payout_account_verified'
const orderSelect = 'id, order_kind, garment_type, item_title, stage, total_amount, quoted_amount, currency, quoted_currency, updated_at, created_at, customer_id, tailor_id, tailor_profile_id'
type State = { status: 'loading' } | { status: 'ready'; data: WorkData } | { status: 'error'; message: string }

async function loadWork(userId: string): Promise<WorkData> {
  const supabase = createClient()
  const profileResult = await supabase.from('tailor_profiles').select(profileSelect).eq('user_id', userId).maybeSingle()
  if (profileResult.error) throw new Error('Tailor readiness could not load.')
  const tailor = (profileResult.data ?? null) as WorkTailor | null
  if (!tailor) return { userId, tailor: null, orders: [] }
  const ordersResult = await supabase.from('orders').select(orderSelect).or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailor.id}`).order('created_at', { ascending: false }).limit(40)
  if (ordersResult.error) throw new Error('Your work queue could not load.')
  let orders = (ordersResult.data ?? []) as WorkOrder[]
  const customerIds = [...new Set(orders.map((order) => order.customer_id).filter((id): id is string => Boolean(id)))]
  if (customerIds.length) {
    const customersResult = await supabase.from('customer_profiles').select('user_id, display_name').in('user_id', customerIds)
    if (!customersResult.error) {
      const customers = new Map(((customersResult.data ?? []) as Array<{ user_id: string; display_name: string | null }>).map((profile) => [profile.user_id, { display_name: profile.display_name }]))
      orders = orders.map((order) => ({ ...order, customer_profiles: order.customer_id ? customers.get(order.customer_id) ?? null : null }))
    }
  }
  return { userId, tailor, orders }
}

function WorkRoute({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<State>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => { let active = true; void loadWork(userId).then((data) => { if (active) setState({ status: 'ready', data }) }).catch((error) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Work could not load.' }) }); return () => { active = false } }, [revision, userId])
  useEffect(() => { if (state.status !== 'ready' || !state.data.tailor) return; const supabase = createClient(); let timer: ReturnType<typeof setTimeout> | null = null; const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 180) }; const tailor = state.data.tailor; const channel = supabase.channel(`web-work:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tailor_profiles', filter: `id=eq.${tailor.id}` }, queue).on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tailor_id=eq.${userId}` }, queue).on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tailor_profile_id=eq.${tailor.id}` }, queue).subscribe(); return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel) } }, [refresh, state, userId])
  if (state.status === 'loading') return <section className="app-surface p-7" aria-busy="true"><p className="text-sm font-semibold text-ink/60">Loading your work queue…</p></section>
  if (state.status === 'error') return <section className="app-surface p-7" role="alert"><h2 className="text-2xl font-semibold text-ink">Work queue unavailable</h2><p className="mt-2 text-sm text-ink/62">{state.message} Nothing has been changed.</p><button type="button" onClick={refresh} className="mt-5 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white">Try again</button></section>
  return <WorkContent data={state.data} />
}

export function WorkWorkspace() { return <AccountRouteRuntime surface="work">{({ session }) => <WorkRoute userId={session.user.id} />}</AccountRouteRuntime> }
