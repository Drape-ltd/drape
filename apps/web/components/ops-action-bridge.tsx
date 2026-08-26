'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type OpsActionResponse = {
  redirectTo?: string
}

type OpsActionFeedback = {
  id: string
  tone: 'pending' | 'success' | 'error'
  message: string
  actionHref?: Route
  actionLabel?: string
}

const ACTION_NOTICE_COPY: Record<string, string> = {
  'money-desk-elevated': 'Elevation active for 15 minutes.',
  'money-desk-requested': 'Money action submitted for independent approval.',
  'money-desk-approved': 'Independent approval recorded.',
  'money-desk-rejected': 'Money action rejected and closed.',
  'money-desk-executed': 'Money action completed successfully.',
  'money-desk-processing': 'Provider processing started. The terminal outcome is still being monitored.',
  'dispute-saved': 'Dispute status updated.',
  'consultation-reschedule-recorded': 'Consultation resolved. Both people can choose another time, and the fee remains protected.',
  'consultation-money-decision-prepared': 'Attendance decision recorded and sent to Money Desk for independent approval.',
  'dispatch-quote-saved': 'Provider quote saved. Funding and customer follow-up are being tracked.',
  'dispatch-event-saved': 'Delivery update saved and sent to both order participants.',
}

const ACTION_ERROR_COPY: Record<string, Pick<OpsActionFeedback, 'message' | 'actionHref' | 'actionLabel'>> = {
  'money-desk-elevation-required': {
    message: 'Start a fresh 15-minute Money Desk elevation, then retry this protected action.',
    actionHref: '/ops?view=money-desk#money-desk' as Route,
    actionLabel: 'Open Money Desk',
  },
  'money-desk-request-invalid': {
    message: 'This money action is missing a valid target or has an incomplete amount and currency.',
  },
  'money-desk-action-failed': {
    message: 'The protected Money Desk action did not complete. Review the request and try again.',
    actionHref: '/ops?view=money-desk#money-desk' as Route,
    actionLabel: 'Review Money Desk',
  },
  'payout-change-review-unavailable': {
    message: 'This payout change is no longer waiting for review. Refresh the issue to see its current outcome.',
  },
  'payout-change-request-not-found': {
    message: 'The payout change request could not be found. Refresh the issue before taking another action.',
  },
  'dispatch-custody-proof-required': {
    message: 'Record provider acceptance or parcel collection with photo proof before marking this order delivered.',
  },
  'dispatch-photo-proof-required': {
    message: 'A clear handoff or delivery photo is required for this update.',
  },
  'dispatch-funding-not-ready': {
    message: 'Complete the provider quote and any required customer payment before booking dispatch.',
  },
  'dispatch-method-mismatch': {
    message: 'This update does not match the order’s current pickup or delivery method.',
  },
  'dispatch-location-invalid': {
    message: 'The delivery location is incomplete. Enter a location name or a complete coordinate pair.',
  },
  'dispatch-eta-invalid': {
    message: 'Choose a valid estimated arrival date and time.',
  },
  'dispatch-proof-invalid': {
    message: 'Use a supported delivery-proof image smaller than 8 MB.',
  },
  'dispatch-event-save-failed': {
    message: 'The delivery update was not saved. Review the current step and required proof, then try again.',
  },
}

function getActionErrorFeedback(errorKey: string, errorDetail: string | null) {
  const configured = ACTION_ERROR_COPY[errorKey]
  return {
    message: errorDetail || configured?.message || 'This Ops action could not be completed. Refresh the issue and try again.',
    actionHref: configured?.actionHref,
    actionLabel: configured?.actionLabel,
  }
}

function isOpsActionForm(form: HTMLFormElement) {
  const action = new URL(form.action, window.location.href)
  return form.method.toLowerCase() === 'post' && action.pathname === '/ops/action'
}

type OpsActionBridgeProps = {
  initialNotice?: string | null
  initialError?: string | null
  initialErrorDetail?: string | null
}

function cleanFeedbackParams(location: string) {
  const url = new URL(location, window.location.href)
  url.searchParams.delete('notice')
  url.searchParams.delete('error')
  url.searchParams.delete('errorDetail')
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
}

export function OpsActionBridge({ initialNotice, initialError, initialErrorDetail }: OpsActionBridgeProps) {
  const router = useRouter()
  const [feedbacks, setFeedbacks] = useState<OpsActionFeedback[]>(() => [
    ...(initialNotice ? [{ id: 'route-notice', tone: 'success' as const, message: initialNotice }] : []),
    ...(initialError ? [{ id: 'route-error', tone: 'error' as const, message: initialErrorDetail ? `${initialError} ${initialErrorDetail}` : initialError }] : []),
  ])
  const dismissTimers = useRef(new Map<string, number>())
  const actionSequence = useRef(0)

  const upsertFeedback = (feedback: OpsActionFeedback) => {
    setFeedbacks((current) => [...current.filter((item) => item.id !== feedback.id), feedback].slice(-5))
  }

  const dismissFeedback = (id: string) => {
    const timer = dismissTimers.current.get(id)
    if (timer) window.clearTimeout(timer)
    dismissTimers.current.delete(id)
    setFeedbacks((current) => current.filter((item) => item.id !== id))
  }

  useEffect(() => {
    if (!initialNotice && !initialError) return
    window.history.replaceState(window.history.state, '', cleanFeedbackParams(window.location.href))
  }, [initialError, initialNotice])

  useEffect(() => {
    for (const feedback of feedbacks) {
      if (feedback.tone !== 'success' || dismissTimers.current.has(feedback.id)) continue
      dismissTimers.current.set(feedback.id, window.setTimeout(() => dismissFeedback(feedback.id), 5000))
    }
  }, [feedbacks])

  useEffect(() => {
    const timers = dismissTimers.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  useEffect(() => {
    const handleSubmit = async (event: SubmitEvent) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || !isOpsActionForm(form)) return

      event.preventDefault()
      const submitter =
        event.submitter instanceof HTMLButtonElement || event.submitter instanceof HTMLInputElement
          ? event.submitter
          : null
      const formData = new FormData(form)
      if (submitter?.name) formData.append(submitter.name, submitter.value)
      actionSequence.current += 1
      const feedbackId = `action-${Date.now()}-${actionSequence.current}`

      submitter?.setAttribute('aria-busy', 'true')
      if (submitter) submitter.disabled = true
      upsertFeedback({ id: feedbackId, tone: 'pending', message: 'Saving this Ops action…' })

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        const payload = (await response.json()) as OpsActionResponse
        const nextLocation = payload.redirectTo || window.location.pathname + window.location.search
        const nextUrl = new URL(nextLocation, window.location.href)
        const noticeKey = nextUrl.searchParams.get('notice')
        const errorKey = nextUrl.searchParams.get('error')
        const errorDetail = nextUrl.searchParams.get('errorDetail')
        upsertFeedback(errorKey
          ? { id: feedbackId, tone: 'error', ...getActionErrorFeedback(errorKey, errorDetail) }
          : {
              id: feedbackId,
              tone: 'success',
              message: (noticeKey && ACTION_NOTICE_COPY[noticeKey]) || 'Ops action saved.',
            })
        router.replace(cleanFeedbackParams(nextLocation) as Route, { scroll: false })
      } catch {
        upsertFeedback({ id: feedbackId, tone: 'error', message: 'The live update failed. Retrying with a full page submission…' })
        form.submit()
      } finally {
        submitter?.removeAttribute('aria-busy')
        if (submitter) submitter.disabled = false
      }
    }

    document.addEventListener('submit', handleSubmit)
    return () => document.removeEventListener('submit', handleSubmit)
  }, [router])

  if (feedbacks.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[110] flex flex-col items-end gap-2 sm:left-auto sm:w-[28rem]" aria-label="Ops notifications">
      {feedbacks.map((feedback) => {
        const toneClass = feedback.tone === 'error'
          ? 'border-rust/24 text-rust-700'
          : feedback.tone === 'success'
            ? 'border-needle/24 text-needle-700'
            : 'border-ink/12 text-ink/72'
        return (
          <div
            key={feedback.id}
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            className={`pointer-events-auto flex w-full items-start gap-3 rounded-[8px] border bg-white px-5 py-4 text-sm font-semibold leading-6 shadow-[0_18px_60px_rgba(22,28,24,0.20)] ${toneClass}`}
          >
            <div className="min-w-0 flex-1">
              <p>{feedback.message}</p>
              {feedback.actionHref && feedback.actionLabel ? (
                <Link
                  href={feedback.actionHref}
                  onClick={() => dismissFeedback(feedback.id)}
                  className="mt-2 inline-flex cursor-pointer items-center rounded-full border border-current/18 bg-white px-3 py-1.5 text-xs font-semibold text-current transition-colors duration-200 hover:bg-bone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35"
                >
                  {feedback.actionLabel}
                </Link>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismissFeedback(feedback.id)}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-current/15 bg-white text-current transition-colors duration-200 hover:bg-bone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35"
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
