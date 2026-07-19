'use client'

import { useEffect, useState, type JSX } from 'react'
import Link from 'next/link'
import type { Route } from 'next'

const DISMISSED_KEY_BASE = 'drape_getting_started_dismissed_v1'

type CheckItem = {
  label: string
  detail: string
  href: Route
  done: boolean
}

type Props = {
  role: 'CUSTOMER' | 'TAILOR' | null
  userId: string | null
  hasCustomerProfile: boolean
  hasMeasurements: boolean
  hasCustomerOrder: boolean
  hasTailorProfileComplete: boolean
  hasPayoutVerified: boolean
  hasSellerItem: boolean
  hasTailorOrder: boolean
}

function CheckRow({ item }: { item: CheckItem }) {
  return (
    <Link
      href={item.href}
      className="flex min-h-[3.25rem] items-center gap-3 rounded-lg border border-ink/6 bg-white px-3 py-2 transition hover:bg-bone/60"
    >
      <div
        className={[
          'grid size-6 shrink-0 place-items-center rounded-full border text-[0.7rem] font-bold',
          item.done
            ? 'border-needle/30 bg-needle/10 text-needle'
            : 'border-ink/12 bg-bone text-ink/32',
        ].join(' ')}
      >
        {item.done ? '✓' : '○'}
      </div>
      <div className="min-w-0 flex-1">
        <p className={['text-sm font-semibold', item.done ? 'text-ink/48 line-through' : 'text-ink'].join(' ')}>
          {item.label}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink/48">{item.detail}</p>
      </div>
      {!item.done && (
        <svg className="size-4 shrink-0 text-ink/28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      )}
    </Link>
  )
}

export function GettingStartedCard({
  role,
  userId,
  hasCustomerProfile,
  hasMeasurements,
  hasCustomerOrder,
  hasTailorProfileComplete,
  hasPayoutVerified,
  hasSellerItem,
  hasTailorOrder,
}: Props): JSX.Element | null {
  const [dismissed, setDismissed] = useState(true)
  const [open, setOpen] = useState(true)

  const dismissedKey = userId ? `${DISMISSED_KEY_BASE}_${userId}` : DISMISSED_KEY_BASE

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDismissed(localStorage.getItem(dismissedKey) === '1')
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [dismissedKey])

  function dismiss() {
    localStorage.setItem(dismissedKey, '1')
    setDismissed(true)
  }

  const customerItems: CheckItem[] = [
    {
      label: 'Set up your profile',
      detail: 'Add your name, phone, and garment preferences',
      href: '/account/settings' as Route,
      done: hasCustomerProfile,
    },
    {
      label: 'Add your measurements',
      detail: 'Use Drapeon Vision in the app or enter manually',
      href: '/account/measurements' as Route,
      done: hasMeasurements,
    },
    {
      label: 'Place your first order',
      detail: 'Browse tailors and send a custom brief',
      href: '/discover' as Route,
      done: hasCustomerOrder,
    },
  ]

  const tailorItems: CheckItem[] = [
    {
      label: 'Complete your profile',
      detail: 'Finish identity, portfolio, and selling setup',
      href: '/account/profile' as Route,
      done: hasTailorProfileComplete,
    },
    {
      label: 'Set up payouts',
      detail: 'Connect a payout account so earnings can release',
      href: '/account/payout' as Route,
      done: hasPayoutVerified,
    },
    {
      label: 'Add a ready-made item',
      detail: 'Help customers understand your taste before briefing',
      href: '/account/shop' as Route,
      done: hasSellerItem,
    },
    {
      label: 'Receive your first order',
      detail: 'Your profile goes live after ID review',
      href: '/account/orders' as Route,
      done: hasTailorOrder,
    },
  ]

  const items = role === 'TAILOR' ? tailorItems : customerItems
  const doneCount = items.filter((item) => item.done).length
  const allDone = doneCount === items.length

  if (dismissed || allDone || !role) return null

  return (
    <div className="rounded-lg border border-ink/8 bg-white/88 p-4 shadow-[0_10px_34px_rgba(22,28,24,0.05)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="flex items-center gap-2 text-left"
            aria-expanded={open}
          >
            <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Getting started</p>
            <svg
              className={['size-3.5 text-ink/40 transition-transform', open ? 'rotate-180' : ''].join(' ')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="grid size-7 place-items-center rounded-full border border-ink/8 bg-bone text-ink/40 transition hover:bg-ink/8 hover:text-ink/70"
          aria-label="Dismiss getting started"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {open && (
        <>
          <div className="mt-2 flex items-baseline gap-1.5">
            <p className="text-xl font-semibold text-ink">
              {doneCount === 0
                ? role === 'TAILOR'
                  ? "Set up your tailor workspace."
                  : "Get ready for your first order."
                : `${doneCount} of ${items.length} done.`}
            </p>
          </div>
          <p className="mt-1 text-sm leading-5 text-ink/58">
            {role === 'TAILOR'
              ? 'Complete these steps to go live and start earning.'
              : 'A few quick steps before you place your first order.'}
          </p>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink/6">
            <div
              className="h-full rounded-full bg-needle transition-all duration-500"
              style={{ width: `${(doneCount / items.length) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink/40">
            {items.length - doneCount} step{items.length - doneCount === 1 ? '' : 's'} remaining
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {items.map((item) => (
              <CheckRow key={item.label} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
