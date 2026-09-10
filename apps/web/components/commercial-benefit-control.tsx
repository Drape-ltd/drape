'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatMoney } from '@drape/shared'
import { createClient } from '../lib/supabase'
import { Button } from './ui/button'

export type WebBenefitReservation = {
  id: string
  total_benefit_amount: number
  customer_due_amount: number
  currency: string
  expires_at: string
}
type WebBenefitGrant = {
  id: string
  reason: string
  remaining_amount: number | null
  currency: string | null
}

async function responseMessage(error: unknown) {
  try {
    const response = (error as { context?: Response }).context
    const payload = response ? await response.clone().json() as { message?: string; error?: string } : null
    return payload?.message || payload?.error || null
  } catch {
    return null
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke('commercial-benefit-action', { body })
  if (error) throw new Error((await responseMessage(error)) || 'This benefit could not be updated. Try again.')
  if (data?.error) throw new Error(String(data.message || data.error))
  return (data ?? {}) as T
}

export function CommercialBenefitControl({
  orderId,
  onChanged,
}: {
  orderId: string
  onChanged?: (reservation: WebBenefitReservation | null) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const changedRef = useRef(onChanged)
  const inFlight = useRef(false)
  const [code, setCode] = useState('')
  const [active, setActive] = useState<WebBenefitReservation | null>(null)
  const [grants, setGrants] = useState<WebBenefitGrant[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => { changedRef.current = onChanged }, [onChanged])

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('commercial_benefit_reservations')
      .select('id,total_benefit_amount,customer_due_amount,currency,expires_at')
      .eq('order_id', orderId)
      .eq('status', 'RESERVED')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const reservation = (data ?? null) as WebBenefitReservation | null
    setActive(reservation)
    changedRef.current?.(reservation)
  }, [orderId, supabase])

  useEffect(() => {
    let activeEffect = true
    const load = async () => {
      try {
        const result = await invoke<{ grants?: WebBenefitGrant[] }>({ action: 'list' })
        if (activeEffect) setGrants(result.grants ?? [])
        await refresh()
      } catch {
        if (activeEffect) setGrants([])
      }
    }
    void load()
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { activeEffect = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  async function reserve(source: { code?: string; grantId?: string }) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    try {
      await invoke({
        action: 'reserve', orderId, ...source,
        idempotencyKey: `web:benefit:${orderId}:${source.code ?? source.grantId}:${crypto.randomUUID()}`,
      })
      setCode('')
      await refresh()
      setNotice({ tone: 'success', text: 'Applied. Your amount due has been updated.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'This benefit could not be applied.' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function release() {
    if (!active || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    try {
      await invoke({ action: 'release', reservationId: active.id })
      await refresh()
      setNotice({ tone: 'success', text: 'Removed. Your original amount due is restored.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'This benefit could not be removed.' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section className="mt-5 rounded-[8px] border border-ui-border bg-ui-canvas p-4" aria-labelledby="checkout-benefit-title">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">Promotion or Drapeon credit</p>
      <h2 id="checkout-benefit-title" className="mt-1 text-lg font-semibold text-ink">Apply before payment</h2>
      {notice ? <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-[8px] p-3 text-sm ${notice.tone === 'error' ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}>{notice.text}</p> : null}
      {active ? (
        <div className="mt-3 rounded-[8px] border border-needle/15 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-needle">{formatMoney(active.total_benefit_amount, active.currency)} covered</p>
              <p className="mt-1 text-sm text-ink/60">{active.customer_due_amount === 0 ? 'No payment is due.' : `${formatMoney(active.customer_due_amount, active.currency)} remains to pay.`}</p>
            </div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void release()}>{busy ? 'Updating…' : 'Remove'}</Button>
          </div>
          <p className="mt-3 text-xs text-ink/48">The tailor still receives the full protected seller amount.</p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input aria-label="Promotion code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Promotion code" className="h-10 min-w-0 flex-1 rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15" />
            <Button disabled={busy || code.trim().length < 3} onClick={() => void reserve({ code: code.trim() })}>{busy ? 'Applying…' : 'Apply'}</Button>
          </div>
          {grants.length ? <div className="mt-3 grid gap-2">{grants.map((grant) => (
            <button type="button" key={grant.id} disabled={busy} onClick={() => void reserve({ grantId: grant.id })} className="flex items-center justify-between rounded-[8px] border border-ui-border bg-white p-3 text-left disabled:opacity-50">
              <span><strong className="block text-sm text-ink">{grant.reason}</strong><span className="text-xs text-ink/52">Available account credit</span></span>
              <span className="text-sm font-semibold text-needle">{grant.remaining_amount != null && grant.currency ? formatMoney(grant.remaining_amount, grant.currency) : 'Apply'}</span>
            </button>
          ))}</div> : null}
        </>
      )}
    </section>
  )
}
