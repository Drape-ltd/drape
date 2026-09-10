'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'

const PAYMENT_RETURN_KEY = 'drapeon:payment-return'

type PaymentReturn = { orderId: string; returnTo: Route }

function buildAppUrl(reference: string | null, status: string | null) {
  const params = new URLSearchParams()
  if (reference) {
    params.set('reference', reference)
    params.set('trxref', reference)
  }
  if (status) params.set('status', status)
  const query = params.toString()
  return `drape:///paystack-redirect${query ? `?${query}` : ''}`
}

function readStoredReturn(): PaymentReturn | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PAYMENT_RETURN_KEY) ?? '') as Partial<PaymentReturn>
    if (!value.orderId || value.returnTo !== `/account/orders/${value.orderId}`) return null
    return { orderId: value.orderId, returnTo: value.returnTo as Route }
  } catch {
    return null
  }
}

export default function PaystackCallbackPage(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const reference = searchParams.get('reference') ?? searchParams.get('trxref')
  const status = searchParams.get('status')
  const appUrl = useMemo(() => buildAppUrl(reference, status), [reference, status])
  const [accountReturn, setAccountReturn] = useState<PaymentReturn | null>(null)
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function resolveReturn() {
      const stored = readStoredReturn()
      const supabase = createClient()
      const { data: auth } = await supabase.auth.getUser()
      let resolved = stored

      if (!resolved && auth.user && reference && /^[A-Za-z0-9_-]+$/u.test(reference)) {
        const { data: order } = await supabase
          .from('orders')
          .select('id')
          .eq('customer_id', auth.user.id)
          .or(`payment_intent_id.eq.${reference},fulfillment_payment_intent_id.eq.${reference}`)
          .maybeSingle()
        if (order?.id) resolved = { orderId: order.id, returnTo: `/account/orders/${order.id}` as Route }
      }

      if (cancelled) return
      setAccountReturn(resolved)
      setResolving(false)
      if (!resolved) return

      window.sessionStorage.removeItem(PAYMENT_RETURN_KEY)
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: 'drapeon:payment-return', orderId: resolved.orderId, reference, status },
          window.location.origin
        )
        window.close()
        return
      }
      router.replace(resolved.returnTo)
    }
    void resolveReturn()
    return () => { cancelled = true }
  }, [reference, router, status])

  if (resolving || accountReturn) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Payment received</p>
        <h1 className="font-display text-3xl text-ink">Returning to your order</h1>
        <p className="text-sm leading-6 text-ink/60">We are confirming the provider result and refreshing your Drapeon receipt.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Payment return</p>
      <h1 className="font-display text-3xl text-ink">Continue securely</h1>
      <p className="text-sm leading-6 text-ink/60">Sign in to review the order receipt, or return to the Drapeon app if you started there.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/sign-in" className="rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">Sign in</Link>
        <a href={appUrl} className="rounded-full border border-ink/14 bg-white px-5 py-3 text-sm font-semibold text-ink">Open app</a>
      </div>
      {reference ? <p className="text-xs text-ink/45">Reference: {reference}</p> : null}
    </main>
  )
}
