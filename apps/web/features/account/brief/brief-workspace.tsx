'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'
import {
  BriefForm,
  type BriefCustomerProfile,
  type BriefMeasurementProfile,
  type BriefRenderData,
  type BriefTailorProfile,
} from './brief-form'

const publicTailorProfileSelect =
  'id, user_id, display_name, business_name, location, specialty_tags, currency, availability, accepts_custom_orders_now, shop_paused, is_live, supports_custom_orders, pickup_available, delivery_available, shipping_available, portfolio_photo_urls, avatar_url'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: BriefRenderData }
  | { status: 'error'; message: string }

async function loadBrief(userId: string, tailorId: string): Promise<BriefRenderData> {
  const supabase = createClient()
  const [tailorResult, measurementsResult, customerResult, accountResult] = await Promise.all([
    supabase.from('tailor_profiles').select(publicTailorProfileSelect).eq('id', tailorId).maybeSingle(),
    supabase.from('customer_measurement_profiles').select('id, label, relationship, source, unit_preference, measurements, is_default, last_measured_at, updated_at').eq('customer_id', userId).order('is_default', { ascending: false }).order('updated_at', { ascending: false }).limit(10),
    supabase.from('customer_profiles').select('user_id, display_name, measurements, unit_preference, updated_at').eq('user_id', userId).maybeSingle(),
    supabase.from('users').select('default_currency').eq('id', userId).maybeSingle(),
  ])

  if (tailorResult.error) throw new Error('The tailor profile could not load. Refresh to retry.')
  if (measurementsResult.error || customerResult.error) throw new Error('Your measurement context could not load. Refresh to retry.')
  if (accountResult.error) throw new Error('Your account currency could not load. Refresh to retry.')

  return {
    tailor: (tailorResult.data ?? null) as BriefTailorProfile | null,
    measurementProfiles: (measurementsResult.data ?? []) as BriefMeasurementProfile[],
    customerProfile: (customerResult.data ?? null) as BriefCustomerProfile | null,
    accountCurrency: (accountResult.data as { default_currency?: string | null } | null)?.default_currency ?? null,
    userId,
    warning: null,
  }
}

function BriefContent({ userId, tailorId }: { userId: string; tailorId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) setState({ status: 'loading' }) })
    void loadBrief(userId, tailorId)
      .then((data) => { if (active) setState({ status: 'ready', data }) })
      .catch((error) => {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'The custom brief could not load.' })
      })
    return () => { active = false }
  }, [revision, tailorId, userId])

  if (state.status === 'loading') {
    return <section className="app-surface p-7" aria-busy="true"><p className="text-sm font-semibold text-ink/60">Loading your custom brief…</p></section>
  }
  if (state.status === 'error') {
    return <section className="app-surface p-7" role="alert"><h2 className="text-2xl font-semibold text-ink">Custom brief unavailable</h2><p className="mt-2 text-sm leading-6 text-ink/62">{state.message}</p><button type="button" onClick={refresh} className="mt-5 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white">Try again</button></section>
  }
  return <BriefForm data={state.data} tailorId={tailorId} onRefresh={refresh} />
}

export function BriefWorkspace({ tailorId }: { tailorId: string }) {
  return <AccountRouteRuntime surface="brief">{({ session }) => <BriefContent userId={session.user.id} tailorId={tailorId} />}</AccountRouteRuntime>
}
