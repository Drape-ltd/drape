'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { AccountRouteRuntime } from '../account-route-runtime'
import {
  MeasurementsContent,
  type CustomerProfile,
  type MeasurementProfile,
  type MeasurementScan,
  type MeasurementsRenderData,
} from './measurements-content'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: MeasurementsRenderData }
  | { status: 'error'; message: string }

async function loadMeasurements(userId: string): Promise<MeasurementsRenderData> {
  const supabase = createClient()
  const [profilesResult, scansResult, customerResult] = await Promise.all([
    supabase.from('customer_measurement_profiles').select('id, label, relationship, source, unit_preference, measurements, is_default, last_measured_at, updated_at').eq('customer_id', userId).order('is_default', { ascending: false }).order('updated_at', { ascending: false }).limit(20),
    supabase.from('measurement_scans').select('id, capture_method, status, confidence_overall, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(12),
    supabase.from('customer_profiles').select('user_id, display_name, measurements, unit_preference, updated_at').eq('user_id', userId).maybeSingle(),
  ])
  if (profilesResult.error || scansResult.error || customerResult.error) {
    throw new Error('Your measurement records could not load. Refresh to retry; nothing has been changed.')
  }
  return {
    userId,
    measurementProfiles: (profilesResult.data ?? []) as MeasurementProfile[],
    measurementScans: (scansResult.data ?? []) as MeasurementScan[],
    customerProfile: (customerResult.data ?? null) as CustomerProfile | null,
    warning: null,
  }
}

function MeasurementsRouteContent({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) setState((current) => current.status === 'ready' ? current : { status: 'loading' }) })
    void loadMeasurements(userId)
      .then((data) => { if (active) setState({ status: 'ready', data }) })
      .catch((error) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'Measurements could not load.' }) })
    return () => { active = false }
  }, [revision, userId])

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const queueRefresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 180)
    }
    const channel = supabase
      .channel(`web-measurements:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_measurement_profiles', filter: `customer_id=eq.${userId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'measurement_scans', filter: `user_id=eq.${userId}` }, queueRefresh)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [refresh, userId])

  if (state.status === 'loading') return <section className="app-surface p-7" aria-busy="true"><p className="text-sm font-semibold text-ink/60">Loading measurements…</p></section>
  if (state.status === 'error') return <section className="app-surface p-7" role="alert"><h2 className="text-2xl font-semibold text-ink">Measurements unavailable</h2><p className="mt-2 text-sm leading-6 text-ink/62">{state.message}</p><button type="button" onClick={refresh} className="mt-5 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white">Try again</button></section>
  return <MeasurementsContent data={state.data} onRefresh={refresh} />
}

export function MeasurementsWorkspace() {
  return <AccountRouteRuntime surface="measurements">{({ session }) => <MeasurementsRouteContent userId={session.user.id} />}</AccountRouteRuntime>
}
